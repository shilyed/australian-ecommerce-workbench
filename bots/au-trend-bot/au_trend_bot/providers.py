import base64
import hashlib
import re
import time
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Callable
from urllib.parse import quote
from zoneinfo import ZoneInfo

from .config import Settings
from .http import HttpClient, HttpError
from .models import Observation, observation
from .safety import BotError, DataError, clean_text, count, object_data, public_url
from .storage import Store, encode
from .timeutil import parse_time, stamp, utcnow


class PendingRun(BotError):
    pass


def ebay_item(
    raw: object,
    settings: Settings,
    when: datetime,
    queries: list[str],
    rank: int | None = None,
) -> Observation:
    row = object_data(raw, "eBay item")
    item_id = clean_text(row.get("itemId"), 250)
    title = clean_text(row.get("title"))
    price = object_data(row.get("price"), "eBay price")
    try:
        amount = Decimal(str(price.get("value")))
    except InvalidOperation as exc:
        raise DataError("Invalid eBay price") from exc
    currency = price.get("currency")
    if (
        not amount.is_finite()
        or amount < 0
        or not isinstance(currency, str)
        or not re.fullmatch(r"[A-Z]{3}", currency)
    ):
        raise DataError("Invalid eBay price/currency")
    location = object_data(row.get("itemLocation", {}), "eBay item location")
    country = location.get("country")
    if country is not None and (
        not isinstance(country, str) or not re.fullmatch(r"[A-Z]{2}", country)
    ):
        raise DataError("Invalid eBay item location country")
    return observation(
        settings,
        "ebay",
        item_id,
        when,
        title,
        public_url(row.get("itemWebUrl"), ("ebay.com.au", "ebay.com")),
        {"price": str(amount), "currency": currency, "search_rank": rank, "availability": "listed"},
        {
            "marketplace": "EBAY_AU",
            "item_location_country": country,
            "seller_country": None,
            "buyer_country": None,
        },
        queries,
    )


class EbayProvider:
    def __init__(
        self, settings: Settings, store: Store, client: HttpClient, clock: Callable = utcnow
    ):
        self.settings, self.store, self.client, self.clock = settings, store, client, clock

    def token(self) -> str:
        if self.settings.get("EBAY_ACCESS_TOKEN"):
            return self.settings.get("EBAY_ACCESS_TOKEN")
        credential = (
            self.settings.get("EBAY_CLIENT_ID") + ":" + self.settings.get("EBAY_CLIENT_SECRET")
        ).encode()
        result = object_data(
            self.client.request(
                "POST",
                "https://api.ebay.com/identity/v1/oauth2/token",
                headers={"Authorization": "Basic " + base64.b64encode(credential).decode()},
                form={
                    "grant_type": "client_credentials",
                    "scope": "https://api.ebay.com/oauth/api_scope",
                },
                retry_safe=True,
            ),
            "eBay OAuth",
        )
        token = result.get("access_token")
        if not isinstance(token, str) or not token:
            raise DataError("eBay OAuth did not return an application token")
        return token

    def collect(self) -> dict:
        headers = {
            "Authorization": "Bearer " + self.token(),
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_AU",
            "Accept-Language": "en-AU",
        }
        known = self.store.known("ebay", self.settings.limits.refresh_limit)
        items: list[Observation] = []
        discovered: set[str] = set()
        warnings = False
        for keyword in self.settings.keywords:
            result = object_data(
                self.client.request(
                    "GET",
                    "https://api.ebay.com/buy/browse/v1/item_summary/search",
                    headers=headers,
                    query={"q": keyword, "limit": self.settings.limits.items_per_query},
                ),
                "eBay search",
            )
            if result.get("errors"):
                raise DataError("eBay returned application-level errors; details withheld")
            warnings |= bool(result.get("warnings"))
            rows = result.get("itemSummaries")
            if rows is None and result.get("total") == 0:
                rows = []
            if not isinstance(rows, list) or len(rows) > self.settings.limits.items_per_query:
                raise DataError("Invalid or oversized eBay search sample")
            when = self.clock()
            for rank, row in enumerate(rows, 1):
                item = ebay_item(row, self.settings, when, [keyword], rank)
                items.append(item)
                discovered.add(item.external_id)
        for previous in known:
            if previous["external_id"] in discovered:
                continue
            try:
                row = self.client.request(
                    "GET",
                    "https://api.ebay.com/buy/browse/v1/item/"
                    + quote(previous["external_id"], safe=""),
                    headers=headers,
                )
                items.append(ebay_item(row, self.settings, self.clock(), previous["queries"]))
            except HttpError as exc:
                if exc.status != 404:
                    raise
                items.append(
                    observation(
                        self.settings,
                        "ebay",
                        previous["external_id"],
                        self.clock(),
                        previous["title"],
                        previous["url"],
                        {
                            "price": None,
                            "currency": None,
                            "search_rank": None,
                            "availability": "not_found",
                        },
                        previous["geography"],
                        previous["queries"],
                    )
                )
        inserted = self.store.put_observations(items)
        return {
            "state": "partial" if warnings else ("ok" if items else "empty"),
            "detail": (
                "eBay 返回警告，样本可能不完整；在售证据不是成交"
                if warnings
                else "AU 站点在售样本；没有买家国家或本周销量证明"
            ),
            "items": len({i.external_id for i in items}),
            "new_snapshots": inserted,
        }


def tiktok_item(raw: object, settings: Settings, when: datetime, queries: list[str]) -> Observation:
    row = object_data(raw, "TikTok video")
    if row.get("error") or row.get("errorDescription"):
        raise DataError("TikTok actor returned an error record")
    video_id = clean_text(row.get("id"), 100)
    if not re.fullmatch(r"\d{5,30}", video_id):
        raise DataError("Invalid TikTok video ID")
    url = public_url(row.get("webVideoUrl"), ("tiktok.com",))
    if not url.endswith("/video/" + video_id):
        raise DataError("TikTok video ID does not match its public URL")
    created = row.get("createTimeISO")
    try:
        if created is not None:
            created = stamp(parse_time(created))
        elif row.get("createTime") is not None:
            epoch = count(row["createTime"], "createTime", optional=False)
            created = stamp(datetime.fromtimestamp(epoch, UTC))
    except (ValueError, TypeError, OverflowError, OSError) as exc:
        raise DataError("Invalid TikTok creation timestamp") from exc
    if created and parse_time(created) > when + timedelta(minutes=5):
        raise DataError("TikTok creation timestamp is later than its observation")
    country = row.get("locationCreated")
    if country is not None and (
        not isinstance(country, str) or not re.fullmatch(r"[A-Z]{2}", country)
    ):
        raise DataError("Invalid TikTok content-creation region")
    query = row.get("searchQuery")
    if query is not None and not isinstance(query, str):
        raise DataError("Invalid TikTok query metadata")
    title = clean_text(row.get("text", ""))
    au_signals = [
        term
        for term in ("australia", "australian", "sydney", "melbourne")
        if re.search(r"(?<!\w)" + term + r"(?!\w)", title, re.I)
    ]
    metrics = {
        target: count(row.get(source), source)
        for source, target in (
            ("playCount", "views"),
            ("diggCount", "likes"),
            ("commentCount", "comments"),
            ("shareCount", "shares"),
            ("collectCount", "saves"),
        )
    }
    return observation(
        settings,
        "tiktok",
        video_id,
        when,
        title,
        url,
        metrics,
        {
            "creation_region": country,
            "creator_country": None,
            "audience_country": None,
            "buyer_country": None,
            "au_text_signals": au_signals,
            "au_context": "creation_region_AU" if country == "AU" else "keyword_context_only",
        },
        [query] if query else queries,
        created,
        "actor_run_finished_at",
    )


def api_id(value: object, field: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9]{5,80}", value):
        raise DataError(f"Invalid Apify {field}")
    return value


class TikTokProvider:
    actor = "clockworks~tiktok-scraper"
    actor_id = "GdWCkxBtKWOsKjdch"

    def __init__(
        self,
        settings: Settings,
        store: Store,
        client: HttpClient,
        clock: Callable = utcnow,
        sleeper: Callable = time.sleep,
    ):
        self.settings, self.store, self.client = settings, store, client
        self.clock, self.sleep = clock, sleeper
        self.headers = {"Authorization": "Bearer " + settings.get("APIFY_TOKEN")}

    def job_key(self, kind: str) -> str:
        day = self.clock().astimezone(ZoneInfo(self.settings.timezone)).date().isoformat()
        return f"apify:{day}:{kind}"

    def run(self, kind: str, inputs: dict, cap: int, *, key_override: str | None = None) -> int:
        key = key_override or self.job_key(kind)
        job = self.store.job(key)
        if job and job["state"] == "ok":
            return job["payload"]["items"]
        if job and job["state"] in ("launching", "uncertain", "failed"):
            raise BotError(
                f"Apify job {key} needs operator reconciliation; automatic relaunch is forbidden"
            )
        if not job:
            now = self.clock()
            day = now.astimezone(ZoneInfo(self.settings.timezone)).date().isoformat()
            limits = self.settings.limits
            self.store.reserve(
                [
                    (day, "apify_runs", 1, limits.apify_runs_per_day),
                    (
                        day[:7],
                        "apify_cents_reserved",
                        limits.apify_run_max_cents,
                        limits.apify_monthly_max_cents,
                    ),
                ]
            )
            self.store.set_job(key, "apify", "launching", {"input": inputs, "cap": cap}, now)
            try:
                reply = object_data(
                    self.client.request(
                        "POST",
                        f"https://api.apify.com/v2/actors/{self.actor}/runs",
                        headers=self.headers,
                        query={
                            "timeout": limits.apify_timeout_seconds,
                            "memory": 512,
                            "waitForFinish": 0,
                            "maxItems": cap,
                            "maxTotalChargeUsd": f"{limits.apify_run_max_cents / 100:.2f}",
                            "restartOnError": "false",
                        },
                        payload=inputs,
                        retry_safe=False,
                    ),
                    "Apify start",
                )
                run_id = api_id(object_data(reply.get("data"), "Apify run").get("id"), "run ID")
            except BotError as exc:
                self.store.set_job(
                    key,
                    "apify",
                    "uncertain",
                    {
                        "input": inputs,
                        "cap": cap,
                        "detail": str(exc),
                    },
                    self.clock(),
                )
                raise
            self.store.set_job(
                key,
                "apify",
                "running",
                {
                    "run_id": run_id,
                    "input": inputs,
                    "cap": cap,
                },
                self.clock(),
            )
            job = self.store.job(key)
        payload = job["payload"]
        run_id = api_id(payload.get("run_id"), "run ID")
        deadline = time.monotonic() + self.settings.limits.apify_poll_seconds
        while True:
            reply = object_data(
                self.client.request(
                    "GET",
                    "https://api.apify.com/v2/actor-runs/" + run_id,
                    headers=self.headers,
                ),
                "Apify run status",
            )
            run = object_data(reply.get("data"), "Apify run")
            if run.get("id") != run_id:
                raise DataError("Apify status response does not match the requested run")
            if run.get("actId") != self.actor_id:
                raise DataError("Apify run belongs to an unexpected actor")
            status = run.get("status")
            if status == "SUCCEEDED":
                break
            if status in ("FAILED", "TIMED-OUT", "ABORTED"):
                self.store.set_job(
                    key, "apify", "failed", {**payload, "detail": status}, self.clock()
                )
                raise BotError(f"Apify run ended with {status}; no automatic paid relaunch")
            if status not in ("READY", "RUNNING", "TIMING-OUT", "ABORTING"):
                raise DataError("Unknown Apify run status")
            if time.monotonic() >= deadline:
                raise PendingRun(f"Apify {key} still running; next collection resumes run {run_id}")
            self.sleep(min(2, max(0, deadline - time.monotonic())))
        dataset_id = api_id(run.get("defaultDatasetId"), "dataset ID")
        try:
            observed = parse_time(run["finishedAt"])
        except (KeyError, TypeError, ValueError) as exc:
            raise DataError("Apify successful run lacks a valid finishedAt timestamp") from exc
        if observed > self.clock() + timedelta(minutes=5):
            raise DataError("Apify run timestamp is in the future")
        saved_cap = payload["cap"]
        rows = self.client.request(
            "GET",
            f"https://api.apify.com/v2/datasets/{dataset_id}/items",
            headers=self.headers,
            query={"format": "json", "clean": "true", "limit": saved_cap + 1},
        )
        if not isinstance(rows, list) or len(rows) > saved_cap + 1:
            raise DataError("Apify dataset invalid or ignored the requested response-size limit")
        truncated = len(rows) > saved_cap
        rows = rows[:saved_cap]
        previous = {row["external_id"]: row for row in self.store.known("tiktok", 100)}
        inputs = payload["input"]
        unique: dict[str, Observation] = {}
        conflicts: set[str] = set()
        for raw in rows:
            row = object_data(raw, "TikTok dataset row")
            video_id = clean_text(row.get("id"), 100)
            fallback_queries = inputs.get(
                "searchQueries", previous.get(video_id, {}).get("queries", [])
            )
            item = tiktok_item(row, self.settings, observed, fallback_queries)
            existing = unique.get(item.external_id)
            if existing is None:
                unique[item.external_id] = item
                continue
            existing.queries = sorted(set(existing.queries + item.queries))
            if (
                existing.metrics != item.metrics
                or existing.geography != item.geography
                or existing.title != item.title
            ):
                conflicts.add(item.external_id)
                existing.metrics = {
                    name: value if value == item.metrics[name] else None
                    for name, value in existing.metrics.items()
                }
                existing.geography = {
                    name: value if value == item.geography.get(name) else None
                    for name, value in existing.geography.items()
                }
                existing.geography["au_context"] = "conflicting_duplicate_metadata"
                existing.features = sorted(set(existing.features) & set(item.features))
                existing.time_basis = "actor_run_finished_at_duplicate_conflict_unknown"
        items = list(unique.values())
        self.store.put_observations(items)
        n_items = len({item.external_id for item in items})
        self.store.set_job(
            key,
            "apify",
            "ok",
            {
                **payload,
                "items": n_items,
                "observed_at": stamp(observed),
                "duplicate_conflicts": len(conflicts),
                "dataset_truncated": truncated,
            },
            self.clock(),
        )
        return n_items

    def collect(self) -> dict:
        for job in self.store.jobs("apify"):
            if job["key"].split(":")[1] != self.job_key("discover").split(":")[1] and job[
                "state"
            ] in (
                "running",
                "launching",
                "uncertain",
            ):
                self.run(
                    job["key"].rsplit(":", 1)[-1],
                    job["payload"]["input"],
                    job["payload"]["cap"],
                    key_override=job["key"],
                )
        common = {
            "shouldDownloadVideos": False,
            "shouldDownloadCovers": False,
            "shouldDownloadAvatars": False,
            "shouldDownloadSlideshowImages": False,
            "shouldDownloadMusicCovers": False,
            "scrapeRelatedVideos": False,
            "downloadSubtitlesOptions": "NEVER_DOWNLOAD_SUBTITLES",
            "aiVideoDescription": False,
            "aiVideoSummary": False,
            "commentsPerPost": 0,
            "maxFollowersPerProfile": 0,
            "maxFollowingPerProfile": 0,
        }
        count_discovered = self.run(
            "discover",
            {
                **common,
                "searchQueries": [f"{keyword} Australia" for keyword in self.settings.keywords],
                "searchSection": "/video",
                "resultsPerPage": self.settings.limits.items_per_query,
            },
            len(self.settings.keywords) * self.settings.limits.items_per_query,
        )
        today = self.clock().astimezone(ZoneInfo(self.settings.timezone)).date()
        midnight = datetime.combine(today, datetime.min.time(), ZoneInfo(self.settings.timezone))
        known = self.store.known("tiktok", self.settings.limits.refresh_limit, before=midnight)
        refresh_job = self.store.job(self.job_key("refresh"))
        count_refreshed = 0
        if known or refresh_job:
            count_refreshed = self.run(
                "refresh",
                {**common, "postURLs": [row["url"] for row in known], "resultsPerPage": 1},
                len(known),
            )
        jobs = [self.store.job(self.job_key(kind)) for kind in ("discover", "refresh")]
        partial = any(
            job
            and (
                job["payload"].get("duplicate_conflicts") or job["payload"].get("dataset_truncated")
            )
            for job in jobs
        )
        return {
            "state": ("partial" if partial else "ok")
            if count_discovered + count_refreshed
            else "empty",
            "detail": (
                "样本被数量上限截断或 run 内重复对象冲突；冲突指标置未知，未宣称完整采集"
                if partial
                else "公开累计互动；创作地区不是观众地区，不能据此计算 AU 销量"
            ),
            "items": count_discovered + count_refreshed,
        }

    def attach_run(self, key: str, run_id: str) -> dict:
        job = self.store.job(key)
        if not job or job["kind"] != "apify" or job["state"] not in ("launching", "uncertain"):
            raise BotError("Only an uncertain Apify launch can be reconciled")
        run_id = api_id(run_id, "run ID")
        reply = object_data(
            self.client.request(
                "GET",
                "https://api.apify.com/v2/actor-runs/" + run_id,
                headers=self.headers,
            ),
            "Apify reconciliation",
        )
        run = object_data(reply.get("data"), "Apify reconciliation run")
        if run.get("actId") != self.actor_id or run.get("id") != run_id:
            raise DataError("Reconciled run does not belong to the configured actor")
        self.store.set_job(
            key, "apify", "running", {**job["payload"], "run_id": run_id}, self.clock()
        )
        return {
            "key": key,
            "state": "ok",
            "run_state": "running",
            "detail": "下次采集将复用该 run，不重新收费启动",
        }


def trends_series(
    raw: object,
    settings: Settings,
    when: datetime,
    *,
    source: str = "serpapi",
) -> dict:
    result = object_data(raw, "Google Trends")
    if result.get("error"):
        raise DataError("Google Trends backend returned an application error; body withheld")
    params = object_data(result.get("search_parameters", {}), "Trends parameters")
    if params.get("geo", "AU") != "AU":
        raise DataError("Google Trends returned a non-AU region")
    timeline = object_data(result.get("interest_over_time"), "Trends interest_over_time").get(
        "timeline_data"
    )
    if not isinstance(timeline, list) or len(timeline) > 500:
        raise DataError("Invalid or oversized Trends timeline")
    points: dict[str, list[dict]] = {keyword: [] for keyword in settings.keywords}
    timestamps: list[int] = []
    zone = ZoneInfo(settings.timezone)
    for raw_row in timeline:
        row = object_data(raw_row, "Trends point")
        epoch = row.get("timestamp")
        if not isinstance(epoch, (str, int)) or isinstance(epoch, bool) or not str(epoch).isdigit():
            raise DataError("Invalid Trends epoch")
        try:
            point_time = datetime.fromtimestamp(int(epoch), UTC)
        except (ValueError, OverflowError, OSError) as exc:
            raise DataError("Invalid Trends timestamp") from exc
        timestamps.append(int(epoch))
        values = row.get("values")
        if not isinstance(values, list) or len(values) != len(settings.keywords):
            raise DataError("Trends query coverage changed inside one response")
        used: set[str] = set()
        for raw_value in values:
            value = object_data(raw_value, "Trends query value")
            query = value.get("query")
            if query is None:
                index = value.get("query_index", 0 if len(settings.keywords) == 1 else None)
                if (
                    isinstance(index, bool)
                    or not isinstance(index, int)
                    or not 0 <= index < len(settings.keywords)
                ):
                    raise DataError("Trends response lacks unambiguous query identity")
                query = settings.keywords[index]
            if not isinstance(query, str) or query not in points or query in used:
                raise DataError("Unexpected or duplicate Trends query")
            used.add(query)
            raw_number = value.get("extracted_value")
            number = None if value.get("value") == "<1" else count(raw_number, "Trends value")
            if number is not None and number > 100:
                raise DataError("Trends interest must be normalized to 0-100")
            partial = row.get("isPartial", row.get("partial", False))
            if not isinstance(partial, bool):
                raise DataError("Invalid Trends partial-point flag")
            day = point_time.astimezone(zone).date()
            points[query].append(
                {
                    "date": day.isoformat(),
                    "value": number,
                    "partial": partial or day >= when.astimezone(zone).date(),
                }
            )
    ordered = sorted(timestamps)
    daily = len(ordered) >= 2 and all(
        23 * 3600 <= b - a <= 25 * 3600 for a, b in zip(ordered, ordered[1:])
    )
    if len(set(timestamps)) != len(timestamps):
        raise DataError("Duplicate Trends timestamps")
    identity = {"source": source, "fetched_at": stamp(when), "points": points}
    return {
        **identity,
        "id": hashlib.sha256(encode(identity).encode()).hexdigest(),
        "geo": "AU",
        "granularity": "day" if daily else "unsupported_or_sparse",
        "normalization": "one_response_0_100",
        "source_url": "https://trends.google.com/trends/",
        "request": {"keywords": list(settings.keywords), "geo": "AU", "data_type": "TIMESERIES"},
    }


class TrendsProvider:
    def __init__(
        self, settings: Settings, store: Store, client: HttpClient, clock: Callable = utcnow
    ):
        self.settings, self.store, self.client, self.clock = settings, store, client, clock

    def collect(self) -> dict:
        now = self.clock()
        local = now.astimezone(ZoneInfo(self.settings.timezone))
        day = local.date().isoformat()
        self.store.reserve([(day, "serpapi_calls", 1, self.settings.limits.serpapi_calls_per_day)])
        date_range = (
            f"{(local.date() - timedelta(days=89)).isoformat()} "
            f"{(local.date() - timedelta(days=1)).isoformat()}"
        )
        response = self.client.request(
            "GET",
            "https://serpapi.com/search.json",
            query={
                "engine": "google_trends",
                "q": ",".join(self.settings.keywords),
                "geo": "AU",
                "data_type": "TIMESERIES",
                "date": date_range,
                "tz": -int(local.utcoffset().total_seconds() // 60),
                "api_key": self.settings.get("SERPAPI_KEY"),
            },
            retry_safe=False,
        )
        series = trends_series(response, self.settings, self.clock())
        series["request"]["date"] = date_range
        self.store.put_series(series)
        n_points = sum(len(p) for p in series["points"].values())
        return {
            "state": ("partial" if series["granularity"] != "day" else "ok")
            if n_points
            else "empty",
            "detail": "AU 搜索兴趣；单份归一化序列，非搜索量／销量；缺失或非日粒度不计算周环比",
            "items": n_points,
            "series_id": series["id"],
        }
