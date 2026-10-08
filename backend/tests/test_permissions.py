"""Role enforcement: membership decides visibility, role decides what you may change.

The checks live in the service layer on purpose, so the HTTP API and the AI tools are gated by
exactly the same code.
"""

import pytest
import sqlalchemy as sa

from app.models import User, WorkspaceMember, WorkspaceRole
from app.services import boards as svc
from app.services import permissions
from app.services.errors import Forbidden, NotFound
from tests.conftest import session_for


@pytest.fixture
def shared(client, register_and_login):
    """An owner's board, plus tokens for a viewer, a member and an outsider in/outside it."""
    tokens = {
        role: register_and_login(f"{role}@example.com")
        for role in ("owner", "viewer", "member", "admin", "outsider")
    }
    board = client.post(
        "/api/boards",
        json={"title": "Shared", "columns": ["Todo"]},
        headers={"Authorization": f"Bearer {tokens['owner']}"},
    ).json()
    with session_for() as db:
        for role in ("viewer", "member", "admin"):
            user = db.scalar(sa.select(User).where(User.email == f"{role}@example.com"))
            db.add(
                WorkspaceMember(
                    workspace_id=board["workspace_id"], user_id=user.id, role=role
                )
            )
        db.commit()
    return board, tokens


def headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_viewer_reads_but_cannot_write(shared, client):
    board, tokens = shared
    column_id = board["columns"][0]["id"]

    assert client.get(f"/api/boards/{board['id']}", headers=headers(tokens["viewer"])).status_code == 200

    forbidden = [
        ("PATCH", f"/api/boards/{board['id']}", {"title": "Nope"}),
        ("POST", f"/api/boards/{board['id']}/columns", {"title": "Nope"}),
        ("PATCH", f"/api/columns/{column_id}", {"title": "Nope"}),
        ("POST", f"/api/columns/{column_id}/cards", {"title": "Nope"}),
        ("DELETE", f"/api/boards/{board['id']}", None),
        ("DELETE", f"/api/columns/{column_id}", None),
    ]
    for method, path, body in forbidden:
        res = client.request(method, path, json=body, headers=headers(tokens["viewer"]))
        assert res.status_code == 403, f"{method} {path} -> {res.status_code}"
        assert "needs" in res.json()["detail"]


def test_member_can_write(shared, client):
    board, tokens = shared
    column_id = board["columns"][0]["id"]
    res = client.post(
        f"/api/columns/{column_id}/cards", json={"title": "Mine"}, headers=headers(tokens["member"])
    )
    assert res.status_code == 201
    assert client.patch(
        f"/api/boards/{board['id']}", json={"title": "Renamed"}, headers=headers(tokens["member"])
    ).status_code == 200


def test_outsider_sees_nothing_at_all(shared, client):
    board, tokens = shared
    column_id = board["columns"][0]["id"]
    out = headers(tokens["outsider"])
    assert client.get(f"/api/boards/{board['id']}", headers=out).status_code == 404
    assert client.get("/api/boards", headers=out).json() == []
    # A workspace they are not in must be indistinguishable from one that does not exist.
    assert client.patch(f"/api/columns/{column_id}", json={"title": "x"}, headers=out).status_code == 404
    assert client.post(f"/api/columns/{column_id}/cards", json={"title": "x"}, headers=out).status_code == 404


def test_card_level_checks_walk_up_to_the_workspace(shared, client):
    board, tokens = shared
    column_id = board["columns"][0]["id"]
    card = client.post(
        f"/api/columns/{column_id}/cards", json={"title": "Card"}, headers=headers(tokens["owner"])
    ).json()

    assert client.patch(
        f"/api/cards/{card['id']}", json={"title": "Edited"}, headers=headers(tokens["viewer"])
    ).status_code == 403
    assert client.patch(
        f"/api/cards/{card['id']}", json={"title": "Edited"}, headers=headers(tokens["outsider"])
    ).status_code == 404
    assert client.delete(f"/api/cards/{card['id']}", headers=headers(tokens["member"])).status_code == 204


def test_missing_resources_report_their_own_kind(shared, client):
    _, tokens = shared
    owner = headers(tokens["owner"])
    assert client.get("/api/boards/9999", headers=owner).json()["detail"] == "Board not found"
    assert client.patch("/api/columns/9999", json={"title": "x"}, headers=owner).json()["detail"] == "Column not found"
    assert client.patch("/api/cards/9999", json={"title": "x"}, headers=owner).json()["detail"] == "Card not found"


def test_require_helpers_are_consistent(shared, client):
    board, _ = shared
    column_id = board["columns"][0]["id"]
    with session_for() as db:
        viewer = db.scalar(sa.select(User).where(User.email == "viewer@example.com"))
        outsider = db.scalar(sa.select(User).where(User.email == "outsider@example.com"))

        access = permissions.require_board(db, viewer, board["id"])
        assert access.role is WorkspaceRole.VIEWER
        assert not access.can_write and not access.can_administer

        with pytest.raises(Forbidden):
            permissions.require_column(db, viewer, column_id, WorkspaceRole.MEMBER)
        with pytest.raises(NotFound):
            permissions.require_board(db, outsider, board["id"])
        with pytest.raises(NotFound):
            permissions.require_board(db, viewer, 9999)
        assert permissions.role_in(db, outsider, board["workspace_id"]) is None


def test_new_boards_cannot_be_created_by_a_viewer(shared, client):
    board, tokens = shared
    res = client.post(
        "/api/boards",
        json={"title": "Nope", "workspace_id": board["workspace_id"]},
        headers=headers(tokens["viewer"]),
    )
    assert res.status_code == 403


def test_service_functions_reject_a_viewer_directly(shared, client):
    """The AI calls these functions, not the HTTP layer, so they must refuse on their own."""
    board, _ = shared
    with session_for() as db:
        viewer = db.scalar(sa.select(User).where(User.email == "viewer@example.com"))
        with pytest.raises(Forbidden):
            svc.update_board(db, viewer, board["id"], "Nope")
        with pytest.raises(Forbidden):
            svc.create_column(db, viewer, board["id"], "Nope")
        with pytest.raises(Forbidden):
            svc.create_card(db, viewer, board["columns"][0]["id"], "Nope")
        assert svc.get_board(db, viewer, board["id"]).title == "Shared"
