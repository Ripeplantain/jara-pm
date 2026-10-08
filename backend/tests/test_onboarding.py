from datetime import date

import sqlalchemy as sa

from app.models import OnboardingProfile, Sprint, Workspace, WorkspaceInvite
from app.services import email as email_service
from tests.conftest import session_for


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_onboarding_status_starts_incomplete(client, register_and_login):
    token = register_and_login()
    res = client.get("/api/onboarding", headers=auth(token))
    assert res.status_code == 200
    assert res.json() == {"completed": False, "workspace_id": None, "workspace_name": None, "board_id": None, "sprint_id": None}


def test_onboarding_creates_context_board_sprint_and_invites(client, register_and_login, monkeypatch):
    token = register_and_login()
    sent: list[tuple] = []
    monkeypatch.setattr(email_service, "send_invitation", lambda *args: sent.append(args))
    body = {
        "workspace_name": "Acme product",
        "product_context": "A customer support product",
        "team_size": 4,
        "board_template": "scrum",
        "sprint_name": "Discovery sprint",
        "sprint_goal": "Validate the next workflow",
        "starts_on": "2026-10-08",
        "ends_on": "2026-10-22",
        "invites": [{"email": "teammate@example.com", "role": "member"}],
    }
    result = client.post("/api/onboarding", json=body, headers=auth(token))
    assert result.status_code == 201
    status = result.json()
    assert status["completed"] is True
    assert status["workspace_id"]
    assert status["board_id"]
    assert status["sprint_id"]
    assert len(sent) == 1

    with session_for() as db:
        profile = db.scalar(sa.select(OnboardingProfile))
        workspace = db.get(Workspace, profile.workspace_id)
        sprint = db.get(Sprint, profile.sprint_id)
        invite = db.scalar(sa.select(WorkspaceInvite))
        assert profile.product_context == "A customer support product"
        assert workspace.name == "Acme product"
        assert sprint.name == "Discovery sprint"
        assert sprint.starts_on == date(2026, 10, 8)
        assert invite.email == "teammate@example.com"

    assert client.post("/api/onboarding", json=body, headers=auth(token)).status_code == 409


def test_demo_onboarding_is_available_once_and_returns_a_real_board(client, register_and_login):
    token = register_and_login()
    result = client.post("/api/onboarding/demo", headers=auth(token))
    assert result.status_code == 201
    assert result.json()["completed"] is True
    boards = client.get("/api/boards", headers=auth(token)).json()
    assert any(board["title"] == "My product" for board in boards)
    assert client.post("/api/onboarding/demo", headers=auth(token)).status_code == 409
