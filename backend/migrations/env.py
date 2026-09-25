from alembic import context

from app import models  # noqa: F401  (registers tables on Base.metadata)
from app.config import database_path
from app.db import Base, make_engine

target_metadata = Base.metadata


def run_migrations_online() -> None:
    # Foreign keys off: batch table rebuilds drop the original table, which would cascade.
    engine = make_engine(database_path(), enforce_foreign_keys=False)
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata, render_as_batch=True
        )
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
