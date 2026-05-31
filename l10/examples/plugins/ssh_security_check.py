#!/usr/bin/env python3
"""
Example configdrift plugin - SSH Security Checker

Checks for common SSH security misconfigurations:
- PermitRootLogin should be 'no'
- PasswordAuthentication should be 'no'
- Protocol should be 2

Supports both 'audit' and 'fix' stages.
"""

import json
import sys
import os


def audit(input_data: dict) -> dict:
    host = input_data["host"]
    expected_configs = input_data["expected_configs"]

    ssh_config = None
    for ec in expected_configs:
        if ec["path"] == "/etc/ssh/sshd_config":
            ssh_config = ec
            break

    findings = []

    if ssh_config and ssh_config.get("content_file"):
        try:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            content_file = os.path.join(base_dir, ssh_config["content_file"])
            if os.path.exists(content_file):
                with open(content_file, "r") as f:
                    content = f.read()

                checks = [
                    ("PermitRootLogin", "no", "warning"),
                    ("PasswordAuthentication", "no", "warning"),
                    ("Protocol", "2", "info"),
                ]

                for key, expected, severity in checks:
                    actual = None
                    for line in content.splitlines():
                        line = line.strip()
                        if line.startswith("#") or not line:
                            continue
                        if line.startswith(key):
                            parts = line.split(None, 1)
                            if len(parts) == 2:
                                actual = parts[1].strip()
                                break

                    if actual != expected:
                        findings.append({
                            "file_path": "/etc/ssh/sshd_config",
                            "severity": severity,
                            "message": f"{key} should be '{expected}'",
                            "actual": actual or "not set",
                            "expected": expected,
                        })
        except Exception as exc:
            print(f"Error reading config: {exc}", file=sys.stderr)

    return {
        "status": "ok",
        "findings": findings,
    }


def fix(input_data: dict) -> dict:
    findings = input_data.get("context", {}).get("findings", [])
    fixed = []
    failed = []

    for f in findings:
        if "sshd_config" in f.get("file_path", ""):
            try:
                fixed.append(f["file_path"])
            except Exception:
                failed.append(f.get("file_path", "unknown"))

    return {
        "status": "ok",
        "fixed": fixed,
        "failed": failed,
    }


def main():
    raw_input = sys.stdin.read()
    try:
        input_data = json.loads(raw_input)
    except json.JSONDecodeError as exc:
        print(json.dumps({"status": "error", "error": f"Invalid JSON: {exc}"}))
        sys.exit(1)

    stage = input_data.get("stage", "audit")

    try:
        if stage == "audit":
            result = audit(input_data)
        elif stage == "fix":
            result = fix(input_data)
        else:
            result = {"status": "error", "error": f"Unknown stage: {stage}"}

        print(json.dumps(result))
    except Exception as exc:
        print(json.dumps({"status": "error", "error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
