from __future__ import annotations

import base64
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


_DEFAULT_KEY_ENV = "CONFIGDRIFT_AES_KEY"


@dataclass
class FileExpectation:
    path: str
    hash: str | None = None
    content: str | None = None
    content_file: str | None = None

    def resolved_content(self, base_dir: Path | None = None) -> str | None:
        if self.content is not None:
            return self.content
        if self.content_file is not None and base_dir is not None:
            candidate = base_dir / self.content_file
            if candidate.exists():
                return candidate.read_text(encoding="utf-8")
        return None

    def resolved_content_stream(self, base_dir: Path | None = None):
        if self.content is not None:
            for line in self.content.splitlines(keepends=True):
                yield line
        elif self.content_file is not None and base_dir is not None:
            candidate = base_dir / self.content_file
            if candidate.exists():
                with candidate.open("r", encoding="utf-8") as f:
                    for line in f:
                        yield line

    def content_file_size(self, base_dir: Path | None = None) -> int | None:
        if self.content is not None:
            return len(self.content.encode("utf-8"))
        if self.content_file is not None and base_dir is not None:
            candidate = base_dir / self.content_file
            if candidate.exists():
                return candidate.stat().st_size
        return None


@dataclass
class SSHCreds:
    username: str = "root"
    port: int = 22
    key_path: str | None = None
    password: str | None = None


@dataclass
class PluginConfig:
    name: str
    path: str
    stages: list[str] = field(default_factory=lambda: ["audit"])
    timeout: int = 30
    enabled: bool = True


@dataclass
class DriftConfig:
    hosts: list[str] = field(default_factory=list)
    host_file: str | None = None
    ssh: SSHCreds = field(default_factory=SSHCreds)
    expected: list[FileExpectation] = field(default_factory=list)
    plugins: list[PluginConfig] = field(default_factory=list)
    plugin_dir: str = "plugins"
    history_db: str = "drift_history.db"
    git_repo: str | None = None
    git_branch: str = "main"
    git_config_dir: str = "configs"
    max_concurrency: int = 20
    encrypted: bool = False


def _derive_key(key_material: str) -> bytes:
    raw = base64.urlsafe_b64decode(key_material)
    if len(raw) == 32:
        return raw
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=b"configdrift-v1", iterations=600_000)
    return kdf.derive(raw)


def encrypt_value(plaintext: str, key_b64: str | None = None) -> str:
    key_material = key_b64 or os.environ.get(_DEFAULT_KEY_ENV)
    if not key_material:
        raise RuntimeError(f"AES key not found. Set {_DEFAULT_KEY_ENV} or pass key_b64.")
    try:
        key = _derive_key(key_material)
    except Exception as exc:
        raise RuntimeError(f"Invalid AES key material: {exc}") from exc

    nonce = os.urandom(12)
    if len(nonce) != 12:
        raise RuntimeError("Failed to generate secure nonce")

    try:
        aesgcm = AESGCM(key)
        ct = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
        return base64.urlsafe_b64encode(nonce + ct).decode("ascii")
    except Exception as exc:
        raise RuntimeError(f"Encryption failed: {exc}") from exc


def decrypt_value(ciphertext_b64: str, key_b64: str | None = None) -> str:
    key_material = key_b64 or os.environ.get(_DEFAULT_KEY_ENV)
    if not key_material:
        raise RuntimeError(f"AES key not found. Set {_DEFAULT_KEY_ENV} or pass key_b64.")

    if not ciphertext_b64:
        raise RuntimeError("Ciphertext is empty")

    try:
        key = _derive_key(key_material)
    except Exception as exc:
        raise RuntimeError(f"Invalid AES key material: {exc}") from exc

    try:
        raw = base64.urlsafe_b64decode(ciphertext_b64)
    except Exception as exc:
        raise RuntimeError(f"Invalid base64 encoding: {exc}") from exc

    if len(raw) < 28:
        raise RuntimeError(
            f"Invalid ciphertext length: {len(raw)} bytes. "
            f"Expected at least 28 bytes (12-byte nonce + 16-byte GCM tag)"
        )

    nonce, ct = raw[:12], raw[12:]
    if len(nonce) != 12:
        raise RuntimeError(f"Invalid nonce length: {len(nonce)} bytes, expected 12")

    try:
        aesgcm = AESGCM(key)
        return aesgcm.decrypt(nonce, ct, None).decode("utf-8")
    except InvalidTag:
        raise RuntimeError(
            "Decryption failed: invalid authentication tag. "
            "The ciphertext may be corrupted, tampered with, or the wrong key was used."
        )
    except UnicodeDecodeError:
        raise RuntimeError("Decryption failed: plaintext is not valid UTF-8")
    except Exception as exc:
        raise RuntimeError(f"Decryption failed: {exc}") from exc


def _decrypt_if_needed(value: str, encrypted: bool) -> str:
    if not encrypted:
        return value
    if value.startswith("ENC:"):
        try:
            return decrypt_value(value[4:])
        except RuntimeError as exc:
            raise RuntimeError(f"Failed to decrypt encrypted value: {exc}") from exc
    return value


def load_config(config_path: str | Path) -> DriftConfig:
    p = Path(config_path)
    if not p.exists():
        raise FileNotFoundError(f"Config file not found: {p}")
    with p.open("r", encoding="utf-8") as f:
        raw: dict[str, Any] = yaml.safe_load(f) or {}

    encrypted = raw.get("encrypted", False)

    ssh_raw = raw.get("ssh", {})
    ssh_creds = SSHCreds(
        username=ssh_raw.get("username", "root"),
        port=ssh_raw.get("port", 22),
        key_path=ssh_raw.get("key_path"),
        password=_decrypt_if_needed(ssh_raw["password"]) if "password" in ssh_raw else None,
    )

    expected: list[FileExpectation] = []
    for item in raw.get("expected", []):
        exp = FileExpectation(
            path=item["path"],
            hash=item.get("hash"),
            content=item.get("content"),
            content_file=item.get("content_file"),
        )
        expected.append(exp)

    plugins: list[PluginConfig] = []
    for item in raw.get("plugins", []):
        pc = PluginConfig(
            name=item["name"],
            path=item["path"],
            stages=item.get("stages", ["audit"]),
            timeout=item.get("timeout", 30),
            enabled=item.get("enabled", True),
        )
        plugins.append(pc)

    hosts: list[str] = list(raw.get("hosts", []))
    host_file = raw.get("host_file")

    cfg = DriftConfig(
        hosts=hosts,
        host_file=host_file,
        ssh=ssh_creds,
        expected=expected,
        plugins=plugins,
        plugin_dir=raw.get("plugin_dir", "plugins"),
        history_db=raw.get("history_db", "drift_history.db"),
        git_repo=raw.get("git_repo"),
        git_branch=raw.get("git_branch", "main"),
        git_config_dir=raw.get("git_config_dir", "configs"),
        max_concurrency=raw.get("max_concurrency", 20),
        encrypted=encrypted,
    )
    return cfg


def resolve_hosts(cfg: DriftConfig, base_dir: Path | None = None) -> list[str]:
    hosts = list(cfg.hosts)
    if cfg.host_file:
        hf = (base_dir or Path.cwd()) / cfg.host_file
        if hf.exists():
            for line in hf.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if stripped and not stripped.startswith("#"):
                    hosts.append(stripped)
    return list(dict.fromkeys(hosts))
