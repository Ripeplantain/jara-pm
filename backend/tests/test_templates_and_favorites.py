"""Board templates and personal favourites."""

import pytest


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def team(client, register_and_login):
    tokens = {who: register_and_login(f"{who}@example.com") for who in ("owner", "mate", "viewer")}
    owner = headers(tokens["owner"])
    workspace = client.get("/api/workspaces", headers=owner).json()[0]
    for who, role in (("mate", "member"), ("viewer", "viewer")):
        client.post(
            f"/api/workspaces/{workspace['id']}/invites",
            json={"email": f"{who}@example.com", "role": role},
            headers=owner,
        )
    return workspace, tokens


def test_templates_are_listed_with_their_shape(client, team):
    _, tokens = team
    body = client.get("/api/board-templates", headers=headers(tokens["owner"])).json()
    keys = {t["key"] for t in body}
    assert keys == {"kanban", "scrum", "bug-triage", "content-calendar", "product-roadmap"}
    kanban = next(t for t in body if t["key"] == "kanban")
    assert kanban["columns"] == ["Backlog", "Doing", "Done"]
    assert kanban["description"]


def test_creating_from_a_template_sets_up_the_whole_board(client, team):
    workspace, tokens = team
    owner = headers(tokens["owner"])
    res = client.post("/api/boards/from-template", json={"template": "scrum"}, headers=owner)
    assert res.status_code == 201
    board = res.json()
    assert board["title"] == "Scrum"
    assert [c["title"] for c in board["columns"]] == [
        "Product backlog",
        "Sprint backlog",
        "In progress",
        "In review",
        "Done",
    ]
    assert board["columns"][0]["cards"][0]["title"] == "Groom this before the next sprint"
    assert [c["is_done"] for c in board["columns"]] == [False, False, False, False, True]
    assert board["description"]

    labels = client.get(f"/api/workspaces/{workspace['id']}/labels", headers=owner).json()
    assert {lbl["name"] for lbl in labels} == {"story", "bug", "spike"}


def test_a_template_board_can_be_renamed_and_placed(client, team):
    _, tokens = team
    owner = headers(tokens["owner"])
    other = client.post("/api/workspaces", json={"name": "Side"}, headers=owner).json()
    board = client.post(
        "/api/boards/from-template",
        json={"template": "kanban", "title": "Launch plan", "workspace_id": other["id"]},
        headers=owner,
    ).json()
    assert board["title"] == "Launch plan"
    assert board["workspace_id"] == other["id"]


def test_template_labels_are_not_duplicated(client, team):
    workspace, tokens = team
    owner = headers(tokens["owner"])
    client.post("/api/boards/from-template", json={"template": "kanban"}, headers=owner)
    client.post("/api/boards/from-template", json={"template": "kanban"}, headers=owner)
    labels = client.get(f"/api/workspaces/{workspace['id']}/labels", headers=owner).json()
    assert sorted(lbl["name"] for lbl in labels) == ["bug", "chore", "idea"]


def test_an_unknown_template_is_404_and_a_viewer_cannot_use_one(client, team):
    _, tokens = team
    assert client.post(
        "/api/boards/from-template", json={"template": "nope"}, headers=headers(tokens["owner"])
    ).status_code == 404
    assert client.post(
        "/api/boards/from-template", json={"template": "kanban"}, headers=headers(tokens["viewer"])
    ).status_code == 403


def test_favourites_are_personal_and_sort_first(client, team):
    _, tokens = team
    owner, mate = headers(tokens["owner"]), headers(tokens["mate"])
    zebra = client.post("/api/boards", json={"title": "Zebra"}, headers=owner).json()
    client.post("/api/boards", json={"title": "Alpha"}, headers=owner)

    assert [b["title"] for b in client.get("/api/boards", headers=owner).json()] == ["Alpha", "Zebra"]

    faved = client.put(f"/api/boards/{zebra['id']}/favorite", headers=owner)
    assert faved.status_code == 200 and faved.json()["is_favorite"] is True
    assert [b["title"] for b in client.get("/api/boards", headers=owner).json()] == ["Zebra", "Alpha"]

    # Someone else's list is untouched.
    theirs = client.get("/api/boards", headers=mate).json()
    assert [b["title"] for b in theirs] == ["Alpha", "Zebra"]
    assert all(b["is_favorite"] is False for b in theirs)


def test_favouriting_is_idempotent_and_reversible(client, team):
    _, tokens = team
    owner = headers(tokens["owner"])
    board = client.post("/api/boards", json={"title": "B"}, headers=owner).json()
    for _ in range(2):
        assert client.put(f"/api/boards/{board['id']}/favorite", headers=owner).status_code == 200
    assert client.get("/api/boards", headers=owner).json()[0]["is_favorite"] is True

    removed = client.delete(f"/api/boards/{board['id']}/favorite", headers=owner)
    assert removed.status_code == 200 and removed.json()["is_favorite"] is False
    assert client.delete(f"/api/boards/{board['id']}/favorite", headers=owner).status_code == 200


def test_you_cannot_favourite_a_board_you_cannot_see(client, team, register_and_login):
    _, tokens = team
    board = client.post("/api/boards", json={"title": "B"}, headers=headers(tokens["owner"])).json()
    outsider = headers(register_and_login("outsider@example.com"))
    assert client.put(f"/api/boards/{board['id']}/favorite", headers=outsider).status_code == 404


def test_a_viewer_may_favourite(client, team):
    _, tokens = team
    board = client.post("/api/boards", json={"title": "B"}, headers=headers(tokens["owner"])).json()
    assert client.put(
        f"/api/boards/{board['id']}/favorite", headers=headers(tokens["viewer"])
    ).status_code == 200
