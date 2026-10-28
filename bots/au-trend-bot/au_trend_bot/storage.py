import contextlib
import json
import os
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from .config import Settings
from .models import Observation
from .safety import BotError, BudgetError, DataError
from .timeutil import stamp, utcnow


SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS observations (
  source TEXT NOT NULL, external_id TEXT NOT NULL, observed_at TEXT NOT NULL,
  payload TEXT NOT NULL, PRIMARY KEY(source, external_id, observed_at)
);
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, fetched_at TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY, imported_at TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  key TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL,
  updated_at TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS budgets (
  period TEXT NOT NULL, kind TEXT NOT NULL, used INTEGER NOT NULL,
  PRIMARY KEY(period, kind)
);
CREATE TABLE IF NOT EXISTS reports (
  key TEXT PRIMARY KEY, end_date TEXT NOT NULL, revision INTEGER NOT NULL,
  created_at TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
  key TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS observations_time ON observations(observed_at);
"""


def encode(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


class Store:
    def __init__(self, settings: Settings, mode: str = "live"):
        self.settings = settings
        self.root = settings.data_dir
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = self.root / "trend.sqlite3"
        self.connection = sqlite3.connect(self.path, timeout=15)
        self.connection.row_factory = sqlite3.Row
        tables = {
            row[0]
            for row in self.connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if tables and "meta" not in tables:
            self.connection.close()
            raise BotError("Refusing to modify an existing non-bot SQLite database")
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.executescript(SCHEMA)
        identity = {"schema": "1", "mode": mode, "fingerprint": settings.fingerprint}
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            for key, value in identity.items():
                found = self.connection.execute(
                    "SELECT value FROM meta WHERE key=?", (key,)
                ).fetchone()
                if found and found["value"] != value:
                    raise BotError(
                        "Database identity mismatch; use a separate ATB_DATA_DIR for demo/topic changes"
                    )
                self.connection.execute(
                    "INSERT OR IGNORE INTO meta(key,value) VALUES (?,?)", (key, value)
                )
            self.connection.commit()
        except (sqlite3.Error, BotError):
            self.connection.rollback()
            self.connection.close()
            raise
        self.mode = mode

    def close(self):
        self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def put_observations(self, items: list[Observation]) -> int:
        inserted = 0
        with self.connection:
            for item in items:
                payload = self.settings.redactor.value(item.as_dict())
                keys = (item.source, item.external_id, item.observed_at)
                old = self.connection.execute(
                    "SELECT payload FROM observations WHERE source=? AND external_id=? AND observed_at=?",
                    keys,
                ).fetchone()
                if old:
                    previous = json.loads(old["payload"])
                    merged_queries = sorted(set(previous["queries"] + payload["queries"]))
                    previous["queries"] = payload["queries"] = merged_queries
                    if previous != payload:
                        raise DataError("Conflicting snapshots at the same provider timestamp")
                    self.connection.execute(
                        "UPDATE observations SET payload=? WHERE source=? AND external_id=? AND observed_at=?",
                        (encode(payload), *keys),
                    )
                else:
                    self.connection.execute(
                        "INSERT INTO observations VALUES (?,?,?,?)", (*keys, encode(payload))
                    )
                    inserted += 1
        return inserted

    def observations(
        self, source: str, start: datetime | None = None, end: datetime | None = None
    ) -> list[dict]:
        query = "SELECT payload FROM observations WHERE source=?"
        args: list[str] = [source]
        if start:
            query += " AND observed_at>=?"
            args.append(stamp(start))
        if end:
            query += " AND observed_at<=?"
            args.append(stamp(end))
        query += " ORDER BY observed_at,external_id"
        return [json.loads(row[0]) for row in self.connection.execute(query, args)]

    def known(self, source: str, limit: int, *, before: datetime | None = None) -> list[dict]:
        query = """SELECT o.payload FROM observations o
               JOIN (SELECT external_id,MAX(observed_at) AS latest FROM observations
                     WHERE source=? GROUP BY external_id) x
               ON o.external_id=x.external_id AND o.observed_at=x.latest
               WHERE o.source=?"""
        args: list[str | int] = [source, source]
        if before is not None:
            query += " AND o.observed_at<?"
            args.append(stamp(before))
        query += " ORDER BY o.observed_at DESC,o.external_id LIMIT ?"
        args.append(limit)
        rows = self.connection.execute(query, args)
        return [json.loads(row[0]) for row in rows]

    def put_series(self, item: dict):
        with self.connection:
            self.connection.execute(
                "INSERT OR IGNORE INTO series VALUES (?,?,?,?)",
                (
                    item["id"],
                    item["source"],
                    item["fetched_at"],
                    encode(self.settings.redactor.value(item)),
                ),
            )

    def all_series(self) -> list[dict]:
        return [
            json.loads(row[0])
            for row in self.connection.execute(
                "SELECT payload FROM series ORDER BY fetched_at DESC,id"
            )
        ]

    def put_sales(self, items: list[dict], now: datetime) -> int:
        inserted = 0
        with self.connection:
            for item in items:
                payload = encode(self.settings.redactor.value(item))
                old = self.connection.execute(
                    "SELECT payload FROM sales WHERE id=?", (item["id"],)
                ).fetchone()
                if old and old[0] != payload:
                    raise DataError("Conflicting sale record ID; imports are immutable")
                if not old:
                    self.connection.execute(
                        "INSERT INTO sales VALUES (?,?,?)", (item["id"], stamp(now), payload)
                    )
                    inserted += 1
        return inserted

    def all_sales(self) -> list[dict]:
        return [
            json.loads(row[0])
            for row in self.connection.execute("SELECT payload FROM sales ORDER BY id")
        ]

    def job(self, key: str) -> dict | None:
        row = self.connection.execute("SELECT * FROM jobs WHERE key=?", (key,)).fetchone()
        return None if row is None else {**dict(row), "payload": json.loads(row["payload"])}

    def set_job(self, key: str, kind: str, state: str, payload: dict, now: datetime | None = None):
        with self.connection:
            self.connection.execute(
                "INSERT OR REPLACE INTO jobs VALUES (?,?,?,?,?)",
                (
                    key,
                    kind,
                    state,
                    stamp(now or utcnow()),
                    encode(self.settings.redactor.value(payload)),
                ),
            )

    def jobs(self, kind: str | None = None) -> list[dict]:
        query = (
            "SELECT * FROM jobs" + (" WHERE kind=?" if kind else "") + " ORDER BY updated_at DESC"
        )
        return [
            {**dict(row), "payload": json.loads(row["payload"])}
            for row in self.connection.execute(query, (kind,) if kind else ())
        ]

    def reserve(self, charges: list[tuple[str, str, int, int]]):
        try:
            self.connection.execute("BEGIN IMMEDIATE")
            for period, kind, amount, maximum in charges:
                row = self.connection.execute(
                    "SELECT used FROM budgets WHERE period=? AND kind=?", (period, kind)
                ).fetchone()
                used = row[0] if row else 0
                if amount <= 0 or used + amount > maximum:
                    raise BudgetError(f"Budget exhausted: {kind} for {period}")
                self.connection.execute(
                    "INSERT OR REPLACE INTO budgets VALUES (?,?,?)", (period, kind, used + amount)
                )
            self.connection.commit()
        except (sqlite3.Error, BudgetError):
            self.connection.rollback()
            raise

    def budgets(self) -> list[dict]:
        return [
            dict(row)
            for row in self.connection.execute("SELECT * FROM budgets ORDER BY period DESC,kind")
        ]

    def report(self, key: str) -> dict | None:
        row = self.connection.execute("SELECT payload FROM reports WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def save_report(self, report: dict):
        with self.connection:
            self.connection.execute(
                "INSERT INTO reports VALUES (?,?,?,?,?)",
                (
                    report["key"],
                    report["window"]["end_local"][:10],
                    report["revision"],
                    report["generated_at"],
                    encode(self.settings.redactor.value(report)),
                ),
            )

    def delivery(self, key: str) -> dict | None:
        row = self.connection.execute("SELECT * FROM deliveries WHERE key=?", (key,)).fetchone()
        return None if row is None else {**dict(row), "payload": json.loads(row["payload"])}

    def set_delivery(self, key: str, state: str, payload: dict):
        with self.connection:
            self.connection.execute(
                "INSERT OR REPLACE INTO deliveries VALUES (?,?,?,?)",
                (key, state, stamp(utcnow()), encode(self.settings.redactor.value(payload))),
            )

    def deliveries(self) -> list[dict]:
        return [
            {**dict(row), "payload": json.loads(row["payload"])}
            for row in self.connection.execute("SELECT * FROM deliveries ORDER BY updated_at DESC")
        ]

    def backup(self, target: Path):
        target = target.resolve()
        if target == self.path.resolve() or target.exists():
            raise BotError("Backup destination must be a new file, not the live database")
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with contextlib.closing(sqlite3.connect(target)) as destination:
            self.connection.backup(destination)
        if os.name != "nt":
            target.chmod(0o600)

    def prune(self, days: int, now: datetime) -> dict:
        if days < 30:
            raise BotError("Keep at least 30 days of snapshots for window and baseline analysis")
        cutoff = stamp(now - timedelta(days=days))
        with self.connection:
            observations = self.connection.execute(
                "DELETE FROM observations WHERE observed_at<?", (cutoff,)
            ).rowcount
            series = self.connection.execute(
                "DELETE FROM series WHERE fetched_at<?", (cutoff,)
            ).rowcount
        return {
            "observations_removed": observations,
            "series_removed": series,
            "cutoff_utc": cutoff,
        }


@contextlib.contextmanager
def process_lock(root: Path):
    root.mkdir(parents=True, exist_ok=True)
    handle = (root / "job.lock").open("a+b")
    locked = False
    try:
        if os.name == "nt":
            import msvcrt

            if os.fstat(handle.fileno()).st_size == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise BotError("Another bot command holds the data-directory lock") from exc
        else:
            import fcntl

            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise BotError("Another bot command holds the data-directory lock") from exc
        locked = True
        yield
    finally:
        if locked:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()
