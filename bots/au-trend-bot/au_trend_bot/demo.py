from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import Settings
from .http import HttpClient
from .models import observation
from .providers import trends_series
from .safety import BotError
from .service import create_report
from .storage import Store, process_lock
from .timeutil import Window, stamp


DEMO_NOW = datetime(2026, 10, 26, 0, 0, tzinfo=UTC)
DEMO_END = date(2026, 10, 26)


def seed(settings: Settings, store: Store, window: Window):
    first, last = window.start, window.end
    items = []
    for n, title in enumerate(
        (
            "Ceramic double wall coffee cup 350 ml pastel",
            "Stainless steel leakproof travel mug 500 ml camping",
        ),
        1,
    ):
        for when in (first + timedelta(hours=6), last - timedelta(hours=18)):
            items.append(
                observation(
                    settings,
                    "ebay",
                    f"demo-listing-{n}",
                    when,
                    title,
                    f"https://www.ebay.com.au/itm/{100000000000 + n}",
                    {
                        "price": str(18 + n),
                        "currency": "AUD",
                        "search_rank": n,
                        "availability": "listed",
                    },
                    {
                        "marketplace": "EBAY_AU",
                        "item_location_country": "AU",
                        "seller_country": None,
                        "buyer_country": None,
                    },
                    [settings.keywords[0]],
                )
            )
    cases = [
        ("100001", [(first, 100), (first + timedelta(days=3), 160), (last, 300)]),
        ("100002", [(first + timedelta(days=1), 200), (last - timedelta(hours=18), 350)]),
        ("100003", [(first, 500), (first + timedelta(days=3), 20), (last, 90)]),
        ("100004", [(first, 10), (first + timedelta(days=3), None), (last, 80)]),
        ("100005", [(last - timedelta(days=1), 1000)]),
    ]
    for video_id, snapshots in cases:
        for when, views in snapshots:
            items.append(
                observation(
                    settings,
                    "tiktok",
                    video_id,
                    when,
                    "DEMO ceramic double wall coffee cup 350 ml",
                    f"https://www.tiktok.com/@demo/video/{video_id}",
                    {"views": views, "likes": 12, "comments": 2, "shares": 1, "saves": None},
                    {
                        "creation_region": "AU",
                        "audience_country": None,
                        "buyer_country": None,
                        "au_context": "creation_region_AU",
                    },
                    [settings.keywords[0]],
                )
            )
    store.put_observations(items)
    sales = []
    for record_id, buyer, sold_at, quantity in (
        ("demo-au", "AU", first + timedelta(hours=1), 5),
        ("demo-us", "US", first + timedelta(hours=1), 9000),
        ("demo-unknown", None, first + timedelta(hours=1), 8000),
        ("demo-boundary-excluded", "AU", last, 7000),
    ):
        sales.append(
            {
                "id": record_id,
                "source": "ebay_authorized_import",
                "item_id": "demo-cup",
                "title": "DEMO ceramic coffee cup 350 ml",
                "url": "https://www.ebay.com.au/itm/100000000001",
                "kind": "transaction",
                "quantity": quantity,
                "provenance": "DEMO_SYNTHETIC_NOT_REAL",
                "sold_at": stamp(sold_at),
                "period_start": None,
                "period_end": None,
                "buyer_country": buyer,
                "marketplace": "EBAY_AU",
                "item_location_country": "AU",
                "seller_country": None,
                "features": ["材质: 陶瓷", "容量文案: 350 ml"],
                "verification": "DEMO_SYNTHETIC_NOT_REAL",
            }
        )
    store.put_sales(sales, DEMO_NOW)
    timeline = []
    zone = ZoneInfo(settings.timezone)
    for n, day_text in enumerate(window.previous().dates() + window.dates()):
        point_time = datetime.combine(date.fromisoformat(day_text), time.min, zone)
        timeline.append(
            {
                "timestamp": str(int(point_time.timestamp())),
                "values": [
                    {
                        "query": query,
                        "value": str(20 if n < 7 else 40),
                        "extracted_value": 20 if n < 7 else 40,
                    }
                    for query in settings.keywords
                ],
            }
        )
    store.put_series(
        trends_series(
            {"search_parameters": {"geo": "AU"}, "interest_over_time": {"timeline_data": timeline}},
            settings,
            DEMO_NOW,
            source="demo_fixture",
        )
    )


def run_demo(settings: Settings, output: Path) -> dict:
    output = output.resolve()
    live = settings.data_dir
    if output == live or output in live.parents or live in output.parents:
        raise BotError("DEMO output must be separate from the live data directory")
    isolated = replace(settings, data_dir=output, env={})
    window = Window.ending(DEMO_END, settings.timezone)
    with process_lock(output), Store(isolated, "demo") as store:
        seed(isolated, store, window)
        count_before = store.connection.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
        seed(isolated, store, window)
        count_after = store.connection.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
        report, paths = create_report(
            isolated,
            store,
            HttpClient(isolated, store),
            window,
            now=DEMO_NOW,
        )
        rows = {row["external_id"]: row for row in report["social"]}
        checks = {
            "demo_label": report["mode"] == "DEMO",
            "snapshot_idempotency": count_before == count_after,
            "only_au_in_window_sales": report["sales"]["ranking"][0]["quantity"] == 5,
            "non_au_excluded": report["sales"]["excluded"]["non_au"] == 1,
            "right_boundary_excluded": report["sales"]["excluded"]["outside_window"] == 1,
            "full_boundary_delta": rows["100001"]["deltas"]["views"]["week_delta"] == 200,
            "partial_not_weekly": rows["100002"]["deltas"]["views"]["week_delta"] is None,
            "reset_unknown": rows["100003"]["deltas"]["views"]["observed_delta"] is None,
            "missing_unknown": rows["100004"]["deltas"]["views"]["observed_delta"] is None,
            "no_baseline_unknown": rows["100005"]["deltas"]["views"]["observed_delta"] is None,
            "same_series_search": all(row["wow_pct"] == 100 for row in report["search"]),
            "ai_not_called": report["ai"]["state"] == "disabled",
            "no_deliveries": not store.deliveries(),
            "no_network_budget": not store.budgets(),
        }
        if not all(checks.values()):
            raise BotError(
                "Offline acceptance failed: " + ", ".join(k for k, v in checks.items() if not v)
            )
        return {
            "state": "ok",
            "mode": "DEMO",
            "live_verified": False,
            "checks": checks,
            "paths": paths,
        }
