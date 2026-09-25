from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import database_path


class Base(DeclarativeBase):
    pass


def make_engine(path: str, *, enforce_foreign_keys: bool = True) -> Engine:
    """Engine for the SQLite file at `path`.

    Migrations pass `enforce_foreign_keys=False`: SQLite has no ALTER for most schema changes, so
    Alembic's batch mode rebuilds a table by dropping it and renaming a copy into place. With
    enforcement on, that DROP cascades and silently deletes every child row. Enforcement is on
    everywhere else, which is what the application actually runs with.
    """
    engine = create_engine(f"sqlite:///{path}")
    fk = "ON" if enforce_foreign_keys else "OFF"

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover - trivial
        cur = dbapi_conn.cursor()
        cur.execute(f"PRAGMA foreign_keys={fk}")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()

    return engine


@lru_cache
def get_engine() -> Engine:
    return make_engine(database_path())


def get_db() -> Iterator[Session]:
    """Session-per-request dependency."""
    with sessionmaker(bind=get_engine(), expire_on_commit=False)() as session:
        yield session
