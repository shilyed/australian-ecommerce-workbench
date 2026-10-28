import csv
import io
import json
import smtplib
import sqlite3
from contextlib import closing
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from au_trend_bot.ai import public_evidence, summarize, validate_summary
from au_trend_bot.analysis import build_report
from au_trend_bot.delivery import deliver, resolve_delivery
from au_trend_bot.http import HttpError, Response
from au_trend_bot.reports import render_csv, render_html
from au_trend_bot.safety import BotError, DataError, Redactor, public_url
from au_trend_bot.service import collect, create_report, health, tick
from au_trend_bot.storage import Store, process_lock
from au_trend_bot.storage import encode

from .support import NOW, WINDOW, BotTest


class ReportSafetyTests(BotTest):
    def test_external_html_and_link_injection_are_escaped_or_rejected(self):
        malicious = '"><script>alert("bad")</script><img src=x onerror=alert(1)>'
        self.store.put_observations([self.social(WINDOW.start, 10, title=malicious)])
        report = build_report(self.settings, self.store, WINDOW, NOW)
        document = render_html(report)
        self.assertNotIn("<script>", document)
        self.assertNotIn("<img", document)
        self.assertIn("&lt;script&gt;", document)
        self.assertIn("Content-Security-Policy", document)
        for url in (
            "javascript:alert(1)",
            "http://example.test",
            "https://evil.test/video/100001",
            "https://www.tiktok.com:invalid/video/100001",
        ):
            with self.subTest(url=url), self.assertRaises(DataError):
                public_url(url, ("tiktok.com",))

    def test_csv_formula_injection_gets_literal_prefix(self):
        self.store.put_observations(
            [self.social(WINDOW.start, 10, title='=HYPERLINK("https://evil.test")')]
        )
        report = build_report(self.settings, self.store, WINDOW, NOW)
        rows = list(csv.DictReader(io.StringIO(render_csv(report).lstrip("\ufeff"))))
        social = next(row for row in rows if row["kind"] == "social_cumulative")
        self.assertTrue(social["title"].startswith("'="))

    def test_csv_keeps_daily_search_values_from_one_acquisition(self):
        self.store.put_series(self.series())
        report = build_report(self.settings, self.store, WINDOW, NOW)
        rows = list(csv.DictReader(io.StringIO(render_csv(report).lstrip("\ufeff"))))
        daily = [row for row in rows if row["kind"] == "search_daily_interest"]
        self.assertEqual(len(daily), 14 * len(self.settings.keywords))
        self.assertEqual(len({row["external_id"] for row in daily}), 1)
        self.assertEqual(json.loads(daily[0]["metrics_json"])["interest_index"], 20)

    def test_secrets_are_redacted_from_db_report_html_csv_and_ai_input(self):
        secret = "private-test-key-123"
        self.configure(DEEPSEEK_API_KEY=secret)
        self.store.put_observations([self.social(WINDOW.start, 10, title="ceramic " + secret)])
        report = build_report(self.settings, self.store, WINDOW, NOW)
        for rendered in (
            json.dumps(report),
            render_html(report),
            render_csv(report),
            json.dumps(self.store.observations("tiktok")),
            json.dumps(public_evidence(report, self.settings)),
        ):
            self.assertNotIn(secret, rendered)

    def test_redaction_is_idempotent_and_does_not_corrupt_json_scalar_syntax(self):
        redactor = Redactor(("REDACTED", "private-key"))
        once = redactor.text("private-key REDACTED")
        self.assertEqual(redactor.text(once), once)
        self.configure(DEEPSEEK_API_KEY="null")
        client, _, _ = self.http([])
        report, paths = create_report(self.settings, self.store, client, WINDOW, now=NOW)
        self.assertEqual(json.loads(Path(paths["json"]).read_text(encoding="utf-8")), report)

    def test_report_idempotence_persists_content_and_files_without_rewriting(self):
        client, sender, _ = self.http([])
        report, paths = create_report(self.settings, self.store, client, WINDOW, now=NOW)
        file_times = {kind: Path(path).stat().st_mtime_ns for kind, path in paths.items()}
        self.store.put_observations([self.social(WINDOW.start, 500)])
        cached, _ = create_report(
            self.settings, self.store, client, WINDOW, now=NOW + timedelta(hours=1)
        )
        self.assertEqual(report, cached)
        self.assertEqual(
            file_times,
            {kind: Path(path).stat().st_mtime_ns for kind, path in paths.items()},
        )
        revised, _ = create_report(self.settings, self.store, client, WINDOW, revision=2, now=NOW)
        self.assertEqual(len(revised["social"]), 1)
        self.assertNotEqual(report["key"], revised["key"])
        self.assertEqual(sender.calls, [])


class AiTests(BotTest):
    def enable_ai(self):
        self.configure(
            AI_ENABLED="true",
            AI_PUBLIC_EVIDENCE_CONSENT="true",
            DEEPSEEK_API_KEY="fake-deepseek-key",
            DEEPSEEK_MODEL="deepseek-flash",
        )
        self.store.put_observations([self.social(WINDOW.start, 100)])
        return build_report(self.settings, self.store, WINDOW, NOW)

    def valid_summary(self):
        return {
            "themes": [
                {
                    "feature": "材质: 陶瓷",
                    "evidence_ids": ["tiktok:100001"],
                    "interpretation": "材质与使用场景值得进一步核实",
                }
            ],
            "caveats": ["仅反映有限公开文案样本"],
        }

    def test_ai_disabled_or_no_consent_never_calls(self):
        client, sender, _ = self.http([])
        report = build_report(self.settings, self.store, WINDOW, NOW)
        self.assertEqual(
            summarize(report, self.settings, self.store, client, NOW)["state"], "disabled"
        )
        self.configure(AI_ENABLED="true", DEEPSEEK_API_KEY="fake-key")
        self.assertEqual(
            summarize(report, self.settings, self.store, client, NOW)["state"], "blocked"
        )
        self.assertEqual(sender.calls, [])

    def test_success_only_sends_public_evidence_and_caches_paid_call(self):
        report = self.enable_ai()
        private_sale = self.sale()
        private_sale["provenance"] = "PRIVATE_AUTHORIZED_EXPORT_NOT_FOR_AI"
        self.store.put_sales([private_sale], NOW)
        report = build_report(self.settings, self.store, WINDOW, NOW)
        response = {
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {"content": json.dumps(self.valid_summary())},
                }
            ]
        }
        client, sender, _ = self.http([response])
        first = summarize(report, self.settings, self.store, client, NOW)
        second = summarize(report, self.settings, self.store, client, NOW)
        self.assertEqual(first["state"], "ok")
        self.assertEqual(first, second)
        self.assertEqual(len(sender.calls), 1)
        body = sender.calls[0]["body"].decode()
        self.assertNotIn("PRIVATE_AUTHORIZED_EXPORT_NOT_FOR_AI", body)
        self.assertNotIn("fake-deepseek-key", body)
        self.assertIn("deepseek-flash", body)
        self.assertEqual(json.loads(body)["max_tokens"], self.settings.limits.ai_max_output_tokens)
        self.assertTrue(sender.calls[0]["url"].endswith("/chat/completions"))

    def test_public_evidence_obeys_exact_configured_character_limit(self):
        self.settings = replace(
            self.settings,
            limits=replace(self.settings.limits, ai_max_input_chars=1500),
        )
        self.store.settings = self.settings
        self.store.put_observations(
            [
                self.social(WINDOW.start, n, video_id=str(100001 + n), title="ceramic " + "x" * 600)
                for n in range(35)
            ]
        )
        evidence = public_evidence(
            build_report(self.settings, self.store, WINDOW, NOW),
            self.settings,
        )
        self.assertGreater(len(evidence), 0)
        self.assertLessEqual(len(encode(evidence)), 1500)
        self.assertLess(len(evidence), 35)

    def test_failure_is_explicit_report_degrades_and_never_blindly_retries(self):
        self.enable_ai()
        client, sender, _ = self.http([HttpError(0, "safe failure")])
        report, _ = create_report(self.settings, self.store, client, WINDOW, now=NOW)
        self.assertEqual(report["ai"]["state"], "failed")
        self.assertEqual(report["status"], "degraded")
        self.assertIn("failed", render_html(report))
        again, _ = create_report(self.settings, self.store, client, WINDOW, now=NOW)
        self.assertEqual(again["ai"]["state"], "failed")
        self.assertEqual(len(sender.calls), 1)

    def test_invalid_numbers_financial_claims_and_fake_refs_rejected(self):
        report = self.enable_ai()
        evidence = public_evidence(report, self.settings)
        for value in (
            "增长100%",
            "销量显著",
            "profit guaranteed",
            "https://invented.test",
            "一百件",
            "ten units",
            "稳赚",
        ):
            data = self.valid_summary()
            data["themes"][0]["interpretation"] = value
            with self.subTest(value=value), self.assertRaises(DataError):
                validate_summary(data, evidence)
        data = self.valid_summary()
        data["themes"][0]["evidence_ids"] = ["tiktok:999999"]
        with self.assertRaises(DataError):
            validate_summary(data, evidence)
        data = self.valid_summary()
        data["themes"][0]["feature"] = "不存在的特征"
        with self.assertRaises(DataError):
            validate_summary(data, evidence)

    def test_incomplete_json_output_is_not_ai_success(self):
        report = self.enable_ai()
        client, _, _ = self.http(
            [{"choices": [{"finish_reason": "length", "message": {"content": "{}"}}]}]
        )
        self.assertEqual(
            summarize(report, self.settings, self.store, client, NOW)["state"], "failed"
        )

    def test_interrupted_ai_post_is_not_reissued_automatically(self):
        report = self.enable_ai()
        self.store.set_job("ai:" + report["key"], "ai", "calling", {"state": "calling"}, NOW)
        client, sender, _ = self.http([])
        self.assertEqual(
            summarize(report, self.settings, self.store, client, NOW)["state"], "uncertain"
        )
        self.assertEqual(sender.calls, [])


class DeliveryTests(BotTest):
    def enable_smtp(self):
        self.configure(
            NOTIFICATION="smtp",
            SMTP_HOST="smtp.example.test",
            SMTP_PORT="587",
            SMTP_FROM="robot@example.test",
            SMTP_TO="owner@example.test",
            SMTP_PASSWORD="fake-secret",
            SMTP_USER="robot@example.test",
        )

    def test_unconfigured_notification_never_claims_sent(self):
        client, sender, _ = self.http([])
        result = deliver(
            "test-report", "subject", "<p>report</p>", "", self.settings, self.store, client
        )
        self.assertEqual(result["state"], "blocked")
        self.assertEqual(self.store.delivery("test-report")["state"], "blocked")
        self.assertEqual(sender.calls, [])

    def test_success_is_idempotent_and_subject_and_content_redacted(self):
        self.enable_smtp()
        client, _, _ = self.http([])
        calls = []

        def send(*args):
            calls.append(args)

        for _ in range(2):
            result = deliver(
                "test-report",
                "fake-secret",
                "<p>fake-secret</p>",
                "fake-secret",
                self.settings,
                self.store,
                client,
                send,
            )
            self.assertEqual(result["state"], "sent")
        self.assertEqual(len(calls), 1)
        self.assertNotIn("fake-secret", str(calls[0][1:]))

    def test_ambiguous_network_failure_and_crash_stop_auto_resend(self):
        self.enable_smtp()
        client, _, _ = self.http([])
        calls = []

        def timeout(*args):
            calls.append(args)
            raise OSError("fake-secret")

        first = deliver(
            "uncertain", "sub", "<p>x</p>", "", self.settings, self.store, client, timeout
        )
        second = deliver(
            "uncertain", "sub", "<p>x</p>", "", self.settings, self.store, client, timeout
        )
        self.assertEqual(first["state"], "uncertain")
        self.assertEqual(second["state"], "uncertain")
        self.assertEqual(len(calls), 1)
        self.assertNotIn("fake-secret", json.dumps(self.store.deliveries()))

        def crash(*args):
            raise KeyboardInterrupt

        with self.assertRaises(KeyboardInterrupt):
            deliver("crash", "sub", "<p>x</p>", "", self.settings, self.store, client, crash)
        self.assertEqual(self.store.delivery("crash")["state"], "sending")
        recovered = deliver(
            "crash", "sub", "<p>x</p>", "", self.settings, self.store, client, crash
        )
        self.assertEqual(recovered["state"], "uncertain")

    def test_auth_failure_and_explicit_operator_retry(self):
        self.enable_smtp()
        client, _, _ = self.http([])

        def rejected(*args):
            raise smtplib.SMTPAuthenticationError(535, b"private-remote-message")

        first = deliver(
            "rejected", "sub", "<p>x</p>", "", self.settings, self.store, client, rejected
        )
        self.assertEqual(first["state"], "failed")
        self.assertNotIn("private-remote-message", str(first))
        self.assertEqual(resolve_delivery("rejected", "retry", self.store)["state"], "pending")
        second = deliver(
            "rejected", "sub", "<p>x</p>", "", self.settings, self.store, client, lambda *args: None
        )
        self.assertEqual(second["state"], "sent")

    def test_https_webhook_accepts_empty_204_and_stable_idempotency_key(self):
        self.configure(NOTIFICATION="webhook", WEBHOOK_URL="https://notify.example.test/hook")
        client, sender, _ = self.http([Response(204, {}, b"")])
        for _ in range(2):
            self.assertEqual(
                deliver("stable-key", "sub", "<p>x</p>", "csv", self.settings, self.store, client)[
                    "state"
                ],
                "sent",
            )
        self.assertEqual(len(sender.calls), 1)
        self.assertEqual(sender.calls[0]["headers"]["Idempotency-Key"], "stable-key")

    def test_restored_report_can_receive_explicit_manual_sent_ack_without_network(self):
        client, sender, _ = self.http([])
        report, _ = create_report(self.settings, self.store, client, WINDOW, now=NOW)
        self.assertIsNone(self.store.delivery(report["key"]))
        result = resolve_delivery(report["key"], "sent", self.store)
        self.assertEqual(result["state"], "sent")
        self.assertEqual(
            deliver(report["key"], "subject", "", "", self.settings, self.store, client)["state"],
            "sent",
        )
        self.assertEqual(sender.calls, [])
        with self.assertRaises(BotError):
            resolve_delivery("invented-key", "sent", self.store)
        with self.assertRaises(BotError):
            resolve_delivery(report["key"], "unknown", self.store)


class StorageSchedulerTests(BotTest):
    def test_demo_and_topic_databases_cannot_mix(self):
        with self.assertRaises(BotError):
            Store(self.settings, "demo")
        with self.assertRaises(BotError):
            Store(replace(self.settings, keywords=("different niche",)))
        self.assertEqual(self.store.mode, "live")

    def test_existing_unrelated_sqlite_database_is_not_modified(self):
        directory = self.root / "unrelated"
        directory.mkdir()
        path = directory / "trend.sqlite3"
        with closing(sqlite3.connect(path)) as other:
            other.execute("CREATE TABLE unrelated (id INTEGER)")
            other.commit()
        with self.assertRaises(BotError):
            Store(replace(self.settings, data_dir=directory))
        with closing(sqlite3.connect(path)) as other:
            tables = other.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            self.assertEqual(tables, [("unrelated",)])

    def test_single_process_lock_is_released_and_busy_lock_rejected(self):
        with process_lock(self.settings.data_dir):
            with self.assertRaises(BotError):
                with process_lock(self.settings.data_dir):
                    self.fail("Concurrent lock should not be acquired")
        with process_lock(self.settings.data_dir):
            pass

    def test_consistent_backup_retains_outbox_and_integrity(self):
        self.store.put_observations([self.social(WINDOW.start, 100)])
        self.store.set_delivery("sent-key", "sent", {"detail": "accepted"})
        target = self.root / "backup.sqlite3"
        self.store.backup(target)
        with closing(sqlite3.connect(target)) as backup:
            self.assertEqual(backup.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(backup.execute("SELECT COUNT(*) FROM observations").fetchone()[0], 1)
            self.assertEqual(backup.execute("SELECT state FROM deliveries").fetchone()[0], "sent")
        with self.assertRaises(BotError):
            self.store.backup(target)

    def test_pruning_is_bounded_and_preserves_delivery_idempotency(self):
        self.store.put_observations(
            [
                self.social(NOW - timedelta(days=31), 10),
                self.social(NOW - timedelta(days=10), 30),
            ]
        )
        self.store.set_delivery("sent-key", "sent", {"detail": "accepted"})
        with self.assertRaises(BotError):
            self.store.prune(1, NOW)
        self.assertEqual(self.store.prune(30, NOW)["observations_removed"], 1)
        self.assertEqual(len(self.store.observations("tiktok")), 1)
        self.assertEqual(self.store.delivery("sent-key")["state"], "sent")

    def test_missing_credentials_are_not_empty_success_and_never_call_network(self):
        client, sender, _ = self.http([])
        result = collect(self.settings, self.store, client, clock=lambda: NOW)
        self.assertEqual(result["state"], "degraded")
        self.assertTrue(all(row["state"] == "unconfigured" for row in result["sources"].values()))
        self.assertEqual(sender.calls, [])
        self.assertTrue(all(row["state"] == "blocked" for row in self.store.deliveries()))

    def test_repeated_tick_has_no_duplicate_provider_runs_or_notifications(self):
        self.configure(
            EBAY_ACCESS_TOKEN="fake-ebay",
            APIFY_TOKEN="fake-apify",
            SERPAPI_KEY="fake-serp",
            ALLOW_PAID_PROVIDERS="true",
            NOTIFICATION="webhook",
            WEBHOOK_URL="https://notify.example.test/hook",
        )
        calls = []

        class FixtureProvider:
            def __init__(self, *args, **kwargs):
                pass

            def collect(self):
                calls.append("collection")
                return {"state": "ok", "detail": "test adapter fixture only", "items": 1}

        def fixture_collection(settings, store, client, **kwargs):
            return collect(
                settings,
                store,
                client,
                factories={source: FixtureProvider for source in ("ebay", "tiktok", "trends")},
                **kwargs,
            )

        client, sender, _ = self.http([Response(204, {}, b"")] * 2)
        for _ in range(2):
            tick(self.settings, self.store, client, clock=lambda: NOW, collector=fixture_collection)
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(sender.calls), 2)
        self.assertEqual(len(self.store.deliveries()), 2)
        self.assertTrue(all(row["state"] == "sent" for row in self.store.deliveries()))
        self.assertIsNone(self.store.job("collect:2026-10-25:ebay"))

    def test_health_is_not_a_fake_live_provider_test(self):
        with patch("au_trend_bot.service.utcnow", return_value=NOW):
            self.assertEqual(health(self.settings, self.store, True)["state"], "stale")
            self.store.set_job("scheduler-heartbeat", "heartbeat", "running", {}, NOW)
            self.assertEqual(health(self.settings, self.store, True)["state"], "ok")
            self.assertEqual(health(self.settings, self.store)["state"], "degraded")
