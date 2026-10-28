import re
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit


class BotError(Exception):
    """Only safe, operator-facing messages belong in this exception."""


class DataError(BotError):
    pass


class BudgetError(BotError):
    pass


@dataclass(frozen=True)
class Redactor:
    secrets: tuple[str, ...] = ()

    def text(self, value: str) -> str:
        for secret in sorted(set(self.secrets), key=len, reverse=True):
            if secret:
                value = "[REDACTED]".join(
                    part.replace(secret, "[REDACTED]") for part in value.split("[REDACTED]")
                )
        value = re.sub(
            r"(?i)(bearer\s+|(?:api_key|token|password|secret)=)[^\s&\"<>]+",
            r"\1[REDACTED]",
            value,
        )
        return value

    def value(self, value):
        if isinstance(value, str):
            return self.text(value)
        if isinstance(value, dict):
            return {self.text(str(k)): self.value(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [self.value(v) for v in value]
        return value


def clean_text(value: object, limit: int = 1500) -> str:
    if not isinstance(value, str):
        raise DataError("Expected text in provider data")
    try:
        value.encode("utf-8")
    except UnicodeError as exc:
        raise DataError("Provider text contains invalid Unicode") from exc
    return re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", value).strip()[:limit]


def public_url(value: object, hosts: tuple[str, ...] = ()) -> str:
    if not isinstance(value, str):
        raise DataError("Missing public evidence URL")
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError as exc:
        raise DataError("Malformed evidence URL") from exc
    if (
        parts.scheme != "https"
        or not parts.hostname
        or parts.username
        or parts.password
        or port not in (None, 443)
        or (
            hosts
            and not any(
                parts.hostname == host or parts.hostname.endswith("." + host) for host in hosts
            )
        )
    ):
        raise DataError("Invalid HTTPS evidence URL or unexpected provider host")
    return urlunsplit(("https", parts.netloc, parts.path, "", ""))


def endpoint_url(value: str) -> str:
    try:
        parts = urlsplit(value)
        parts.port
    except ValueError as exc:
        raise BotError("Malformed HTTPS service endpoint") from exc
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        raise BotError("An outgoing service endpoint must use HTTPS without embedded credentials")
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        raise BotError("Service endpoints cannot contain control characters")
    if parts.fragment:
        raise BotError("Service endpoints cannot contain URL fragments")
    return value


def count(value: object, field: str, *, optional: bool = True) -> int | None:
    if value is None and optional:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 10**15:
        raise DataError(f"Invalid non-negative integer: {field}")
    return value


def object_data(value: object, context: str) -> dict:
    if not isinstance(value, dict):
        raise DataError(f"Expected an object: {context}")
    return value


def csv_cell(value: object) -> str:
    text = "" if value is None else str(value)
    if text.lstrip().startswith(("=", "+", "-", "@")) or text.startswith(("\t", "\r")):
        return "'" + text
    return text
