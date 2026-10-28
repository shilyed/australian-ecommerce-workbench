import time
from datetime import datetime, timedelta
from typing import Callable
from zoneinfo import ZoneInfo

from .ai import summarize
from .analysis import CORE_SOURCES, build_report, source_status
from .config import Settings
from .delivery import alert, deliver_report
from .http import HttpClient
from .providers import EbayProvider, PendingRun, TikTokProvider, TrendsProvider
from .reports import write_report
from .safety import BotError, BudgetError
from .storage import Store, process_lock
from .timeutil import Window, parse_time, utcnow


def collect(
    settings: Settings,
    store: Store,
    client: HttpClient,
    *,
    retry: bool = False,
    notify: bool = True,
    clock: Callable = utcnow,
    factories: dict | None = None,
) -> dict:
    if store.mode != "live":
        raise BotError("DEMO databases cannot perform real collection")
    now = clock()
    day = now.astimezone(ZoneInfo(settings.timezone)).date().isoformat()
    providers = factories or {
        "ebay": EbayProvider,
        "tiktok": TikTokProvider,
        "trends": TrendsProvider,
    }
    results = {}
    for source in CORE_SOURCES:
        key = f"collect:{day}:{source}"
        old = store.job(key)
        config_status = settings.source_status()[source]
        attempts = old["payload"].get("attempts", 0) if old else 0
        if config_status["state"] != "ready":
            result = {**config_status, "source": source, "attempts": attempts}
        elif old and old["state"] in ("ok", "empty"):
            results[source] = old["payload"]
            continue
        elif old and old["state"] in ("failed", "partial", "blocked") and not retry:
            results[source] = old["payload"]
            continue
        elif attempts >= settings.limits.collection_attempts_per_day and (
            not old or old["state"] not in ("pending", "collecting")
        ):
            result = {
                "state": "blocked",
                "source": source,
                "attempts": attempts,
                "detail": "本地每日采集尝试次数用尽，不继续请求",
            }
        else:
            if not old or old["state"] not in ("pending", "collecting"):
                attempts += 1
            store.set_job(
                key,
                "collection",
                "collecting",
                {
                    "source": source,
                    "attempts": attempts,
                    "detail": "采集中；重启时保留外部运行键",
                },
                now,
            )
            try:
                result = providers[source](settings, store, client, clock=clock).collect()
            except PendingRun as exc:
                result = {"state": "pending", "detail": str(exc)}
            except BudgetError as exc:
                result = {"state": "blocked", "detail": str(exc)}
            except BotError as exc:
                result = {"state": "failed", "detail": str(exc)}
            result = {**result, "source": source, "attempts": attempts}
        store.set_job(key, "collection", result["state"], result, clock())
        if notify and result["state"] not in ("ok", "pending"):
            result["alert"] = alert(source, result["detail"], settings, store, client)
        results[source] = result
    return {
        "state": "ok" if all(r["state"] == "ok" for r in results.values()) else "degraded",
        "sources": results,
    }


def create_report(
    settings: Settings,
    store: Store,
    client: HttpClient,
    window: Window,
    *,
    revision: int = 1,
    now: datetime | None = None,
) -> tuple[dict, dict]:
    now = now or utcnow()
    if not 1 <= revision <= 999:
        raise BotError("Report revision must be 1-999")
    if window.end > now:
        raise BotError("Cannot report an incomplete future week")
    key = f"{settings.topic_id}-{settings.fingerprint}-{window.end_date}-r{revision}"
    report = store.report(key)
    if report is None:
        report = build_report(settings, store, window, now, revision)
        report["ai"] = summarize(report, settings, store, client, now)
        if report["ai"]["state"] not in ("ok", "disabled"):
            report["status"] = "degraded"
        store.save_report(report)
    paths = write_report(store, report)
    return report, {kind: str(path) for kind, path in paths.items()}


def tick(
    settings: Settings,
    store: Store,
    client: HttpClient,
    *,
    clock: Callable = utcnow,
    collector: Callable = collect,
) -> dict:
    now = clock()
    local = now.astimezone(ZoneInfo(settings.timezone))
    store.set_job("scheduler-heartbeat", "heartbeat", "running", {"detail": "调度进程响应"}, now)
    actions = {}
    if local.hour >= settings.schedule.collect_hour:
        day = local.date().isoformat()
        failures = [
            job
            for source in CORE_SOURCES
            if (job := store.job(f"collect:{day}:{source}"))
            and job["state"] in ("failed", "partial", "blocked")
        ]
        retry = bool(failures) and all(
            now - parse_time(job["updated_at"]) >= timedelta(hours=1) for job in failures
        )
        actions["collection"] = collector(
            settings,
            store,
            client,
            retry=retry,
            notify=True,
            clock=clock,
        )
    latest = Window.latest(now, settings.timezone)
    if local.weekday() == 0 and local.hour < settings.schedule.report_hour:
        latest = latest.previous()
    reports = []
    for offset in range(settings.schedule.catchup_weeks - 1, -1, -1):
        end = datetime.fromisoformat(latest.end_date).date() - timedelta(weeks=offset)
        window = Window.ending(end, settings.timezone)
        report, paths = create_report(settings, store, client, window, now=now)
        delivery = deliver_report(report, settings, store, client)
        reports.append(
            {
                "key": report["key"],
                "status": report["status"],
                "paths": paths,
                "delivery": delivery,
            }
        )
    actions["reports"] = reports
    degraded = actions.get("collection", {}).get("state") == "degraded" or any(
        row["status"] != "ok" or row["delivery"]["state"] != "sent" for row in reports
    )
    return {"state": "degraded" if degraded else "ok", **actions}


def status(settings: Settings, store: Store) -> dict:
    return {
        **settings.public_summary(),
        "mode": store.mode.upper(),
        "sources": source_status(settings, store, utcnow()),
        "jobs": store.jobs()[:30],
        "deliveries": store.deliveries()[:30],
        "budgets": store.budgets()[:30],
    }


def health(settings: Settings, store: Store, scheduler_only: bool = False) -> dict:
    heartbeat = store.job("scheduler-heartbeat")
    responsive = bool(heartbeat) and utcnow() - parse_time(heartbeat["updated_at"]) < timedelta(
        seconds=max(300, settings.schedule.poll_seconds * 3)
    )
    if scheduler_only:
        return {
            "state": "ok" if responsive else "stale",
            "scheduler_responsive": responsive,
            "detail": "仅调度存活检查，不代表来源权限、数据完整性或邮件送达",
        }
    sources = source_status(settings, store, utcnow())
    return {
        "state": "ok" if all(sources[s]["state"] == "ok" for s in CORE_SOURCES) else "degraded",
        "scheduler_responsive": responsive,
        "sources": sources,
    }


def run_forever(settings: Settings, store: Store, client: HttpClient, emit: Callable):
    client.activity = lambda: store.set_job(
        "scheduler-heartbeat",
        "heartbeat",
        "running",
        {"detail": "调度采集中；请求仍有超时限制"},
    )
    previous = None
    while True:
        with process_lock(settings.data_dir):
            result = tick(settings, store, client)
        if result != previous:
            emit(result)
            previous = result
        time.sleep(settings.schedule.poll_seconds)
