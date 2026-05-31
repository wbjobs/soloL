from __future__ import annotations

import asyncio
import json
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

from .config import DriftConfig, PluginConfig, SSHCreds
from .drift import AuditReport, DriftResult, DriftStatus


@dataclass
class PluginFinding:
    file_path: str
    severity: str
    message: str
    actual: str = ""
    expected: str = ""


@dataclass
class PluginResult:
    plugin_name: str
    host: str
    status: str = "ok"
    findings: list[PluginFinding] = field(default_factory=list)
    error: str = ""


@dataclass
class PluginFixResult:
    plugin_name: str
    host: str
    status: str = "ok"
    fixed: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    error: str = ""


class PluginManager:
    def __init__(self, config: DriftConfig, config_dir: Path | None = None):
        self._config = config
        self._config_dir = config_dir or Path.cwd()
        self._sem = asyncio.Semaphore(config.max_concurrency)

    def _resolve_plugin_path(self, plugin_cfg: PluginConfig) -> str:
        path = Path(plugin_cfg.path)
        if not path.is_absolute():
            path = self._config_dir / self._config.plugin_dir / path
        return str(path.resolve())

    def _build_input(self, stage: str, host: str, ssh_creds: SSHCreds, extra: dict | None = None) -> dict:
        input_data = {
            "stage": stage,
            "host": host,
            "ssh_config": {
                "username": ssh_creds.username,
                "port": ssh_creds.port,
                "key_path": ssh_creds.key_path,
            },
            "expected_configs": [
                {
                    "path": e.path,
                    "hash": e.hash,
                    "content_file": e.content_file,
                }
                for e in self._config.expected
            ],
            "context": extra or {},
        }
        return input_data

    async def _run_plugin(
        self,
        plugin_cfg: PluginConfig,
        stage: str,
        host: str,
        extra: dict | None = None,
    ) -> dict:
        plugin_path = self._resolve_plugin_path(plugin_cfg)

        if not os.path.exists(plugin_path):
            raise RuntimeError(f"Plugin not found: {plugin_path}")

        input_data = self._build_input(stage, host, self._config.ssh, extra)
        input_json = json.dumps(input_data)

        env = os.environ.copy()
        env["CONFIGDRIFT_STAGE"] = stage
        env["CONFIGDRIFT_HOST"] = host
        env["CONFIGDRIFT_PLUGIN"] = plugin_cfg.name

        proc = await asyncio.create_subprocess_exec(
            plugin_path,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(input=input_json.encode("utf-8")),
                timeout=plugin_cfg.timeout,
            )

            if proc.returncode != 0:
                err_msg = stderr.decode("utf-8", errors="replace").strip()
                raise RuntimeError(
                    f"Plugin exited with code {proc.returncode}: {err_msg}"
                )

            output_str = stdout.decode("utf-8", errors="replace").strip()
            if not output_str:
                return {}

            try:
                return json.loads(output_str)
            except json.JSONDecodeError as exc:
                raise RuntimeError(
                    f"Plugin returned invalid JSON: {exc}. Output: {output_str[:200]}"
                )

        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            raise RuntimeError(f"Plugin timed out after {plugin_cfg.timeout}s")

    async def run_audit_plugins(self, hosts: Sequence[str]) -> list[PluginResult]:
        results: list[PluginResult] = []
        plugins = [p for p in self._config.plugins if p.enabled and "audit" in p.stages]

        if not plugins:
            return results

        tasks = []
        for plugin_cfg in plugins:
            for host in hosts:
                tasks.append(self._run_single_audit(plugin_cfg, host))

        results = await asyncio.gather(*tasks)
        return list(results)

    async def _run_single_audit(
        self, plugin_cfg: PluginConfig, host: str
    ) -> PluginResult:
        async with self._sem:
            try:
                output = await self._run_plugin(plugin_cfg, "audit", host)
                findings = []
                for f in output.get("findings", []):
                    findings.append(PluginFinding(
                        file_path=f.get("file_path", ""),
                        severity=f.get("severity", "info"),
                        message=f.get("message", ""),
                        actual=f.get("actual", ""),
                        expected=f.get("expected", ""),
                    ))
                return PluginResult(
                    plugin_name=plugin_cfg.name,
                    host=host,
                    status=output.get("status", "ok"),
                    findings=findings,
                )
            except Exception as exc:
                return PluginResult(
                    plugin_name=plugin_cfg.name,
                    host=host,
                    status="error",
                    error=str(exc),
                )

    def merge_plugin_results(
        self, report: AuditReport, plugin_results: Sequence[PluginResult]
    ) -> AuditReport:
        for pr in plugin_results:
            if pr.status == "error":
                report.results.append(DriftResult(
                    host=pr.host,
                    file_path=f"plugin:{pr.plugin_name}",
                    status=DriftStatus.ERROR,
                    error=pr.error,
                ))
                continue

            for finding in pr.findings:
                severity = finding.severity.lower()
                status = DriftStatus.ERROR if severity == "error" else DriftStatus.DRIFTED
                report.results.append(DriftResult(
                    host=pr.host,
                    file_path=finding.file_path,
                    status=status,
                    error=f"[{pr.plugin_name}] {finding.message}"
                    + (f" (expected: {finding.expected})" if finding.expected else "")
                    + (f" (actual: {finding.actual})" if finding.actual else ""),
                ))
        return report

    async def run_fix_plugins(
        self, host: str, findings: Sequence[dict]
    ) -> list[PluginFixResult]:
        results: list[PluginFixResult] = []
        plugins = [p for p in self._config.plugins if p.enabled and "fix" in p.stages]

        if not plugins:
            return results

        tasks = [
            self._run_single_fix(plugin_cfg, host, findings)
            for plugin_cfg in plugins
        ]
        results = await asyncio.gather(*tasks)
        return list(results)

    async def _run_single_fix(
        self, plugin_cfg: PluginConfig, host: str, findings: Sequence[dict]
    ) -> PluginFixResult:
        async with self._sem:
            try:
                extra = {"findings": list(findings)}
                output = await self._run_plugin(plugin_cfg, "fix", host, extra)
                return PluginFixResult(
                    plugin_name=plugin_cfg.name,
                    host=host,
                    status=output.get("status", "ok"),
                    fixed=output.get("fixed", []),
                    failed=output.get("failed", []),
                )
            except Exception as exc:
                return PluginFixResult(
                    plugin_name=plugin_cfg.name,
                    host=host,
                    status="error",
                    error=str(exc),
                )
