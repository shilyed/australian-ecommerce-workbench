from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo


def utcnow() -> datetime:
    return datetime.now(UTC)


def parse_time(value: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError("A timestamp must be ISO-8601 text")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None or result.utcoffset() is None:
        raise ValueError("A timestamp must include an explicit UTC offset")
    return result.astimezone(UTC)


def stamp(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("A timestamp must be timezone aware")
    return value.astimezone(UTC).isoformat(timespec="microseconds")


@dataclass(frozen=True)
class Window:
    start: datetime
    end: datetime
    timezone: str = "Australia/Sydney"

    @classmethod
    def ending(cls, end: date, timezone: str = "Australia/Sydney") -> "Window":
        if end.weekday() != 0:
            raise ValueError("The exclusive week end must be a local Monday")
        zone = ZoneInfo(timezone)
        return cls(
            datetime.combine(end - timedelta(days=7), time.min, zone).astimezone(UTC),
            datetime.combine(end, time.min, zone).astimezone(UTC),
            timezone,
        )

    @classmethod
    def latest(cls, now: datetime, timezone: str = "Australia/Sydney") -> "Window":
        local = now.astimezone(ZoneInfo(timezone)).date()
        return cls.ending(local - timedelta(days=local.weekday()), timezone)

    def previous(self) -> "Window":
        return Window.ending(self.start.astimezone(ZoneInfo(self.timezone)).date(), self.timezone)

    def contains(self, value: datetime) -> bool:
        return self.start <= value < self.end

    def dates(self) -> list[str]:
        first = self.start.astimezone(ZoneInfo(self.timezone)).date()
        return [(first + timedelta(days=n)).isoformat() for n in range(7)]

    @property
    def end_date(self) -> str:
        return self.end.astimezone(ZoneInfo(self.timezone)).date().isoformat()

    def as_dict(self) -> dict:
        zone = ZoneInfo(self.timezone)
        return {
            "start_utc": stamp(self.start),
            "end_utc": stamp(self.end),
            "start_local": self.start.astimezone(zone).isoformat(),
            "end_local": self.end.astimezone(zone).isoformat(),
            "timezone": self.timezone,
            "interval": "[start, end)",
        }
