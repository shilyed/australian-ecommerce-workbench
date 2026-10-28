import json
import tempfile
import unittest
from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from au_trend_bot.config import load_settings
from au_trend_bot.http import HttpClient, Response
from au_trend_bot.models import observation
from au_trend_bot.storage import Store
from au_trend_bot.timeutil import Window, stamp


ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 10, 26, 0, tzinfo=UTC)
WINDOW = Window.ending(date(2026, 10, 26))


class FakeTransport:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def __call__(self, method, url, headers, body, timeout):
        self.calls.append(
            {"method": method, "url": url, "headers": headers, "body": body, "timeout": timeout}
        )
        if not self.replies:
            raise AssertionError("Unexpected external call: " + method)
        reply = self.replies.pop(0)
        if isinstance(reply, BaseException):
            raise reply
        if isinstance(reply, Response):
            return reply
        return Response(200, {}, json.dumps(reply).encode())


class BotTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        base = load_settings(ROOT / "config.example.toml", environ={})
        self.settings = replace(
            base,
            data_dir=self.root / "live",
            limits=replace(base.limits, http_min_interval_seconds=0, apify_poll_seconds=0),
        )
        self.store = Store(self.settings)
        self.addCleanup(self.store.close)

    def configure(self, **env):
        self.settings = replace(
            self.settings, env={"ATB_" + key: value for key, value in env.items()}
        )
        self.store.settings = self.settings
        return self.settings

    def http(self, replies):
        sender = FakeTransport(replies)
        sleeps = []
        client = HttpClient(self.settings, self.store, sender, sleeps.append, lambda: NOW)
        return client, sender, sleeps

    def social(self, when, views, *, video_id="100001", title="ceramic double wall coffee cup"):
        return observation(
            self.settings,
            "tiktok",
            video_id,
            when,
            title,
            f"https://www.tiktok.com/@demo/video/{video_id}",
            {"views": views, "likes": 5, "comments": 1, "shares": 1, "saves": None},
            {"creation_region": "AU", "audience_country": None, "buyer_country": None},
            [self.settings.keywords[0]],
        )

    def sale(self, record_id="one", quantity=2, buyer="AU", sold_at=None, kind="transaction"):
        return {
            "id": record_id,
            "source": "ebay_authorized_import",
            "item_id": "cup",
            "title": "ceramic cup",
            "url": "https://www.ebay.com.au/itm/100000000001",
            "kind": kind,
            "quantity": quantity,
            "provenance": "authorized-export",
            "sold_at": stamp(sold_at or WINDOW.start),
            "period_start": None,
            "period_end": None,
            "buyer_country": buyer,
            "marketplace": "EBAY_AU",
            "item_location_country": "AU",
            "seller_country": "CN",
            "features": ["材质: 陶瓷"],
            "verification": "authorized_reported",
        }

    def series(self, *, previous=20, current=40, when=NOW, queries=None):
        query_list = queries or self.settings.keywords
        points = {
            query: [
                {"date": day, "value": previous if n < 7 else current, "partial": False}
                for n, day in enumerate(WINDOW.previous().dates() + WINDOW.dates())
            ]
            for query in query_list
        }
        return {
            "id": "series-" + stamp(when),
            "source": "serpapi",
            "fetched_at": stamp(when),
            "points": points,
            "geo": "AU",
            "granularity": "day",
            "normalization": "one_response_0_100",
            "source_url": "https://trends.google.com/trends/",
        }

    def trends_payload(self):
        timeline = []
        for day in WINDOW.previous().dates() + WINDOW.dates():
            epoch = int(
                datetime.combine(
                    date.fromisoformat(day), time.min, ZoneInfo("Australia/Sydney")
                ).timestamp()
            )
            timeline.append(
                {
                    "timestamp": str(epoch),
                    "values": [
                        {"query": query, "value": "30", "extracted_value": 30}
                        for query in self.settings.keywords
                    ],
                }
            )
        return {
            "search_parameters": {"geo": "AU"},
            "interest_over_time": {"timeline_data": timeline},
        }


def ebay_payload(item_id="v1|100000000001|0"):
    return {
        "itemId": item_id,
        "title": "Ceramic coffee cup 350 ml",
        "itemWebUrl": "https://www.ebay.com.au/itm/100000000001?tracking=discard",
        "price": {"value": "19.95", "currency": "AUD"},
        "itemLocation": {"country": "AU"},
    }


def tiktok_payload(video_id="100001"):
    return {
        "id": video_id,
        "text": "Ceramic coffee cup 350 ml",
        "webVideoUrl": f"https://www.tiktok.com/@demo/video/{video_id}",
        "playCount": 1000,
        "diggCount": 50,
        "commentCount": 2,
        "shareCount": 3,
        "createTimeISO": stamp(NOW - timedelta(days=10)),
        "locationCreated": "AU",
    }
