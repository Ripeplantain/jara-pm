"""PostHog capture: what is sent, what is not, and what a failure does.

No test reaches a live provider. With no `POSTHOG_PROJECT_TOKEN` the real adapter is never
built; `DisabledSink` records what would have been sent, which is what these tests read.
"""

import pytest

from app.services import posthog_client
from app.services.metrics import metrics
from app.services.posthog_client import DisabledSink, PostHogSink
from tests.conftest import session_for


@pytest.fixture
def sink(monkeypatch):
    """One recording sink for the duration of a test, in place of the cached one."""
    recorder = DisabledSink()
    monkeypatch.setattr(posthog_client, "get_sink", lambda: recorder)
    return recorder


def names(sink: DisabledSink) -> list[str]:
    return [event for event, _distinct_id, _properties in sink.captured]


def event(sink: DisabledSink, name: str) -> tuple[str, str, dict]:
    matches = [row for row in sink.captured if row[0] == name]
    assert matches, f"{name} not captured; got {names(sink)}"
    return matches[0]


# --- the sink is optional -------------------------------------------------------------------


def test_no_token_means_no_provider(monkeypatch):
    """The whole integration stays off without configuration, rather than failing."""
    monkeypatch.delenv("POSTHOG_PROJECT_TOKEN", raising=False)
    posthog_client.reset_sink()
    assert isinstance(posthog_client.get_sink(), DisabledSink)
    posthog_client.reset_sink()


def test_token_builds_the_real_adapter(monkeypatch):
    monkeypatch.setenv("POSTHOG_PROJECT_TOKEN", "phc_test_token")
    monkeypatch.setenv("POSTHOG_HOST", "https://eu.i.posthog.com")
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.setenv("APP_RELEASE", "abc123")
    posthog_client.reset_sink()
    built = posthog_client.get_sink()
    assert isinstance(built, PostHogSink)
    # The environment rides on every event, so staging is never read as production.
    assert built.client.super_properties == {"environment": "staging", "$app_version": "abc123"}
    posthog_client.reset_sink()


def test_a_broken_provider_is_counted_not_raised():
    """A PostHog outage must not fail the request that triggered the event."""

    class Broken:
        def capture(self, *_args, **_kwargs):
            raise RuntimeError("provider down")

        def capture_exception(self, *_args, **_kwargs):
            raise RuntimeError("provider down")

    before = metrics.snapshot()["analytics_failures"]
    sink = PostHogSink(Broken())
    sink.capture("board_created", distinct_id="user:1", properties={})
    sink.capture_exception(ValueError("x"), properties={})
    assert metrics.snapshot()["analytics_failures"] == before + 2


# --- events ride on the transaction ---------------------------------------------------------


def test_events_are_sent_only_when_the_session_commits(sink):
    with session_for() as db:
        posthog_client.capture(db, "board_created", distinct_id="user:1")
        assert names(sink) == [], "sent before commit"
        db.commit()
    assert names(sink) == ["board_created"]


def test_a_rolled_back_change_sends_nothing(sink):
    with session_for() as db:
        posthog_client.capture(db, "board_created", distinct_id="user:1")
        db.rollback()
        db.commit()
    assert names(sink) == []


def test_a_second_commit_does_not_resend(sink):
    with session_for() as db:
        posthog_client.capture(db, "board_created", distinct_id="user:1")
        db.commit()
        db.commit()
    assert names(sink) == ["board_created"]


def test_workspace_scoped_events_create_no_person(sink):
    with session_for() as db:
        posthog_client.capture(db, "ai_used", distinct_id="workspace:7", person=False)
        db.commit()
    _name, distinct_id, properties = event(sink, "ai_used")
    assert distinct_id == "workspace:7"
    assert properties["$process_person_profile"] is False


# --- the real flows through the API ---------------------------------------------------------


def test_registration_and_sign_in_are_captured(client, sink):
    client.post("/api/auth/register", json={"email": "new@example.com", "password": "correct-horse"})
    assert "user_registered" in names(sink)
    _name, distinct_id, properties = event(sink, "user_registered")
    assert distinct_id.startswith("user:")
    assert properties == {"invited": False}

    client.post("/api/auth/login", json={"email": "new@example.com", "password": "correct-horse"})
    assert "user_signed_in" in names(sink)


def test_a_rejected_registration_reports_no_signup(client, sink):
    body = {"email": "dupe@example.com", "password": "correct-horse"}
    client.post("/api/auth/register", json=body)
    sink.captured.clear()
    assert client.post("/api/auth/register", json=body).status_code == 409
    assert names(sink) == [], "a conflicting registration still reported a signup"


def test_a_failed_sign_in_reports_nothing(client, register_and_login, sink):
    register_and_login("real@example.com")
    sink.captured.clear()
    assert client.post(
        "/api/auth/login", json={"email": "real@example.com", "password": "wrong"}
    ).status_code == 401
    assert names(sink) == []


def test_board_and_card_milestones_are_captured(client, register_and_login, sink):
    token = register_and_login("builder@example.com")
    auth = {"Authorization": f"Bearer {token}"}
    board = client.post(
        "/api/boards", json={"title": "Roadmap", "columns": ["Todo"]}, headers=auth
    ).json()
    column = board["columns"][0]
    client.post(f"/api/columns/{column['id']}/cards", json={"title": "Ship it"}, headers=auth)

    assert "board_created" in names(sink)
    assert "card_created" in names(sink)
    _name, distinct_id, properties = event(sink, "card_created")
    assert distinct_id == "user:1", "distinct id must be the internal user id, not the email"
    assert properties["board_id"] == board["id"]
    assert properties["workspace_id"] == board["workspace_id"]


def test_no_event_property_carries_content_or_credentials(client, register_and_login, sink):
    """Card titles, emails, passwords and tokens must never become event properties."""
    token = register_and_login("private@example.com")
    auth = {"Authorization": f"Bearer {token}"}
    board = client.post(
        "/api/boards", json={"title": "Secret plan", "columns": ["Todo"]}, headers=auth
    ).json()
    column = board["columns"][0]
    client.post(
        f"/api/columns/{column['id']}/cards",
        json={"title": "Acquire Initech", "description": "for 4.2m"},
        headers=auth,
    )

    forbidden = ["Secret plan", "Acquire Initech", "4.2m", "private@example.com", "correct-horse", token]
    for name, distinct_id, properties in sink.captured:
        blob = f"{name} {distinct_id} {properties}"
        for secret in forbidden:
            assert secret not in blob, f"{secret!r} leaked into {name}"
        # Only ids, counts and flags are allowed through.
        for key in properties:
            assert key.endswith("_id") or key in {
                "count",
                "provider_calls",
                "invited",
                "$process_person_profile",
            }, f"unexpected property {key} on {name}"


# --- exceptions -----------------------------------------------------------------------------


def test_an_unhandled_exception_is_reported_with_a_redacted_path(client, sink, monkeypatch):
    from app.routers import health

    def boom(*_args, **_kwargs):
        raise RuntimeError("database on fire")

    monkeypatch.setattr(health.metrics, "snapshot", boom)
    token = client.post(
        "/api/auth/register", json={"email": "oops@example.com", "password": "correct-horse"}
    ) and client.post(
        "/api/auth/login", json={"email": "oops@example.com", "password": "correct-horse"}
    ).json()["access_token"]
    sink.captured.clear()

    with pytest.raises(RuntimeError):
        client.get("/api/health/metrics", headers={"Authorization": f"Bearer {token}"})

    assert "$exception" in names(sink)
    _name, exc_type, properties = event(sink, "$exception")
    assert exc_type == "RuntimeError"
    assert properties["path"] == "/api/health/metrics"
    assert properties["method"] == "GET"


def test_an_expected_refusal_is_not_an_exception(client, register_and_login, sink):
    """A 403 or 404 is the application working, and must not pollute error tracking."""
    token = register_and_login("viewer@example.com")
    sink.captured.clear()
    assert client.get(
        "/api/boards/99999", headers={"Authorization": f"Bearer {token}"}
    ).status_code == 404
    assert "$exception" not in names(sink)


def test_an_invite_token_never_reaches_an_exception_property(sink):
    """The path is redacted the same way the HTTP log is."""
    from app.main import _safe_path

    assert _safe_path("/api/auth/invites/secret-token-value") == "/api/auth/invites/[redacted]"
