from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Sequence

import asyncssh

from .config import SSHCreds


@dataclass
class SSHResult:
    host: str
    success: bool
    stdout: str = ""
    stderr: str = ""
    exit_status: int = -1


class SSHConnectionPool:
    def __init__(self, creds: SSHCreds, max_concurrency: int = 20):
        self._creds = creds
        self._sem = asyncio.Semaphore(max_concurrency)

    def _connect_kwargs(self) -> dict:
        kw: dict = {
            "username": self._creds.username,
            "port": self._creds.port,
            "known_hosts": None,
        }
        if self._creds.key_path:
            kw["client_keys"] = [self._creds.key_path]
        elif self._creds.password:
            kw["password"] = self._creds.password
        return kw

    async def run_command(self, host: str, command: str, timeout: float = 30.0, handshake_timeout: float = 10.0) -> SSHResult:
        conn: asyncssh.SSHClientConnection | None = None
        try:
            async with self._sem:
                try:
                    conn = await asyncio.wait_for(
                        asyncssh.connect(host, **self._connect_kwargs()),
                        timeout=handshake_timeout,
                    )
                except asyncio.TimeoutError:
                    return SSHResult(host=host, success=False, stderr=f"SSH handshake timed out after {handshake_timeout}s")
                except Exception as exc:
                    return SSHResult(host=host, success=False, stderr=f"Connection failed: {exc}")

                try:
                    result = await asyncio.wait_for(conn.run(command), timeout=timeout)
                    return SSHResult(
                        host=host,
                        success=result.exit_status == 0,
                        stdout=result.stdout,
                        stderr=result.stderr,
                        exit_status=result.exit_status,
                    )
                except asyncio.TimeoutError:
                    return SSHResult(host=host, success=False, stderr=f"Command timed out after {timeout}s")
                except Exception as exc:
                    return SSHResult(host=host, success=False, stderr=f"Command failed: {exc}")
        finally:
            if conn is not None:
                try:
                    conn.abort()
                except Exception:
                    pass

    async def run_commands(self, hosts: Sequence[str], command: str, timeout: float = 30.0) -> list[SSHResult]:
        tasks = [self.run_command(h, command, timeout) for h in hosts]
        return await asyncio.gather(*tasks)

    async def run_host_commands(self, commands_by_host: dict[str, str], timeout: float = 30.0) -> list[SSHResult]:
        tasks = [self.run_command(h, cmd, timeout) for h, cmd in commands_by_host.items()]
        return await asyncio.gather(*tasks)

    async def stream_remote_file(self, host: str, remote_path: str, handshake_timeout: float = 10.0):
        conn: asyncssh.SSHClientConnection | None = None
        sftp: asyncssh.SFTPClient | None = None
        remote_file: asyncssh.SFTPFile | None = None
        try:
            async with self._sem:
                try:
                    conn = await asyncio.wait_for(
                        asyncssh.connect(host, **self._connect_kwargs()),
                        timeout=handshake_timeout,
                    )
                except asyncio.TimeoutError:
                    raise RuntimeError(f"SSH handshake timed out after {handshake_timeout}s")
                except Exception as exc:
                    raise RuntimeError(f"Connection failed: {exc}")

                try:
                    sftp = await conn.start_sftp_client()
                    remote_file = await sftp.open(remote_path, "r")
                    while True:
                        chunk = await asyncio.wait_for(remote_file.read(65536), timeout=30.0)
                        if not chunk:
                            break
                        yield chunk
                except Exception as exc:
                    raise RuntimeError(f"Failed to stream {remote_path}: {exc}")
        finally:
            if remote_file is not None:
                try:
                    await remote_file.close()
                except Exception:
                    pass
            if sftp is not None:
                try:
                    await sftp.close()
                except Exception:
                    pass
            if conn is not None:
                try:
                    conn.abort()
                except Exception:
                    pass
