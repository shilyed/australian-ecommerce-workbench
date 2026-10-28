import re
from dataclasses import asdict, dataclass, field
from datetime import datetime

from .config import Settings
from .safety import DataError
from .timeutil import stamp


@dataclass
class Observation:
    source: str
    external_id: str
    observed_at: str
    title: str
    url: str
    metrics: dict
    geography: dict
    queries: list[str] = field(default_factory=list)
    features: list[str] = field(default_factory=list)
    created_at: str | None = None
    time_basis: str = "retrieved_at"

    def as_dict(self) -> dict:
        return asdict(self)


def feature_matches(text: str, settings: Settings) -> list[str]:
    folded = text.casefold()
    result = [
        name
        for name, terms in settings.features.items()
        if any(term.casefold() in folded for term in terms)
    ]
    for match in re.finditer(r"(?<!\w)(\d{2,4})\s*ml\b", folded):
        capacity = int(match.group(1))
        if 30 <= capacity <= 3000:
            result.append(f"容量文案: {capacity} ml")
    for match in re.finditer(r"(?<!\w)(\d{1,2}(?:\.\d)?)\s*(?:fl\.?\s*)?oz\b", folded):
        result.append(f"容量文案: {match.group(1)} oz")
    return sorted(set(result))


def observation(
    settings: Settings,
    source: str,
    external_id: str,
    when: datetime,
    title: str,
    url: str,
    metrics: dict,
    geography: dict,
    queries: list[str],
    created_at: str | None = None,
    time_basis: str = "retrieved_at",
) -> Observation:
    if not external_id or len(external_id) > 250:
        raise DataError("Invalid external evidence ID")
    return Observation(
        source,
        external_id,
        stamp(when),
        settings.redactor.text(title),
        settings.redactor.text(url),
        metrics,
        geography,
        sorted(set(queries)),
        feature_matches(title, settings),
        created_at,
        time_basis,
    )
