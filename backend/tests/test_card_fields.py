"""Assignee, priority, due date, estimate - and the rules that keep them honest."""

from datetime import UTC, datetime, timedelta

import pytest

from app.models import Column
from tests.conftest import session_for


def mark_done(column_id: int) -> None:
    """The endpoint for this arrives with column settings (8.2); the flag is what matters here."""
    with session_for() as db:
        db.get(Column, column_id).is_done = True
        db.commit()


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def board(client, register_and_login):
    tokens = {who: register_and_login(f"{who}@example.com") for who in ("owner", "mate", "outsider")}
    owner = headers(tokens["owner"])
    board = client.post(
        "/api/boards", json={"title": "Board", "columns": ["Todo", "Done"]}, headers=owner
    ).json()
    client.post(
        f"/api/workspaces/{board['workspace_id']}/invites",
        json={"email": "mate@example.com", "role": "member"},
        headers=owner,
    )
    mate_id = client.get("/api/me", headers=headers(tokens["mate"])).json()["id"]
    return board, tokens, mate_id


def test_a_new_card_records_its_creator_and_defaults(client, board):
    b, tokens, _ = board
    card = client.post(
        f"/api/columns/{b['columns'][0]['id']}/cards",
        json={"title": "Plain"},
        headers=headers(tokens["owner"]),
    ).json()
    me = client.get("/api/me", headers=headers(tokens["owner"])).json()
    assert card["created_by_id"] == me["id"]
    assert card["priority"] == "none"
    assert card["assignee"] is None
    assert card["due_date"] is None and card["estimate"] is None
    assert card["completed_at"] is None and card["archived_at"] is None
    assert card["updated_at"] is not None


def test_create_a_card_with_every_field(client, board):
    b, tokens, mate_id = board
    due = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    card = client.post(
        f"/api/columns/{b['columns'][0]['id']}/cards",
        json={
            "title": "Rich",
            "assignee_id": mate_id,
            "priority": "high",
            "due_date": due,
            "estimate": 5,
        },
        headers=headers(tokens["owner"]),
    )
    assert card.status_code == 201
    body = card.json()
    assert body["assignee_id"] == mate_id
    assert body["assignee"]["email"] == "mate@example.com"
    assert body["assignee"]["name"] == "Mate"
    assert "password_hash" not in body["assignee"]
    assert body["priority"] == "high"
    assert body["estimate"] == 5


def test_updating_leaves_untouched_fields_alone_and_null_clears(client, board):
    b, tokens, mate_id = board
    owner = headers(tokens["owner"])
    card = client.post(
        f"/api/columns/{b['columns'][0]['id']}/cards",
        json={"title": "Rich", "assignee_id": mate_id, "estimate": 3, "priority": "urgent"},
        headers=owner,
    ).json()

    renamed = client.patch(f"/api/cards/{card['id']}", json={"title": "Renamed"}, headers=owner).json()
    assert renamed["title"] == "Renamed"
    assert renamed["assignee_id"] == mate_id and renamed["estimate"] == 3
    assert renamed["priority"] == "urgent"

    cleared = client.patch(
        f"/api/cards/{card['id']}", json={"assignee_id": None, "estimate": None}, headers=owner
    ).json()
    assert cleared["assignee_id"] is None and cleared["assignee"] is None
    assert cleared["estimate"] is None
    assert cleared["priority"] == "urgent"


def test_assignee_must_be_a_member_of_the_workspace(client, board):
    b, tokens, _ = board
    owner = headers(tokens["owner"])
    outsider_id = client.get("/api/me", headers=headers(tokens["outsider"])).json()["id"]
    res = client.post(
        f"/api/columns/{b['columns'][0]['id']}/cards",
        json={"title": "Nope", "assignee_id": outsider_id},
        headers=owner,
    )
    assert res.status_code == 422 and "not a member" in res.json()["detail"]

    card = client.post(
        f"/api/columns/{b['columns'][0]['id']}/cards", json={"title": "Ok"}, headers=owner
    ).json()
    assert client.patch(
        f"/api/cards/{card['id']}", json={"assignee_id": outsider_id}, headers=owner
    ).status_code == 422


def test_priority_and_estimate_are_validated(client, board):
    b, tokens, _ = board
    owner = headers(tokens["owner"])
    url = f"/api/columns/{b['columns'][0]['id']}/cards"
    assert client.post(url, json={"title": "x", "priority": "sometime"}, headers=owner).status_code == 422
    assert client.post(url, json={"title": "x", "estimate": -1}, headers=owner).status_code == 422
    assert client.post(url, json={"title": "x", "estimate": 99999}, headers=owner).status_code == 422


def test_completed_at_follows_the_done_column(client, board):
    b, tokens, _ = board
    owner = headers(tokens["owner"])
    todo, done = b["columns"][0]["id"], b["columns"][1]["id"]
    card = client.post(f"/api/columns/{todo}/cards", json={"title": "Work"}, headers=owner).json()
    assert card["completed_at"] is None

    # The starter board has no done column configured yet, so moving there changes nothing.
    moved = client.post(
        f"/api/cards/{card['id']}/move", json={"column_id": done, "position": 0}, headers=owner
    ).json()
    assert moved["completed_at"] is None

    mark_done(done)
    finished = client.post(
        f"/api/cards/{card['id']}/move", json={"column_id": todo}, headers=owner
    ).json()
    assert finished["completed_at"] is None
    finished = client.post(
        f"/api/cards/{card['id']}/move", json={"column_id": done}, headers=owner
    ).json()
    assert finished["completed_at"] is not None

    back = client.post(f"/api/cards/{card['id']}/move", json={"column_id": todo}, headers=owner).json()
    assert back["completed_at"] is None


def test_completion_cannot_be_faked_by_editing_a_field(client, board):
    b, tokens, _ = board
    owner = headers(tokens["owner"])
    card = client.post(
        f"/api/columns/{b['columns'][0]['id']}/cards", json={"title": "Work"}, headers=owner
    ).json()
    res = client.patch(
        f"/api/cards/{card['id']}",
        json={"completed_at": datetime.now(UTC).isoformat()},
        headers=owner,
    )
    # Unknown fields are ignored by the schema rather than written through.
    assert res.status_code == 200 and res.json()["completed_at"] is None
