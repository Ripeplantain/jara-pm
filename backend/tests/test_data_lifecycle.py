def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_workspace_export_is_scoped_and_contains_safe_product_data(client, register_and_login):
    owner = register_and_login("owner@example.com")
    workspace = client.get("/api/workspaces", headers=auth(owner)).json()[0]
    board = client.post(
        "/api/boards",
        json={"title": "Export board", "workspace_id": workspace["id"], "columns": ["Todo"]},
        headers=auth(owner),
    ).json()
    exported = client.get(f"/api/workspaces/{workspace['id']}/export", headers=auth(owner))
    assert exported.status_code == 200
    body = exported.json()
    assert body["workspace"]["name"] == workspace["name"]
    assert body["boards"][0]["id"] == board["id"]
    assert body["members"][0]["email"] == "owner@example.com"
    assert "password_hash" not in str(body)
    assert "token" not in str(body).lower()

    outsider = register_and_login("outsider@example.com")
    assert client.get(
        f"/api/workspaces/{workspace['id']}/export", headers=auth(outsider)
    ).status_code == 404


def test_workspace_deletion_requires_exact_confirmation(client, register_and_login):
    owner = register_and_login("owner@example.com")
    workspace = client.get("/api/workspaces", headers=auth(owner)).json()[0]
    client.post("/api/workspaces", json={"name": "Second"}, headers=auth(owner))
    bad = client.request(
        "DELETE",
        f"/api/workspaces/{workspace['id']}",
        json={"confirmation": "delete"},
        headers=auth(owner),
    )
    assert bad.status_code == 422
    assert client.get(f"/api/workspaces/{workspace['id']}", headers=auth(owner)).status_code == 200
    assert client.request(
        "DELETE",
        f"/api/workspaces/{workspace['id']}",
        json={"confirmation": "DELETE"},
        headers=auth(owner),
    ).status_code == 204
