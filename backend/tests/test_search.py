"""Board filters, workspace search, and "my work"."""

from datetime import timedelta
from urllib.parse import quote

import pytest

from app.util.time import now


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def scene(client, register_and_login):
    """One board with a spread of cards, plus a second board in the same workspace."""
    tokens = {who: register_and_login(f"{who}@example.com") for who in ("owner", "mate", "outsider")}
    owner = headers(tokens["owner"])
    board = client.post(
        "/api/boards", json={"title": "Roadmap", "columns": ["Todo", "Doing"]}, headers=owner
    ).json()
    wid = board["workspace_id"]
    client.post(
        f"/api/workspaces/{wid}/invites",
        json={"email": "mate@example.com", "role": "member"},
        headers=owner,
    )
    mate_id = client.get("/api/me", headers=headers(tokens["mate"])).json()["id"]
    label = client.post(
        f"/api/workspaces/{wid}/labels", json={"name": "bug", "color": "rose"}, headers=owner
    ).json()
    todo = board["columns"][0]["id"]

    soon = (now() + timedelta(days=1)).isoformat()
    later = (now() + timedelta(days=30)).isoformat()
    cards = {
        "login": client.post(
            todo_url := f"/api/columns/{todo}/cards",
            json={"title": "Fix login", "description": "Users cannot sign in", "priority": "urgent",
                  "assignee_id": mate_id, "due_date": soon},
            headers=owner,
        ).json(),
        "docs": client.post(
            todo_url, json={"title": "Write docs", "priority": "low", "due_date": later}, headers=owner
        ).json(),
        "discount": client.post(
            todo_url, json={"title": "Add 50% discount banner"}, headers=owner
        ).json(),
    }
    client.post(f"/api/cards/{cards['login']['id']}/labels/{label['id']}", headers=owner)

    other = client.post("/api/boards", json={"title": "Marketing"}, headers=owner).json()
    other_col = client.post(
        f"/api/boards/{other['id']}/columns", json={"title": "Ideas"}, headers=owner
    ).json()
    cards["campaign"] = client.post(
        f"/api/columns/{other_col['id']}/cards",
        json={"title": "Launch campaign", "description": "for the login release", "assignee_id": mate_id},
        headers=owner,
    ).json()
    return board, other, cards, tokens, label, mate_id


def titles(rows):
    return sorted(r["title"] for r in rows)


def test_text_filter_looks_at_title_and_description(client, scene):
    board, _, _, tokens, _, _ = scene
    owner = headers(tokens["owner"])
    url = f"/api/boards/{board['id']}/cards"
    assert titles(client.get(f"{url}?q=login", headers=owner).json()) == ["Fix login"]
    assert titles(client.get(f"{url}?q=sign in", headers=owner).json()) == ["Fix login"]
    assert client.get(f"{url}?q=nothing-here", headers=owner).json() == []


def test_wildcards_in_the_query_are_escaped(client, scene):
    board, _, _, tokens, _, _ = scene
    owner = headers(tokens["owner"])
    url = f"/api/boards/{board['id']}/cards"
    # A bare % must not behave as "match everything".
    assert titles(client.get(f"{url}?q=%", headers=owner).json()) == ["Add 50% discount banner"]
    assert titles(client.get(f"{url}?q=50%", headers=owner).json()) == ["Add 50% discount banner"]
    assert client.get(f"{url}?q=_", headers=owner).json() == []


def test_every_filter_narrows(client, scene):
    board, _, _, tokens, label, mate_id = scene
    owner = headers(tokens["owner"])
    url = f"/api/boards/{board['id']}/cards"
    assert titles(client.get(f"{url}?assignee_id={mate_id}", headers=owner).json()) == ["Fix login"]
    assert titles(client.get(f"{url}?label_id={label['id']}", headers=owner).json()) == ["Fix login"]
    assert titles(client.get(f"{url}?priority=urgent", headers=owner).json()) == ["Fix login"]

    # The "+" in an ISO offset has to be percent-encoded, or it arrives as a space.
    cutoff = quote((now() + timedelta(days=7)).isoformat())
    assert titles(client.get(f"{url}?due_before={cutoff}", headers=owner).json()) == ["Fix login"]

    combined = client.get(f"{url}?q=fix&priority=low", headers=owner).json()
    assert combined == []  # filters are ANDed
    assert len(client.get(url, headers=owner).json()) == 3


def test_archived_cards_are_a_separate_view(client, scene):
    board, _, cards, tokens, _, _ = scene
    owner = headers(tokens["owner"])
    url = f"/api/boards/{board['id']}/cards"
    client.post(f"/api/cards/{cards['docs']['id']}/archive", headers=owner)
    assert "Write docs" not in titles(client.get(url, headers=owner).json())
    assert titles(client.get(f"{url}?archived=true", headers=owner).json()) == ["Write docs"]


def test_filtering_by_sprint(client, scene):
    board, _, cards, tokens, _, _ = scene
    owner = headers(tokens["owner"])
    sprint = client.post(
        f"/api/boards/{board['id']}/sprints", json={"name": "S1"}, headers=owner
    ).json()
    client.put(
        f"/api/cards/{cards['docs']['id']}/sprint", json={"sprint_id": sprint["id"]}, headers=owner
    )
    url = f"/api/boards/{board['id']}/cards?sprint_id={sprint['id']}"
    assert titles(client.get(url, headers=owner).json()) == ["Write docs"]


def test_workspace_search_spans_boards_and_says_where(client, scene):
    board, _, _, tokens, _, _ = scene
    owner = headers(tokens["owner"])
    wid = board["workspace_id"]
    hits = client.get(f"/api/workspaces/{wid}/search?q=login", headers=owner).json()
    assert titles(hits) == ["Fix login", "Launch campaign"]
    by_title = {h["title"]: h for h in hits}
    assert by_title["Launch campaign"]["board_title"] == "Marketing"
    assert by_title["Launch campaign"]["column_title"] == "Ideas"
    assert by_title["Fix login"]["board_id"] == board["id"]
    assert client.get(f"/api/workspaces/{wid}/search?q=   ", headers=owner).json() == []


def test_my_cards_lists_open_work_by_due_date(client, scene):
    board, _, cards, tokens, _, _ = scene
    mate = headers(tokens["mate"])
    mine = client.get("/api/my-cards", headers=mate).json()
    # Soonest deadline first, then the undated one.
    assert [c["title"] for c in mine] == ["Fix login", "Launch campaign"]

    owner = headers(tokens["owner"])
    doing = board["columns"][1]["id"]
    client.patch(f"/api/columns/{doing}", json={"is_done": True}, headers=owner)
    client.post(f"/api/cards/{cards['login']['id']}/move", json={"column_id": doing}, headers=owner)
    assert [c["title"] for c in client.get("/api/my-cards", headers=mate).json()] == ["Launch campaign"]


def test_search_and_filters_respect_membership(client, scene):
    board, _, _, tokens, _, _ = scene
    out = headers(tokens["outsider"])
    wid = board["workspace_id"]
    assert client.get(f"/api/boards/{board['id']}/cards", headers=out).status_code == 404
    assert client.get(f"/api/workspaces/{wid}/search?q=login", headers=out).status_code == 404
    assert client.get("/api/my-cards", headers=out).json() == []
