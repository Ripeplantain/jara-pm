from contextlib import contextmanager

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.ai.llm import AssistantTurn, get_llm_client
from app.db import get_engine
from app.main import app
from app.services.abuse import rate_limiter

TEST_JWT_SECRET = "test-secret-" + "x" * 32


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    """Temporary SQLite database per test, built with the real migrations."""
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("BACKEND_JWT_SECRET", TEST_JWT_SECRET)
    rate_limiter.clear()
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


class FakeLLM:
    """Replays scripted assistant turns and records everything it was sent."""

    def __init__(self, *turns: AssistantTurn):
        self.turns = list(turns)
        self.calls: list[list[dict]] = []

    def complete(self, messages, tools):
        self.calls.append([dict(m) for m in messages])
        return self.turns.pop(0) if self.turns else AssistantTurn(content="(script ended)")


@pytest.fixture
def use_llm():
    """Swap the real provider for a script. No test ever calls a live model."""

    def _use(*turns: AssistantTurn) -> FakeLLM:
        fake = FakeLLM(*turns)
        app.dependency_overrides[get_llm_client] = lambda: fake
        return fake

    yield _use
    app.dependency_overrides.pop(get_llm_client, None)
