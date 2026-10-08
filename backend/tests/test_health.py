from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_is_public_and_ok():
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_metrics_requires_auth_and_reports_redacted_counters(client, register_and_login):
    assert client.get("/api/health/metrics").status_code == 401
    token = register_and_login("metrics@example.com")
    res = client.get("/api/health/metrics", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert "requests" in res.json() and "avg_duration_ms" in res.json()
