from contextlib import contextmanager

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.db import get_engine
from app.main import app

TEST_JWT_SECRET = "test-secret-" + "x" * 32


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    """Temporary SQLite database per test, built with the real migrations."""
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("BACKEND_JWT_SECRET", TEST_JWT_SECRET)
    get_engine.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")
    yield
    get_engine().dispose()
    get_engine.cache_clear()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def register_and_login(client):
    def _do(email="a@example.com", password="correct-horse"):
        client.post("/api/auth/register", json={"email": email, "password": password})
        res = client.post("/api/auth/login", json={"email": email, "password": password})
        return res.json()["access_token"]

    return _do


@contextmanager
def session_for() -> "Session":
    """A session on the test database, for asserting on rows the API wrote."""
    with sessionmaker(bind=get_engine(), expire_on_commit=False)() as session:
        yield session
