from collections import Counter, defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .config import Settings
from .storage import Store
from .timeutil import Window, parse_time, stamp


CORE_SOURCES = ("ebay", "tiktok", "trends")
METRICS = ("views", "likes", "comments", "shares", "saves")


def source_status(settings: Settings, store: Store, now: datetime) -> dict:
    statuses = settings.source_status()
    if store.mode == "demo":
        for source in CORE_SOURCES:
            statuses[source] = {
                "state": "demo_fixture",
                "detail": "固定的合成示例；不是实时来源或权限联调结果",
            }
        return statuses
    for source in CORE_SOURCES:
        jobs = [job for job in store.jobs("collection") if job["payload"].get("source") == source]
        if statuses[source]["state"] != "ready":
            continue
        if not jobs:
            statuses[source] = {"state": "not_collected", "detail": "尚无真实采集记录"}
            continue
        job = jobs[0]
        statuses[source] = {
            **job["payload"],
            "state": job["state"],
            "last_attempt_at": job["updated_at"],
        }
        age = now - parse_time(job["updated_at"])
        if age > timedelta(hours=36):
            statuses[source]["state"] = "stale"
            statuses[source]["detail"] = "最近采集记录已超过三十六小时；不能冒充本期正常运行"
    return statuses


def metric_delta(rows: list[dict], metric: str, window: Window) -> dict:
    points = sorted(rows, key=lambda row: row["observed_at"])
    result = {
        "observed_delta": None,
        "week_delta": None,
        "reason": "no_baseline",
        "from": points[0]["observed_at"] if points else None,
        "to": points[-1]["observed_at"] if points else None,
        "coverage": "unknown",
        "snapshots": len(points),
        "first_value": points[0]["metrics"].get(metric) if points else None,
        "last_value": points[-1]["metrics"].get(metric) if points else None,
    }
    if len(points) < 2:
        return result
    values = [point["metrics"].get(metric) for point in points]
    if any(value is None for value in values):
        return {**result, "reason": "missing_counter"}
    if any(b < a for a, b in zip(values, values[1:])):
        return {**result, "reason": "counter_reset_or_decrease"}
    first, last = parse_time(points[0]["observed_at"]), parse_time(points[-1]["observed_at"])
    if last <= first:
        return result
    result.update(
        observed_delta=values[-1] - values[0], reason="partial_observation", coverage="partial"
    )
    approximate = any(point.get("time_basis", "").startswith("actor_run_") for point in points)
    if first == window.start and last == window.end and not approximate:
        result.update(
            week_delta=result["observed_delta"], reason="full_boundary_snapshots", coverage="full"
        )
    elif approximate:
        result["reason"] = "approximate_run_time_partial_observation"
    return result


def social_rows(store: Store, window: Window) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    previous_groups: dict[str, list[dict]] = defaultdict(list)
    for row in store.observations("tiktok", window.start, window.end):
        groups[row["external_id"]].append(row)
    previous = window.previous()
    for row in store.observations("tiktok", previous.start, previous.end):
        previous_groups[row["external_id"]].append(row)
    result = []
    for external_id, points in groups.items():
        if not any(parse_time(point["observed_at"]) < window.end for point in points):
            continue
        latest = points[-1]
        deltas = {metric: metric_delta(points, metric, window) for metric in METRICS}
        before = metric_delta(previous_groups[external_id], "views", previous)
        current = deltas["views"]["week_delta"]
        old = before["week_delta"]
        wow = None
        wow_reason = "missing_comparable_full_weeks"
        if current is not None and old is not None:
            if old > 0:
                wow = round((current - old) / old * 100, 2)
                wow_reason = "same_object_full_boundary_windows"
            else:
                wow_reason = "previous_week_zero"
        result.append(
            {
                **latest,
                "evidence_id": "tiktok:" + external_id,
                "queries": sorted({q for point in points for q in point["queries"]}),
                "deltas": deltas,
                "weekly_views_wow_pct": wow,
                "wow_reason": wow_reason,
                "confidence": "observed_counter_only"
                if deltas["views"]["observed_delta"] is not None
                else "low_no_baseline",
                "limitation": "全球累计互动／实际观察区间；非 AU 观看量，非成交",
            }
        )
    return sorted(
        result,
        key=lambda row: (-(row["deltas"]["views"]["observed_delta"] or 0), row["external_id"]),
    )


def market_rows(store: Store, window: Window) -> list[dict]:
    latest: dict[str, dict] = {}
    queries: dict[str, set[str]] = defaultdict(set)
    for row in store.observations("ebay", window.start, window.end):
        if parse_time(row["observed_at"]) == window.end:
            continue
        latest[row["external_id"]] = row
        queries[row["external_id"]].update(row["queries"])
    return sorted(
        [
            {
                **row,
                "evidence_id": "ebay:" + key,
                "queries": sorted(queries[key]),
                "confidence": "listing_only",
                "limitation": "在售／相关性样本，不是成交热榜；商品所在地不是买家国家",
            }
            for key, row in latest.items()
        ],
        key=lambda row: (
            row["queries"],
            row["metrics"].get("search_rank") or 10**9,
            row["external_id"],
        ),
    )


def sales_analysis(store: Store, window: Window) -> dict:
    excluded = Counter(outside_window=0, non_au=0, unknown_buyer_country=0, non_transaction=0)
    transactions, estimates, rolling = [], [], []
    products: dict[str, dict] = {}
    for record in store.all_sales():
        if record["kind"] == "transaction":
            if not window.contains(parse_time(record["sold_at"])):
                excluded["outside_window"] += 1
                continue
            if record["buyer_country"] != "AU":
                excluded[
                    "unknown_buyer_country" if record["buyer_country"] is None else "non_au"
                ] += 1
                continue
            transactions.append(record)
            item_id = record["item_id"]
            if item_id not in products:
                products[item_id] = {
                    "item_id": item_id,
                    "title": record["title"],
                    "url": record["url"],
                    "quantity": 0,
                    "features": record["features"],
                    "buyer_country": "AU",
                    "provenance": [],
                    "marketplaces": [],
                    "records": 0,
                    "confidence": "authorized_reported_not_independently_verified",
                }
            product = products[item_id]
            product["quantity"] += record["quantity"]
            product["records"] += 1
            product["provenance"] = sorted(set(product["provenance"] + [record["provenance"]]))
            product["marketplaces"] = sorted(set(product["marketplaces"] + [record["marketplace"]]))
        else:
            excluded["non_transaction"] += 1
            start, end = parse_time(record["period_start"]), parse_time(record["period_end"])
            if record["kind"] == "period_estimate" and window.start <= start < end <= window.end:
                estimates.append(record)
            if record["kind"] == "rolling_30d" and start < window.end and end > window.start:
                rolling.append(record)
    return {
        "state": "authorized_sample" if transactions else "unknown",
        "detail": (
            "仅为有权导入、买家国家明确为 AU 的本周成交样本，未经系统独立核验，不代表全市场"
            if transactions
            else "本周 AU 买家销量未知：缺少窗口内且买家国家明确为 AU 的授权成交证据"
        ),
        "ranking": sorted(products.values(), key=lambda row: (-row["quantity"], row["item_id"])),
        "transactions": transactions,
        "period_estimates": estimates,
        "rolling_30d": rolling,
        "excluded": dict(excluded),
        "weekly_wow_pct": None,
        "wow_reason": "授权样本不保证两期覆盖一致，不能从缺少记录推断零销量",
    }


def search_analysis(settings: Settings, store: Store, window: Window, now: datetime) -> list[dict]:
    all_series = store.all_series()
    previous_dates, current_dates = window.previous().dates(), window.dates()
    result = []
    for query in settings.keywords:
        series = next((s for s in all_series if query in s["points"]), None)
        record = {
            "query": query,
            "current_mean": None,
            "previous_mean": None,
            "wow_pct": None,
            "state": "unknown",
            "reason": "no_series",
            "current_days": 0,
            "previous_days": 0,
            "geo": "AU",
            "source": None,
            "series_id": None,
            "fetched_at": None,
            "daily_points": [],
            "limitation": "单份序列内的归一化搜索兴趣，不是绝对搜索量／销量",
        }
        if not series:
            result.append(record)
            continue
        record.update(
            source=series["source"],
            series_id=series["id"],
            fetched_at=series["fetched_at"],
            granularity=series["granularity"],
            normalization=series["normalization"],
            daily_points=[
                point
                for point in series["points"][query]
                if point["date"] in previous_dates + current_dates
            ],
        )
        values = {
            point["date"]: point["value"]
            for point in series["points"][query]
            if not point["partial"] and point["value"] is not None
        }
        current = [values[day] for day in current_dates if day in values]
        previous = [values[day] for day in previous_dates if day in values]
        record.update(current_days=len(current), previous_days=len(previous))
        if series["geo"] != "AU":
            record["reason"] = "non_au_series"
        elif parse_time(series["fetched_at"]) > now + timedelta(minutes=5):
            record["reason"] = "future_acquisition_time"
        elif now - parse_time(series["fetched_at"]) > timedelta(days=3):
            record["reason"] = "stale_acquisition"
        elif series["granularity"] != "day":
            record["reason"] = "unsupported_or_sparse_granularity"
        elif len(current) != 7 or len(previous) != 7:
            record["reason"] = "missing_or_partial_daily_points"
        else:
            current_mean, previous_mean = sum(current) / 7, sum(previous) / 7
            record.update(
                current_mean=round(current_mean, 3),
                previous_mean=round(previous_mean, 3),
                state="ok",
                reason="same_series_complete_daily_windows",
            )
            if previous_mean:
                record["wow_pct"] = round((current_mean - previous_mean) / previous_mean * 100, 2)
            else:
                record["reason"] = "previous_week_zero"
        result.append(record)
    return result


def feature_counts(rows: list[dict]) -> list[dict]:
    counts = Counter(feature for row in rows for feature in set(row["features"]))
    return [
        {"feature": feature, "sample_count": n}
        for feature, n in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


def snapshot_coverage(store: Store, window: Window) -> dict:
    coverage = {}
    for source in ("ebay", "tiktok"):
        rows = [
            row
            for row in store.observations(source, window.start, window.end)
            if parse_time(row["observed_at"]) < window.end
        ]
        days = sorted(
            {
                parse_time(row["observed_at"])
                .astimezone(ZoneInfo(window.timezone))
                .date()
                .isoformat()
                for row in rows
            }
        )
        coverage[source] = {
            "unique_objects": len({row["external_id"] for row in rows}),
            "snapshots": len(rows),
            "observed_local_days": days,
            "missing_local_days": sorted(set(window.dates()) - set(days)),
        }
    return coverage


def build_report(
    settings: Settings,
    store: Store,
    window: Window,
    now: datetime,
    revision: int = 1,
) -> dict:
    sources = source_status(settings, store, now)
    market, social = market_rows(store, window), social_rows(store, window)
    sales = sales_analysis(store, window)
    search = search_analysis(settings, store, window, now)
    quality = [
        "仅覆盖受限关键词和采集样本；没有澳洲全量市场覆盖或全市场热销排名。",
        "不同平台不合成总分；在售证据、成交样本、社媒互动、搜索兴趣各自独立。",
        "观察区间不同会影响社媒增量排序；只有精确边界快照才有完整周增量。",
        "词典命中仅为标题／文案特征，不是实测性能或产品认证；缺失不是零。",
        "滚动三十天和第三方估算从未换算或混入七天 AU 买家成交。",
    ]
    if not market:
        quality.append("本周没有 eBay 在售快照；不使用今天或其他周的数据冒充本周。")
    if not social:
        quality.append("本周没有 TikTok 快照或基线；无法给出本周流量结论。")
    if not all(row["state"] == "ok" for row in search):
        quality.append("部分搜索兴趣缺少同份序列的完整可比窗口，具体原因见搜索表。")
    if sales["state"] == "unknown":
        quality.append(sales["detail"])
    degraded = any(sources[source]["state"] != "ok" for source in CORE_SOURCES)
    degraded |= not market or not social or not all(row["state"] == "ok" for row in search)
    return settings.redactor.value(
        {
            "schema_version": 1,
            "key": f"{settings.topic_id}-{settings.fingerprint}-{window.end_date}-r{revision}",
            "topic": settings.topic_name,
            "topic_id": settings.topic_id,
            "config_fingerprint": settings.fingerprint,
            "revision": revision,
            "mode": store.mode.upper(),
            "status": "degraded" if degraded else "ok",
            "generated_at": stamp(now),
            "window": window.as_dict(),
            "sources": sources,
            "coverage": snapshot_coverage(store, window),
            "ai": settings.ai_status(),
            "notification": settings.notification_status(),
            "market": market,
            "social": social,
            "sales": sales,
            "search": search,
            "features": {
                "ebay_listing_samples": feature_counts(market),
                "tiktok_content_samples": feature_counts(social),
                "authorized_au_sold_product_samples": feature_counts(sales["ranking"]),
            },
            "quality": quality,
        }
    )
