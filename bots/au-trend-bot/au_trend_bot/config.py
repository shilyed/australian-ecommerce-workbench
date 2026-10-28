import hashlib
import json
import os
import re
import tomllib
from dataclasses import asdict, dataclass, field, fields
from email.utils import parseaddr
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from .safety import BotError, Redactor, endpoint_url


@dataclass(frozen=True)
class Limits:
    items_per_query: int = 10
    refresh_limit: int = 20
    http_requests_per_day: int = 120
    http_timeout_seconds: int = 20
    http_retries: int = 2
    http_min_interval_seconds: float = 0.3
    collection_attempts_per_day: int = 3
    serpapi_calls_per_day: int = 1
    apify_runs_per_day: int = 2
    apify_run_max_cents: int = 50
    apify_monthly_max_cents: int = 3100
    apify_timeout_seconds: int = 300
    apify_poll_seconds: int = 30
    ai_calls_per_day: int = 2
    ai_max_input_chars: int = 10000
    ai_max_output_tokens: int = 800


@dataclass(frozen=True)
class Schedule:
    collect_hour: int = 6
    report_hour: int = 8
    catchup_weeks: int = 2
    poll_seconds: int = 60


@dataclass(frozen=True)
class Settings:
    topic_id: str
    topic_name: str
    keywords: tuple[str, ...]
    features: dict[str, list[str]]
    timezone: str
    sources: dict[str, bool]
    data_dir: Path
    limits: Limits = field(default_factory=Limits)
    schedule: Schedule = field(default_factory=Schedule)
    env: dict[str, str] = field(default_factory=dict, repr=False)

    def get(self, name: str, default: str = "") -> str:
        return self.env.get("ATB_" + name, default)

    def enabled(self, name: str) -> bool:
        return boolean(self.get(name, "false"), "ATB_" + name)

    @property
    def fingerprint(self) -> str:
        identity = {
            "id": self.topic_id,
            "name": self.topic_name,
            "keywords": self.keywords,
            "features": self.features,
            "timezone": self.timezone,
        }
        return hashlib.sha256(
            json.dumps(identity, ensure_ascii=False, sort_keys=True).encode()
        ).hexdigest()[:16]

    @property
    def redactor(self) -> Redactor:
        sensitive = ("KEY", "TOKEN", "SECRET", "PASSWORD", "BEARER", "WEBHOOK_URL")
        return Redactor(tuple(v for k, v in self.env.items() if any(s in k for s in sensitive)))

    def source_status(self) -> dict[str, dict]:
        statuses: dict[str, dict] = {}
        for source in ("ebay", "tiktok", "trends"):
            state, detail = "ready", "配置就绪；尚不代表实际账号联调通过"
            if not self.sources[source]:
                state, detail = "disabled", "由独立机器人配置关闭"
            elif source == "ebay" and not (
                self.get("EBAY_ACCESS_TOKEN")
                or (self.get("EBAY_CLIENT_ID") and self.get("EBAY_CLIENT_SECRET"))
            ):
                state, detail = "unconfigured", "缺少独立 eBay Browse 应用凭证"
            elif source in ("tiktok", "trends"):
                key = "APIFY_TOKEN" if source == "tiktok" else "SERPAPI_KEY"
                if not self.get(key):
                    state, detail = "unconfigured", f"缺少 ATB_{key}"
                elif not self.enabled("ALLOW_PAID_PROVIDERS"):
                    state, detail = "blocked", "收费后端未取得显式启用授权"
            statuses[source] = {"state": state, "detail": detail}
        for source in ("instagram", "facebook"):
            statuses[source] = {
                "state": "not_implemented",
                "detail": "后续范围；需适用业务账号及实际获批权限，首期没有采集适配器",
            }
        return statuses

    def ai_status(self) -> dict:
        if not self.enabled("AI_ENABLED"):
            return {"state": "disabled", "detail": "未启用 AI；保留确定性分析"}
        if not self.enabled("AI_PUBLIC_EVIDENCE_CONSENT"):
            return {"state": "blocked", "detail": "未同意向 AI 发送公共证据摘要"}
        if not self.get("DEEPSEEK_API_KEY"):
            return {"state": "unconfigured", "detail": "缺少 DeepSeek API key"}
        return {"state": "ready", "detail": "仅允许公共证据的定性摘要"}

    def notification_status(self) -> dict:
        channel = self.get("NOTIFICATION", "none")
        if channel == "none":
            return {"state": "unconfigured", "detail": "仅本地文件；未配置外部投递"}
        needed = ("SMTP_HOST", "SMTP_FROM", "SMTP_TO") if channel == "smtp" else ("WEBHOOK_URL",)
        missing = [f"ATB_{key}" for key in needed if not self.get(key)]
        if missing:
            return {"state": "unconfigured", "detail": "缺少 " + ", ".join(missing)}
        return {"state": "ready", "detail": f"{channel} 已配置；不代表已投递"}

    def public_summary(self) -> dict:
        return {
            "topic": self.topic_name,
            "fingerprint": self.fingerprint,
            "timezone": self.timezone,
            "sources": self.source_status(),
            "ai": self.ai_status(),
            "notification": self.notification_status(),
            "limits": asdict(self.limits),
        }


def boolean(value: str, name: str) -> bool:
    if value.casefold() not in ("true", "false"):
        raise BotError(f"{name} must be true or false")
    return value.casefold() == "true"


def read_environment(path: Path | None, environ: dict[str, str] | None = None) -> dict[str, str]:
    result: dict[str, str] = {}
    if path:
        for number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            key, separator, value = line.partition("=")
            if not separator or not re.fullmatch(r"ATB_[A-Z0-9_]+", key):
                raise BotError(f"Invalid independent environment key at line {number}")
            if key in result:
                raise BotError(f"Duplicate independent environment key at line {number}")
            value = value.strip()
            if value.startswith(("'", '"')):
                if len(value) < 2 or value[-1] != value[0]:
                    raise BotError(f"Unclosed environment quote at line {number}")
                value = value[1:-1]
            result[key] = value
    result.update(
        {
            k: v
            for k, v in (os.environ if environ is None else environ).items()
            if k.startswith("ATB_")
        }
    )
    return result


def load_settings(
    path: Path, env_file: Path | None = None, environ: dict[str, str] | None = None
) -> Settings:
    config = tomllib.loads(path.read_text(encoding="utf-8-sig"))
    if set(config) - {"topic", "sources", "features", "schedule", "limits"}:
        raise BotError("Unknown configuration section")
    if any(not isinstance(value, dict) for value in config.values()):
        raise BotError("Each configuration section must be a TOML table")
    topic = config.get("topic", {})
    if set(topic) - {"id", "name", "keywords", "timezone"}:
        raise BotError("Unknown topic setting")
    topic_id, name = topic.get("id"), topic.get("name")
    if not isinstance(topic_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,59}", topic_id):
        raise BotError("topic.id must be a short kebab-case identifier")
    if not isinstance(name, str) or not name.strip() or len(name) > 100:
        raise BotError("topic.name must contain 1-100 characters")
    keywords = topic.get("keywords")
    if (
        not isinstance(keywords, list)
        or not 1 <= len(keywords) <= 5
        or any(
            not isinstance(k, str) or not k.strip() or len(k) > 100 or "," in k for k in keywords
        )
        or len(set(k.casefold().strip() for k in keywords)) != len(keywords)
    ):
        raise BotError("Provide 1-5 distinct nonempty keywords without commas")
    timezone = topic.get("timezone", "Australia/Sydney")
    if timezone != "Australia/Sydney":
        raise BotError("This AU report contract currently requires Australia/Sydney")
    ZoneInfo(timezone)
    sources = {"ebay": True, "tiktok": True, "trends": True}
    if set(config.get("sources", {})) - set(sources):
        raise BotError("Unknown source; Instagram/Facebook are not first-release providers")
    sources.update(config.get("sources", {}))
    if any(not isinstance(v, bool) for v in sources.values()):
        raise BotError("Source switches must be booleans")
    features = config.get("features", {})
    if (
        not isinstance(features, dict)
        or len(features) > 100
        or any(
            not isinstance(k, str)
            or not k
            or len(k) > 100
            or not isinstance(v, list)
            or not v
            or len(v) > 30
            or any(not isinstance(term, str) or not term.strip() or len(term) > 100 for term in v)
            for k, v in features.items()
        )
    ):
        raise BotError("Invalid bounded feature dictionary")
    limits_data, schedule_data = config.get("limits", {}), config.get("schedule", {})
    if set(limits_data) - {f.name for f in fields(Limits)}:
        raise BotError("Unknown limit")
    if set(schedule_data) - {f.name for f in fields(Schedule)}:
        raise BotError("Unknown schedule setting")
    limits, schedule = Limits(**limits_data), Schedule(**schedule_data)
    for key, value in asdict(limits).items():
        if key == "http_min_interval_seconds":
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not 0 <= value <= 60
            ):
                raise BotError("Invalid HTTP rate interval")
        elif isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100000:
            raise BotError(f"Invalid integer limit: {key}")
        elif value == 0 and key not in ("refresh_limit", "http_retries", "apify_poll_seconds"):
            raise BotError(f"Limit must be positive: {key}")
    if not 1 <= limits.items_per_query <= 100 or limits.refresh_limit > 100:
        raise BotError("Bound item and refresh samples to at most 100 per query/run")
    if limits.http_retries > 4 or not 1 <= limits.http_timeout_seconds <= 120:
        raise BotError("Bound HTTP retries to 4 and request timeout to 120 seconds")
    if not 1 <= limits.apify_timeout_seconds <= 3600 or limits.apify_poll_seconds > 120:
        raise BotError("Invalid Apify timeout or polling duration")
    if not 1000 <= limits.ai_max_input_chars <= 50000 or limits.ai_max_output_tokens > 4000:
        raise BotError(
            "Bound AI input to 1,000-50,000 characters and output to at most 4,000 tokens"
        )
    for key, value in asdict(schedule).items():
        if isinstance(value, bool) or not isinstance(value, int):
            raise BotError(f"Invalid schedule: {key}")
    if not 0 <= schedule.collect_hour < 24 or not 0 <= schedule.report_hour < 24:
        raise BotError("Schedule hours must be 0-23")
    if not 1 <= schedule.catchup_weeks <= 4 or not 10 <= schedule.poll_seconds <= 3600:
        raise BotError("Bound catch-up to 1-4 weeks and polling to 10-3600 seconds")
    env = read_environment(env_file, environ)
    if any("\r" in value or "\n" in value for value in env.values()):
        raise BotError("Independent environment values cannot contain line breaks")
    data_dir = Path(env.get("ATB_DATA_DIR", "data"))
    if not data_dir.is_absolute():
        data_dir = path.resolve().parent / data_dir
    result = Settings(
        topic_id,
        name.strip(),
        tuple(k.strip() for k in keywords),
        features,
        timezone,
        sources,
        data_dir.resolve(),
        limits,
        schedule,
        env,
    )
    for switch in ("ALLOW_PAID_PROVIDERS", "AI_ENABLED", "AI_PUBLIC_EVIDENCE_CONSENT"):
        result.enabled(switch)
    if result.get("NOTIFICATION", "none") not in ("none", "smtp", "webhook"):
        raise BotError("ATB_NOTIFICATION must be none, smtp or webhook")
    if result.get("WEBHOOK_URL"):
        endpoint_url(result.get("WEBHOOK_URL"))
    endpoint_url(result.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"))
    if urlsplit(result.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")).query:
        raise BotError("DeepSeek base URL cannot contain query credentials or parameters")
    if result.get("SMTP_PORT", "587") not in ("465", "587"):
        raise BotError("SMTP requires TLS port 465 or 587")
    if bool(result.get("SMTP_USER")) != bool(result.get("SMTP_PASSWORD")):
        raise BotError("SMTP username and password must be supplied together")
    for key in ("SMTP_FROM", "SMTP_TO"):
        for address in filter(None, result.get(key).split(",")):
            if (
                "\r" in address
                or "\n" in address
                or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", parseaddr(address.strip())[1])
            ):
                raise BotError(f"Invalid email address in ATB_{key}")
    if "\r" in result.get("DEEPSEEK_MODEL") or "\n" in result.get("DEEPSEEK_MODEL"):
        raise BotError("Invalid DeepSeek model name")
    return result
