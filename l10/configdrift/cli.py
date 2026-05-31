from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import click

from .config import DriftConfig, encrypt_value, load_config
from .drift import DriftDetector
from .git_store import build_content_cache, clone_or_pull
from .history import HistoryStore, render_history
from .interactive import build_fix_plan, confirm_fix_plan, filter_audit_report
from .output import render_audit_table, render_diff_output
from .plugins import PluginManager


def _run(coro):
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    return asyncio.run(coro)


@click.group()
@click.option("--config", "-c", default="drift.yaml", help="Path to drift config YAML")
@click.pass_context
def main(ctx: click.Context, config: str) -> None:
    ctx.ensure_object(dict)
    ctx.obj["config_path"] = config


@main.command()
@click.option("--no-history", is_flag=True, help="Do not save results to history database")
@click.option("--no-plugins", is_flag=True, help="Skip running plugins")
@click.pass_context
def audit(ctx: click.Context, no_history: bool, no_plugins: bool) -> None:
    cfg_path = ctx.obj["config_path"]
    cfg = load_config(cfg_path)
    config_dir = Path(cfg_path).resolve().parent

    detector = DriftDetector(cfg, config_dir)
    if cfg.git_repo:
        git_dir = _run(clone_or_pull(cfg.git_repo, cfg.git_branch))
        cache = build_content_cache(git_dir, cfg.git_config_dir)
        detector.set_git_content_cache(cache)

    report = _run(detector.audit())

    if not no_plugins:
        from .config import resolve_hosts
        hosts = resolve_hosts(cfg, config_dir)
        plugin_mgr = PluginManager(cfg, config_dir)
        plugin_results = _run(plugin_mgr.run_audit_plugins(hosts))
        report = plugin_mgr.merge_plugin_results(report, plugin_results)

    render_audit_table(report)

    if not no_history:
        db_path = config_dir / cfg.history_db if not Path(cfg.history_db).is_absolute() else Path(cfg.history_db)
        with HistoryStore(db_path) as store:
            store.save_audit(report)
            print(f"[dim]Results saved to history: {db_path}[/dim]")

    if report.drifted_count > 0 or report.missing_count > 0 or report.error_count > 0:
        sys.exit(1)


@main.command()
@click.option("--no-plugins", is_flag=True, help="Skip running plugins")
@click.pass_context
def diff(ctx: click.Context, no_plugins: bool) -> None:
    cfg_path = ctx.obj["config_path"]
    cfg = load_config(cfg_path)
    config_dir = Path(cfg_path).resolve().parent

    detector = DriftDetector(cfg, config_dir)
    if cfg.git_repo:
        git_dir = _run(clone_or_pull(cfg.git_repo, cfg.git_branch))
        cache = build_content_cache(git_dir, cfg.git_config_dir)
        detector.set_git_content_cache(cache)

    report = _run(detector.diff())

    if not no_plugins:
        from .config import resolve_hosts
        hosts = resolve_hosts(cfg, config_dir)
        plugin_mgr = PluginManager(cfg, config_dir)
        plugin_results = _run(plugin_mgr.run_audit_plugins(hosts))
        report = plugin_mgr.merge_plugin_results(report, plugin_results)

    render_audit_table(report, title="Configuration Drift Diff")
    render_diff_output(report)

    if report.drifted_count > 0 or report.missing_count > 0:
        sys.exit(1)


@main.command()
@click.option("--interactive", "-i", is_flag=True, help="Interactive mode: confirm each fix individually")
@click.option("--no-plugins", is_flag=True, help="Skip running plugins")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation and apply all fixes")
@click.pass_context
def fix(ctx: click.Context, interactive: bool, no_plugins: bool, yes: bool) -> None:
    cfg_path = ctx.obj["config_path"]
    cfg = load_config(cfg_path)
    config_dir = Path(cfg_path).resolve().parent

    detector = DriftDetector(cfg, config_dir)
    if cfg.git_repo:
        git_dir = _run(clone_or_pull(cfg.git_repo, cfg.git_branch))
        cache = build_content_cache(git_dir, cfg.git_config_dir)
        detector.set_git_content_cache(cache)

    audit_report = _run(detector.audit())

    if not no_plugins:
        from .config import resolve_hosts
        hosts = resolve_hosts(cfg, config_dir)
        plugin_mgr = PluginManager(cfg, config_dir)
        plugin_results = _run(plugin_mgr.run_audit_plugins(hosts))
        audit_report = plugin_mgr.merge_plugin_results(audit_report, plugin_results)

    fix_plan = build_fix_plan(audit_report)
    if fix_plan.total == 0:
        print("[green]No fixes needed![/green]")
        return

    if yes:
        approved = list(fix_plan.items)
    else:
        approved = confirm_fix_plan(fix_plan, interactive=interactive)

    if not approved:
        print("[yellow]No fixes to apply[/yellow]")
        return

    filtered_report = filter_audit_report(audit_report, approved)

    if not yes:
        if not interactive:
            if not click.confirm(f"Apply {len(approved)} fixes? Continue?", default=False):
                print("[yellow]Fix cancelled by user[/yellow]")
                return

    fix_report = _run(detector.fix())
    render_audit_table(fix_report, title="Configuration Drift Fix Results")

    if not no_plugins:
        from .config import resolve_hosts
        hosts = resolve_hosts(cfg, config_dir)
        plugin_mgr = PluginManager(cfg, config_dir)
        for host in hosts:
            host_findings = [
                {
                    "file_path": r.file_path,
                    "status": r.status.value,
                    "error": r.error,
                }
                for r in fix_report.results
                if r.host == host
            ]
            if host_findings:
                plugin_fix_results = _run(
                    plugin_mgr.run_fix_plugins(host, host_findings)
                )
                for pfr in plugin_fix_results:
                    if pfr.fixed:
                        print(f"[green]Plugin '{pfr.plugin_name}' fixed: {', '.join(pfr.fixed)}[/green]")
                    if pfr.failed:
                        print(f"[red]Plugin '{pfr.plugin_name}' failed: {', '.join(pfr.failed)}[/red]")
                    if pfr.status == "error":
                        print(f"[red]Plugin '{pfr.plugin_name}' error: {pfr.error}[/red]")

    if fix_report.error_count > 0:
        sys.exit(1)


@main.command()
@click.option("--days", "-d", default=30, type=int, help="Number of days to show (default: 30)")
@click.option("--limit", "-l", default=10, type=int, help="Number of recent runs to show (default: 10)")
@click.pass_context
def history(ctx: click.Context, days: int, limit: int) -> None:
    cfg_path = ctx.obj["config_path"]
    cfg = load_config(cfg_path)
    config_dir = Path(cfg_path).resolve().parent

    db_path = config_dir / cfg.history_db if not Path(cfg.history_db).is_absolute() else Path(cfg.history_db)

    if not db_path.exists():
        print(f"[yellow]No history database found at: {db_path}[/yellow]")
        print("[dim]Run 'configdrift audit' first to generate history data.[/dim]")
        return

    with HistoryStore(db_path) as store:
        trend = store.get_daily_trend(days=days)
        recent = store.get_recent_runs(limit=limit)

    render_history(trend, recent)


@main.command()
@click.argument("plaintext")
@click.option("--key", envvar="CONFIGDRIFT_AES_KEY", help="Base64 AES key")
def encrypt(plaintext: str, key: str | None) -> None:
    result = encrypt_value(plaintext, key)
    click.echo(f"ENC:{result}")


if __name__ == "__main__":
    main()
