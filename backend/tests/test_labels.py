"""Workspace labels and the cards they are attached to."""

import pytest


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def board_and_tokens(client, register_and_login):
    tokens = {
        who: register_and_login(f"{who}@example.com") for who in ("owner", "member", "viewer")
    }
    owner = headers(tokens["owner"])
    board = client.post(
        "/api/boards", json={"title": "Board", "columns": ["Todo"]}, headers=owner
    ).json()
    for who, role in (("member", "member"), ("viewer", "viewer")):
        client.post(
            f"/api/workspaces/{board['workspace_id']}/invites",
            json={"email": f"{who}@example.com", "role": role},
            headers=owner,
        )
    card = client.post(
        f"/api/columns/{board['columns'][0]['id']}/cards", json={"title": "Card"}, headers=owner
    ).json()
    return board, card, tokens


def test_create_list_and_attach_a_label(client, board_and_tokens):
    board, card, tokens = board_and_tokens
    owner = headers(tokens["owner"])
    wid = board["workspace_id"]

    label = client.post(
        f"/api/workspaces/{wid}/labels", json={"name": "bug", "color": "rose"}, headers=owner
    )
    assert label.status_code == 201
    assert label.json()["color"] == "rose"
    label_id = label.json()["id"]

    assert [lbl["name"] for lbl in client.get(f"/api/workspaces/{wid}/labels", headers=owner).json()] == ["bug"]

    attached = client.post(f"/api/cards/{card['id']}/labels/{label_id}", headers=owner)
    assert attached.status_code == 200
    assert [lbl["name"] for lbl in attached.json()["labels"]] == ["bug"]

    # Attaching twice is not an error and does not duplicate.
    again = client.post(f"/api/cards/{card['id']}/labels/{label_id}", headers=owner)
    assert len(again.json()["labels"]) == 1

    board_now = client.get(f"/api/boards/{board['id']}", headers=owner).json()
    assert [lbl["name"] for lbl in board_now["columns"][0]["cards"][0]["labels"]] == ["bug"]

    removed = client.delete(f"/api/cards/{card['id']}/labels/{label_id}", headers=owner)
    assert removed.status_code == 200 and removed.json()["labels"] == []
    assert client.delete(f"/api/cards/{card['id']}/labels/{label_id}", headers=owner).status_code == 404


def test_label_names_are_unique_per_workspace(client, board_and_tokens):
    board, _, tokens = board_and_tokens
    owner = headers(tokens["owner"])
    url = f"/api/workspaces/{board['workspace_id']}/labels"
    assert client.post(url, json={"name": "bug"}, headers=owner).status_code == 201
    assert client.post(url, json={"name": "bug"}, headers=owner).status_code == 409
    # A different workspace has its own vocabulary.
    other = client.post("/api/workspaces", json={"name": "Other"}, headers=owner).json()
    assert client.post(
        f"/api/workspaces/{other['id']}/labels", json={"name": "bug"}, headers=owner
    ).status_code == 201


def test_colours_come_from_the_palette(client, board_and_tokens):
    board, _, tokens = board_and_tokens
    res = client.post(
        f"/api/workspaces/{board['workspace_id']}/labels",
        json={"name": "bug", "color": "#ff0000"},
        headers=headers(tokens["owner"]),
    )
    assert res.status_code == 422 and "colour must be one of" in res.json()["detail"]


def test_members_create_and_attach_but_only_admins_rename_or_delete(client, board_and_tokens):
    board, card, tokens = board_and_tokens
    member, viewer = headers(tokens["member"]), headers(tokens["viewer"])
    wid = board["workspace_id"]

    created = client.post(f"/api/workspaces/{wid}/labels", json={"name": "chore"}, headers=member)
    assert created.status_code == 201
    label_id = created.json()["id"]
    assert client.post(f"/api/cards/{card['id']}/labels/{label_id}", headers=member).status_code == 200

    assert client.patch(f"/api/labels/{label_id}", json={"name": "task"}, headers=member).status_code == 403
    assert client.delete(f"/api/labels/{label_id}", headers=member).status_code == 403

    assert client.post(f"/api/workspaces/{wid}/labels", json={"name": "x"}, headers=viewer).status_code == 403
    assert client.post(f"/api/cards/{card['id']}/labels/{label_id}", headers=viewer).status_code == 403
    assert client.get(f"/api/workspaces/{wid}/labels", headers=viewer).status_code == 200


def test_deleting_a_label_takes_it_off_every_card(client, board_and_tokens):
    board, card, tokens = board_and_tokens
    owner = headers(tokens["owner"])
    label_id = client.post(
        f"/api/workspaces/{board['workspace_id']}/labels", json={"name": "bug"}, headers=owner
    ).json()["id"]
    client.post(f"/api/cards/{card['id']}/labels/{label_id}", headers=owner)

    assert client.delete(f"/api/labels/{label_id}", headers=owner).status_code == 204
    board_now = client.get(f"/api/boards/{board['id']}", headers=owner).json()
    assert board_now["columns"][0]["cards"][0]["labels"] == []


def test_a_label_cannot_cross_workspaces(client, board_and_tokens):
    _, card, tokens = board_and_tokens
    owner = headers(tokens["owner"])
    other = client.post("/api/workspaces", json={"name": "Other"}, headers=owner).json()
    foreign = client.post(
        f"/api/workspaces/{other['id']}/labels", json={"name": "elsewhere"}, headers=owner
    ).json()
    res = client.post(f"/api/cards/{card['id']}/labels/{foreign['id']}", headers=owner)
    assert res.status_code == 422 and "different workspace" in res.json()["detail"]


def test_an_outsider_sees_no_labels(client, board_and_tokens, register_and_login):
    board, card, tokens = board_and_tokens
    label_id = client.post(
        f"/api/workspaces/{board['workspace_id']}/labels",
        json={"name": "bug"},
        headers=headers(tokens["owner"]),
    ).json()["id"]
    out = headers(register_and_login("outsider@example.com"))
    assert client.get(f"/api/workspaces/{board['workspace_id']}/labels", headers=out).status_code == 404
    assert client.patch(f"/api/labels/{label_id}", json={"name": "x"}, headers=out).status_code == 404
    assert client.delete(f"/api/labels/{label_id}", headers=out).status_code == 404
    assert client.post(f"/api/cards/{card['id']}/labels/{label_id}", headers=out).status_code == 404
