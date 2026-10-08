"""Sprints: one active at a time, and completing one decides the fate of unfinished work."""

from datetime import timedelta

import pytest

from app.models import Column
from app.util.time import now
from tests.conftest import session_for


def today():
    return now().date()


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def board(client, register_and_login):
    tokens = {who: register_and_login(f"{who}@example.com") for who in ("owner", "viewer", "outsider")}
    owner = headers(tokens["owner"])
    b = client.post(
        "/api/boards", json={"title": "B", "columns": ["Todo", "Done"]}, headers=owner
    ).json()
    client.post(
        f"/api/workspaces/{b['workspace_id']}/invites",
        json={"email": "viewer@example.com", "role": "viewer"},
        headers=owner,
    )
    with session_for() as db:  # the done flag gets its endpoint in 8.2
        db.get(Column, b["columns"][1]["id"]).is_done = True
        db.commit()
    return b, tokens


def make_card(client, board, token, title, column=0):
    return client.post(
        f"/api/columns/{board['columns'][column]['id']}/cards",
        json={"title": title},
        headers=headers(token),
    ).json()


def test_create_start_and_complete_a_sprint(client, board):
    b, tokens = board
    owner = headers(tokens["owner"])
    sprint = client.post(
        f"/api/boards/{b['id']}/sprints",
        json={"name": "Sprint 1", "goal": "Ship the beta"},
        headers=owner,
    )
    assert sprint.status_code == 201
    assert sprint.json()["state"] == "planned"
    sid = sprint.json()["id"]

    started = client.post(f"/api/sprints/{sid}/start", headers=owner)
    assert started.status_code == 200
    assert started.json()["state"] == "active"
    assert started.json()["starts_on"] == today().isoformat()

    done = client.post(f"/api/sprints/{sid}/complete", json={}, headers=owner)
    assert done.status_code == 200
    assert done.json()["state"] == "completed"
    assert done.json()["completed_at"] is not None

    log = client.get(f"/api/boards/{b['id']}/activity", headers=owner).json()
    assert [e["action"] for e in log[:2]] == ["sprint.completed", "sprint.started"]


def test_only_one_sprint_runs_at_a_time(client, board):
    b, tokens = board
    owner = headers(tokens["owner"])
    first = client.post(f"/api/boards/{b['id']}/sprints", json={"name": "One"}, headers=owner).json()
    second = client.post(f"/api/boards/{b['id']}/sprints", json={"name": "Two"}, headers=owner).json()
    client.post(f"/api/sprints/{first['id']}/start", headers=owner)

    clash = client.post(f"/api/sprints/{second['id']}/start", headers=owner)
    assert clash.status_code == 409 and "still running" in clash.json()["detail"]

    client.post(f"/api/sprints/{first['id']}/complete", json={}, headers=owner)
    assert client.post(f"/api/sprints/{second['id']}/start", headers=owner).status_code == 200


def test_completing_sends_unfinished_work_to_the_backlog(client, board):
    b, tokens = board
    owner = headers(tokens["owner"])
    sprint = client.post(f"/api/boards/{b['id']}/sprints", json={"name": "S1"}, headers=owner).json()
    doing = make_card(client, b, tokens["owner"], "Unfinished")
    shipped = make_card(client, b, tokens["owner"], "Shipped", column=1)
    for card in (doing, shipped):
        client.put(f"/api/cards/{card['id']}/sprint", json={"sprint_id": sprint["id"]}, headers=owner)

    progress = client.get(f"/api/sprints/{sprint['id']}/progress", headers=owner).json()
    assert progress == {"total": 2, "done": 1, "estimate_total": 0, "estimate_done": 0}

    client.post(f"/api/sprints/{sprint['id']}/start", headers=owner)
    client.post(f"/api/sprints/{sprint['id']}/complete", json={}, headers=owner)

    board_now = client.get(f"/api/boards/{b['id']}", headers=owner).json()
    cards = {c["title"]: c for col in board_now["columns"] for c in col["cards"]}
    assert cards["Unfinished"]["sprint_id"] is None
    assert cards["Shipped"]["sprint_id"] == sprint["id"]  # finished work stays with its sprint
    # The cards themselves did not move columns.
    assert cards["Unfinished"]["column_id"] == b["columns"][0]["id"]


def test_completing_can_roll_work_into_the_next_sprint(client, board):
    b, tokens = board
    owner = headers(tokens["owner"])
    first = client.post(f"/api/boards/{b['id']}/sprints", json={"name": "S1"}, headers=owner).json()
    nxt = client.post(f"/api/boards/{b['id']}/sprints", json={"name": "S2"}, headers=owner).json()
    card = make_card(client, b, tokens["owner"], "Carry over")
    client.put(f"/api/cards/{card['id']}/sprint", json={"sprint_id": first["id"]}, headers=owner)
    client.post(f"/api/sprints/{first['id']}/start", headers=owner)

    res = client.post(
        f"/api/sprints/{first['id']}/complete", json={"move_unfinished_to": nxt["id"]}, headers=owner
    )
    assert res.status_code == 200
    moved = client.get(f"/api/boards/{b['id']}", headers=owner).json()["columns"][0]["cards"][0]
    assert moved["sprint_id"] == nxt["id"]

    log = client.get(f"/api/boards/{b['id']}/activity", headers=owner).json()[0]
    assert "1 unfinished moved to “S2”" in log["summary"]


def test_completing_twice_is_a_conflict(client, board):
    b, tokens = board
    owner = headers(tokens["owner"])
    sprint = client.post(f"/api/boards/{b['id']}/sprints", json={"name": "S"}, headers=owner).json()
    client.post(f"/api/sprints/{sprint['id']}/complete", json={}, headers=owner)
    assert client.post(f"/api/sprints/{sprint['id']}/complete", json={}, headers=owner).status_code == 409
    assert client.post(f"/api/sprints/{sprint['id']}/start", headers=owner).status_code == 409


def test_dates_and_cross_board_moves_are_validated(client, board):
    b, tokens = board
    owner = headers(tokens["owner"])
    backwards = client.post(
        f"/api/boards/{b['id']}/sprints",
        json={
            "name": "Bad",
            "starts_on": today().isoformat(),
            "ends_on": (today() - timedelta(days=1)).isoformat(),
        },
        headers=owner,
    )
    assert backwards.status_code == 422 and "cannot end before" in backwards.json()["detail"]

    other_board = client.post("/api/boards", json={"title": "Other"}, headers=owner).json()
    mine = client.post(f"/api/boards/{b['id']}/sprints", json={"name": "Mine"}, headers=owner).json()
    theirs = client.post(
        f"/api/boards/{other_board['id']}/sprints", json={"name": "Theirs"}, headers=owner
    ).json()
    res = client.post(
        f"/api/sprints/{mine['id']}/complete", json={"move_unfinished_to": theirs["id"]}, headers=owner
    )
    assert res.status_code == 422 and "same board" in res.json()["detail"]

    card = make_card(client, b, tokens["owner"], "Card")
    cross = client.put(
        f"/api/cards/{card['id']}/sprint", json={"sprint_id": theirs["id"]}, headers=owner
    )
    assert cross.status_code == 422 and "different board" in cross.json()["detail"]


def test_deleting_a_sprint_leaves_its_cards_in_the_backlog(client, board):
    b, tokens = board
    owner = headers(tokens["owner"])
    sprint = client.post(f"/api/boards/{b['id']}/sprints", json={"name": "S"}, headers=owner).json()
    card = make_card(client, b, tokens["owner"], "Card")
    client.put(f"/api/cards/{card['id']}/sprint", json={"sprint_id": sprint["id"]}, headers=owner)

    assert client.delete(f"/api/sprints/{sprint['id']}", headers=owner).status_code == 204
    after = client.get(f"/api/boards/{b['id']}", headers=owner).json()["columns"][0]["cards"][0]
    assert after["sprint_id"] is None
    assert after["title"] == "Card"


def test_sprints_respect_roles(client, board):
    b, tokens = board
    owner, viewer, outsider = (headers(tokens[k]) for k in ("owner", "viewer", "outsider"))
    sprint = client.post(f"/api/boards/{b['id']}/sprints", json={"name": "S"}, headers=owner).json()

    assert client.get(f"/api/boards/{b['id']}/sprints", headers=viewer).status_code == 200
    assert client.get(f"/api/sprints/{sprint['id']}/progress", headers=viewer).status_code == 200
    assert client.post(f"/api/boards/{b['id']}/sprints", json={"name": "No"}, headers=viewer).status_code == 403
    assert client.post(f"/api/sprints/{sprint['id']}/start", headers=viewer).status_code == 403
    assert client.delete(f"/api/sprints/{sprint['id']}", headers=viewer).status_code == 403

    assert client.get(f"/api/boards/{b['id']}/sprints", headers=outsider).status_code == 404
    assert client.post(f"/api/sprints/{sprint['id']}/start", headers=outsider).status_code == 404
    assert client.get(f"/api/sprints/{sprint['id']}/progress", headers=outsider).status_code == 404
