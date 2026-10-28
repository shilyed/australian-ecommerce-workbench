from dataclasses import replace
from datetime import date, timedelta

from au_trend_bot.analysis import (
    build_report,
    feature_counts,
    market_rows,
    metric_delta,
    sales_analysis,
    search_analysis,
    social_rows,
)
from au_trend_bot.models import feature_matches
from au_trend_bot.providers import ebay_item
from au_trend_bot.timeutil import Window, parse_time, stamp

from .support import NOW, WINDOW, BotTest, ebay_payload


class WindowTests(BotTest):
    def test_spring_dst_week_is_167_utc_hours(self):
        week = Window.ending(date(2026, 10, 5))
        self.assertEqual((week.end - week.start).total_seconds() / 3600, 167)
        self.assertEqual(week.previous().end, week.start)
        self.assertTrue(week.as_dict()["end_local"].endswith("+11:00"))

    def test_autumn_dst_week_is_169_utc_hours(self):
        week = Window.ending(date(2026, 4, 6))
        self.assertEqual((week.end - week.start).total_seconds() / 3600, 169)
        self.assertEqual(week.previous().end, week.start)

    def test_half_open_window_and_explicit_offsets(self):
        self.assertTrue(WINDOW.contains(WINDOW.start))
        self.assertFalse(WINDOW.contains(WINDOW.end))
        self.assertFalse(WINDOW.contains(WINDOW.start - timedelta(microseconds=1)))
        self.assertEqual(parse_time(WINDOW.as_dict()["start_local"]), WINDOW.start)
        with self.assertRaises(ValueError):
            parse_time("2026-10-19T00:00:00")
        with self.assertRaises(ValueError):
            Window.ending(date(2026, 10, 27))

    def test_latest_week_uses_au_not_utc_date(self):
        now = parse_time("2026-10-25T14:00:00Z")
        self.assertEqual(Window.latest(now).end_date, "2026-10-26")


class CounterTests(BotTest):
    def test_no_baseline_is_unknown_not_zero(self):
        row = self.social(WINDOW.start, 100).as_dict()
        delta = metric_delta([row], "views", WINDOW)
        self.assertIsNone(delta["observed_delta"])
        self.assertEqual(delta["reason"], "no_baseline")

    def test_full_boundary_snapshots_allow_week_delta(self):
        rows = [self.social(WINDOW.start, 0).as_dict(), self.social(WINDOW.end, 80).as_dict()]
        delta = metric_delta(rows, "views", WINDOW)
        self.assertEqual(delta["observed_delta"], 80)
        self.assertEqual(delta["week_delta"], 80)
        self.assertEqual(delta["coverage"], "full")

    def test_partial_interval_never_claims_full_week(self):
        first, last = WINDOW.start + timedelta(days=1), WINDOW.end - timedelta(hours=12)
        delta = metric_delta(
            [self.social(first, 20).as_dict(), self.social(last, 50).as_dict()], "views", WINDOW
        )
        self.assertEqual(delta["observed_delta"], 30)
        self.assertIsNone(delta["week_delta"])
        self.assertEqual(delta["from"], stamp(first))
        self.assertEqual(delta["to"], stamp(last))

    def test_actor_run_approximate_timestamps_never_claim_exact_week_boundaries(self):
        rows = [self.social(WINDOW.start, 10).as_dict(), self.social(WINDOW.end, 80).as_dict()]
        for row in rows:
            row["time_basis"] = "actor_run_finished_at"
        delta = metric_delta(rows, "views", WINDOW)
        self.assertEqual(delta["observed_delta"], 70)
        self.assertIsNone(delta["week_delta"])
        self.assertEqual(delta["reason"], "approximate_run_time_partial_observation")

    def test_reset_in_middle_invalidates_even_recovered_end(self):
        rows = [
            self.social(WINDOW.start, 100).as_dict(),
            self.social(WINDOW.start + timedelta(days=2), 5).as_dict(),
            self.social(WINDOW.end, 200).as_dict(),
        ]
        delta = metric_delta(rows, "views", WINDOW)
        self.assertEqual(delta["reason"], "counter_reset_or_decrease")
        self.assertIsNone(delta["observed_delta"])

    def test_missing_counter_in_middle_is_not_ignored(self):
        rows = [
            self.social(WINDOW.start, 100).as_dict(),
            self.social(WINDOW.start + timedelta(days=2), None).as_dict(),
            self.social(WINDOW.end, 200).as_dict(),
        ]
        self.assertEqual(metric_delta(rows, "views", WINDOW)["reason"], "missing_counter")

    def test_cross_keyword_dedup_preserves_queries_and_one_feature_sample(self):
        first = self.social(WINDOW.start, 100)
        second = replace(first, queries=["travel mug"])
        self.assertEqual(self.store.put_observations([first, second]), 1)
        self.assertEqual(len(self.store.observations("tiktok")), 1)
        rows = social_rows(self.store, WINDOW)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["queries"], ["coffee cup", "travel mug"])
        self.assertIsNone(rows[0]["geography"]["audience_country"])
        self.assertTrue(all(row["sample_count"] == 1 for row in feature_counts(rows)))

    def test_new_end_boundary_snapshot_does_not_become_previous_week_content(self):
        self.store.put_observations([self.social(WINDOW.end, 100)])
        self.assertEqual(social_rows(self.store, WINDOW), [])

    def test_wow_only_when_both_weeks_have_full_actual_boundaries(self):
        self.store.put_observations(
            [
                self.social(WINDOW.previous().start, 10),
                self.social(WINDOW.start, 30),
                self.social(WINDOW.end, 70),
            ]
        )
        self.assertEqual(social_rows(self.store, WINDOW)[0]["weekly_views_wow_pct"], 100)

    def test_au_listing_location_not_sales_or_buyer_evidence(self):
        self.store.put_observations(
            [ebay_item(ebay_payload(), self.settings, WINDOW.start, ["coffee cup"], 1)]
        )
        rows = market_rows(self.store, WINDOW)
        self.assertIsNone(rows[0]["geography"]["buyer_country"])
        self.assertIsNone(rows[0]["geography"]["seller_country"])
        self.assertEqual(rows[0]["geography"]["item_location_country"], "AU")
        self.assertEqual(sales_analysis(self.store, WINDOW)["state"], "unknown")

    def test_feature_labels_are_copy_evidence_and_units_are_not_silently_converted(self):
        features = feature_matches(
            "350 ml, 12oz ceramic double-wall LEAKPROOF commuter mug", self.settings
        )
        self.assertIn("容量文案: 350 ml", features)
        self.assertIn("容量文案: 12 oz", features)
        self.assertIn("杯盖: 防漏文案", features)
        self.assertNotIn("容量文案: 355 ml", features)


class SalesTests(BotTest):
    def test_only_au_buyer_transactions_inside_half_open_window_are_ranked(self):
        self.store.put_sales(
            [
                self.sale("first", sold_at=WINDOW.start),
                self.sale("last", sold_at=WINDOW.end - timedelta(microseconds=1), quantity=3),
                self.sale("end", sold_at=WINDOW.end, quantity=9000),
                self.sale(
                    "outside", sold_at=WINDOW.start - timedelta(microseconds=1), quantity=9000
                ),
                self.sale("nonau", buyer="US", quantity=9000),
                self.sale("unknown", buyer=None, quantity=9000),
            ],
            NOW,
        )
        result = sales_analysis(self.store, WINDOW)
        self.assertEqual(result["ranking"][0]["quantity"], 5)
        self.assertEqual(result["excluded"]["outside_window"], 2)
        self.assertEqual(result["excluded"]["non_au"], 1)
        self.assertEqual(result["excluded"]["unknown_buyer_country"], 1)
        self.assertIsNone(result["weekly_wow_pct"])

    def test_estimates_and_rolling_30_days_never_become_seven_day_transactions(self):
        estimate = self.sale("estimate", kind="period_estimate", quantity=600)
        estimate.update(
            sold_at=None, period_start=stamp(WINDOW.start), period_end=stamp(WINDOW.end)
        )
        rolling = self.sale("rolling", kind="rolling_30d", quantity=3000)
        rolling.update(
            sold_at=None,
            period_start=stamp(WINDOW.end - timedelta(days=30)),
            period_end=stamp(WINDOW.end),
        )
        straddling = {
            **estimate,
            "id": "straddle",
            "period_start": stamp(WINDOW.start - timedelta(days=1)),
        }
        self.store.put_sales([estimate, rolling, straddling], NOW)
        result = sales_analysis(self.store, WINDOW)
        self.assertEqual(result["state"], "unknown")
        self.assertEqual(result["ranking"], [])
        self.assertEqual(len(result["period_estimates"]), 1)
        self.assertEqual(result["rolling_30d"][0]["quantity"], 3000)


class SearchTests(BotTest):
    def test_complete_comparison_is_within_one_series(self):
        self.store.put_series(self.series())
        rows = search_analysis(self.settings, self.store, WINDOW, NOW)
        self.assertTrue(
            all(row["current_mean"] == 40 and row["previous_mean"] == 20 for row in rows)
        )
        self.assertTrue(all(row["wow_pct"] == 100 for row in rows))

    def test_independently_scaled_requests_are_never_stitched(self):
        earlier = self.series(when=NOW - timedelta(hours=1))
        later = self.series()
        for points in earlier["points"].values():
            del points[7:]
        for points in later["points"].values():
            del points[:7]
        self.store.put_series(earlier)
        self.store.put_series(later)
        rows = search_analysis(self.settings, self.store, WINDOW, NOW)
        self.assertTrue(all(row["previous_days"] == 0 for row in rows))
        self.assertTrue(all(row["current_mean"] is None and row["wow_pct"] is None for row in rows))

    def test_partial_missing_stale_and_weekly_series_do_not_get_means(self):
        for variant in ("partial", "missing", "stale", "weekly"):
            with self.subTest(variant=variant):
                self.store.connection.execute("DELETE FROM series")
                self.store.connection.commit()
                series = self.series()
                if variant == "partial":
                    for points in series["points"].values():
                        points[-1]["partial"] = True
                elif variant == "missing":
                    for points in series["points"].values():
                        points[-1]["value"] = None
                elif variant == "stale":
                    series["fetched_at"] = stamp(NOW - timedelta(days=4))
                else:
                    series["granularity"] = "week"
                self.store.put_series(series)
                self.assertTrue(
                    all(
                        row["current_mean"] is None and row["wow_pct"] is None
                        for row in search_analysis(self.settings, self.store, WINDOW, NOW)
                    )
                )

    def test_previous_zero_is_not_infinite_growth(self):
        self.store.put_series(self.series(previous=0))
        rows = search_analysis(self.settings, self.store, WINDOW, NOW)
        self.assertEqual(rows[0]["current_mean"], 40)
        self.assertIsNone(rows[0]["wow_pct"])
        self.assertEqual(rows[0]["reason"], "previous_week_zero")

    def test_missing_all_sources_produces_degraded_unknowns(self):
        report = build_report(self.settings, self.store, WINDOW, NOW)
        self.assertEqual(report["status"], "degraded")
        self.assertEqual(report["sales"]["state"], "unknown")
        self.assertTrue(all(row["current_mean"] is None for row in report["search"]))

    def test_calendar_coverage_is_actual_dates_not_backfilled(self):
        self.store.put_observations(
            [
                self.social(WINDOW.start + timedelta(hours=6), 10),
                self.social(WINDOW.end, 40),
            ]
        )
        report = build_report(self.settings, self.store, WINDOW, NOW)
        coverage = report["coverage"]["tiktok"]
        self.assertEqual(coverage["observed_local_days"], [WINDOW.dates()[0]])
        self.assertEqual(len(coverage["missing_local_days"]), 6)
        self.assertEqual(coverage["snapshots"], 1)
        self.assertEqual(coverage["unique_objects"], 1)
