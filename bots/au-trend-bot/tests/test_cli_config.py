import json
import os
import subprocess
import sys
from dataclasses import replace

from au_trend_bot.config import load_settings, read_environment
from au_trend_bot.demo import run_demo
from au_trend_bot.safety import BotError

from .support import ROOT, BotTest


class ConfigurationTests(BotTest):
    def test_only_independent_prefixed_credentials_are_accepted(self):
        settings = load_settings(
            ROOT / "config.example.toml",
            environ={
                "EBAY_CLIENT_ID": "website-id",
                "EBAY_CLIENT_SECRET": "website-secret",
                "DEEPSEEK_API_KEY": "unscoped-key",
                "DATABASE_URL": "mysql://website",
            },
        )
        self.assertEqual(settings.get("EBAY_CLIENT_ID"), "")
        self.assertEqual(settings.source_status()["ebay"]["state"], "unconfigured")
        self.assertNotIn("DATABASE_URL", settings.env)

    def test_paid_credentials_require_separate_explicit_permission(self):
        self.configure(APIFY_TOKEN="fake-token", SERPAPI_KEY="fake-key")
        for source in ("tiktok", "trends"):
            self.assertEqual(self.settings.source_status()[source]["state"], "blocked")

    def test_environment_parser_does_not_interpolate_and_env_wins(self):
        path = self.root / ".env"
        path.write_text(
            "# independent env\nATB_SMTP_PASSWORD='literal$SECRET'\nATB_DATA_DIR=data\n",
            encoding="utf-8",
        )
        result = read_environment(path, {"ATB_DATA_DIR": "override", "DATABASE_URL": "not-read"})
        self.assertEqual(result["ATB_SMTP_PASSWORD"], "literal$SECRET")
        self.assertEqual(result["ATB_DATA_DIR"], "override")
        self.assertNotIn("DATABASE_URL", result)

    def test_invalid_booleans_unknown_limits_and_insecure_notification_fail(self):
        path = self.root / "config.toml"
        original = (ROOT / "config.example.toml").read_text(encoding="utf-8")
        for env in (
            {"ATB_ALLOW_PAID_PROVIDERS": "yes"},
            {"ATB_WEBHOOK_URL": "http://notify.example.test"},
            {"ATB_SMTP_PORT": "25"},
        ):
            with self.subTest(env=env), self.assertRaises(BotError):
                load_settings(ROOT / "config.example.toml", environ=env)
        path.write_text(original + "\nunknown_limit = 5\n", encoding="utf-8")
        with self.assertRaises(BotError):
            load_settings(path, environ={})

    def test_secret_values_are_not_in_settings_repr_or_public_status(self):
        self.configure(APIFY_TOKEN="private-token-test", DEEPSEEK_API_KEY="private-key-test")
        for value in (repr(self.settings), json.dumps(self.settings.public_summary())):
            self.assertNotIn("private-token-test", value)
            self.assertNotIn("private-key-test", value)

    def test_wrong_section_types_and_credential_linebreaks_fail_without_traceback(self):
        path = self.root / "wrong-type.toml"
        path.write_text("topic = 7\n", encoding="utf-8")
        with self.assertRaises(BotError):
            load_settings(path, environ={})
        for env in (
            {"ATB_DEEPSEEK_BASE_URL": "https://api.deepseek.com?api_key=private"},
            {"ATB_EBAY_ACCESS_TOKEN": "private\nheader"},
        ):
            with self.subTest(env=env), self.assertRaises(BotError):
                load_settings(ROOT / "config.example.toml", environ=env)


class CliTests(BotTest):
    def run_cli(self, *args):
        env = {k: v for k, v in os.environ.items() if not k.startswith("ATB_")}
        env["ATB_DATA_DIR"] = str(self.root / "cli-live")
        env["PYTHONIOENCODING"] = "utf-8"
        return subprocess.run(
            [sys.executable, "-m", "au_trend_bot", *args],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )

    def test_doctor_is_offline_and_exits_two_when_unconfigured(self):
        result = self.run_cli("doctor")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(json.loads(result.stdout)["state"], "degraded")
        self.assertFalse((self.root / "cli-live").exists())

    def test_unconfigured_collection_report_and_status_are_honestly_nonzero(self):
        collection = self.run_cli("collect", "--no-notify")
        self.assertEqual(collection.returncode, 2, collection.stderr)
        report = self.run_cli("report", "--end", "2026-10-26")
        self.assertEqual(report.returncode, 2, report.stderr)
        document = json.loads(report.stdout)
        self.assertEqual(document["state"], "degraded")
        state = self.run_cli("status")
        self.assertEqual(state.returncode, 2, state.stderr)
        self.assertEqual(json.loads(state.stdout)["mode"], "LIVE")

    def test_one_command_demo_acceptance_is_offline_repeatable_and_separate(self):
        output = self.root / "demo-output"
        first = self.run_cli("demo", "--output", str(output))
        self.assertEqual(first.returncode, 0, first.stderr + first.stdout)
        data = json.loads(first.stdout)
        self.assertEqual(data["mode"], "DEMO")
        self.assertFalse(data["live_verified"])
        self.assertTrue(all(data["checks"].values()))
        again = self.run_cli("demo", "--output", str(output))
        self.assertEqual(again.returncode, 0, again.stderr + again.stdout)
        self.assertFalse((self.root / "cli-live").exists())

    def test_demo_refuses_live_or_nested_live_output(self):
        for path in (self.settings.data_dir, self.settings.data_dir / "nested", self.root):
            with self.subTest(path=path), self.assertRaises(BotError):
                run_demo(self.settings, path)

    def test_demo_ignores_ai_and_notification_credentials_and_never_sends(self):
        settings = replace(
            self.settings,
            env={
                "ATB_AI_ENABLED": "true",
                "ATB_AI_PUBLIC_EVIDENCE_CONSENT": "true",
                "ATB_DEEPSEEK_API_KEY": "fake-secret",
                "ATB_NOTIFICATION": "webhook",
                "ATB_WEBHOOK_URL": "https://notify.example.test/hook",
            },
        )
        result = run_demo(settings, self.root / "safe-demo")
        self.assertTrue(result["checks"]["ai_not_called"])
        self.assertTrue(result["checks"]["no_deliveries"])
        self.assertTrue(result["checks"]["no_network_budget"])
