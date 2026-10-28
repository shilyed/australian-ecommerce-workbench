import json
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable
from zoneinfo import ZoneInfo

from .config import Settings
from .safety import BotError, DataError, endpoint_url
from .storage import Store
from .timeutil import utcnow


@dataclass(frozen=True)
class Response:
    status: int
    headers: dict[str, str]
    body: bytes


class HttpError(BotError):
    def __init__(self, status: int, detail: str):
        self.status = status
        super().__init__(detail)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def transport(method: str, url: str, headers: dict, body: bytes | None, timeout: int) -> Response:
    opener = urllib.request.build_opener(
        NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context())
    )
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with opener.open(request, timeout=timeout) as response:
            data = response.read(5_000_001)
            if len(data) > 5_000_000:
                raise DataError("Provider response exceeded 5 MB")
            return Response(response.status, dict(response.headers.items()), data)
    except urllib.error.HTTPError as exc:
        # Error bodies and full request URLs can contain credentials; never persist or print them.
        return Response(exc.code, dict(exc.headers.items()), b"")
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError) as exc:
        raise HttpError(
            0, "HTTPS transport failed or timed out; inspect credentials/network privately"
        ) from exc


class HttpClient:
    def __init__(
        self,
        settings: Settings,
        store: Store,
        sender: Callable = transport,
        sleeper: Callable = time.sleep,
        clock: Callable = utcnow,
    ):
        self.settings, self.store = settings, store
        self.sender, self.sleep, self.clock = sender, sleeper, clock
        self.last_request = 0.0
        self.activity: Callable | None = None

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: dict | None = None,
        query: dict | None = None,
        payload: dict | None = None,
        form: dict | None = None,
        retry_safe: bool | None = None,
        expect_json: bool = True,
    ):
        if self.store.mode != "live":
            raise BotError("DEMO databases cannot make network calls")
        endpoint_url(url)
        if query:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(query)
        outgoing = {
            "Accept": "application/json",
            "User-Agent": "au-trend-bot/1.0",
            **(headers or {}),
        }
        body = None
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
            outgoing["Content-Type"] = "application/json"
        elif form is not None:
            body = urllib.parse.urlencode(form).encode()
            outgoing["Content-Type"] = "application/x-www-form-urlencoded"
        safe = method == "GET" if retry_safe is None else retry_safe
        attempts = 1 + (self.settings.limits.http_retries if safe else 0)
        for attempt in range(attempts):
            if self.activity:
                self.activity()
            day = self.clock().astimezone(ZoneInfo(self.settings.timezone)).date().isoformat()
            self.store.reserve(
                [(day, "http_requests", 1, self.settings.limits.http_requests_per_day)]
            )
            delay = self.settings.limits.http_min_interval_seconds - (
                time.monotonic() - self.last_request
            )
            if delay > 0:
                self.sleep(delay)
            try:
                self.last_request = time.monotonic()
                response = self.sender(
                    method, url, outgoing, body, self.settings.limits.http_timeout_seconds
                )
            except HttpError:
                if attempt + 1 == attempts:
                    raise
                self.sleep(min(2**attempt, 8))
                continue
            if response.status == 429 or 500 <= response.status <= 599:
                if attempt + 1 < attempts:
                    retry_after = response.headers.get("Retry-After", "")
                    delay = (
                        min(int(retry_after), 10) if retry_after.isdigit() else min(2**attempt, 8)
                    )
                    self.sleep(delay)
                    continue
            if not 200 <= response.status < 300:
                raise HttpError(
                    response.status, f"Provider HTTP {response.status}; response body withheld"
                )
            if not expect_json:
                return response
            try:
                return json.loads(response.body.decode("utf-8"))
            except (UnicodeError, json.JSONDecodeError) as exc:
                raise DataError("Provider returned invalid UTF-8 JSON") from exc
        raise BotError("HTTP retry loop ended unexpectedly")
