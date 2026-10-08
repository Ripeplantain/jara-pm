from datetime import UTC, datetime, timedelta

import jwt
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from fastapi.routing import APIRoute
from sqlalchemy import text

from app.db import get_engine
from app.models import Board, Card, Column, User, WorkspaceMember
from app.models.user import AVATAR_COLORS
from app.services import auth as auth_service
from tests.conftest import TEST_JWT_SECRET, session_for

CREDS = {"email": "a@example.com", "password": "correct-horse"}


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_register_returns_user_without_password_or_hash(client):
    res = client.post("/api/auth/register", json=CREDS)
    assert res.status_code == 201
    assert set(res.json()) == {
        "id", "email", "name", "display_name", "avatar_color", "is_active", "email_verified"
    }


def test_register_normalizes_email_and_rejects_duplicates(client):
    assert client.post("/api/auth/register", json={**CREDS, "email": "  A@Example.COM "}).status_code == 201
    res = client.post("/api/auth/register", json=CREDS)
    assert res.status_code == 409


def test_register_validates_email_and_password_length(client):
    assert client.post("/api/auth/register", json={**CREDS, "email": "nope"}).status_code == 422
    assert client.post("/api/auth/register", json={**CREDS, "password": "short"}).status_code == 422


def test_password_is_stored_hashed(client):
    client.post("/api/auth/register", json=CREDS)
    with get_engine().connect() as conn:
        stored = conn.execute(text("select password_hash from users")).scalar_one()
    assert stored != CREDS["password"]
    assert stored.startswith("$argon2")


def test_login_success_returns_token_and_user(client):
    client.post("/api/auth/register", json=CREDS)
    res = client.post("/api/auth/login", json={**CREDS, "email": "A@example.com"})
    assert res.status_code == 200
    body = res.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0
    assert body["user"]["email"] == "a@example.com"
    assert "password" not in str(body) and "argon2" not in str(body)


def test_login_failures_are_indistinguishable(client):
    client.post("/api/auth/register", json=CREDS)
    wrong_pw = client.post("/api/auth/login", json={**CREDS, "password": "wrong-password"})
    unknown = client.post("/api/auth/login", json={"email": "who@example.com", "password": "whatever1"})
    assert wrong_pw.status_code == unknown.status_code == 401
    assert wrong_pw.json() == unknown.json() == {"detail": "Invalid credentials"}


def test_protected_route_requires_token(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers=bearer("garbage")).status_code == 401


def test_protected_route_with_valid_token(client, register_and_login):
    token = register_and_login()
    res = client.get("/api/me", headers=bearer(token))
    assert res.status_code == 200
    assert res.json()["email"] == "a@example.com"


def test_expired_token_rejected(client, register_and_login):
    register_and_login()
    past = datetime.now(UTC) - timedelta(minutes=5)
    token = jwt.encode({"sub": "1", "exp": past}, TEST_JWT_SECRET, algorithm="HS256")
    assert client.get("/api/me", headers=bearer(token)).status_code == 401


def test_token_signed_with_other_secret_rejected(client, register_and_login):
    register_and_login()
    exp = datetime.now(UTC) + timedelta(minutes=5)
    token = jwt.encode({"sub": "1", "exp": exp}, "some-other-secret-" + "y" * 32, algorithm="HS256")
    assert client.get("/api/me", headers=bearer(token)).status_code == 401


def test_token_for_deleted_user_rejected(client, register_and_login):
    token = register_and_login()
    with get_engine().begin() as conn:
        conn.execute(text("delete from users"))
    assert client.get("/api/me", headers=bearer(token)).status_code == 401


def test_only_health_register_login_are_public(client):
    assert client.get("/api/health").status_code == 200
    public = {
        "/api/health",
        "/api/auth/register",
        "/api/auth/login",
        "/api/auth/verify-email",
        "/api/auth/verification-email",
        "/api/auth/password-reset/request",
        "/api/auth/password-reset/confirm",
        "/api/auth/invites/{token}",
        "/openapi.json",
        "/docs",
        "/redoc",
        "/docs/oauth2-redirect",
    }
    for route in client.app.routes:
        if isinstance(route, APIRoute) and route.path not in public:
            names = {d.call.__name__ for d in route.dependant.dependencies}
            assert "get_current_user" in names, f"{route.path} is not protected"


def test_sqlite_foreign_keys_enabled():
    with get_engine().connect() as conn:
        assert conn.execute(text("pragma foreign_keys")).scalar_one() == 1


# --- profile (6.7) ----------------------------------------------------------------------------


def test_registration_fills_in_a_readable_name_and_a_colour(client):
    body = client.post(
        "/api/auth/register", json={"email": "ada.lovelace@example.com", "password": "correct-horse"}
    ).json()
    assert body["display_name"] == "Ada Lovelace"
    assert body["name"] == "Ada Lovelace"
    assert body["avatar_color"] in AVATAR_COLORS
    assert body["is_active"] is True


def test_update_my_profile(client, register_and_login):
    token = register_and_login()
    res = client.patch(
        "/api/me", json={"display_name": "  Ada  ", "avatar_color": "rose"}, headers=bearer(token)
    )
    assert res.status_code == 200
    assert res.json()["display_name"] == "Ada"
    assert res.json()["avatar_color"] == "rose"
    assert client.get("/api/me", headers=bearer(token)).json()["display_name"] == "Ada"


def test_profile_rejects_a_colour_outside_the_palette(client, register_and_login):
    token = register_and_login()
    res = client.patch("/api/me", json={"avatar_color": "#ff0000"}, headers=bearer(token))
    assert res.status_code == 422
    assert "Avatar colour" in res.json()["detail"]


def test_profile_needs_a_session(client):
    assert client.patch("/api/me", json={"display_name": "x"}).status_code == 401
    assert client.post(
        "/api/me/password", json={"current_password": "a", "new_password": "bbbbbbbb"}
    ).status_code == 401


def test_change_password_then_sign_in_with_the_new_one(client, register_and_login):
    token = register_and_login()
    res = client.post(
        "/api/me/password",
        json={"current_password": "correct-horse", "new_password": "battery-staple"},
        headers=bearer(token),
    )
    assert res.status_code == 204
    assert client.get("/api/me", headers=bearer(token)).status_code == 401
    assert client.post("/api/auth/login", json=CREDS).status_code == 401
    assert client.post(
        "/api/auth/login", json={**CREDS, "password": "battery-staple"}
    ).status_code == 200


def test_change_password_needs_the_current_one(client, register_and_login):
    token = register_and_login()
    res = client.post(
        "/api/me/password",
        json={"current_password": "wrong-one", "new_password": "battery-staple"},
        headers=bearer(token),
    )
    assert res.status_code == 403
    assert client.post("/api/auth/login", json=CREDS).status_code == 200


def test_change_password_enforces_a_minimum_length(client, register_and_login):
    token = register_and_login()
    res = client.post(
        "/api/me/password",
        json={"current_password": "correct-horse", "new_password": "short"},
        headers=bearer(token),
    )
    assert res.status_code == 422


def test_a_deactivated_account_cannot_sign_in(client, register_and_login):
    register_and_login()
    with session_for() as db:
        user = db.scalar(sa.select(User).where(User.email == CREDS["email"]))
        user.is_active = False
        db.commit()
    assert client.post("/api/auth/login", json=CREDS).status_code == 401


def test_account_deletion_requires_password_and_removes_a_personal_account(client):
    client.post("/api/auth/register", json=CREDS)
    token = client.post("/api/auth/login", json=CREDS).json()["access_token"]
    assert client.request(
        "DELETE",
        "/api/me", json={"password": "wrong-password"}, headers=bearer(token)
    ).status_code == 403
    assert client.request(
        "DELETE",
        "/api/me", json={"password": CREDS["password"]}, headers=bearer(token)
    ).status_code == 204
    assert client.post("/api/auth/login", json=CREDS).status_code == 401
    assert client.get("/api/me", headers=bearer(token)).status_code == 401


def test_account_deletion_requires_workspace_ownership_transfer(client, register_and_login):
    token = register_and_login()
    workspace = client.get("/api/workspaces", headers=bearer(token)).json()[0]
    register_and_login("teammate@example.com")
    assert client.post(
        f"/api/workspaces/{workspace['id']}/members",
        json={"email": "teammate@example.com", "role": "member"},
        headers=bearer(token),
    ).status_code == 201
    assert client.request(
        "DELETE",
        "/api/me", json={"password": CREDS["password"]}, headers=bearer(token)
    ).status_code == 422
    assert client.post("/api/auth/login", json=CREDS).status_code == 200


# --- account lifecycle (15.2) -----------------------------------------------------------------


def test_email_verification_is_single_use_and_can_be_resent(client, monkeypatch):
    sent: list[str] = []
    monkeypatch.setattr(
        auth_service.email_service, "send_verification", lambda _email, token: sent.append(token)
    )

    registered = client.post("/api/auth/register", json=CREDS)
    assert registered.status_code == 201
    assert registered.json()["email_verified"] is False
    assert len(sent) == 1

    verified = client.post("/api/auth/verify-email", json={"token": sent[0]})
    assert verified.status_code == 200
    assert verified.json()["email_verified"] is True
    assert client.post("/api/auth/verify-email", json={"token": sent[0]}).status_code == 422

    assert client.post("/api/auth/verification-email", json={"email": CREDS["email"]}).status_code == 202
    assert len(sent) == 1


def test_required_email_verification_blocks_login_until_verified(client, monkeypatch):
    sent: list[str] = []
    monkeypatch.setenv("REQUIRE_EMAIL_VERIFICATION", "true")
    monkeypatch.setattr(
        auth_service.email_service, "send_verification", lambda _email, token: sent.append(token)
    )

    assert client.post("/api/auth/register", json=CREDS).status_code == 201
    assert client.post("/api/auth/login", json=CREDS).status_code == 401
    assert client.post("/api/auth/verify-email", json={"token": sent[0]}).status_code == 200
    assert client.post("/api/auth/login", json=CREDS).status_code == 200


def test_password_reset_is_generic_single_use_and_revokes_sessions(client, register_and_login, monkeypatch):
    token = register_and_login()
    sent: list[str] = []
    monkeypatch.setattr(
        auth_service.email_service, "send_password_reset", lambda _email, raw: sent.append(raw)
    )

    unknown = client.post("/api/auth/password-reset/request", json={"email": "unknown@example.com"})
    known = client.post("/api/auth/password-reset/request", json={"email": CREDS["email"]})
    assert unknown.status_code == known.status_code == 202
    assert len(sent) == 1

    reset = client.post(
        "/api/auth/password-reset/confirm",
        json={"token": sent[0], "new_password": "battery-staple"},
    )
    assert reset.status_code == 204
    assert client.get("/api/me", headers=bearer(token)).status_code == 401
    assert client.post("/api/auth/login", json=CREDS).status_code == 401
    assert client.post(
        "/api/auth/login", json={**CREDS, "password": "battery-staple"}
    ).status_code == 200
    assert client.post(
        "/api/auth/password-reset/confirm",
        json={"token": sent[0], "new_password": "third-password"},
    ).status_code == 422


def test_deactivation_requires_password_and_revokes_account(client, register_and_login):
    token = register_and_login()
    wrong = client.post(
        "/api/me/deactivate", json={"password": "wrong-password"}, headers=bearer(token)
    )
    assert wrong.status_code == 403
    assert client.get("/api/me", headers=bearer(token)).status_code == 200

    deactivated = client.post(
        "/api/me/deactivate", json={"password": CREDS["password"]}, headers=bearer(token)
    )
    assert deactivated.status_code == 204
    assert client.get("/api/me", headers=bearer(token)).status_code == 401
    assert client.post("/api/auth/login", json=CREDS).status_code == 401


def test_account_lifecycle_migration_preserves_child_rows(client):
    client.post("/api/auth/register", json=CREDS)
    with session_for() as db:
        user = db.scalar(sa.select(User).where(User.email == CREDS["email"]))
        membership = db.scalar(
            sa.select(WorkspaceMember).where(WorkspaceMember.user_id == user.id)
        )
        board = Board(
            workspace_id=membership.workspace_id,
            created_by_id=user.id,
            title="Migration board",
            description="",
        )
        db.add(board)
        db.flush()
        column = Column(board_id=board.id, title="Todo", position=0)
        db.add(column)
        db.flush()
        db.add(Card(column_id=column.id, title="Keep me", description="", position=0, created_by_id=user.id))
        db.commit()

    get_engine().dispose()
    command.downgrade(Config("alembic.ini"), "0012")
    command.upgrade(Config("alembic.ini"), "head")
    with get_engine().connect() as conn:
        assert conn.execute(text("select count(*) from boards")).scalar_one() == 1
        assert conn.execute(text("select count(*) from columns")).scalar_one() == 1
        assert conn.execute(text("select count(*) from cards")).scalar_one() == 1
