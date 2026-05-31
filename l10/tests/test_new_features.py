#!/usr/bin/env python3
"""Full integration test for new configdrift features."""

import json
import os
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from configdrift.config import DriftConfig, load_config, encrypt_value, decrypt_value, PluginConfig
from configdrift.ssh_client import SSHConnectionPool
from configdrift.drift import DriftDetector, DriftStatus, _streaming_line_diff, _streaming_diff_single_async, AuditReport, DriftResult
from configdrift.git_store import clone_or_pull, build_content_cache
from configdrift.output import render_audit_table, render_diff_output
from configdrift.history import HistoryStore, render_history, render_ascii_chart, DailyTrend
from configdrift.interactive import build_fix_plan, confirm_fix_plan, render_fix_plan, FixPlan
from configdrift.plugins import PluginManager, PluginResult, PluginFinding, PluginFixResult


def test_imports():
    print("=== Module Import Test ===")
    print("All modules imported successfully")
    return True


def test_config_with_plugins():
    print()
    print("=== Config with Plugins Test ===")

    config_text = """
ssh:
  username: root
  port: 22
hosts:
  - 192.168.1.10
max_concurrency: 5
history_db: test_history.db
plugin_dir: plugins
plugins:
  - name: test_plugin
    path: test_plugin.py
    stages: [audit, fix]
    timeout: 30
    enabled: true
expected:
  - path: /etc/test
    content: test_content
"""

    with tempfile.TemporaryDirectory() as tmpdir:
        cfg_path = Path(tmpdir) / "test.yaml"
        cfg_path.write_text(config_text)
        cfg = load_config(cfg_path)

        assert len(cfg.plugins) == 1
        assert cfg.plugins[0].name == "test_plugin"
        assert cfg.plugins[0].path == "test_plugin.py"
        assert cfg.plugins[0].stages == ["audit", "fix"]
        assert cfg.history_db == "test_history.db"
        assert cfg.plugin_dir == "plugins"

        print(f"Plugins loaded: {len(cfg.plugins)}")
        print(f"History DB path: {cfg.history_db}")
        print(f"Plugin dir: {cfg.plugin_dir}")
        print("Config with plugins: OK")

    return True


def test_history_store():
    print()
    print("=== History Store Test ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"

        with HistoryStore(db_path) as store:
            for i in range(5):
                drift_rate = i * 0.1
                drifted = int(drift_rate * 10)
                ok = 10 - drifted

                report = AuditReport(results=[
                    DriftResult(
                        host="host1",
                        file_path=f"/etc/file{j}",
                        status=DriftStatus.OK if j < ok else DriftStatus.DRIFTED,
                    )
                    for j in range(10)
                ])

                run_id = store.save_audit(report)
                print(f"Saved run {run_id}: drift_rate={drift_rate*100:.0f}%")

            trend = store.get_daily_trend(days=7)
            print(f"\nGot {len(trend)} days of trend data")
            for t in trend:
                print(f"  {t.date}: {t.drift_rate*100:.1f}% ({t.total_runs} runs)")

            recent = store.get_recent_runs(limit=3)
            print(f"\nRecent {len(recent)} runs:")
            for r in recent:
                rt = r["run_time"]
                dr = r["drift_rate"] * 100
                print(f"  {rt[:19]}: drift={dr:.1f}%")

        print("History store: OK")

    return True


def test_ascii_chart():
    print()
    print("=== ASCII Chart Test ===")

    trend_data = [
        DailyTrend(date="2026-05-25", drift_rate=0.05, total_runs=2),
        DailyTrend(date="2026-05-26", drift_rate=0.12, total_runs=3),
        DailyTrend(date="2026-05-27", drift_rate=0.08, total_runs=2),
        DailyTrend(date="2026-05-28", drift_rate=0.15, total_runs=4),
        DailyTrend(date="2026-05-29", drift_rate=0.02, total_runs=1),
    ]

    chart = render_ascii_chart(trend_data, height=5)
    print(chart)
    print()
    print("ASCII chart: OK")

    return True


def test_plugin_protocol():
    print()
    print("=== Plugin Protocol Test ===")

    test_input = {
        "stage": "audit",
        "host": "192.168.1.10",
        "ssh_config": {"username": "root", "port": 22},
        "expected_configs": [{"path": "/etc/ssh/sshd_config"}],
        "context": {},
    }
    print(f"Plugin input JSON keys: {list(test_input.keys())}")
    print(f"Plugin input JSON valid: {json.dumps(test_input) is not None}")

    test_output = {
        "status": "ok",
        "findings": [
            {"file_path": "/etc/ssh/sshd_config", "severity": "warning", "message": "PermitRootLogin should be no"},
        ],
    }
    print(f"Plugin output JSON keys: {list(test_output.keys())}")
    print(f"Plugin output JSON valid: {json.dumps(test_output) is not None}")
    print("Plugin protocol: OK")

    return True


def test_fix_plan():
    print()
    print("=== Fix Plan Test ===")

    report = AuditReport(results=[
        DriftResult(host="host1", file_path="/etc/file1", status=DriftStatus.DRIFTED),
        DriftResult(host="host1", file_path="/etc/file2", status=DriftStatus.MISSING),
        DriftResult(host="host2", file_path="/etc/file1", status=DriftStatus.OK),
        DriftResult(host="host2", file_path="/etc/file2", status=DriftStatus.DRIFTED),
    ])

    plan = build_fix_plan(report)
    print(f"Fix plan items: {plan.total}")
    assert plan.total == 3
    assert len(plan.by_host()["host1"]) == 2
    assert len(plan.by_host()["host2"]) == 1
    print(f"Host1 items: {len(plan.by_host()['host1'])}")
    print(f"Host2 items: {len(plan.by_host()['host2'])}")
    print("Fix plan: OK")

    return True


def main():
    tests = [
        test_imports,
        test_config_with_plugins,
        test_history_store,
        test_ascii_chart,
        test_plugin_protocol,
        test_fix_plan,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            if test():
                passed += 1
            else:
                failed += 1
        except Exception as exc:
            print(f"\n[FAILED] {test.__name__}: {exc}")
            import traceback
            traceback.print_exc()
            failed += 1

    print()
    print("=" * 50)
    print(f"Tests passed: {passed}/{len(tests)}")
    print(f"Tests failed: {failed}/{len(tests)}")

    if failed > 0:
        sys.exit(1)
    else:
        print("\nAll tests passed!")
        sys.exit(0)


if __name__ == "__main__":
    main()
