from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Sequence

from rich.console import Console
from rich.table import Table
from rich.text import Text

from .drift import AuditReport, DriftStatus


SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_time TEXT NOT NULL,
    total_files INTEGER NOT NULL,
    ok_count INTEGER NOT NULL,
    drifted_count INTEGER NOT NULL,
    missing_count INTEGER NOT NULL,
    error_count INTEGER NOT NULL,
    drift_rate REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    host TEXT NOT NULL,
    file_path TEXT NOT NULL,
    status TEXT NOT NULL,
    expected_hash TEXT,
    actual_hash TEXT,
    error TEXT,
    FOREIGN KEY (run_id) REFERENCES audit_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_runs_time ON audit_runs(run_time);
CREATE INDEX IF NOT EXISTS idx_audit_details_run_id ON audit_details(run_id);
"""


@dataclass
class DailyTrend:
    date: str
    drift_rate: float
    total_runs: int


class HistoryStore:
    def __init__(self, db_path: str | Path):
        self._db_path = Path(db_path)
        self._conn = sqlite3.connect(str(self._db_path))
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._init_schema()

    def _init_schema(self) -> None:
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def save_audit(self, report: AuditReport) -> int:
        total = len(report.results)
        drift_rate = 0.0
        if total > 0:
            drift_rate = (report.drifted_count + report.missing_count) / total

        now = datetime.utcnow().isoformat()
        cur = self._conn.execute(
            """
            INSERT INTO audit_runs
            (run_time, total_files, ok_count, drifted_count, missing_count, error_count, drift_rate)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now, total, report.ok_count, report.drifted_count,
                report.missing_count, report.error_count, drift_rate,
            ),
        )
        run_id = cur.lastrowid

        for r in report.results:
            self._conn.execute(
                """
                INSERT INTO audit_details
                (run_id, host, file_path, status, expected_hash, actual_hash, error)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id, r.host, r.file_path, r.status.value,
                    r.expected_hash, r.actual_hash, r.error or None,
                ),
            )

        self._conn.commit()
        return run_id

    def get_daily_trend(self, days: int = 30) -> list[DailyTrend]:
        start_date = datetime.utcnow() - timedelta(days=days - 1)
        start_str = start_date.strftime("%Y-%m-%d")

        cur = self._conn.execute(
            """
            SELECT
                date(run_time) as run_date,
                AVG(drift_rate) as avg_drift_rate,
                COUNT(*) as run_count
            FROM audit_runs
            WHERE date(run_time) >= ?
            GROUP BY date(run_time)
            ORDER BY run_date ASC
            """,
            (start_str,),
        )

        results = []
        for row in cur.fetchall():
            results.append(DailyTrend(
                date=row[0],
                drift_rate=row[1],
                total_runs=row[2],
            ))
        return results

    def get_recent_runs(self, limit: int = 10) -> list[dict]:
        cur = self._conn.execute(
            """
            SELECT run_time, total_files, ok_count, drifted_count, missing_count, error_count, drift_rate
            FROM audit_runs
            ORDER BY run_time DESC
            LIMIT ?
            """,
            (limit,),
        )

        results = []
        for row in cur.fetchall():
            results.append({
                "run_time": row[0],
                "total_files": row[1],
                "ok_count": row[2],
                "drifted_count": row[3],
                "missing_count": row[4],
                "error_count": row[5],
                "drift_rate": row[6],
            })
        return results


_BARS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]


def _rate_to_bar(rate: float) -> str:
    if rate <= 0:
        return _BARS[0]
    idx = int(rate * 8)
    if idx >= len(_BARS):
        idx = len(_BARS) - 1
    return _BARS[idx]


def render_ascii_chart(trend: Sequence[DailyTrend], height: int = 10) -> str:
    if not trend:
        return "No data available."

    max_rate = max((t.drift_rate for t in trend), default=1.0)
    if max_rate <= 0:
        max_rate = 1.0

    date_labels = [t.date[5:] for t in trend]
    values = [t.drift_rate for t in trend]

    chart_lines: list[str] = []

    for row in range(height, -1, -1):
        line_parts = []
        threshold = (row / height) * max_rate
        for val in values:
            if val >= threshold:
                bar_idx = min(8, int((val / max_rate) * 8))
                line_parts.append(_BARS[bar_idx])
            else:
                line_parts.append(" ")
        y_label = f"{threshold * 100:5.1f}% "
        chart_lines.append(y_label + "│" + "".join(line_parts))

    x_axis = "      └" + "─" * len(trend)
    x_labels = "       " + "".join(
        d if i % 3 == 0 else "  "
        for i, d in enumerate(date_labels)
    )

    chart_lines.append(x_axis)
    chart_lines.append(x_labels)

    return "\n".join(chart_lines)


def render_history(trend: Sequence[DailyTrend], recent_runs: list[dict]) -> None:
    console = Console()

    console.print()
    console.print("[bold]Drift Rate Trend - Last 30 Days[/bold]")
    console.print()

    chart = render_ascii_chart(trend)
    console.print(chart)
    console.print()

    if recent_runs:
        table = Table(title="Recent Audit Runs", show_lines=True)
        table.add_column("Time", style="dim", no_wrap=True)
        table.add_column("Total", justify="right")
        table.add_column("OK", justify="right", style="green")
        table.add_column("Drifted", justify="right", style="red")
        table.add_column("Missing", justify="right", style="yellow")
        table.add_column("Error", justify="right", style="magenta")
        table.add_column("Drift Rate", justify="right")

        for run in recent_runs:
            try:
                dt = datetime.fromisoformat(run["run_time"])
                time_str = dt.strftime("%Y-%m-%d %H:%M")
            except Exception:
                time_str = run["run_time"]

            rate_pct = run["drift_rate"] * 100
            rate_color = "green" if rate_pct == 0 else "red" if rate_pct > 10 else "yellow"

            table.add_row(
                time_str,
                str(run["total_files"]),
                str(run["ok_count"]),
                str(run["drifted_count"]),
                str(run["missing_count"]),
                str(run["error_count"]),
                Text(f"{rate_pct:5.1f}%", style=rate_color),
            )

        console.print(table)
        console.print()
