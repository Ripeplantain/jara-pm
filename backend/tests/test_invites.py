"""Invitations: one endpoint, two outcomes, and automatic acceptance at registration."""

import hashlib
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa

from app.models import WorkspaceInvite
from app.services import email as email_service
from tests.conftest import session_for


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def workspace(client, register_and_login):
    token = register_and_login("owner@example.com")
    return client.get("/api/workspaces", headers=headers(token)).json()[0], token


def test_inviting_an_unregistered_address_creates_an_invite(client, workspace, monkeypatch):
    sent: list[tuple] = []
    monkeypatch.setattr(email_service, "send_invitation", lambda *args: sent.append(args))
    ws, token = workspace
    res = client.post(
        f"/api/workspaces/{ws['id']}/invites",
        json={"email": "New@Example.com", "role": "member"},
        headers=headers(token),
    )
    assert res.status_code == 201
    body = res.json()
    assert body["kind"] == "invite"
    assert body["member"] is None
    assert body["invite"]["email"] == "new@example.com"
    assert body["invite"]["role"] == "member"
    # The token is a secret for a future email link and must not travel in the response.
    assert "token" not in body["invite"]
    with session_for() as db:
        invite = db.get(WorkspaceInvite, body["invite"]["id"])
        raw_token = sent[0][4]
        assert invite.token_hash == hashlib.sha256(raw_token.encode()).hexdigest()
        assert raw_token not in invite.token_hash and not hasattr(invite, "token")

    listed = client.get(f"/api/workspaces/{ws['id']}/invites", headers=headers(token)).json()
    assert [i["email"] for i in listed] == ["new@example.com"]


def test_invite_delivery_and_resend_rotate_the_single_use_link(client, workspace, monkeypatch):
    sent: list[tuple] = []
    monkeypatch.setattr(email_service, "send_invitation", lambda *args: sent.append(args))
    ws, token = workspace
    url = f"/api/workspaces/{ws['id']}/invites"
    created = client.post(
        url, json={"email": "new@example.com", "role": "member"}, headers=headers(token)
    )
    invite_id = created.json()["invite"]["id"]
    assert len(sent) == 1
    first_token = sent[0][4]
    assert sent[0][0] == "new@example.com"
    assert sent[0][1] == ws["name"]
    assert sent[0][4] == first_token
    preview = client.get(f"/api/auth/invites/{first_token}")
    assert preview.status_code == 200
    assert preview.json()["email"] == "new@example.com"

    resent = client.post(f"{url}/{invite_id}/resend", headers=headers(token))
    assert resent.status_code == 202
    second_token = sent[1][4]
    assert second_token != first_token
    assert len(sent) == 2
    assert sent[1][4] == second_token
    assert client.get(f"/api/auth/invites/{first_token}").status_code == 422
    assert client.get(f"/api/auth/invites/{second_token}").status_code == 200


def test_invite_email_failure_does_not_rollback_committed_invite(client, workspace, monkeypatch):
    def fail(*_args):
        raise email_service.EmailDeliveryError("provider unavailable")

    monkeypatch.setattr(email_service, "send_invitation", fail)
    ws, token = workspace
    res = client.post(
        f"/api/workspaces/{ws['id']}/invites",
        json={"email": "offline@example.com", "role": "viewer"},
        headers=headers(token),
    )
    assert res.status_code == 201
    assert client.get(f"/api/workspaces/{ws['id']}/invites", headers=headers(token)).json()


def test_invite_token_binds_registration_to_the_invited_email(client, workspace, monkeypatch):
    sent: list[tuple] = []
    monkeypatch.setattr(email_service, "send_invitation", lambda *args: sent.append(args))
    ws, token = workspace
    client.post(
        f"/api/workspaces/{ws['id']}/invites",
        json={"email": "future@example.com", "role": "viewer"},
        headers=headers(token),
    )
    invite_token = sent[0][4]

    mismatch = client.post(
        "/api/auth/register",
        json={"email": "other@example.com", "password": "correct-horse", "invite_token": invite_token},
    )
    assert mismatch.status_code == 422
    accepted = client.post(
        "/api/auth/register",
        json={"email": "future@example.com", "password": "correct-horse", "invite_token": invite_token},
    )
    assert accepted.status_code == 201


def test_inviting_an_existing_account_adds_them_directly(client, workspace, register_and_login):
    ws, token = workspace
    register_and_login("known@example.com")
    res = client.post(
        f"/api/workspaces/{ws['id']}/invites",
        json={"email": "known@example.com", "role": "admin"},
        headers=headers(token),
    )
    assert res.status_code == 201
    body = res.json()
    assert body["kind"] == "member"
    assert body["member"]["role"] == "admin"
    assert body["invite"] is None
    assert client.get(f"/api/workspaces/{ws['id']}/invites", headers=headers(token)).json() == []


def test_registering_with_an_invited_address_joins_the_workspace(client, workspace, monkeypatch):
    sent: list[tuple] = []
    monkeypatch.setattr(email_service, "send_invitation", lambda *args: sent.append(args))
    ws, token = workspace
    client.post(
        f"/api/workspaces/{ws['id']}/invites",
        json={"email": "future@example.com", "role": "viewer"},
        headers=headers(token),
    )
    without_link = client.post(
        "/api/auth/register", json={"email": "future@example.com", "password": "correct-horse"}
    )
    assert without_link.status_code == 422
    invite_token = sent[0][4]
    assert client.post(
        "/api/auth/register",
        json={
            "email": "future@example.com",
            "password": "correct-horse",
            "invite_token": invite_token,
        },
    ).status_code == 201
    new_token = client.post(
        "/api/auth/login", json={"email": "future@example.com", "password": "correct-horse"}
    ).json()["access_token"]

    mine = client.get("/api/workspaces", headers=headers(new_token)).json()
    joined = next(w for w in mine if w["id"] == ws["id"])
    assert joined["my_role"] == "viewer"
    # They still get their own personal workspace as well.
    assert len(mine) == 2
    assert client.get(f"/api/workspaces/{ws['id']}/invites", headers=headers(token)).json() == []


def test_an_expired_invite_is_not_accepted(client, workspace):
    ws, token = workspace
    client.post(
        f"/api/workspaces/{ws['id']}/invites",
        json={"email": "late@example.com", "role": "member"},
        headers=headers(token),
    )
    with session_for() as db:
        invite = db.scalar(sa.select(WorkspaceInvite))
        invite.expires_at = datetime.now(UTC) - timedelta(days=1)
        db.commit()

    client.post(
        "/api/auth/register", json={"email": "late@example.com", "password": "correct-horse"}
    )
    late_token = client.post(
        "/api/auth/login", json={"email": "late@example.com", "password": "correct-horse"}
    ).json()["access_token"]
    assert [w["id"] for w in client.get("/api/workspaces", headers=headers(late_token)).json()] != [
        ws["id"]
    ]
    assert client.get(f"/api/workspaces/{ws['id']}", headers=headers(late_token)).status_code == 404
    # Expired invitations drop out of the pending list rather than lingering.
    assert client.get(f"/api/workspaces/{ws['id']}/invites", headers=headers(token)).json() == []


def test_duplicate_invites_are_rejected_and_can_be_revoked(client, workspace):
    ws, token = workspace
    body = {"email": "dupe@example.com", "role": "member"}
    url = f"/api/workspaces/{ws['id']}/invites"
    first = client.post(url, json=body, headers=headers(token))
    assert first.status_code == 201
    assert client.post(url, json=body, headers=headers(token)).status_code == 409

    invite_id = first.json()["invite"]["id"]
    assert client.delete(f"{url}/{invite_id}", headers=headers(token)).status_code == 204
    assert client.post(url, json=body, headers=headers(token)).status_code == 201


def test_only_admins_can_invite(client, workspace, register_and_login):
    ws, token = workspace
    register_and_login("plain@example.com")
    client.post(
        f"/api/workspaces/{ws['id']}/invites",
        json={"email": "plain@example.com", "role": "member"},
        headers=headers(token),
    )
    plain = client.post(
        "/api/auth/login", json={"email": "plain@example.com", "password": "correct-horse"}
    ).json()["access_token"]

    res = client.post(
        f"/api/workspaces/{ws['id']}/invites",
        json={"email": "someone@example.com"},
        headers=headers(plain),
    )
    assert res.status_code == 403
    assert client.get(f"/api/workspaces/{ws['id']}/invites", headers=headers(plain)).status_code == 403


def test_an_outsider_cannot_see_or_create_invites(client, workspace, register_and_login):
    ws, _ = workspace
    outsider = register_and_login("outsider@example.com")
    assert client.get(f"/api/workspaces/{ws['id']}/invites", headers=headers(outsider)).status_code == 404
    assert client.post(
        f"/api/workspaces/{ws['id']}/invites",
        json={"email": "x@example.com"},
        headers=headers(outsider),
    ).status_code == 404


def test_inviting_an_existing_member_is_a_conflict(client, workspace, register_and_login):
    ws, token = workspace
    register_and_login("twice@example.com")
    url = f"/api/workspaces/{ws['id']}/invites"
    assert client.post(url, json={"email": "twice@example.com"}, headers=headers(token)).status_code == 201
    assert client.post(url, json={"email": "twice@example.com"}, headers=headers(token)).status_code == 409
