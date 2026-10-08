"""Checklists and comments on a card."""

import pytest


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def card(client, register_and_login):
    tokens = {
        who: register_and_login(f"{who}@example.com")
        for who in ("owner", "mate", "viewer", "outsider")
    }
    owner = headers(tokens["owner"])
    board = client.post(
        "/api/boards", json={"title": "Board", "columns": ["Todo"]}, headers=owner
    ).json()
    for who, role in (("mate", "member"), ("viewer", "viewer")):
        client.post(
            f"/api/workspaces/{board['workspace_id']}/invites",
            json={"email": f"{who}@example.com", "role": role},
            headers=owner,
        )
    card = client.post(
        f"/api/columns/{board['columns'][0]['id']}/cards", json={"title": "Card"}, headers=owner
    ).json()
    return card, board, tokens


# --- checklist -----------------------------------------------------------------------------


def test_checklist_add_toggle_rename_and_progress(client, card):
    c, board, tokens = card
    owner = headers(tokens["owner"])
    url = f"/api/cards/{c['id']}/checklist"

    first = client.post(url, json={"text": "Write it"}, headers=owner)
    assert first.status_code == 201 and first.json()["position"] == 0
    second = client.post(url, json={"text": "Ship it"}, headers=owner).json()
    assert second["position"] == 1

    toggled = client.patch(
        f"/api/checklist-items/{first.json()['id']}", json={"done": True}, headers=owner
    )
    assert toggled.status_code == 200 and toggled.json()["done"] is True

    renamed = client.patch(
        f"/api/checklist-items/{second['id']}", json={"text": "Ship it today"}, headers=owner
    )
    assert renamed.json()["text"] == "Ship it today"

    board_now = client.get(f"/api/boards/{board['id']}", headers=owner).json()
    face = board_now["columns"][0]["cards"][0]
    assert (face["checklist_done"], face["checklist_total"]) == (1, 2)
    assert [i["text"] for i in face["checklist"]] == ["Write it", "Ship it today"]


def test_checklist_positions_stay_contiguous(client, card):
    c, _, tokens = card
    owner = headers(tokens["owner"])
    url = f"/api/cards/{c['id']}/checklist"
    items = [client.post(url, json={"text": t}, headers=owner).json() for t in "abcd"]

    client.patch(f"/api/checklist-items/{items[3]['id']}", json={"position": 0}, headers=owner)
    after = client.get(url, headers=owner).json()
    assert [i["text"] for i in after] == ["d", "a", "b", "c"]
    assert [i["position"] for i in after] == [0, 1, 2, 3]

    client.delete(f"/api/checklist-items/{items[0]['id']}", headers=owner)
    after = client.get(url, headers=owner).json()
    assert [i["text"] for i in after] == ["d", "b", "c"]
    assert [i["position"] for i in after] == [0, 1, 2]


def test_checklist_inserting_at_a_position(client, card):
    c, _, tokens = card
    owner = headers(tokens["owner"])
    url = f"/api/cards/{c['id']}/checklist"
    for t in ("a", "b"):
        client.post(url, json={"text": t}, headers=owner)
    client.post(url, json={"text": "first", "position": 0}, headers=owner)
    assert [i["text"] for i in client.get(url, headers=owner).json()] == ["first", "a", "b"]


def test_checklist_respects_roles(client, card):
    c, _, tokens = card
    url = f"/api/cards/{c['id']}/checklist"
    item = client.post(url, json={"text": "x"}, headers=headers(tokens["owner"])).json()

    assert client.get(url, headers=headers(tokens["viewer"])).status_code == 200
    assert client.post(url, json={"text": "no"}, headers=headers(tokens["viewer"])).status_code == 403
    assert client.patch(
        f"/api/checklist-items/{item['id']}", json={"done": True}, headers=headers(tokens["viewer"])
    ).status_code == 403

    assert client.get(url, headers=headers(tokens["outsider"])).status_code == 404
    assert client.patch(
        f"/api/checklist-items/{item['id']}", json={"done": True}, headers=headers(tokens["outsider"])
    ).status_code == 404
    assert client.patch(
        f"/api/checklist-items/{item['id']}", json={"done": True}, headers=headers(tokens["mate"])
    ).status_code == 200


def test_deleting_a_card_takes_its_checklist(client, card):
    c, _, tokens = card
    owner = headers(tokens["owner"])
    item = client.post(
        f"/api/cards/{c['id']}/checklist", json={"text": "x"}, headers=owner
    ).json()
    client.delete(f"/api/cards/{c['id']}", headers=owner)
    assert client.patch(
        f"/api/checklist-items/{item['id']}", json={"done": True}, headers=owner
    ).status_code == 404


# --- comments ------------------------------------------------------------------------------


def test_comment_create_list_and_edit(client, card):
    c, board, tokens = card
    owner, mate = headers(tokens["owner"]), headers(tokens["mate"])
    url = f"/api/cards/{c['id']}/comments"

    mine = client.post(url, json={"body": "  Looks good  "}, headers=owner)
    assert mine.status_code == 201
    assert mine.json()["body"] == "Looks good"
    assert mine.json()["author"]["email"] == "owner@example.com"
    assert mine.json()["edited"] is False

    client.post(url, json={"body": "Agreed"}, headers=mate)
    listed = client.get(url, headers=mate).json()
    assert [cm["body"] for cm in listed] == ["Looks good", "Agreed"]

    edited = client.patch(f"/api/comments/{mine.json()['id']}", json={"body": "Actually no"}, headers=owner)
    assert edited.status_code == 200 and edited.json()["body"] == "Actually no"

    face = client.get(f"/api/boards/{board['id']}", headers=owner).json()["columns"][0]["cards"][0]
    assert face["comment_count"] == 2


def test_only_the_author_edits_but_admins_can_delete(client, card):
    c, _, tokens = card
    owner, mate = headers(tokens["owner"]), headers(tokens["mate"])
    theirs = client.post(f"/api/cards/{c['id']}/comments", json={"body": "Mine"}, headers=mate).json()

    assert client.patch(f"/api/comments/{theirs['id']}", json={"body": "Hijacked"}, headers=owner).status_code == 403
    assert client.delete(f"/api/comments/{theirs['id']}", headers=owner).status_code == 204


def test_a_member_cannot_delete_someone_elses_comment(client, card):
    c, _, tokens = card
    owner, mate = headers(tokens["owner"]), headers(tokens["mate"])
    theirs = client.post(f"/api/cards/{c['id']}/comments", json={"body": "Mine"}, headers=owner).json()
    assert client.delete(f"/api/comments/{theirs['id']}", headers=mate).status_code == 403
    mine = client.post(f"/api/cards/{c['id']}/comments", json={"body": "Ok"}, headers=mate).json()
    assert client.delete(f"/api/comments/{mine['id']}", headers=mate).status_code == 204


def test_comments_respect_roles_and_validation(client, card):
    c, _, tokens = card
    url = f"/api/cards/{c['id']}/comments"
    assert client.get(url, headers=headers(tokens["viewer"])).status_code == 200
    assert client.post(url, json={"body": "no"}, headers=headers(tokens["viewer"])).status_code == 403
    assert client.get(url, headers=headers(tokens["outsider"])).status_code == 404
    assert client.post(url, json={"body": ""}, headers=headers(tokens["owner"])).status_code == 422
    assert client.post(url, json={"body": "x" * 5001}, headers=headers(tokens["owner"])).status_code == 422


def test_a_missing_comment_is_404_for_everyone(client, card):
    _, _, tokens = card
    assert client.patch("/api/comments/9999", json={"body": "x"}, headers=headers(tokens["owner"])).status_code == 404
    assert client.delete("/api/comments/9999", headers=headers(tokens["owner"])).status_code == 404
