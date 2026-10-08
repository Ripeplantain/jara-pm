"""Archiving: reversible, keeps history, and keeps the visible ordering contiguous."""

import pytest


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def board(client, register_and_login):
    tokens = {who: register_and_login(f"{who}@example.com") for who in ("owner", "viewer", "outsider")}
    owner = headers(tokens["owner"])
    b = client.post("/api/boards", json={"title": "B", "columns": ["Todo"]}, headers=owner).json()
    client.post(
        f"/api/workspaces/{b['workspace_id']}/invites",
        json={"email": "viewer@example.com", "role": "viewer"},
        headers=owner,
    )
    cards = [
        client.post(
            f"/api/columns/{b['columns'][0]['id']}/cards", json={"title": t}, headers=owner
        ).json()
        for t in ("a", "b", "c")
    ]
    return b, cards, tokens


def visible(client, board_id, token):
    got = client.get(f"/api/boards/{board_id}", headers=headers(token)).json()
    return [(c["title"], c["position"]) for c in got["columns"][0]["cards"]]


def test_archiving_hides_a_card_and_closes_the_gap(client, board):
    b, cards, tokens = board
    owner = tokens["owner"]
    res = client.post(f"/api/cards/{cards[0]['id']}/archive", headers=headers(owner))
    assert res.status_code == 200 and res.json()["archived_at"] is not None

    assert visible(client, b["id"], owner) == [("b", 0), ("c", 1)]

    with_archived = client.get(
        f"/api/boards/{b['id']}?include_archived=true", headers=headers(owner)
    ).json()
    assert [c["title"] for c in with_archived["columns"][0]["cards"]] == ["a", "b", "c"]

    listed = client.get(f"/api/boards/{b['id']}/archived-cards", headers=headers(owner)).json()
    assert [c["title"] for c in listed] == ["a"]


def test_unarchiving_puts_the_card_at_the_end(client, board):
    b, cards, tokens = board
    owner = tokens["owner"]
    client.post(f"/api/cards/{cards[0]['id']}/archive", headers=headers(owner))
    restored = client.post(f"/api/cards/{cards[0]['id']}/unarchive", headers=headers(owner))
    assert restored.status_code == 200 and restored.json()["archived_at"] is None
    assert visible(client, b["id"], owner) == [("b", 0), ("c", 1), ("a", 2)]


def test_archiving_twice_is_harmless(client, board):
    b, cards, tokens = board
    owner = tokens["owner"]
    first = client.post(f"/api/cards/{cards[1]['id']}/archive", headers=headers(owner)).json()
    second = client.post(f"/api/cards/{cards[1]['id']}/archive", headers=headers(owner)).json()
    assert first["archived_at"] == second["archived_at"]
    assert visible(client, b["id"], owner) == [("a", 0), ("c", 1)]
    # Unarchiving something that is not archived is equally harmless.
    client.post(f"/api/cards/{cards[0]['id']}/unarchive", headers=headers(owner))
    assert visible(client, b["id"], owner) == [("a", 0), ("c", 1)]


def test_archived_cards_do_not_disturb_later_moves(client, board):
    b, cards, tokens = board
    owner = tokens["owner"]
    client.post(f"/api/cards/{cards[1]['id']}/archive", headers=headers(owner))
    client.post(
        f"/api/cards/{cards[2]['id']}/move",
        json={"column_id": b["columns"][0]["id"], "position": 0},
        headers=headers(owner),
    )
    assert visible(client, b["id"], owner) == [("c", 0), ("a", 1)]


def test_archiving_is_recorded_and_respects_roles(client, board):
    b, cards, tokens = board
    client.post(f"/api/cards/{cards[0]['id']}/archive", headers=headers(tokens["owner"]))
    latest = client.get(
        f"/api/boards/{b['id']}/activity", headers=headers(tokens["owner"])
    ).json()[0]
    assert latest["action"] == "card.archived"
    assert latest["summary"] == "archived “a”"

    assert client.post(
        f"/api/cards/{cards[1]['id']}/archive", headers=headers(tokens["viewer"])
    ).status_code == 403
    assert client.post(
        f"/api/cards/{cards[1]['id']}/archive", headers=headers(tokens["outsider"])
    ).status_code == 404
    assert client.get(
        f"/api/boards/{b['id']}/archived-cards", headers=headers(tokens["outsider"])
    ).status_code == 404
    assert client.get(
        f"/api/boards/{b['id']}/archived-cards", headers=headers(tokens["viewer"])
    ).status_code == 200
