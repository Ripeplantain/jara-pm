"""Workspaces: personal workspace on registration, membership, and the 0002 backfill."""

import sqlalchemy as sa
from alembic import command
from alembic.config import Config

from app.db import get_engine
from app.models import User, Workspace, WorkspaceMember, WorkspaceRole
from app.services import workspaces as svc
from tests.conftest import session_for


def test_role_ranking():
    assert WorkspaceRole.OWNER.at_least(WorkspaceRole.ADMIN)
    assert WorkspaceRole.ADMIN.at_least(WorkspaceRole.MEMBER)
    assert WorkspaceRole.MEMBER.at_least(WorkspaceRole.VIEWER)
    assert not WorkspaceRole.VIEWER.at_least(WorkspaceRole.MEMBER)
    assert WorkspaceRole.MEMBER.at_least(WorkspaceRole.MEMBER)


def test_registration_creates_an_owned_personal_workspace(client):
    client.post("/api/auth/register", json={"email": "Ada@Example.com", "password": "correct-horse"})
    with session_for() as db:
        user = db.scalar(sa.select(User).where(User.email == "ada@example.com"))
        members = list(db.scalars(sa.select(WorkspaceMember).where(WorkspaceMember.user_id == user.id)))
        assert len(members) == 1
        assert members[0].role_enum is WorkspaceRole.OWNER
        workspace = db.get(Workspace, members[0].workspace_id)
        assert workspace.name == "ada's workspace"
        assert workspace.created_by_id == user.id


def test_failed_registration_leaves_no_orphan_workspace(client):
    body = {"email": "dup@example.com", "password": "correct-horse"}
    assert client.post("/api/auth/register", json=body).status_code == 201
    assert client.post("/api/auth/register", json=body).status_code == 409
    with session_for() as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(Workspace)) == 1


def test_list_workspaces_only_returns_mine(client):
    client.post("/api/auth/register", json={"email": "a@example.com", "password": "correct-horse"})
    client.post("/api/auth/register", json={"email": "b@example.com", "password": "correct-horse"})
    with session_for() as db:
        a = db.scalar(sa.select(User).where(User.email == "a@example.com"))
        b = db.scalar(sa.select(User).where(User.email == "b@example.com"))
        assert [w.name for w in svc.list_workspaces(db, a)] == ["a's workspace"]
        assert [w.name for w in svc.list_workspaces(db, b)] == ["b's workspace"]
        assert svc.membership(db, a, svc.list_workspaces(db, b)[0].id) is None
        assert svc.count_owners(db, svc.list_workspaces(db, a)[0].id) == 1


def test_personal_workspace_name_handles_odd_emails():
    assert svc.personal_workspace_name("sam@example.com") == "sam's workspace"
    assert svc.personal_workspace_name("") == "Personal workspace"


def test_migration_0002_backfills_existing_users(tmp_path, monkeypatch):
    """A database at 0001 with real rows must come out of 0002 fully reachable."""
    db_path = tmp_path / "legacy.db"
    monkeypatch.setenv("DATABASE_PATH", str(db_path))
    get_engine.cache_clear()
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "0001")  # fresh file: the autouse fixture's database is a different one

    engine = get_engine()
    with engine.begin() as conn:
        for email in ("legacy1@example.com", "legacy2@example.com"):
            conn.execute(
                sa.text(
                    "INSERT INTO users (email, password_hash, created_at) "
                    "VALUES (:e, 'x', CURRENT_TIMESTAMP)"
                ),
                {"e": email},
            )
        conn.execute(
            sa.text("INSERT INTO boards (owner_id, title, created_at) VALUES (1, 'Old', CURRENT_TIMESTAMP)")
        )

    command.upgrade(cfg, "0002")

    with engine.begin() as conn:
        rows = conn.execute(
            sa.text(
                "SELECT w.name, m.user_id, m.role FROM workspaces w "
                "JOIN workspace_members m ON m.workspace_id = w.id ORDER BY m.user_id"
            )
        ).fetchall()
    assert rows == [("legacy1's workspace", 1, "owner"), ("legacy2's workspace", 2, "owner")]


# --- boards live in workspaces (6.2) --------------------------------------------------------


def test_new_board_lands_in_the_personal_workspace(client, register_and_login):
    token = register_and_login()
    res = client.post(
        "/api/boards", json={"title": "Roadmap"}, headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 201
    body = res.json()
    with session_for() as db:
        user = db.scalar(sa.select(User).where(User.email == "a@example.com"))
        workspace = svc.list_workspaces(db, user)[0]
    assert body["workspace_id"] == workspace.id
    assert body["created_by_id"] is not None
    assert body["description"] == ""


def test_every_workspace_member_sees_the_board(client, register_and_login):
    owner_token = register_and_login("owner@example.com")
    mate_token = register_and_login("mate@example.com")
    board = client.post(
        "/api/boards", json={"title": "Shared"}, headers={"Authorization": f"Bearer {owner_token}"}
    ).json()

    mate_headers = {"Authorization": f"Bearer {mate_token}"}
    assert client.get(f"/api/boards/{board['id']}", headers=mate_headers).status_code == 404

    with session_for() as db:  # 6.5 adds the endpoint; the model is what matters here
        mate = db.scalar(sa.select(User).where(User.email == "mate@example.com"))
        db.add(
            WorkspaceMember(
                workspace_id=board["workspace_id"],
                user_id=mate.id,
                role=WorkspaceRole.MEMBER.value,
            )
        )
        db.commit()

    assert client.get(f"/api/boards/{board['id']}", headers=mate_headers).status_code == 200
    assert [b["id"] for b in client.get("/api/boards", headers=mate_headers).json()] == [board["id"]]


def test_board_list_can_be_narrowed_to_one_workspace(client, register_and_login):
    token = register_and_login()
    headers = {"Authorization": f"Bearer {token}"}
    first = client.post("/api/boards", json={"title": "A"}, headers=headers).json()
    with session_for() as db:
        user = db.scalar(sa.select(User).where(User.email == "a@example.com"))
        second = svc.create_workspace(db, user, "Side project")
        second_id = second.id
    other = client.post(
        "/api/boards", json={"title": "B", "workspace_id": second_id}, headers=headers
    ).json()

    assert {b["id"] for b in client.get("/api/boards", headers=headers).json()} == {
        first["id"],
        other["id"],
    }
    narrowed = client.get(f"/api/boards?workspace_id={second_id}", headers=headers).json()
    assert [b["id"] for b in narrowed] == [other["id"]]


def test_cannot_create_a_board_in_a_workspace_you_are_not_in(client, register_and_login):
    outsider = register_and_login("outsider@example.com")
    owner = register_and_login("owner2@example.com")
    with session_for() as db:
        user = db.scalar(sa.select(User).where(User.email == "owner2@example.com"))
        private_id = svc.list_workspaces(db, user)[0].id
    assert owner  # the owner exists; the outsider must not be able to reach their workspace
    res = client.post(
        "/api/boards",
        json={"title": "Sneaky", "workspace_id": private_id},
        headers={"Authorization": f"Bearer {outsider}"},
    )
    assert res.status_code == 404


def test_migration_0003_keeps_columns_and_cards(tmp_path, monkeypatch):
    """Regression: rebuilding `boards` must not cascade-delete its columns and cards."""
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "legacy3.db"))
    get_engine.cache_clear()
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "0002")

    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO users (email, password_hash, created_at) "
                "VALUES ('old@example.com', 'x', CURRENT_TIMESTAMP)"
            )
        )
        conn.execute(
            sa.text(
                "INSERT INTO workspaces (name, created_by_id, created_at) "
                "VALUES ('old workspace', 1, CURRENT_TIMESTAMP)"
            )
        )
        conn.execute(
            sa.text(
                "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) "
                "VALUES (1, 1, 'owner', CURRENT_TIMESTAMP)"
            )
        )
        conn.execute(
            sa.text(
                "INSERT INTO boards (owner_id, title, created_at) "
                "VALUES (1, 'Legacy board', CURRENT_TIMESTAMP)"
            )
        )
        conn.execute(sa.text("INSERT INTO columns (board_id, title, position) VALUES (1, 'Todo', 0)"))
        conn.execute(
            sa.text(
                "INSERT INTO cards (column_id, title, description, position, created_at) "
                "VALUES (1, 'Legacy card', '', 0, CURRENT_TIMESTAMP)"
            )
        )

    command.upgrade(cfg, "0003")

    with engine.begin() as conn:
        assert conn.execute(
            sa.text("SELECT id, workspace_id, created_by_id, title FROM boards")
        ).fetchall() == [(1, 1, 1, "Legacy board")]
        assert conn.execute(sa.text("SELECT title FROM columns")).fetchall() == [("Todo",)]
        assert conn.execute(sa.text("SELECT title FROM cards")).fetchall() == [("Legacy card",)]
