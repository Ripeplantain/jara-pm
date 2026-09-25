from datetime import UTC, datetime, timedelta

import jwt
from fastapi.routing import APIRoute
from sqlalchemy import text

from app.db import get_engine
from tests.conftest import TEST_JWT_SECRET

CREDS = {"email": "a@example.com", "password": "correct-horse"}


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_register_returns_user_without_password_or_hash(client):
    res = client.post("/api/auth/register", json=CREDS)
    assert res.status_code == 201
    assert set(res.json()) == {"id", "email"}


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
    public = {"/api/health", "/api/auth/register", "/api/auth/login", "/openapi.json", "/docs", "/redoc", "/docs/oauth2-redirect"}
    for route in client.app.routes:
        if isinstance(route, APIRoute) and route.path not in public:
            names = {d.call.__name__ for d in route.dependant.dependencies}
            assert "get_current_user" in names, f"{route.path} is not protected"


def test_sqlite_foreign_keys_enabled():
    with get_engine().connect() as conn:
        assert conn.execute(text("pragma foreign_keys")).scalar_one() == 1
