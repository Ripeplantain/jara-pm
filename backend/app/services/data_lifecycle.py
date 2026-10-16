"""Export and deletion operations with explicit tenant and ownership checks."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Activity,
    Board,
    Column,
    Label,
    Note,
    Notification,
    Sprint,
    User,
    Workspace,
    WorkspaceMember,
)
from app.services import permissions
from app.services.errors import Conflict, Forbidden, InvalidRequest, NotFound


def export_workspace(db: Session, user: User, workspace_id: int) -> dict:
    permissions.require_workspace(db, user, workspace_id)
    workspace = db.get(Workspace, workspace_id)
    if workspace is None:
        raise NotFound("Workspace")
    members = list(
        db.scalars(
            select(WorkspaceMember)
            .where(WorkspaceMember.workspace_id == workspace_id)
            .options(selectinload(WorkspaceMember.user))
        )
    )
    boards = list(
        db.scalars(
            select(Board)
            .where(Board.workspace_id == workspace_id)
            .options(selectinload(Board.columns).selectinload(Column.cards))
        )
    )
    labels = list(db.scalars(select(Label).where(Label.workspace_id == workspace_id)))
    # Pages the exporter may read: shared ones, plus their own private ones. Somebody else's
    # private page is not theirs to export, whatever their role in the workspace.
    notes = list(
        db.scalars(
            select(Note)
            .where(
                Note.workspace_id == workspace_id,
                permissions.note_visibility_filter(user),
            )
            .options(selectinload(Note.blocks))
            .order_by(Note.id)
        )
    )
    sprints = list(
        db.scalars(
            select(Sprint).join(Board, Sprint.board_id == Board.id).where(Board.workspace_id == workspace_id)
        )
    )
    activities = list(
        db.scalars(select(Activity).where(Activity.workspace_id == workspace_id).order_by(Activity.id))
    )
    notifications = list(
        db.scalars(select(Notification).where(Notification.workspace_id == workspace_id).order_by(Notification.id))
    )
    return {
        "exported_at": datetime.now(UTC),
        "workspace": {"id": workspace.id, "name": workspace.name, "created_at": workspace.created_at},
        "members": [
            {
                "user_id": member.user_id,
                "email": member.user.email,
                "name": member.user.name,
                "role": member.role,
                "created_at": member.created_at,
            }
            for member in members
        ],
        "boards": [
            {
                "id": board.id,
                "title": board.title,
                "description": board.description,
                "created_by_id": board.created_by_id,
                "created_at": board.created_at,
                "columns": [
                    {
                        "id": column.id,
                        "title": column.title,
                        "position": column.position,
                        "is_done": column.is_done,
                        "cards": [
                            {
                                "id": card.id,
                                "title": card.title,
                                "description": card.description,
                                "position": card.position,
                                "assignee_id": card.assignee_id,
                                "priority": card.priority,
                                "sprint_id": card.sprint_id,
                                "due_date": card.due_date,
                                "estimate": card.estimate,
                                "archived_at": card.archived_at,
                            }
                            for card in column.cards
                        ],
                    }
                    for column in board.columns
                ],
            }
            for board in boards
        ],
        "labels": [
            {"id": label.id, "name": label.name, "color": label.color}
            for label in labels
        ],
        "notes": [
            {
                "id": note.id,
                "parent_id": note.parent_id,
                "title": note.title,
                "icon": note.icon,
                "visibility": note.visibility,
                "owner_id": note.owner_id,
                "position": note.position,
                "created_at": note.created_at,
                "updated_at": note.updated_at,
                "archived_at": note.archived_at,
                "blocks": [
                    {
                        "id": block.id,
                        "type": block.type,
                        "text": block.text,
                        "checked": block.checked,
                        "indent": block.indent,
                        "position": block.position,
                        "ref_card_id": block.ref_card_id,
                        "ref_board_id": block.ref_board_id,
                    }
                    for block in note.blocks
                ],
            }
            for note in notes
        ],
        "sprints": [
            {
                "id": sprint.id,
                "board_id": sprint.board_id,
                "name": sprint.name,
                "goal": sprint.goal,
                "starts_on": sprint.starts_on,
                "ends_on": sprint.ends_on,
                "state": sprint.state,
                "completed_at": sprint.completed_at,
            }
            for sprint in sprints
        ],
        "activities": [
            {
                "id": item.id,
                "board_id": item.board_id,
                "card_id": item.card_id,
                "actor_id": item.actor_id,
                "action": item.action,
                "summary": item.summary,
                "created_at": item.created_at,
            }
            for item in activities
        ],
        "notifications": [
            {
                "id": item.id,
                "user_id": item.user_id,
                "kind": item.kind,
                "title": item.title,
                "body": item.body,
                "board_id": item.board_id,
                "card_id": item.card_id,
                "actor_id": item.actor_id,
                "read_at": item.read_at,
                "created_at": item.created_at,
            }
            for item in notifications
        ],
    }


def delete_workspace(db: Session, user: User, workspace_id: int, confirmation: str) -> None:
    permissions.require_workspace(db, user, workspace_id)
    if confirmation.strip() != "DELETE":
        raise InvalidRequest('Type "DELETE" to confirm workspace deletion')
    workspace = db.get(Workspace, workspace_id)
    if workspace is None:
        raise NotFound("Workspace")
    access = permissions.role_in(db, user, workspace_id)
    if access.value != "owner":
        raise Forbidden("Only an owner can delete a workspace")
    if len(
        list(
            db.scalars(
                select(WorkspaceMember).where(WorkspaceMember.user_id == user.id)
            )
        )
    ) == 1:
        raise Conflict("This is your only workspace; create another one before deleting it")
    db.delete(workspace)
    db.commit()


__all__ = ["delete_workspace", "export_workspace"]
