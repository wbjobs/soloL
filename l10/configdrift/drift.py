from __future__ import annotations

import asyncio
import difflib
import hashlib
import io
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Iterable, Iterator, Sequence

from .config import DriftConfig, FileExpectation, resolve_hosts
from .ssh_client import SSHConnectionPool, SSHResult


_MAX_DIFF_LINES = 1000
_LARGE_FILE_THRESHOLD = 10 * 1024 * 1024


class DriftStatus(str, Enum):
    OK = "OK"
    DRIFTED = "DRIFTED"
    MISSING = "MISSING"
    ERROR = "ERROR"


@dataclass
class DriftResult:
    host: str
    file_path: str
    status: DriftStatus
    actual_hash: str = ""
    expected_hash: str = ""
    diff_text: str = ""
    error: str = ""


@dataclass
class AuditReport:
    results: list[DriftResult] = field(default_factory=list)

    @property
    def ok_count(self) -> int:
        return sum(1 for r in self.results if r.status == DriftStatus.OK)

    @property
    def drifted_count(self) -> int:
        return sum(1 for r in self.results if r.status == DriftStatus.DRIFTED)

    @property
    def missing_count(self) -> int:
        return sum(1 for r in self.results if r.status == DriftStatus.MISSING)

    @property
    def error_count(self) -> int:
        return sum(1 for r in self.results if r.status == DriftStatus.ERROR)


def _md5_hash(content: str) -> str:
    return hashlib.md5(content.encode("utf-8")).hexdigest()


def _chunk_to_lines(chunk_iter: Iterable[bytes]) -> Iterator[str]:
    buffer = ""
    decoder = io.TextIOWrapper(io.BytesIO(), encoding="utf-8", errors="replace")
    for chunk in chunk_iter:
        buffer += chunk.decode("utf-8", errors="replace")
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            yield line + "\n"
    if buffer:
        yield buffer


def _streaming_line_diff(
    expected_iter: Iterable[str],
    actual_iter: Iterable[str],
    fromfile: str,
    tofile: str,
    max_lines: int = _MAX_DIFF_LINES,
) -> str:
    output: list[str] = [f"--- {fromfile}", f"+++ {tofile}"]
    count = 2
    line_num = 0

    expected_iter = iter(expected_iter)
    actual_iter = iter(actual_iter)

    while count < max_lines:
        line_num += 1
        try:
            exp_line = next(expected_iter)
        except StopIteration:
            exp_line = None
        try:
            act_line = next(actual_iter)
        except StopIteration:
            act_line = None

        if exp_line is None and act_line is None:
            break

        exp_stripped = exp_line.rstrip("\n") if exp_line else ""
        act_stripped = act_line.rstrip("\n") if act_line else ""

        if exp_line is None:
            output.append(f"+{act_stripped}")
            count += 1
        elif act_line is None:
            output.append(f"-{exp_stripped}")
            count += 1
        elif exp_stripped != act_stripped:
            output.append(f"@@ -{line_num},{line_num} +{line_num},{line_num} @@")
            output.append(f"-{exp_stripped}")
            output.append(f"+{act_stripped}")
            count += 3

    if count >= max_lines:
        output.append(f"\n... [diff truncated at {max_lines} lines to avoid OOM]")

    return "\n".join(output)


async def _collect_stream_lines(async_iter) -> list[str]:
    lines: list[str] = []
    async for chunk in async_iter:
        if isinstance(chunk, bytes):
            text = chunk.decode("utf-8", errors="replace")
        else:
            text = chunk
        buffer = text
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            lines.append(line + "\n")
        if buffer:
            lines.append(buffer)
    return lines


async def _async_stream_lines(async_iter) -> Iterator[str]:
    buffer = ""
    async for chunk in async_iter:
        if isinstance(chunk, bytes):
            text = chunk.decode("utf-8", errors="replace")
        else:
            text = chunk
        buffer += text
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            yield line + "\n"
    if buffer:
        yield buffer


def _sync_stream_to_async(sync_iter):
    class _AsyncIter:
        def __aiter__(self):
            self._iter = iter(sync_iter)
            return self

        async def __anext__(self):
            try:
                return next(self._iter)
            except StopIteration:
                raise StopAsyncIteration

    return _AsyncIter()


async def _streaming_diff_single_async(pool, config_dir, host, exp):
    expected_async = _sync_stream_to_async(exp.resolved_content_stream(config_dir))
    actual_async = pool.stream_remote_file(host, exp.path)

    expected_lines = _async_stream_lines(expected_async)
    actual_lines = _async_stream_lines(actual_async)

    output: list[str] = [f"--- expected/{exp.path}", f"+++ {host}:{exp.path}"]
    count = 2
    line_num = 0
    max_lines = _MAX_DIFF_LINES

    exp_line: str | None = None
    act_line: str | None = None
    exp_exhausted = False
    act_exhausted = False

    while count < max_lines:
        line_num += 1

        if not exp_exhausted:
            try:
                exp_line = await expected_lines.__anext__()
            except StopAsyncIteration:
                exp_exhausted = True
                exp_line = None

        if not act_exhausted:
            try:
                act_line = await actual_lines.__anext__()
            except StopAsyncIteration:
                act_exhausted = True
                act_line = None

        if exp_exhausted and act_exhausted:
            break

        exp_stripped = exp_line.rstrip("\n") if exp_line else ""
        act_stripped = act_line.rstrip("\n") if act_line else ""

        if exp_line is None:
            output.append(f"+{act_stripped}")
            count += 1
        elif act_line is None:
            output.append(f"-{exp_stripped}")
            count += 1
        elif exp_stripped != act_stripped:
            output.append(f"@@ -{line_num},{line_num} +{line_num},{line_num} @@")
            output.append(f"-{exp_stripped}")
            output.append(f"+{act_stripped}")
            count += 3

    if count >= max_lines:
        output.append(f"\n... [diff truncated at {max_lines} lines to avoid OOM]")

    return "\n".join(output)


class DriftDetector:
    def __init__(self, config: DriftConfig, config_dir: Path | None = None):
        self._config = config
        self._config_dir = config_dir or Path.cwd()
        self._pool = SSHConnectionPool(config.ssh, config.max_concurrency)
        self._git_content_cache: dict[str, str] | None = None

    def _expected_hash(self, exp: FileExpectation) -> str | None:
        if exp.hash:
            return exp.hash
        content = exp.resolved_content(self._config_dir)
        if content is not None:
            return _md5_hash(content)
        return None

    def _expected_content(self, exp: FileExpectation) -> str | None:
        content = exp.resolved_content(self._config_dir)
        if content is not None:
            return content
        if self._git_content_cache is not None:
            return self._git_content_cache.get(exp.path)
        return None

    async def audit(self) -> AuditReport:
        hosts = resolve_hosts(self._config, self._config_dir)
        report = AuditReport()

        for exp in self._config.expected:
            expected_hash = self._expected_hash(exp)
            if expected_hash is None:
                continue
            cmd = f"md5sum {exp.path} 2>/dev/null || echo '__MISSING__'"
            results = await self._pool.run_commands(hosts, cmd)

            for r in results:
                if not r.success and "__MISSING__" not in r.stdout:
                    report.results.append(DriftResult(
                        host=r.host, file_path=exp.path,
                        status=DriftStatus.ERROR, error=r.stderr,
                    ))
                    continue

                if "__MISSING__" in r.stdout:
                    report.results.append(DriftResult(
                        host=r.host, file_path=exp.path,
                        status=DriftStatus.MISSING, expected_hash=expected_hash,
                    ))
                    continue

                parts = r.stdout.strip().split()
                actual_hash = parts[0] if parts else ""
                status = DriftStatus.OK if actual_hash == expected_hash else DriftStatus.DRIFTED
                report.results.append(DriftResult(
                    host=r.host, file_path=exp.path, status=status,
                    actual_hash=actual_hash, expected_hash=expected_hash,
                ))

        return report

    async def _streaming_diff_single(self, host: str, exp: FileExpectation) -> str:
        return await _streaming_diff_single_async(self._pool, self._config_dir, host, exp)

    async def diff(self) -> AuditReport:
        report = await self.audit()

        drifted = [r for r in report.results if r.status == DriftStatus.DRIFTED]
        if not drifted:
            return report

        small_file_host_cmds: dict[str, str] = {}
        small_file_host_map: dict[str, list[DriftResult]] = {}
        large_file_tasks: list[tuple[DriftResult, FileExpectation]] = []

        for r in drifted:
            exp = next((e for e in self._config.expected if e.path == r.file_path), None)
            if exp is None:
                continue
            expected_content = self._expected_content(exp)
            if expected_content is None:
                continue

            file_size = exp.content_file_size(self._config_dir) or len(expected_content.encode("utf-8"))
            if file_size >= _LARGE_FILE_THRESHOLD:
                large_file_tasks.append((r, exp))
            else:
                tmp_path = f"/tmp/_configdrift_expected_{r.file_path.replace('/', '_')}"
                escaped = expected_content.replace("'", "'\\''")
                marker = f"__DIFF_MARKER_{r.file_path.replace('/', '_')}__"
                cmd = f"echo -n '{escaped}' | sudo tee {tmp_path} > /dev/null && echo '{marker}' && diff -u {tmp_path} {r.file_path} 2>&1 || true"
                if r.host in small_file_host_cmds:
                    small_file_host_cmds[r.host] += f" && echo '---' && {cmd}"
                else:
                    small_file_host_cmds[r.host] = cmd
                small_file_host_map.setdefault(r.host, []).append(r)

        if small_file_host_cmds:
            small_results = await self._pool.run_host_commands(small_file_host_cmds)
            for sr in small_results:
                if sr.host in small_file_host_map:
                    results_for_host = small_file_host_map[sr.host]
                    output_parts = sr.stdout.split("---")
                    for i, r in enumerate(results_for_host):
                        if i < len(output_parts):
                            r.diff_text = output_parts[i]

        for r, exp in large_file_tasks:
            try:
                r.diff_text = await self._streaming_diff_single(r.host, exp)
            except Exception as exc:
                r.diff_text = f"[streaming diff failed: {exc}]"

        return report

    async def fix(self) -> AuditReport:
        report = await self.audit()

        fix_needed = [r for r in report.results if r.status in (DriftStatus.DRIFTED, DriftStatus.MISSING)]
        if not fix_needed:
            return report

        fix_cmds: dict[str, str] = {}
        for r in fix_needed:
            exp = next((e for e in self._config.expected if e.path == r.file_path), None)
            if exp is None:
                continue
            expected_content = self._expected_content(exp)
            if expected_content is None:
                continue

            tmp_path = f"/tmp/_configdrift_fix_{r.file_path.replace('/', '_')}"
            escaped = expected_content.replace("'", "'\\''")
            cmd = (
                f"echo -n '{escaped}' | sudo tee {tmp_path} > /dev/null && "
                f"sudo cp {tmp_path} {r.file_path} && "
                f"sudo rm -f {tmp_path} && "
                f"echo 'FIXED'"
            )
            fix_cmds[r.host] = cmd

        if fix_cmds:
            fix_results = await self._pool.run_host_commands(fix_cmds)
            host_fix = {r.host: r for r in fix_results}
            for r in fix_needed:
                if r.host in host_fix:
                    fr = host_fix[r.host]
                    if fr.success and "FIXED" in fr.stdout:
                        r.status = DriftStatus.OK
                        r.actual_hash = r.expected_hash
                    else:
                        r.error = fr.stderr or fr.stdout

        return report

    def set_git_content_cache(self, cache: dict[str, str]) -> None:
        self._git_content_cache = cache
