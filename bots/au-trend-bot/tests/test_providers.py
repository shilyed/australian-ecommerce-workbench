import csv
import io
import json
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

from au_trend_bot.http import HttpError, NoRedirect, Response
from au_trend_bot.imports import SALES_COLUMNS, import_sales, import_trends
from au_trend_bot.providers import (
    EbayProvider,
    PendingRun,
    TikTokProvider,
    TrendsProvider,
    ebay_item,
    tiktok_item,
    trends_series,
)
from au_trend_bot.safety import BotError, BudgetError, DataError
from au_trend_bot.timeutil import stamp

from .support import NOW, WINDOW, BotTest, ebay_payload, tiktok_payload


class HttpTests(BotTest):
    def test_safe_get_retries_are_bounded_and_each_attempt_is_budgeted(self):
        client, sender, sleeps = self.http(
            [
                Response(429, {"Retry-After": "1000"}, b"secret-error"),
                Response(503, {}, b"secret-error"),
                {"ok": True},
            ]
        )
        self.assertEqual(client.request("GET", "https://api.ebay.com/test"), {"ok": True})
        self.assertEqual(len(sender.calls), 3)
        self.assertEqual(sleeps[0], 10)
        self.assertEqual(self.store.budgets()[0]["used"], 3)

    def test_chargeable_post_not_retried_and_remote_error_body_is_not_exposed(self):
        client, sender, _ = self.http([Response(503, {}, b"secret-private-token")])
        with self.assertRaises(HttpError) as error:
            client.request("POST", "https://api.apify.com/test", payload={})
        self.assertEqual(len(sender.calls), 1)
        self.assertNotIn("secret-private-token", str(error.exception))

    def test_paid_get_can_explicitly_disable_retry(self):
        client, sender, _ = self.http([HttpError(0, "safe network failure")])
        with self.assertRaises(HttpError):
            client.request("GET", "https://serpapi.com/search.json", retry_safe=False)
        self.assertEqual(len(sender.calls), 1)

    def test_redirect_is_not_followed_with_credentials(self):
        self.assertIsNone(
            NoRedirect().redirect_request(None, None, 302, "", {}, "https://elsewhere.test")
        )
        client, sender, _ = self.http([Response(302, {"Location": "https://elsewhere.test"}, b"")])
        with self.assertRaises(HttpError):
            client.request(
                "GET", "https://api.ebay.com/test", headers={"Authorization": "Bearer fake"}
            )
        self.assertEqual(len(sender.calls), 1)

    def test_invalid_json_and_insecure_endpoint_fail_explicitly(self):
        client, sender, _ = self.http([Response(200, {}, b"not-json")])
        with self.assertRaises(DataError):
            client.request("GET", "https://api.ebay.com/test")
        with self.assertRaises(BotError):
            client.request("GET", "http://api.ebay.com/test")
        self.assertEqual(len(sender.calls), 1)

    def test_scheduler_activity_hook_runs_for_each_bounded_http_attempt(self):
        client, _, _ = self.http([Response(503, {}, b""), {"ok": True}])
        activity = []
        client.activity = lambda: activity.append("active")
        client.request("GET", "https://api.ebay.com/test")
        self.assertEqual(activity, ["active", "active"])

    def test_budget_reservation_is_atomic(self):
        self.store.reserve([("2026-10", "apify_cents", 50, 50)])
        with self.assertRaises(BudgetError):
            self.store.reserve(
                [
                    ("2026-10-26", "apify_runs", 1, 2),
                    ("2026-10", "apify_cents", 50, 50),
                ]
            )
        self.assertFalse(any(row["kind"] == "apify_runs" for row in self.store.budgets()))


class EbayTests(BotTest):
    def test_official_application_oauth_and_au_browse_headers(self):
        self.configure(EBAY_CLIENT_ID="fake-id", EBAY_CLIENT_SECRET="fake-secret")
        client, sender, _ = self.http(
            [
                {"access_token": "runtime-token"},
                {"itemSummaries": [ebay_payload()]},
                {"total": 0},
                {"total": 0},
            ]
        )
        result = EbayProvider(self.settings, self.store, client, lambda: NOW).collect()
        self.assertEqual(result["state"], "ok")
        self.assertEqual(sender.calls[0]["method"], "POST")
        self.assertIn(b"grant_type=client_credentials", sender.calls[0]["body"])
        self.assertEqual(sender.calls[1]["headers"]["X-EBAY-C-MARKETPLACE-ID"], "EBAY_AU")
        self.assertEqual(len(self.store.observations("ebay")), 1)
        self.assertNotIn("?", self.store.observations("ebay")[0]["url"])

    def test_missing_listing_on_refresh_is_not_inferred_sale(self):
        self.configure(EBAY_ACCESS_TOKEN="fake-token")
        self.store.put_observations(
            [ebay_item(ebay_payload(), self.settings, NOW - timedelta(days=1), ["coffee cup"])]
        )
        client, _, _ = self.http([{"total": 0}, {"total": 0}, {"total": 0}, Response(404, {}, b"")])
        result = EbayProvider(self.settings, self.store, client, lambda: NOW).collect()
        self.assertEqual(result["state"], "ok")
        latest = self.store.known("ebay", 1)[0]
        self.assertEqual(latest["metrics"]["availability"], "not_found")
        self.assertIsNone(latest["metrics"]["price"])
        self.assertEqual(self.store.all_sales(), [])

    def test_empty_and_format_error_are_not_the_same(self):
        self.configure(EBAY_ACCESS_TOKEN="fake-token")
        client, _, _ = self.http([{"total": 0}] * 3)
        self.assertEqual(
            EbayProvider(self.settings, self.store, client, lambda: NOW).collect()["state"], "empty"
        )
        client, _, _ = self.http([{}])
        with self.assertRaises(DataError):
            EbayProvider(self.settings, self.store, client, lambda: NOW).collect()

    def test_invalid_prices_and_unsafe_links_are_rejected(self):
        for value in ("NaN", "-1", "Infinity", "not-price"):
            row = ebay_payload()
            row["price"]["value"] = value
            with self.subTest(value=value), self.assertRaises(DataError):
                ebay_item(row, self.settings, NOW, ["coffee cup"])
        row = ebay_payload()
        row["itemWebUrl"] = "javascript:alert(1)"
        with self.assertRaises(DataError):
            ebay_item(row, self.settings, NOW, [])


class TikTokTests(BotTest):
    def setUp(self):
        super().setUp()
        self.configure(APIFY_TOKEN="fake-token", ALLOW_PAID_PROVIDERS="true")

    def success_run(self, run_id="RUN000001"):
        return {
            "data": {
                "id": run_id,
                "actId": TikTokProvider.actor_id,
                "status": "SUCCEEDED",
                "defaultDatasetId": "DATA00001",
                "finishedAt": stamp(NOW),
            }
        }

    def test_actor_input_output_caps_and_idempotent_reuse(self):
        client, sender, _ = self.http(
            [
                {"data": {"id": "RUN000001"}},
                self.success_run(),
                [tiktok_payload()],
            ]
        )
        provider = TikTokProvider(self.settings, self.store, client, lambda: NOW)
        self.assertEqual(provider.collect()["state"], "ok")
        self.assertEqual(provider.collect()["state"], "ok")
        self.assertEqual(len(sender.calls), 3)
        start = sender.calls[0]
        self.assertIn("/v2/actors/clockworks~tiktok-scraper/runs", start["url"])
        query = parse_qs(urlsplit(start["url"]).query)
        self.assertEqual(query["maxTotalChargeUsd"], ["0.50"])
        self.assertEqual(query["maxItems"], ["30"])
        inputs = json.loads(start["body"])
        self.assertEqual(inputs["searchSection"], "/video")
        self.assertEqual(
            inputs["searchQueries"], [f"{q} Australia" for q in self.settings.keywords]
        )
        self.assertFalse(inputs["shouldDownloadVideos"])
        self.assertFalse(inputs["aiVideoSummary"])
        latest = self.store.known("tiktok", 1)[0]
        self.assertEqual(latest["metrics"]["views"], 1000)
        self.assertIsNone(latest["metrics"]["saves"])
        self.assertIsNone(latest["geography"]["audience_country"])

    def test_pending_run_resumes_without_second_paid_start(self):
        pending = {
            "data": {"id": "RUN000001", "actId": TikTokProvider.actor_id, "status": "RUNNING"}
        }
        client, sender, _ = self.http(
            [
                {"data": {"id": "RUN000001"}},
                pending,
                self.success_run(),
                [tiktok_payload()],
            ]
        )
        provider = TikTokProvider(self.settings, self.store, client, lambda: NOW)
        with self.assertRaises(PendingRun):
            provider.collect()
        self.assertEqual(provider.collect()["state"], "ok")
        self.assertEqual(sum(call["method"] == "POST" for call in sender.calls), 1)

    def test_uncertain_launch_blocks_automatic_paid_relaunch(self):
        client, sender, _ = self.http([HttpError(0, "safe timeout")])
        provider = TikTokProvider(self.settings, self.store, client, lambda: NOW)
        with self.assertRaises(HttpError):
            provider.collect()
        with self.assertRaises(BotError):
            provider.collect()
        self.assertEqual(len(sender.calls), 1)
        job = self.store.job(provider.job_key("discover"))
        self.assertEqual(job["state"], "uncertain")
        self.assertNotIn("fake-token", json.dumps(job))

    def test_run_actor_identity_is_verified(self):
        run = self.success_run()
        run["data"]["actId"] = "OTHERACTOR"
        client, _, _ = self.http([{"data": {"id": "RUN000001"}}, run])
        with self.assertRaises(DataError):
            TikTokProvider(self.settings, self.store, client, lambda: NOW).collect()

    def test_run_id_mismatch_and_unhashable_external_ids_are_data_errors(self):
        client, _, _ = self.http(
            [
                {"data": {"id": "RUN000001"}},
                self.success_run("RUN000002"),
            ]
        )
        with self.assertRaises(DataError):
            TikTokProvider(self.settings, self.store, client, lambda: NOW).collect()
        row = tiktok_payload()
        row["id"] = []
        with self.assertRaises(DataError):
            tiktok_item(row, self.settings, NOW, [])

    def test_invalid_or_future_creation_time_is_rejected(self):
        row = tiktok_payload()
        for created in (123, stamp(NOW + timedelta(days=1))):
            row["createTimeISO"] = created
            with self.subTest(created=created), self.assertRaises(DataError):
                tiktok_item(row, self.settings, NOW, [])

    def test_old_day_known_run_is_resumed_before_any_new_day_start(self):
        key = "apify:2026-10-25:discover"
        self.store.set_job(
            key,
            "apify",
            "running",
            {
                "run_id": "RUN000001",
                "input": {"searchQueries": ["coffee cup"]},
                "cap": 10,
            },
            NOW - timedelta(days=1),
        )
        client, sender, _ = self.http(
            [
                self.success_run(),
                [tiktok_payload()],
                {"data": {"id": "RUN000002"}},
                self.success_run("RUN000002"),
                [tiktok_payload()],
            ]
        )
        TikTokProvider(self.settings, self.store, client, lambda: NOW).collect()
        self.assertEqual(sender.calls[0]["method"], "GET")
        self.assertIn("actor-runs/RUN000001", sender.calls[0]["url"])
        self.assertEqual(self.store.job(key)["state"], "ok")

    def test_unknown_counts_are_preserved_and_invalid_counts_not_coerced(self):
        row = tiktok_payload()
        row.pop("playCount")
        self.assertIsNone(tiktok_item(row, self.settings, NOW, []).metrics["views"])
        for invalid in (-1, 1.2, True, "1000"):
            row["playCount"] = invalid
            with self.subTest(invalid=invalid), self.assertRaises(DataError):
                tiktok_item(row, self.settings, NOW, [])

    def test_cross_query_duplicate_counter_conflict_is_unknown_not_maximum(self):
        first, changed = tiktok_payload(), tiktok_payload()
        first["searchQuery"] = "coffee cup Australia"
        changed.update(playCount=2000, searchQuery="travel mug Australia")
        client, _, _ = self.http(
            [
                {"data": {"id": "RUN000001"}},
                self.success_run(),
                [first, changed],
            ]
        )
        result = TikTokProvider(self.settings, self.store, client, lambda: NOW).collect()
        self.assertEqual(result["state"], "partial")
        rows = self.store.observations("tiktok")
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]["metrics"]["views"])
        self.assertEqual(rows[0]["metrics"]["likes"], 50)
        self.assertEqual(rows[0]["queries"], ["coffee cup Australia", "travel mug Australia"])

    def test_dataset_sentinel_exposes_truncation_without_claiming_full_success(self):
        rows = [tiktok_payload(str(100001 + n)) for n in range(31)]
        client, _, _ = self.http(
            [
                {"data": {"id": "RUN000001"}},
                self.success_run(),
                rows,
            ]
        )
        result = TikTokProvider(self.settings, self.store, client, lambda: NOW).collect()
        self.assertEqual(result["state"], "partial")
        self.assertEqual(len(self.store.observations("tiktok")), 30)

    def test_new_discovery_does_not_starve_refresh_of_older_known_videos(self):
        self.store.put_observations([self.social(NOW - timedelta(days=2), 50)])
        discovered = [tiktok_payload(str(110001 + n)) for n in range(30)]
        client, sender, _ = self.http(
            [
                {"data": {"id": "RUN000001"}},
                self.success_run(),
                discovered,
                {"data": {"id": "RUN000002"}},
                self.success_run("RUN000002"),
                [tiktok_payload()],
            ]
        )
        result = TikTokProvider(self.settings, self.store, client, lambda: NOW).collect()
        self.assertEqual(result["state"], "ok")
        posts = [call for call in sender.calls if call["method"] == "POST"]
        self.assertEqual(len(posts), 2)
        self.assertEqual(
            json.loads(posts[1]["body"])["postURLs"],
            ["https://www.tiktok.com/@demo/video/100001"],
        )
        self.assertEqual(len(self.store.known("tiktok", 100)), 31)


class TrendsTests(BotTest):
    def setUp(self):
        super().setUp()
        self.configure(SERPAPI_KEY="fake-serp-key", ALLOW_PAID_PROVIDERS="true")

    def test_real_request_au_same_query_group_date_range_and_daily_normalization(self):
        client, sender, _ = self.http([self.trends_payload()])
        result = TrendsProvider(self.settings, self.store, client, lambda: NOW).collect()
        self.assertEqual(result["state"], "ok")
        query = parse_qs(urlsplit(sender.calls[0]["url"]).query)
        self.assertEqual(query["engine"], ["google_trends"])
        self.assertEqual(query["geo"], ["AU"])
        self.assertEqual(query["data_type"], ["TIMESERIES"])
        self.assertEqual(query["tz"], ["-660"])
        self.assertEqual(len(query["q"][0].split(",")), 3)
        self.assertEqual(self.store.all_series()[0]["granularity"], "day")
        with self.assertRaises(BudgetError):
            TrendsProvider(self.settings, self.store, client, lambda: NOW).collect()
        self.assertEqual(len(sender.calls), 1)

    def test_query_index_fallback_is_verified(self):
        payload = self.trends_payload()
        for point in payload["interest_over_time"]["timeline_data"]:
            for index, value in enumerate(point["values"]):
                value.pop("query")
                value["query_index"] = index
        series = trends_series(payload, self.settings, NOW)
        self.assertEqual(set(series["points"]), set(self.settings.keywords))

    def test_non_au_and_wrong_query_identity_are_rejected(self):
        payload = self.trends_payload()
        payload["search_parameters"]["geo"] = "US"
        with self.assertRaises(DataError):
            trends_series(payload, self.settings, NOW)
        payload = self.trends_payload()
        payload["interest_over_time"]["timeline_data"][0]["values"][0]["query"] = []
        with self.assertRaises(DataError):
            trends_series(payload, self.settings, NOW)
        payload = self.trends_payload()
        payload["interest_over_time"]["timeline_data"][0]["values"][0]["query"] = "other"
        with self.assertRaises(DataError):
            trends_series(payload, self.settings, NOW)

    def test_less_than_one_is_unknown_not_invented_half_or_zero(self):
        payload = self.trends_payload()
        value = payload["interest_over_time"]["timeline_data"][0]["values"][0]
        value.update(value="<1", extracted_value=0)
        series = trends_series(payload, self.settings, NOW)
        self.assertIsNone(series["points"][self.settings.keywords[0]][0]["value"])


class ImportTests(BotTest):
    def sales_file(self, rows):
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=SALES_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
        path = self.root / "authorized.csv"
        path.write_text(stream.getvalue(), encoding="utf-8")
        return path

    def raw_sale(self):
        return dict(
            zip(
                SALES_COLUMNS,
                [
                    "pseudonymous-one",
                    "100000000001",
                    "ceramic cup",
                    "https://www.ebay.com.au/itm/100000000001",
                    "transaction",
                    "2",
                    stamp(WINDOW.start),
                    "",
                    "",
                    "AU",
                    "EBAY_AU",
                    "AU",
                    "CN",
                ],
            )
        )

    def test_sales_import_requires_authorization_and_is_immutable_idempotent(self):
        path = self.sales_file([self.raw_sale()])
        with self.assertRaises(BotError):
            import_sales(path, self.settings, self.store, "legal export", False, NOW)
        result = import_sales(path, self.settings, self.store, "legal export", True, NOW)
        self.assertEqual(result["inserted"], 1)
        self.assertEqual(
            import_sales(path, self.settings, self.store, "legal export", True, NOW)["inserted"], 0
        )
        changed = self.raw_sale()
        changed["quantity"] = "3"
        with self.assertRaises(DataError):
            import_sales(
                self.sales_file([changed]), self.settings, self.store, "legal export", True, NOW
            )
        self.assertEqual(self.store.all_sales()[0]["quantity"], 2)
        self.assertNotIn("pseudonymous-one", json.dumps(self.store.all_sales()))

    def test_invalid_batch_is_atomic_and_naive_time_not_assumed_au(self):
        invalid = self.raw_sale()
        invalid.update(record_id="invalid", sold_at="2026-10-19T00:00:00")
        with self.assertRaises(DataError):
            import_sales(
                self.sales_file([self.raw_sale(), invalid]),
                self.settings,
                self.store,
                "legal",
                True,
                NOW,
            )
        self.assertEqual(self.store.all_sales(), [])

    def test_unexpected_columns_including_buyer_pii_are_rejected(self):
        path = self.root / "private.csv"
        path.write_text("buyer_email,quantity\nprivate@example.test,9\n", encoding="utf-8")
        with self.assertRaises(DataError):
            import_sales(path, self.settings, self.store, "legal", True, NOW)

    def test_google_original_au_daily_csv_accepts_unknown_and_is_idempotent(self):
        path = self.root / "trends.csv"
        path.write_text(
            "Category: All categories\n\nDay,coffee cup: (Australia)\n2026-10-20,20\n2026-10-21,<1\n",
            encoding="utf-8",
        )
        self.assertEqual(
            import_trends(path, self.settings, self.store, NOW, True, NOW)["state"], "ok"
        )
        import_trends(path, self.settings, self.store, NOW, True, NOW)
        self.assertEqual(len(self.store.all_series()), 1)
        self.assertIsNone(self.store.all_series()[0]["points"]["coffee cup"][1]["value"])

    def test_google_csv_needs_daily_granularity_and_explicit_au(self):
        path = self.root / "wrong.csv"
        for content in (
            "Week,coffee cup: (Australia)\n2026-10-19,30\n",
            "Day,coffee cup: (United States)\n2026-10-19,30\n",
            "Day,coffee cup\n2026-10-19,30\n",
        ):
            path.write_text(content, encoding="utf-8")
            with self.subTest(content=content), self.assertRaises(DataError):
                import_trends(path, self.settings, self.store, NOW, True, NOW)
