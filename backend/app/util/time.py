"""Datetime helpers.

SQLite has no timezone-aware type: a value written as aware comes back naive, while a value
still in the session is aware. Comparing the two raises, so everything the app compares goes
through `as_utc` first.
"""

from datetime import UTC, datetime


def as_utc(value: datetime | None) -> datetime | None:
    """Treat a naive datetime from SQLite as the UTC it was written as."""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def now() -> datetime:
    return datetime.now(UTC)
