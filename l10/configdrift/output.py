from __future__ import annotations

from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text

from .drift import AuditReport, DriftResult, DriftStatus


_STATUS_STYLE = {
    DriftStatus.OK: "bold green",
    DriftStatus.DRIFTED: "bold red",
    DriftStatus.MISSING: "bold yellow",
    DriftStatus.ERROR: "bold magenta",
}


def render_audit_table(report: AuditReport, title: str = "Configuration Drift Audit") -> None:
    console = Console()

    table = Table(title=title, show_lines=True)
    table.add_column("Host", style="cyan", no_wrap=True)
    table.add_column("File Path", style="white")
    table.add_column("Status", justify="center")
    table.add_column("Expected Hash", style="dim")
    table.add_column("Actual Hash", style="dim")
    table.add_column("Error", style="red")

    for r in report.results:
        status_text = Text(r.status.value, style=_STATUS_STYLE.get(r.status, "white"))
        table.add_row(
            r.host,
            r.file_path,
            status_text,
            r.expected_hash[:16] + "..." if r.expected_hash else "-",
            r.actual_hash[:16] + "..." if r.actual_hash else "-",
            r.error[:60] if r.error else "",
        )

    console.print()
    console.print(table)

    summary = (
        f"[green]OK: {report.ok_count}[/green]  "
        f"[red]Drifted: {report.drifted_count}[/red]  "
        f"[yellow]Missing: {report.missing_count}[/yellow]  "
        f"[magenta]Error: {report.error_count}[/magenta]"
    )
    console.print(Panel(summary, title="Summary", expand=False))
    console.print()


def render_diff_output(report: AuditReport) -> None:
    console = Console()
    drifted = [r for r in report.results if r.status == DriftStatus.DRIFTED and r.diff_text]

    if not drifted:
        console.print("[green]No drift differences found.[/green]")
        return

    for r in drifted:
        console.print(Panel(
            f"[cyan]{r.host}[/cyan] — [white]{r.file_path}[/white]",
            style="bold red",
            expand=False,
        ))
        console.print(r.diff_text)
        console.print()
