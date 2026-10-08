"""The demo seed.

It is the fastest way to see the app with data in it, so it is worth a test: a seed that has
quietly stopped working is worse than none, and because it goes through the service layer it
also exercises most of the app in one run.
"""

import sqlalchemy as sa

from app.models import Activity, Board, Card, Notification, Sprint, User, Workspace
from app.seed import DANA, SAM, seed
from tests.conftest import session_for


def test_seed_builds_a_workspace_you_can_actually_use(client):
    with session_for() as db:
        seed(db)

    with session_for() as db:
        workspace = db.scalar(sa.select(Workspace).where(Workspace.name == "Orchid (demo)"))
        assert workspace is not None
        assert {m.user.email: m.role for m in workspace.members} == {
            DANA: "owner",
            SAM: "member",
        }
        boards = list(db.scalars(sa.select(Board).where(Board.workspace_id == workspace.id)))
        assert sorted(b.title for b in boards) == ["Bug triage", "Orchid roadmap"]

        sprint = db.scalar(sa.select(Sprint))
        assert sprint.state == "active"
        assert db.scalar(sa.select(sa.func.count()).select_from(Card).where(Card.sprint_id == sprint.id)) == 3

        # The insights page needs each of these to have something to show.
        assert db.scalar(sa.select(sa.func.count()).select_from(Card).where(Card.completed_at.is_not(None))) >= 1
        assert db.scalar(sa.select(sa.func.count()).select_from(Card).where(Card.due_date.is_not(None))) >= 3
        assert db.scalar(sa.select(sa.func.count()).select_from(Card).where(Card.assignee_id.is_not(None))) >= 3

        # History and notifications come from the real code path, not a backfill.
        assert db.scalar(sa.select(sa.func.count()).select_from(Activity)) > 10
        kinds = set(db.scalars(sa.select(Notification.kind)))
        assert {"card.assigned", "card.mentioned"} <= kinds


def test_seeded_accounts_can_sign_in_and_see_the_boards(client):
    with session_for() as db:
        seed(db)

    token = client.post(
        "/api/auth/login", json={"email": SAM, "password": "demo-password"}
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    boards = client.get("/api/boards", headers=headers).json()
    assert sorted(b["title"] for b in boards) == ["Bug triage", "Orchid roadmap"]

    roadmap = next(b for b in boards if b["title"] == "Orchid roadmap")
    stats = client.get(f"/api/boards/{roadmap['id']}/analytics", headers=headers).json()
    assert stats["overdue"] >= 1
    assert stats["cycle_time_sample"] >= 1
    assert any(w["open_cards"] > 0 for w in stats["workload"])

    mine = client.get("/api/my-cards", headers=headers).json()
    assert "Rewrite the onboarding flow" in [c["title"] for c in mine]


def test_seeding_twice_changes_nothing(client, capsys):
    with session_for() as db:
        seed(db)
    with session_for() as db:
        before = db.scalar(sa.select(sa.func.count()).select_from(Card))
        seed(db)
        assert "already exist" in capsys.readouterr().out
        assert db.scalar(sa.select(sa.func.count()).select_from(Card)) == before
        assert db.scalar(sa.select(sa.func.count()).select_from(User)) == 2
