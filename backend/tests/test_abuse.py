import logging

from app.main import _safe_path


def test_security_headers_are_present(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Permissions-Policy"] == "camera=(), microphone=(), geolocation=()"
    assert response.headers["Content-Security-Policy"] == "default-src 'none'; frame-ancestors 'none'"
    assert response.headers["X-Request-ID"]


def test_oversized_request_is_rejected_before_validation(client):
    response = client.post(
        "/api/auth/register",
        content="x" * (256 * 1024 + 1),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_login_rate_limit_is_request_level(client, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_LOGIN", "1")
    first = client.post("/api/auth/login", json={"email": "a@example.com", "password": "wrong"})
    second = client.post("/api/auth/login", json={"email": "a@example.com", "password": "wrong"})
    assert first.status_code == 401
    assert second.status_code == 429
    assert second.headers["Retry-After"] == "60"


def test_ai_rate_limit_is_applied_before_authentication(client, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_AI", "1")
    path = "/api/boards/1/ai"
    assert client.post(path, json={}).status_code == 401
    assert client.post(path, json={}).status_code == 429


def test_verification_email_rate_limit_is_request_level(client, monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_VERIFICATION_EMAIL", "1")
    client.post("/api/auth/register", json={"email": "verify@example.com", "password": "correct-horse"})
    first = client.post("/api/auth/verification-email", json={"email": "verify@example.com"})
    second = client.post("/api/auth/verification-email", json={"email": "verify@example.com"})
    assert first.status_code == 202
    assert second.status_code == 429


def test_sensitive_invite_tokens_are_redacted_from_paths(caplog):
    with caplog.at_level(logging.INFO, logger="kobi.http"):
        safe = _safe_path("/api/auth/invites/super-secret-token")
    assert safe == "/api/auth/invites/[redacted]"
    assert "super-secret-token" not in safe
