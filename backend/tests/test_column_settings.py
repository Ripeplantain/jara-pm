"""WIP limits and the done flag. Neither ever refuses a write."""

import pytest


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def board(client, register_and_login):
    tokens = {who: register_and_login(f"{who}@example.com") for who in ("owner", "viewer")}
    owner = headers(tokens["owner"])
    b = client.post(
        "/api/boards", json={"title": "B", "columns": ["Todo", "Done"]}, headers=owner
    ).json()
    client.post(
        f"/api/workspaces/{b['workspace_id']}/invites",
        json={"email": "viewer@example.com", "role": "viewer"},
        headers=owner,
    )
    return b, tokens


def test_a_wip_limit_warns_but_never_blocks(client, board):
    b, tokens = board
    owner = headers(tokens["owner"])
    todo = b["columns"][0]["id"]
    assert client.patch(f"/api/columns/{todo}", json={"wip_limit": 2}, headers=owner).json()["wip_limit"] == 2

    for i in range(3):
        res = client.post(f"/api/columns/{todo}/cards", json={"title": f"C{i}"}, headers=owner)
        assert res.status_code == 201  # the third one is over the limit and still goes in

    column = client.get(f"/api/boards/{b['id']}", headers=owner).json()["columns"][0]
    assert column["card_count"] == 3
    assert column["over_wip_limit"] is True


def test_archived_cards_do_not_count_against_the_limit(client, board):
    b, tokens = board
    owner = headers(tokens["owner"])
    todo = b["columns"][0]["id"]
    client.patch(f"/api/columns/{todo}", json={"wip_limit": 1}, headers=owner)
    first = client.post(f"/api/columns/{todo}/cards", json={"title": "A"}, headers=owner).json()
    client.post(f"/api/columns/{todo}/cards", json={"title": "B"}, headers=owner)
    assert client.get(f"/api/boards/{b['id']}", headers=owner).json()["columns"][0]["over_wip_limit"]

    client.post(f"/api/cards/{first['id']}/archive", headers=owner)
    column = client.get(f"/api/boards/{b['id']}", headers=owner).json()["columns"][0]
    assert column["card_count"] == 1 and column["over_wip_limit"] is False


def test_the_limit_can_be_removed_and_is_validated(client, board):
    b, tokens = board
    owner = headers(tokens["owner"])
    todo = b["columns"][0]["id"]
    client.patch(f"/api/columns/{todo}", json={"wip_limit": 3}, headers=owner)
    assert client.patch(f"/api/columns/{todo}", json={"title": "Backlog"}, headers=owner).json()["wip_limit"] == 3
    assert client.patch(f"/api/columns/{todo}", json={"wip_limit": None}, headers=owner).json()["wip_limit"] is None
    assert client.patch(f"/api/columns/{todo}", json={"wip_limit": 0}, headers=owner).status_code == 422


def test_marking_a_column_done_completes_the_cards_already_in_it(client, board):
    b, tokens = board
    owner = headers(tokens["owner"])
    done_col = b["columns"][1]["id"]
    card = client.post(f"/api/columns/{done_col}/cards", json={"title": "Shipped"}, headers=owner).json()
    assert card["completed_at"] is None

    res = client.patch(f"/api/columns/{done_col}", json={"is_done": True}, headers=owner)
    assert res.status_code == 200 and res.json()["is_done"] is True
    after = client.get(f"/api/boards/{b['id']}", headers=owner).json()["columns"][1]["cards"][0]
    assert after["completed_at"] is not None

    client.patch(f"/api/columns/{done_col}", json={"is_done": False}, headers=owner)
    after = client.get(f"/api/boards/{b['id']}", headers=owner).json()["columns"][1]["cards"][0]
    assert after["completed_at"] is None
    assert after["id"] == card["id"]


def test_column_settings_need_a_member_role(client, board):
    b, tokens = board
    todo = b["columns"][0]["id"]
    assert client.patch(
        f"/api/columns/{todo}", json={"wip_limit": 2}, headers=headers(tokens["viewer"])
    ).status_code == 403
