"""The activity log: written by the service layer, readable by any member, never edited."""

import pytest


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def team(client, register_and_login):
    tokens = {
        who: register_and_login(f"{who}@example.com")
        for who in ("owner", "mate", "viewer", "outsider")
    }
    owner = headers(tokens["owner"])
    board = client.post(
        "/api/boards", json={"title": "Roadmap", "columns": ["Todo", "Doing"]}, headers=owner
    ).json()
    for who, role in (("mate", "member"), ("viewer", "viewer")):
        client.post(
            f"/api/workspaces/{board['workspace_id']}/invites",
            json={"email": f"{who}@example.com", "role": role},
            headers=owner,
        )
    return board, tokens


def actions(entries):
    return [e["action"] for e in entries]


def test_creating_a_board_is_the_first_entry(client, team):
    board, tokens = team
    entries = client.get(f"/api/boards/{board['id']}/activity", headers=headers(tokens["owner"])).json()
    assert actions(entries) == ["board.created"]
    assert entries[0]["summary"] == "created the board “Roadmap”"
    assert entries[0]["actor"]["email"] == "owner@example.com"
    assert entries[0]["board_id"] == board["id"]


def test_every_mutation_leaves_a_trace(client, team):
    board, tokens = team
    owner = headers(tokens["owner"])
    todo, doing = board["columns"][0]["id"], board["columns"][1]["id"]

    card = client.post(f"/api/columns/{todo}/cards", json={"title": "Ship"}, headers=owner).json()
    client.post(f"/api/cards/{card['id']}/move", json={"column_id": doing}, headers=owner)
    client.patch(f"/api/cards/{card['id']}", json={"title": "Ship it"}, headers=owner)
    client.post(f"/api/cards/{card['id']}/comments", json={"body": "on it"}, headers=owner)
    client.post(f"/api/boards/{board['id']}/columns", json={"title": "Done"}, headers=owner)
    client.patch(f"/api/boards/{board['id']}", json={"title": "Plan"}, headers=owner)

    entries = client.get(f"/api/boards/{board['id']}/activity", headers=owner).json()
    assert actions(entries) == [
        "board.updated",
        "column.created",
        "card.commented",
        "card.updated",
        "card.moved",
        "card.created",
        "board.created",
    ]
    moved = next(e for e in entries if e["action"] == "card.moved")
    assert moved["summary"] == "moved “Ship” to Doing"
    assert moved["card_id"] == card["id"]


def test_assigning_someone_reads_as_an_assignment(client, team):
    board, tokens = team
    owner = headers(tokens["owner"])
    mate_id = client.get("/api/me", headers=headers(tokens["mate"])).json()["id"]
    card = client.post(
        f"/api/columns/{board['columns'][0]['id']}/cards", json={"title": "Ship"}, headers=owner
    ).json()
    client.patch(f"/api/cards/{card['id']}", json={"assignee_id": mate_id}, headers=owner)

    latest = client.get(f"/api/boards/{board['id']}/activity", headers=owner).json()[0]
    assert latest["action"] == "card.assigned"
    assert latest["summary"] == "assigned “Ship” to Mate"


def test_history_outlives_the_card_it_describes(client, team):
    board, tokens = team
    owner = headers(tokens["owner"])
    card = client.post(
        f"/api/columns/{board['columns'][0]['id']}/cards", json={"title": "Doomed"}, headers=owner
    ).json()
    client.delete(f"/api/cards/{card['id']}", headers=owner)

    entries = client.get(f"/api/boards/{board['id']}/activity", headers=owner).json()
    assert entries[0]["summary"] == "deleted “Doomed”"
    assert "card.created" in actions(entries)


def test_the_actor_is_whoever_did_it(client, team):
    board, tokens = team
    client.post(
        f"/api/columns/{board['columns'][0]['id']}/cards",
        json={"title": "Theirs"},
        headers=headers(tokens["mate"]),
    )
    latest = client.get(
        f"/api/boards/{board['id']}/activity", headers=headers(tokens["owner"])
    ).json()[0]
    assert latest["actor"]["email"] == "mate@example.com"


def test_viewers_read_history_and_outsiders_do_not(client, team):
    board, tokens = team
    assert client.get(
        f"/api/boards/{board['id']}/activity", headers=headers(tokens["viewer"])
    ).status_code == 200
    assert client.get(
        f"/api/boards/{board['id']}/activity", headers=headers(tokens["outsider"])
    ).status_code == 404
    assert client.get(
        f"/api/workspaces/{board['workspace_id']}/activity", headers=headers(tokens["outsider"])
    ).status_code == 404


def test_workspace_activity_spans_boards_and_filters(client, team):
    board, tokens = team
    owner = headers(tokens["owner"])
    second = client.post("/api/boards", json={"title": "Second"}, headers=owner).json()
    client.post(
        f"/api/columns/{board['columns'][0]['id']}/cards",
        json={"title": "Theirs"},
        headers=headers(tokens["mate"]),
    )
    wid = board["workspace_id"]

    everything = client.get(f"/api/workspaces/{wid}/activity", headers=owner).json()
    assert {e["board_id"] for e in everything} == {board["id"], second["id"]}

    narrowed = client.get(f"/api/workspaces/{wid}/activity?board_id={second['id']}", headers=owner).json()
    assert [e["board_id"] for e in narrowed] == [second["id"]]

    mate_id = client.get("/api/me", headers=headers(tokens["mate"])).json()["id"]
    by_mate = client.get(f"/api/workspaces/{wid}/activity?actor_id={mate_id}", headers=owner).json()
    assert [e["summary"] for e in by_mate] == ["added “Theirs” to Todo"]


def test_paging_backwards_with_before_id(client, team):
    board, tokens = team
    owner = headers(tokens["owner"])
    for i in range(5):
        client.post(
            f"/api/columns/{board['columns'][0]['id']}/cards", json={"title": f"C{i}"}, headers=owner
        )
    page = client.get(f"/api/boards/{board['id']}/activity?limit=2", headers=owner).json()
    assert len(page) == 2
    older = client.get(
        f"/api/boards/{board['id']}/activity?limit=2&before_id={page[-1]['id']}", headers=owner
    ).json()
    assert [e["id"] for e in older] == [page[-1]["id"] - 1, page[-1]["id"] - 2]


def test_a_rolled_back_change_leaves_no_history(client, team):
    """History is written in the same transaction, so a rejected change records nothing."""
    board, tokens = team
    owner = headers(tokens["owner"])
    before = len(client.get(f"/api/boards/{board['id']}/activity", headers=owner).json())
    outsider_id = client.get("/api/me", headers=headers(tokens["outsider"])).json()["id"]
    card = client.post(
        f"/api/columns/{board['columns'][0]['id']}/cards", json={"title": "Ok"}, headers=owner
    ).json()
    assert client.patch(
        f"/api/cards/{card['id']}", json={"assignee_id": outsider_id}, headers=owner
    ).status_code == 422
    after = client.get(f"/api/boards/{board['id']}/activity", headers=owner).json()
    assert len(after) == before + 1  # only the card.created row
    assert actions(after)[0] == "card.created"
