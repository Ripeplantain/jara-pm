"""Analytics, notifications and the workspace overview."""

from datetime import timedelta

import pytest

from app.util.time import now


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def scene(client, register_and_login):
    tokens = {who: register_and_login(f"{who}@example.com") for who in ("owner", "mate", "outsider")}
    owner = headers(tokens["owner"])
    board = client.post(
        "/api/boards", json={"title": "Roadmap", "columns": ["Todo", "Doing", "Done"]}, headers=owner
    ).json()
    client.post(
        f"/api/workspaces/{board['workspace_id']}/invites",
        json={"email": "mate@example.com", "role": "member"},
        headers=owner,
    )
    client.patch(f"/api/columns/{board['columns'][2]['id']}", json={"is_done": True}, headers=owner)
    client.patch(f"/api/columns/{board['columns'][1]['id']}", json={"wip_limit": 1}, headers=owner)
    mate_id = client.get("/api/me", headers=headers(tokens["mate"])).json()["id"]
    return board, tokens, mate_id


def add_card(client, board, token, title, column=0, **fields):
    return client.post(
        f"/api/columns/{board['columns'][column]['id']}/cards",
        json={"title": title, **fields},
        headers=headers(token),
    ).json()


# --- analytics -------------------------------------------------------------------------------


def test_analytics_counts_columns_and_flags_wip(client, scene):
    board, tokens, _ = scene
    owner = tokens["owner"]
    for i in range(2):
        add_card(client, board, owner, f"Doing {i}", column=1)
    add_card(client, board, owner, "Todo")

    stats = client.get(f"/api/boards/{board['id']}/analytics", headers=headers(owner)).json()
    by_title = {c["title"]: c for c in stats["columns"]}
    assert by_title["Todo"]["count"] == 1
    assert by_title["Doing"]["count"] == 2
    assert by_title["Doing"]["over_wip_limit"] is True
    assert by_title["Done"]["is_done"] is True
    assert stats["total_cards"] == 3 and stats["open_cards"] == 3


def test_cycle_time_reports_its_sample_size(client, scene):
    board, tokens, _ = scene
    owner = tokens["owner"]
    stats = client.get(f"/api/boards/{board['id']}/analytics", headers=headers(owner)).json()
    assert stats["cycle_time_hours"] is None and stats["cycle_time_sample"] == 0

    card = add_card(client, board, owner, "Ship")
    client.post(
        f"/api/cards/{card['id']}/move",
        json={"column_id": board["columns"][2]["id"]},
        headers=headers(owner),
    )
    stats = client.get(f"/api/boards/{board['id']}/analytics", headers=headers(owner)).json()
    assert stats["cycle_time_sample"] == 1
    assert stats["cycle_time_hours"] == 0.0
    assert stats["completed_cards"] == 1 and stats["open_cards"] == 0
    assert stats["throughput"][-1]["completed"] == 1
    assert len(stats["throughput"]) == 8


def test_workload_covers_every_member_plus_unassigned(client, scene):
    board, tokens, mate_id = scene
    owner = tokens["owner"]
    add_card(client, board, owner, "Theirs", assignee_id=mate_id, estimate=5)
    add_card(client, board, owner, "Nobody's")

    stats = client.get(f"/api/boards/{board['id']}/analytics", headers=headers(owner)).json()
    workload = {w["name"]: w for w in stats["workload"]}
    assert workload["Mate"]["open_cards"] == 1 and workload["Mate"]["estimate"] == 5
    assert workload["Owner"]["open_cards"] == 0
    assert workload["Unassigned"]["open_cards"] == 1
    assert stats["unestimated"] == 1


def test_overdue_and_due_soon(client, scene):
    board, tokens, _ = scene
    owner = tokens["owner"]
    add_card(client, board, owner, "Late", due_date=(now() - timedelta(days=2)).isoformat())
    add_card(client, board, owner, "Soon", due_date=(now() + timedelta(days=2)).isoformat())
    add_card(client, board, owner, "Later", due_date=(now() + timedelta(days=60)).isoformat())

    stats = client.get(f"/api/boards/{board['id']}/analytics", headers=headers(owner)).json()
    assert stats["overdue"] == 1 and stats["due_soon"] == 1


def test_analytics_respects_membership(client, scene):
    board, tokens, _ = scene
    assert client.get(
        f"/api/boards/{board['id']}/analytics", headers=headers(tokens["outsider"])
    ).status_code == 404


# --- notifications ---------------------------------------------------------------------------


def test_being_assigned_a_card_notifies_you(client, scene):
    board, tokens, mate_id = scene
    owner, mate = tokens["owner"], headers(tokens["mate"])
    card = add_card(client, board, owner, "Yours")
    client.patch(f"/api/cards/{card['id']}", json={"assignee_id": mate_id}, headers=headers(owner))

    inbox = client.get("/api/notifications", headers=mate).json()
    assert len(inbox) == 1
    assert inbox[0]["kind"] == "card.assigned"
    assert inbox[0]["title"] == "Owner assigned you “Yours”"
    assert inbox[0]["card_id"] == card["id"]
    assert inbox[0]["read_at"] is None
    assert client.get("/api/notifications/unread-count", headers=mate).json() == {"unread": 1}


def test_you_are_never_told_about_your_own_actions(client, scene):
    board, tokens, _ = scene
    owner = tokens["owner"]
    owner_id = client.get("/api/me", headers=headers(owner)).json()["id"]
    add_card(client, board, owner, "Mine", assignee_id=owner_id)
    assert client.get("/api/notifications", headers=headers(owner)).json() == []

    # Assigning yourself from a card someone else made is still your own action.
    card = add_card(client, board, tokens["mate"], "Theirs")
    client.patch(f"/api/cards/{card['id']}", json={"assignee_id": owner_id}, headers=headers(owner))
    assert client.get("/api/notifications", headers=headers(owner)).json() == []


def test_mentions_in_a_comment_notify_the_person_named(client, scene):
    board, tokens, _ = scene
    owner, mate = tokens["owner"], headers(tokens["mate"])
    card = add_card(client, board, owner, "Discuss")
    client.post(
        f"/api/cards/{card['id']}/comments",
        json={"body": "@mate@example.com can you look? @nobody-at-all cannot."},
        headers=headers(owner),
    )
    inbox = client.get("/api/notifications", headers=mate).json()
    assert [n["kind"] for n in inbox] == ["card.mentioned"]
    assert inbox[0]["title"] == "Owner mentioned you on “Discuss”"


def test_a_mention_by_display_name_also_works(client, scene):
    board, tokens, _ = scene
    owner, mate = tokens["owner"], headers(tokens["mate"])
    card = add_card(client, board, owner, "Discuss")
    client.post(
        f"/api/cards/{card['id']}/comments", json={"body": "ping @Mate"}, headers=headers(owner)
    )
    assert [n["kind"] for n in client.get("/api/notifications", headers=mate).json()] == [
        "card.mentioned"
    ]


def test_the_assignee_hears_about_comments_and_completion_once(client, scene):
    board, tokens, mate_id = scene
    owner, mate = tokens["owner"], headers(tokens["mate"])
    card = add_card(client, board, owner, "Yours", assignee_id=mate_id)
    client.post(f"/api/cards/{card['id']}/comments", json={"body": "any update?"}, headers=headers(owner))
    client.post(
        f"/api/cards/{card['id']}/move",
        json={"column_id": board["columns"][2]["id"]},
        headers=headers(owner),
    )
    kinds = [n["kind"] for n in client.get("/api/notifications", headers=mate).json()]
    assert kinds == ["card.completed", "card.commented", "card.assigned"]

    # A mention plus being the assignee is still only one notification for that comment.
    client.post(
        f"/api/cards/{card['id']}/comments", json={"body": "thanks @Mate"}, headers=headers(owner)
    )
    kinds = [n["kind"] for n in client.get("/api/notifications", headers=mate).json()]
    assert kinds[0] == "card.mentioned"
    assert len(kinds) == 4


def test_marking_read_one_at_a_time_and_all_at_once(client, scene):
    board, tokens, mate_id = scene
    owner, mate = tokens["owner"], headers(tokens["mate"])
    for i in range(3):
        add_card(client, board, owner, f"C{i}", assignee_id=mate_id)

    inbox = client.get("/api/notifications", headers=mate).json()
    assert len(inbox) == 3
    read = client.post(f"/api/notifications/{inbox[0]['id']}/read", headers=mate)
    assert read.status_code == 200 and read.json()["read_at"] is not None
    assert client.get("/api/notifications/unread-count", headers=mate).json()["unread"] == 2
    assert len(client.get("/api/notifications?unread_only=true", headers=mate).json()) == 2

    assert client.post("/api/notifications/read-all", headers=mate).json() == {"unread": 2}
    assert client.get("/api/notifications/unread-count", headers=mate).json()["unread"] == 0


def test_notifications_are_private(client, scene):
    board, tokens, mate_id = scene
    owner = tokens["owner"]
    add_card(client, board, owner, "Yours", assignee_id=mate_id)
    mate_inbox = client.get("/api/notifications", headers=headers(tokens["mate"])).json()

    assert client.get("/api/notifications", headers=headers(owner)).json() == []
    stolen = client.post(f"/api/notifications/{mate_inbox[0]['id']}/read", headers=headers(owner))
    assert stolen.status_code == 404


# --- workspace overview ----------------------------------------------------------------------


def test_the_overview_answers_the_dashboard_in_one_call(client, scene):
    board, tokens, mate_id = scene
    owner, mate = tokens["owner"], tokens["mate"]
    wid = board["workspace_id"]
    add_card(client, board, owner, "Late", assignee_id=mate_id,
             due_date=(now() - timedelta(days=1)).isoformat())
    add_card(client, board, owner, "Soon", assignee_id=mate_id,
             due_date=(now() + timedelta(days=2)).isoformat())
    add_card(client, board, owner, "Someone else's")
    client.put(f"/api/boards/{board['id']}/favorite", headers=headers(mate))

    body = client.get(f"/api/workspaces/{wid}/overview", headers=headers(mate)).json()
    assert body["workspace_id"] == wid
    assert len(body["boards"]) == 1
    stat = body["boards"][0]
    assert stat["title"] == "Roadmap" and stat["is_favorite"] is True
    assert stat["total_cards"] == 3 and stat["open_cards"] == 3 and stat["overdue"] == 1
    assert body["my_open_cards"] == 2
    assert body["my_overdue"] == 1 and body["my_due_soon"] == 1
    assert body["recent_activity"][0]["action"] == "card.created"
    assert len(body["recent_activity"]) <= 10


def test_overview_exposes_deterministic_copilot_signals(client, scene):
    board, tokens, _ = scene
    owner = tokens["owner"]
    add_card(
        client,
        board,
        owner,
        "Blocked checkout",
        column=1,
        due_date=(now() - timedelta(days=1)).isoformat(),
    )
    add_card(client, board, owner, "Another in progress", column=1)
    body = client.get(
        f"/api/workspaces/{board['workspace_id']}/overview", headers=headers(owner)
    ).json()
    kinds = {signal["kind"] for signal in body["signals"]}
    assert {"overdue", "blocked", "wip"}.issubset(kinds)
    blocked = next(signal for signal in body["signals"] if signal["kind"] == "blocked")
    assert blocked["board_id"] == board["id"] and blocked["card_id"] is not None


def test_overview_surfaces_ai_signals_in_notifications_without_duplicates(client, scene):
    board, tokens, _ = scene
    owner = headers(tokens["owner"])
    add_card(client, board, tokens["owner"], "Unowned work")
    first = client.get(f"/api/workspaces/{board['workspace_id']}/overview", headers=owner)
    assert first.status_code == 200
    notifications = client.get("/api/notifications", headers=owner).json()
    assert any(item["kind"] == "ai.signal" and "unassigned" in item["title"] for item in notifications)
    count = len(notifications)
    client.get(f"/api/workspaces/{board['workspace_id']}/overview", headers=owner)
    assert len(client.get("/api/notifications", headers=owner).json()) == count


def test_overview_includes_active_sprint_health(client, scene):
    board, tokens, _ = scene
    owner = headers(tokens["owner"])
    card = add_card(client, board, tokens["owner"], "Sprint work")
    sprint = client.post(
        f"/api/boards/{board['id']}/sprints", json={"name": "Current"}, headers=owner
    ).json()
    client.put(
        f"/api/cards/{card['id']}/sprint", json={"sprint_id": sprint["id"]}, headers=owner
    )
    client.post(f"/api/sprints/{sprint['id']}/start", headers=owner)
    body = client.get(
        f"/api/workspaces/{board['workspace_id']}/overview", headers=owner
    ).json()
    assert body["active_sprints"] == [{
        "board_id": board["id"],
        "board_title": "Roadmap",
        "sprint_id": sprint["id"],
        "name": "Current",
        "total": 1,
        "done": 0,
        "estimate_total": 0,
        "estimate_done": 0,
        "ends_on": None,
    }]


def test_workspace_ai_returns_evidence_and_respects_membership(client, scene):
    board, tokens, _ = scene
    owner = headers(tokens["owner"])
    add_card(client, board, tokens["owner"], "Blocked checkout", column=1)
    response = client.post(
        f"/api/workspaces/{board['workspace_id']}/ai",
        json={"question": "What is blocked?"},
        headers=owner,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["evidence"][0]["kind"] == "blocked"
    assert body["next_actions"]
    assert client.post(
        f"/api/workspaces/{board['workspace_id']}/ai",
        json={"question": "Tell me a joke"},
        headers=owner,
    ).status_code == 422
    assert client.post(
        f"/api/workspaces/{board['workspace_id']}/ai",
        json={"question": "What is blocked?"},
        headers=headers(tokens["outsider"]),
    ).status_code == 404


def test_the_overview_is_scoped_to_members(client, scene):
    board, tokens, _ = scene
    assert client.get(
        f"/api/workspaces/{board['workspace_id']}/overview", headers=headers(tokens["outsider"])
    ).status_code == 404


def test_cycle_time_is_never_negative(client, scene):
    """A card created straight into a done column finishes at ~its own creation instant."""
    board, tokens, _ = scene
    owner = headers(tokens["owner"])
    add_card(client, board, tokens["owner"], "Instant", column=2)
    stats = client.get(f"/api/boards/{board['id']}/analytics", headers=owner).json()
    assert stats["cycle_time_sample"] == 1
    assert stats["cycle_time_hours"] >= 0
