import csv
import hashlib
import io
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import Settings
from .models import feature_matches
from .safety import BotError, DataError, clean_text, public_url
from .storage import Store, encode
from .timeutil import parse_time, stamp


SALES_COLUMNS = [
    "record_id",
    "item_id",
    "title",
    "url",
    "kind",
    "quantity",
    "sold_at",
    "period_start",
    "period_end",
    "buyer_country",
    "marketplace",
    "item_location_country",
    "seller_country",
]


def bounded_text(path: Path) -> str:
    if path.stat().st_size > 5_000_000:
        raise DataError("Import file exceeds 5 MB")
    return path.read_text(encoding="utf-8-sig")


def country(value: str, column: str) -> str | None:
    if not value:
        return None
    if not re.fullmatch(r"[A-Z]{2}", value):
        raise DataError(f"{column} must be an explicit two-letter uppercase country or empty")
    return value


def import_sales(
    path: Path,
    settings: Settings,
    store: Store,
    provenance: str,
    authorized: bool,
    now: datetime,
) -> dict:
    if not authorized:
        raise BotError(
            "Confirm lawful authorization with --authorized; do not import buyer identities"
        )
    provenance = clean_text(provenance, 300)
    if not provenance:
        raise BotError("An explicit non-secret source/provenance label is required")
    reader = csv.DictReader(io.StringIO(bounded_text(path)))
    if reader.fieldnames != SALES_COLUMNS:
        raise DataError(
            "Sales CSV must use the exact documented columns; unknown/PII columns are rejected"
        )
    items: list[dict] = []
    for row_number, row in enumerate(reader, 2):
        if row_number > 10001:
            raise DataError("Sales import exceeds 10,000 rows")
        if None in row or any(v is None for v in row.values()):
            raise DataError(f"Incorrect sales column count at row {row_number}")
        row = {k: v.strip() for k, v in row.items()}
        kind = row["kind"]
        if kind not in ("transaction", "period_estimate", "rolling_30d"):
            raise DataError(f"Unknown sales evidence kind at row {row_number}")
        if not row["record_id"] or len(row["record_id"]) > 200 or not row["item_id"]:
            raise DataError(f"Missing pseudonymous record/item ID at row {row_number}")
        if not re.fullmatch(r"\d{1,9}", row["quantity"]):
            raise DataError(f"Invalid sales quantity at row {row_number}")
        quantity = int(row["quantity"])
        if kind == "transaction" and quantity == 0:
            raise DataError("A transaction quantity must be positive")
        if not re.fullmatch(r"EBAY_[A-Z]{2,3}", row["marketplace"]):
            raise DataError("Explicit eBay marketplace is required; it is not buyer-country proof")
        sold_at, period_start, period_end = None, None, None
        try:
            if kind == "transaction":
                sold_at = parse_time(row["sold_at"])
                if row["period_start"] or row["period_end"]:
                    raise DataError("A transaction uses sold_at, not an aggregate interval")
                if sold_at > now:
                    raise DataError("Future sales cannot be imported as actual transactions")
            else:
                if row["sold_at"]:
                    raise DataError(
                        "An aggregate estimate cannot also claim a transaction timestamp"
                    )
                period_start = parse_time(row["period_start"])
                period_end = parse_time(row["period_end"])
                if period_end <= period_start or period_end > now:
                    raise DataError("Aggregate intervals must be positive and not in the future")
                if kind == "rolling_30d":
                    zone = ZoneInfo(settings.timezone)
                    if (
                        period_end.astimezone(zone).date() - period_start.astimezone(zone).date()
                    ).days != 30:
                        raise DataError("rolling_30d must retain an actual 30-local-day interval")
        except (ValueError, TypeError) as exc:
            raise DataError(f"Invalid timezone-aware sales timestamp at row {row_number}") from exc
        title = clean_text(row["title"])
        items.append(
            {
                "id": hashlib.sha256(("ebay:" + row["record_id"]).encode()).hexdigest(),
                "source": "ebay_authorized_import",
                "item_id": clean_text(row["item_id"], 250),
                "title": title,
                "url": public_url(row["url"], ("ebay.com.au", "ebay.com")),
                "kind": kind,
                "quantity": quantity,
                "provenance": provenance,
                "sold_at": stamp(sold_at) if sold_at else None,
                "period_start": stamp(period_start) if period_start else None,
                "period_end": stamp(period_end) if period_end else None,
                "buyer_country": country(row["buyer_country"], "buyer_country"),
                "marketplace": row["marketplace"],
                "item_location_country": country(
                    row["item_location_country"], "item_location_country"
                ),
                "seller_country": country(row["seller_country"], "seller_country"),
                "features": feature_matches(title, settings),
                "verification": "user_authorized_reported_not_independently_verified",
            }
        )
    if not items:
        raise DataError("Sales import is empty")
    inserted = store.put_sales(items, now)
    return {
        "state": "ok",
        "source": "authorized_manual_import",
        "rows": len(items),
        "inserted": inserted,
    }


def import_trends(
    path: Path,
    settings: Settings,
    store: Store,
    fetched_at: datetime,
    authorized: bool,
    now: datetime,
) -> dict:
    if not authorized:
        raise BotError("Confirm authorization for the original Google Trends CSV with --authorized")
    if fetched_at > now + timedelta(minutes=5):
        raise DataError("CSV acquisition time cannot be in the future")
    rows = list(csv.reader(io.StringIO(bounded_text(path))))
    header_index = next(
        (index for index, row in enumerate(rows) if row and row[0] in ("Day", "日期")), None
    )
    if header_index is None:
        raise DataError(
            "Only Google Trends daily exports are supported; no weekly/hourly rescaling"
        )
    header = rows[header_index]
    queries: list[str] = []
    for column in header[1:]:
        match = re.fullmatch(r"(.+): \((Australia|澳大利亚)\)", column)
        if not match or match.group(1) not in settings.keywords:
            raise DataError(
                "CSV must identify configured queries and Australia explicitly in each header"
            )
        queries.append(match.group(1))
    if not queries or len(set(queries)) != len(queries):
        raise DataError("Empty or duplicate Google Trends CSV query headers")
    points: dict[str, list[dict]] = {query: [] for query in queries}
    seen: set[date] = set()
    local_today = fetched_at.astimezone(ZoneInfo(settings.timezone)).date()
    for row in rows[header_index + 1 :]:
        if not row:
            continue
        if len(row) != len(header):
            raise DataError("Google Trends CSV column count changed")
        try:
            day = date.fromisoformat(row[0])
        except ValueError as exc:
            raise DataError("Google Trends CSV dates must use YYYY-MM-DD") from exc
        if day in seen or day > local_today:
            raise DataError("Duplicate or future Google Trends CSV date")
        seen.add(day)
        for query, text in zip(queries, row[1:]):
            if text == "<1" or not text:
                value = None
            elif re.fullmatch(r"\d{1,3}", text) and int(text) <= 100:
                value = int(text)
            else:
                raise DataError("Invalid Google Trends CSV normalized value")
            points[query].append(
                {
                    "date": day.isoformat(),
                    "value": value,
                    "partial": day == local_today,
                }
            )
    if not seen or len(seen) > 500:
        raise DataError("Google Trends CSV must contain 1-500 daily rows")
    ordered = sorted(seen)
    daily = len(ordered) >= 2 and all((b - a).days == 1 for a, b in zip(ordered, ordered[1:]))
    identity = {"source": "google_csv", "fetched_at": stamp(fetched_at), "points": points}
    item = {
        **identity,
        "id": hashlib.sha256(encode(identity).encode()).hexdigest(),
        "geo": "AU",
        "granularity": "day" if daily else "unsupported_or_sparse",
        "normalization": "one_csv_0_100",
        "source_url": "https://trends.google.com/trends/",
        "request": {"keywords": queries, "geo": "AU", "method": "authorized_manual_csv"},
    }
    store.put_series(item)
    return {"state": "ok" if daily else "partial", "series_id": item["id"], "source": "google_csv"}
