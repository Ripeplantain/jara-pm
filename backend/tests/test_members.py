"""Workspace CRUD and member management, including the guard rails around owners."""

import pytest

from tests.conftest import session_for


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def team(client, register_and_login):
    """An owner with a workspace, and tokens for people not in it yet."""
    tokens = {
        who: register_and_login(f"{who}@example.com")
        for who in ("owner", "second", "helper", "outsider")
    }
    workspace = client.get("/api/workspaces", headers=headers(tokens["owner"])).json()[0]
    return workspace, tokens


def test_list_workspaces_reports_my_role(client, team):
    _, tokens = team
    body = client.get("/api/workspaces", headers=headers(tokens["owner"])).json()
    assert len(body) == 1
    assert body[0]["my_role"] == "owner"
    assert body[0]["name"] == "owner's workspace"
    assert [m["user"]["email"] for m in body[0]["members"]] == ["owner@example.com"]


def test_create_rename_and_delete_a_workspace(client, team):
    _, tokens = team
    owner = headers(tokens["owner"])
    created = client.post("/api/workspaces", json={"name": "Product"}, headers=owner)
    assert created.status_code == 201
    assert created.json()["my_role"] == "owner"

    renamed = client.patch(
        f"/api/workspaces/{created.json()['id']}", json={"name": "Platform"}, headers=owner
    )
    assert renamed.status_code == 200 and renamed.json()["name"] == "Platform"

    assert client.request(
        "DELETE",
        f"/api/workspaces/{created.json()['id']}",
        json={"confirmation": "DELETE"},
        headers=owner,
    ).status_code == 204
    assert len(client.get("/api/workspaces", headers=owner).json()) == 1


def test_cannot_delete_your_last_workspace(client, team):
    workspace, tokens = team
    res = client.request(
        "DELETE",
        f"/api/workspaces/{workspace['id']}",
        json={"confirmation": "DELETE"},
        headers=headers(tokens["owner"]),
    )
    assert res.status_code == 409
    assert "only workspace" in res.json()["detail"]


def test_add_member_by_email_then_change_role_and_remove(client, team):
    workspace, tokens = team
    owner = headers(tokens["owner"])
    added = client.post(
        f"/api/workspaces/{workspace['id']}/members",
        json={"email": "Helper@Example.com", "role": "member"},
        headers=owner,
    )
    assert added.status_code == 201
    assert added.json()["role"] == "member"
    assert added.json()["user"]["email"] == "helper@example.com"

    helper = headers(tokens["helper"])
    assert [w["id"] for w in client.get("/api/workspaces", headers=helper).json()] == [
        w["id"] for w in client.get("/api/workspaces", headers=helper).json()
    ]
    assert any(w["id"] == workspace["id"] for w in client.get("/api/workspaces", headers=helper).json())

    user_id = added.json()["user_id"]
    promoted = client.patch(
        f"/api/workspaces/{workspace['id']}/members/{user_id}", json={"role": "admin"}, headers=owner
    )
    assert promoted.status_code == 200 and promoted.json()["role"] == "admin"

    assert client.delete(
        f"/api/workspaces/{workspace['id']}/members/{user_id}", headers=owner
    ).status_code == 204
    assert client.get(f"/api/workspaces/{workspace['id']}", headers=helper).status_code == 404


def test_adding_an_unknown_email_is_404(client, team):
    workspace, tokens = team
    res = client.post(
        f"/api/workspaces/{workspace['id']}/members",
        json={"email": "nobody@example.com"},
        headers=headers(tokens["owner"]),
    )
    assert res.status_code == 404


def test_adding_the_same_person_twice_is_409(client, team):
    workspace, tokens = team
    body = {"email": "helper@example.com", "role": "member"}
    url = f"/api/workspaces/{workspace['id']}/members"
    assert client.post(url, json=body, headers=headers(tokens["owner"])).status_code == 201
    assert client.post(url, json=body, headers=headers(tokens["owner"])).status_code == 409


def test_an_admin_cannot_mint_an_owner(client, team):
    workspace, tokens = team
    owner = headers(tokens["owner"])
    admin = client.post(
        f"/api/workspaces/{workspace['id']}/members",
        json={"email": "second@example.com", "role": "admin"},
        headers=owner,
    ).json()
    assert admin["role"] == "admin"

    res = client.post(
        f"/api/workspaces/{workspace['id']}/members",
        json={"email": "helper@example.com", "role": "owner"},
        headers=headers(tokens["second"]),
    )
    assert res.status_code == 403
    assert "cannot grant" in res.json()["detail"]


def test_the_last_owner_cannot_be_demoted_or_removed(client, team):
    workspace, tokens = team
    owner = headers(tokens["owner"])
    owner_id = client.get("/api/me", headers=owner).json()["id"]

    demote = client.patch(
        f"/api/workspaces/{workspace['id']}/members/{owner_id}", json={"role": "member"}, headers=owner
    )
    assert demote.status_code == 409 and "at least one owner" in demote.json()["detail"]
    assert client.delete(
        f"/api/workspaces/{workspace['id']}/members/{owner_id}", headers=owner
    ).status_code == 409


def test_a_second_owner_unlocks_the_first(client, team):
    workspace, tokens = team
    owner = headers(tokens["owner"])
    owner_id = client.get("/api/me", headers=owner).json()["id"]
    client.post(
        f"/api/workspaces/{workspace['id']}/members",
        json={"email": "second@example.com", "role": "owner"},
        headers=owner,
    )
    assert client.patch(
        f"/api/workspaces/{workspace['id']}/members/{owner_id}", json={"role": "member"}, headers=owner
    ).status_code == 200


def test_an_admin_cannot_touch_an_owner(client, team):
    workspace, tokens = team
    owner = headers(tokens["owner"])
    owner_id = client.get("/api/me", headers=owner).json()["id"]
    client.post(
        f"/api/workspaces/{workspace['id']}/members",
        json={"email": "second@example.com", "role": "admin"},
        headers=owner,
    )
    admin = headers(tokens["second"])
    assert client.patch(
        f"/api/workspaces/{workspace['id']}/members/{owner_id}", json={"role": "viewer"}, headers=admin
    ).status_code == 403
    assert client.delete(
        f"/api/workspaces/{workspace['id']}/members/{owner_id}", headers=admin
    ).status_code == 403


def test_a_member_can_leave_on_their_own(client, team):
    workspace, tokens = team
    client.post(
        f"/api/workspaces/{workspace['id']}/members",
        json={"email": "helper@example.com", "role": "member"},
        headers=headers(tokens["owner"]),
    )
    helper = headers(tokens["helper"])
    helper_id = client.get("/api/me", headers=helper).json()["id"]
    assert client.delete(
        f"/api/workspaces/{workspace['id']}/members/{helper_id}", headers=helper
    ).status_code == 204


def test_a_member_cannot_manage_other_members(client, team):
    workspace, tokens = team
    owner = headers(tokens["owner"])
    for who, role in (("helper", "member"), ("second", "viewer")):
        client.post(
            f"/api/workspaces/{workspace['id']}/members",
            json={"email": f"{who}@example.com", "role": role},
            headers=owner,
        )
    second_id = client.get("/api/me", headers=headers(tokens["second"])).json()["id"]
    res = client.delete(
        f"/api/workspaces/{workspace['id']}/members/{second_id}", headers=headers(tokens["helper"])
    )
    assert res.status_code == 403
    assert client.patch(
        f"/api/workspaces/{workspace['id']}", json={"name": "Nope"}, headers=headers(tokens["helper"])
    ).status_code == 403


def test_an_outsider_sees_a_404_everywhere(client, team):
    workspace, tokens = team
    out = headers(tokens["outsider"])
    wid = workspace["id"]
    assert client.get(f"/api/workspaces/{wid}", headers=out).status_code == 404
    assert client.get(f"/api/workspaces/{wid}/members", headers=out).status_code == 404
    assert client.patch(f"/api/workspaces/{wid}", json={"name": "x"}, headers=out).status_code == 404
    assert client.post(
        f"/api/workspaces/{wid}/members", json={"email": "helper@example.com"}, headers=out
    ).status_code == 404
    assert client.request(
        "DELETE",
        f"/api/workspaces/{wid}", json={"confirmation": "DELETE"}, headers=out
    ).status_code == 404


def test_deleting_a_workspace_takes_its_boards(client, team):
    _, tokens = team
    owner = headers(tokens["owner"])
    extra = client.post("/api/workspaces", json={"name": "Temp"}, headers=owner).json()
    board = client.post(
        "/api/boards", json={"title": "Doomed", "workspace_id": extra["id"]}, headers=owner
    ).json()
    assert client.request(
        "DELETE",
        f"/api/workspaces/{extra['id']}",
        json={"confirmation": "DELETE"},
        headers=owner,
    ).status_code == 204
    assert client.get(f"/api/boards/{board['id']}", headers=owner).status_code == 404
    with session_for() as db:
        from app.models import Board

        assert db.get(Board, board["id"]) is None
