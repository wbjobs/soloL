from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import click
from rich.console import Console
from rich.table import Table
from rich.text import Text

from .drift import AuditReport, DriftResult, DriftStatus


@dataclass
class FixPlan:
    items: list[DriftResult]

    @property
    def total(self) -> int:
        return len(self.items)

    def by_host(self) -> dict[str, list[DriftResult]]:
        result: dict[str, list[DriftResult]] = {}
        for item in self.items:
            result.setdefault(item.host, []).append(item)
        return result


def build_fix_plan(report: AuditReport) -> FixPlan:
    items = [
        r for r in report.results
        if r.status in (DriftStatus.DRIFTED, DriftStatus.MISSING)
    ]
    return FixPlan(items=items)


def render_fix_plan(plan: FixPlan) -> None:
    console = Console()

    if plan.total == 0:
        console.print("[green]No fixes needed![/green]")
        return

    table = Table(title=f"Planned Fixes ({plan.total} items)", show_lines=True)
    table.add_column("#", style="dim", justify="right")
    table.add_column("Host", style="cyan", no_wrap=True)
    table.add_column("File Path", style="white")
    table.add_column("Status", justify="center")

    for idx, item in enumerate(plan.items, 1):
        status_style = "bold yellow" if item.status == DriftStatus.MISSING else "bold red"
        status_text = Text(item.status.value, style=status_style)
        table.add_row(str(idx), item.host, item.file_path, status_text)

    console.print()
    console.print(table)
    console.print()


def confirm_fix_plan(plan: FixPlan, interactive: bool = False) -> list[DriftResult]:
    console = Console()

    if plan.total == 0:
        return []

    render_fix_plan(plan)

    if not interactive:
        if not click.confirm(f"Apply all {plan.total} fixes?", default=False):
            console.print("[yellow]Fix cancelled by user[/yellow]")
            return []
        return list(plan.items)

    approved: list[DriftResult] = []
    all_yes = False

    for idx, item in enumerate(plan.items, 1):
        if all_yes:
            approved.append(item)
            continue

        console.print(
            f"[{idx}/{plan.total}] "
            f"[cyan]{item.host}[/cyan] → [white]{item.file_path}[/white] "
            f"([bold {'red' if item.status == DriftStatus.DRIFTED else 'yellow'}]{item.status.value}[/])"
        )

        while True:
            choice = click.prompt(
                "  Apply this fix? (y=yes, n=no, a=all, q=quit)",
                type=str,
                default="n",
                show_default=False,
            ).lower().strip()

            if choice == "y":
                approved.append(item)
                break
            elif choice == "n":
                break
            elif choice == "a":
                all_yes = True
                approved.append(item)
                break
            elif choice == "q":
                console.print("[yellow]Fix cancelled by user[/yellow]")
                return approved
            else:
                console.print("  [red]Invalid choice. Please enter y, n, a, or q[/red]")

        console.print()

    if approved:
        console.print(f"[green]Will apply {len(approved)} of {plan.total} fixes[/green]")
    else:
        console.print("[yellow]No fixes selected[/yellow]")

    return approved


def filter_audit_report(report: AuditReport, approved: Sequence[DriftResult]) -> AuditReport:
    from .drift import AuditReport as _AuditReport
    approved_set = {(r.host, r.file_path) for r in approved}
    filtered = [
        r for r in report.results
        if (r.host, r.file_path) in approved_set
    ]
    return _AuditReport(results=filtered)
