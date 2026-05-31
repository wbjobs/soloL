from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path


async def clone_or_pull(repo_url: str, branch: str, target_dir: Path | None = None) -> Path:
    if target_dir is None:
        target_dir = Path(tempfile.mkdtemp(prefix="configdrift_git_"))

    if (target_dir / ".git").exists():
        proc = await asyncio.create_subprocess_exec(
            "git", "-C", str(target_dir), "fetch", "--all",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        proc = await asyncio.create_subprocess_exec(
            "git", "-C", str(target_dir), "checkout", branch,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        proc = await asyncio.create_subprocess_exec(
            "git", "-C", str(target_dir), "reset", "--hard", f"origin/{branch}",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
    else:
        proc = await asyncio.create_subprocess_exec(
            "git", "clone", "--branch", branch, "--depth", "1", repo_url, str(target_dir),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()

    return target_dir


def load_configs_from_git(git_dir: Path, config_subdir: str) -> dict[str, str]:
    config_path = git_dir / config_subdir
    if not config_path.exists():
        return {}

    result: dict[str, str] = {}
    for f in config_path.rglob("*"):
        if f.is_file():
            relative = f.relative_to(git_dir)
            key = "/" + str(relative).replace("\\", "/")
            if not key.startswith("/" + config_subdir):
                key = "/" + config_subdir + key
            result[key] = f.read_text(encoding="utf-8")

    return result


def build_content_cache(git_dir: Path, config_subdir: str) -> dict[str, str]:
    config_path = git_dir / config_subdir
    if not config_path.exists():
        return {}

    result: dict[str, str] = {}
    for f in config_path.rglob("*"):
        if f.is_file():
            server_path = "/" + str(f.relative_to(config_path)).replace("\\", "/")
            result[server_path] = f.read_text(encoding="utf-8")

    return result
