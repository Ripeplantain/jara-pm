"""A disposable new-user SaaS path, with provider boundaries replaced by local fakes."""

import json

from app.ai.llm import AssistantTurn, ToolCall
from app.services import email as email_service


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_new_user_can_reach_value_and_isolation(client, register_and_login, monkeypatch, use_llm):
    verification_tokens = []
    invitation_messages = []
    reset_tokens = []
    monkeypatch.setattr(email_service, "send_verification", lambda _email, token: verification_tokens.append(token))
    monkeypatch.setattr(email_service, "send_invitation", lambda *args: invitation_messages.append(args))
    monkeypatch.setattr(email_service, "send_password_reset", lambda _email, token: reset_tokens.append(token))

    registered = client.post(
        "/api/auth/register", json={"email": "founder@example.com", "password": "correct-horse"}
    )
    assert registered.status_code == 201
    assert client.post("/api/auth/verify-email", json={"token": verification_tokens[0]}).status_code == 200
    owner_token = client.post(
        "/api/auth/login", json={"email": "founder@example.com", "password": "correct-horse"}
    ).json()["access_token"]

    reset_requested = client.post(
        "/api/auth/password-reset/request", json={"email": "founder@example.com"}
    )
    assert reset_requested.status_code == 202
    assert client.post(
        "/api/auth/password-reset/confirm",
        json={"token": reset_tokens[0], "new_password": "new-correct-horse"},
    ).status_code == 204
    owner_token = client.post(
        "/api/auth/login", json={"email": "founder@example.com", "password": "new-correct-horse"}
    ).json()["access_token"]
    owner = bearer(owner_token)

    assert client.get("/api/onboarding", headers=owner).json()["completed"] is False
    onboarding = client.post(
        "/api/onboarding",
        headers=owner,
        json={
            "workspace_name": "Acme Product",
            "product_context": "A focused product team.",
            "team_size": 2,
            "board_template": "product-roadmap",
            "sprint_name": "First sprint",
            "invites": [{"email": "teammate@example.com", "role": "member"}],
        },
    )
    assert onboarding.status_code == 201
    workspace_id = onboarding.json()["workspace_id"]
    board_id = onboarding.json()["board_id"]
    invite_token = invitation_messages[0][4]
    assert client.post(
        "/api/auth/register",
        json={"email": "teammate@example.com", "password": "correct-horse", "invite_token": invite_token},
    ).status_code == 201
    outsider_token = register_and_login("outsider@example.com")
    # The invited user can see the shared workspace after accepting the single-use link.
    invited_token = client.post(
        "/api/auth/login", json={"email": "teammate@example.com", "password": "correct-horse"}
    ).json()["access_token"]
    assert client.get(f"/api/workspaces/{workspace_id}", headers=bearer(invited_token)).status_code == 200

    board = client.get(f"/api/boards/{board_id}", headers=owner).json()
    card = client.post(
        f"/api/columns/{board['columns'][0]['id']}/cards",
        json={"title": "Ship the first slice"},
        headers=owner,
    ).json()
    sprint = client.post(
        f"/api/boards/{board_id}/sprints", json={"name": "Launch sprint"}, headers=owner
    ).json()
    assert sprint["id"]

    use_llm(
        AssistantTurn(
            tool_calls=[
                ToolCall(
                    id="proposal",
                    name="suggest_card_authoring",
                    arguments=json.dumps(
                        {"card_id": card["id"], "title": "Ship the first usable slice", "estimate": 3}
                    ),
                )
            ]
        ),
        AssistantTurn(content="I prepared a reviewed improvement."),
    )
    ai = client.post(
        f"/api/boards/{board_id}/ai", json={"message": "Improve this card"}, headers=owner
    )
    assert ai.status_code == 200
    proposal_token = ai.json()["pending"][0]["proposal_token"]
    confirmed = client.post(
        f"/api/boards/{board_id}/ai/confirm",
        json={"proposal_token": proposal_token},
        headers=owner,
    )
    assert confirmed.status_code == 200 and confirmed.json()["changes"]
    assert client.get(f"/api/boards/{board_id}/activity", headers=owner).json()
    assert client.get("/api/notifications", headers=owner).status_code == 200
    assert client.get(f"/api/workspaces/{workspace_id}/export", headers=owner).status_code == 200

    extra = client.post("/api/workspaces", json={"name": "Disposable workspace"}, headers=owner).json()
    assert client.request(
        "DELETE",
        f"/api/workspaces/{extra['id']}", json={"confirmation": "DELETE"}, headers=owner
    ).status_code == 204
    assert client.get(f"/api/workspaces/{extra['id']}", headers=owner).status_code == 404
    assert client.get(f"/api/workspaces/{workspace_id}", headers=bearer(outsider_token)).status_code == 404
