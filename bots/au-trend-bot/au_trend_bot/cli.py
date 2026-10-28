import argparse
import json
import sqlite3
import sys
import tomllib
from datetime import date
from pathlib import Path
from zoneinfo import ZoneInfoNotFoundError

from .config import load_settings
from .delivery import deliver_report, resolve_delivery
from .demo import run_demo
from .http import HttpClient
from .imports import import_sales, import_trends
from .providers import TikTokProvider
from .safety import BotError
from .service import collect, create_report, health, run_forever, status, tick
from .storage import Store, process_lock
from .timeutil import Window, parse_time, utcnow


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Isolated Australian trend evidence pipeline")
    root.add_argument("--config", type=Path, default=Path("config.example.toml"))
    root.add_argument("--env-file", type=Path)
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "doctor", help="Validate independent config; readiness is not a live API probe"
    )
    commands.add_parser("status", help="Show safe provider, run, budget and outbox states")
    health_command = commands.add_parser("health")
    health_command.add_argument("--scheduler-only", action="store_true")
    collection = commands.add_parser("collect", help="Discover and refresh today's real snapshots")
    collection.add_argument(
        "--retry", action="store_true", help="Retry a failed safe collection within daily caps"
    )
    collection.add_argument(
        "--no-notify", action="store_true", help="Keep failures in local state/exit code only"
    )
    report = commands.add_parser("report", help="Generate an immutable complete local-week report")
    report.add_argument("--end", type=date.fromisoformat, help="Exclusive local Monday, YYYY-MM-DD")
    report.add_argument("--revision", type=int, default=1)
    report.add_argument("--send", action="store_true")
    commands.add_parser("tick", help="Run one restart-safe scheduling pass")
    commands.add_parser("run", help="Run foreground scheduler; use a service manager for restarts")
    demo = commands.add_parser("demo", help="No-key/no-network acceptance, separate DEMO database")
    demo.add_argument("--output", type=Path, default=Path("demo-output"))
    sales = commands.add_parser("import-sales")
    sales.add_argument("path", type=Path)
    sales.add_argument("--provenance", required=True)
    sales.add_argument("--authorized", action="store_true")
    trends = commands.add_parser("import-trends")
    trends.add_argument("path", type=Path)
    trends.add_argument("--fetched-at", required=True, type=parse_time)
    trends.add_argument("--authorized", action="store_true")
    backup = commands.add_parser("backup")
    backup.add_argument("--output", required=True, type=Path)
    prune = commands.add_parser("prune")
    prune.add_argument("--days", type=int, required=True)
    resolve = commands.add_parser("resolve-delivery")
    resolve.add_argument("key")
    resolve.add_argument("--outcome", choices=("sent", "retry"), required=True)
    apify = commands.add_parser("reconcile-apify")
    apify.add_argument("key")
    choices = apify.add_mutually_exclusive_group(required=True)
    choices.add_argument("--run-id")
    choices.add_argument("--no-run-confirmed", action="store_true")
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    settings = None

    def emit(value):
        if settings:
            value = settings.redactor.value(value)
        print(json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False), flush=True)

    try:
        settings = load_settings(args.config, args.env_file)
        if args.command == "doctor":
            result = settings.public_summary()
            result["state"] = (
                "ok"
                if all(
                    result["sources"][name]["state"] == "ready"
                    for name in ("ebay", "tiktok", "trends")
                )
                and result["ai"]["state"] in ("ready", "disabled")
                else "degraded"
            )
            emit(result)
            return 0 if result["state"] == "ok" else 2
        if args.command == "demo":
            emit(run_demo(settings, args.output))
            return 0
        with Store(settings) as store:
            client = HttpClient(settings, store)
            if args.command in ("status", "health"):
                result = (
                    status(settings, store)
                    if args.command == "status"
                    else health(
                        settings,
                        store,
                        args.scheduler_only,
                    )
                )
                emit(result)
                ready = (
                    result.get("state") == "ok"
                    if args.command == "health"
                    else all(
                        result["sources"][name]["state"] == "ok"
                        for name in ("ebay", "tiktok", "trends")
                    )
                )
                return 0 if ready else 2
            if args.command == "run":
                run_forever(settings, store, client, emit)
                return 0
            with process_lock(settings.data_dir):
                if args.command == "collect":
                    result = collect(
                        settings, store, client, retry=args.retry, notify=not args.no_notify
                    )
                elif args.command == "report":
                    window = (
                        Window.ending(args.end, settings.timezone)
                        if args.end
                        else Window.latest(
                            utcnow(),
                            settings.timezone,
                        )
                    )
                    report, paths = create_report(
                        settings, store, client, window, revision=args.revision
                    )
                    result = {
                        "state": report["status"],
                        "key": report["key"],
                        "paths": paths,
                        "mode": report["mode"],
                    }
                    if args.send:
                        result["delivery"] = deliver_report(report, settings, store, client)
                        if result["delivery"]["state"] != "sent":
                            result["state"] = "degraded"
                elif args.command == "tick":
                    result = tick(settings, store, client)
                elif args.command == "import-sales":
                    result = import_sales(
                        args.path,
                        settings,
                        store,
                        args.provenance,
                        args.authorized,
                        utcnow(),
                    )
                elif args.command == "import-trends":
                    result = import_trends(
                        args.path,
                        settings,
                        store,
                        args.fetched_at,
                        args.authorized,
                        utcnow(),
                    )
                elif args.command == "backup":
                    store.backup(args.output)
                    result = {
                        "state": "ok",
                        "output": str(args.output.resolve()),
                        "method": "sqlite_online_backup",
                    }
                elif args.command == "prune":
                    result = {"state": "ok", **store.prune(args.days, utcnow())}
                elif args.command == "resolve-delivery":
                    result = resolve_delivery(args.key, args.outcome, store)
                elif args.command == "reconcile-apify":
                    if args.no_run_confirmed:
                        job = store.job(args.key)
                        if (
                            not job
                            or job["kind"] != "apify"
                            or job["state"] not in ("launching", "uncertain")
                        ):
                            raise BotError("Only an uncertain Apify launch can be reconciled")
                        store.set_job(
                            args.key,
                            "apify",
                            "failed",
                            {
                                **job["payload"],
                                "detail": "Operator confirmed no external run; no same-day relaunch",
                            },
                        )
                        result = {"state": "ok", "detail": "已记录人工核对；下一当地日可启动新任务"}
                    else:
                        result = TikTokProvider(settings, store, client).attach_run(
                            args.key, args.run_id
                        )
                else:
                    raise BotError("Unsupported command")
                emit(result)
                return 0 if result.get("state") in ("ok", "sent", "pending") else 2
    except KeyboardInterrupt:
        emit(
            {
                "state": "interrupted",
                "detail": "Stopped; persisted run and outbox states will be reconciled on restart",
            }
        )
        return 130
    except (
        BotError,
        ValueError,
        OSError,
        sqlite3.Error,
        ZoneInfoNotFoundError,
        tomllib.TOMLDecodeError,
    ) as exc:
        detail = (
            str(exc)
            if isinstance(exc, BotError)
            else (
                f"{type(exc).__name__}; check config, input timestamps, file permissions or timezone data"
            )
        )
        emit({"state": "failed", "detail": detail})
        return 1


if __name__ == "__main__":
    sys.exit(main())
