"""The activity log.

`record()` is called from inside the mutating service functions, before their commit, so the
change and its history land in the same transaction. Nothing outside the service layer writes
here, and nothing ever updates or deletes a row.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Activity, Board, Card, Column, User
from app.services import permissions

# Machine names. Keep them stable: the UI groups and filters on these.
CARD_CREATED = "card.created"
CARD_UPDATED = "card.updated"
CARD_MOVED = "card.moved"
CARD_ARCHIVED = "card.archived"
CARD_UNARCHIVED = "card.unarchived"
CARD_DELETED = "card.deleted"
CARD_ASSIGNED = "card.assigned"
CARD_COMMENTED = "card.commented"
COLUMN_CREATED = "column.created"
COLUMN_UPDATED = "column.updated"
COLUMN_DELETED = "column.deleted"
BOARD_CREATED = "board.created"
BOARD_UPDATED = "board.updated"
BOARD_DELETED = "board.deleted"
SPRINT_STARTED = "sprint.started"
SPRINT_COMPLETED = "sprint.completed"


def record(
    db: Session,
    user: User | None,
    workspace_id: int,
    action: str,
    summary: str,
    board_id: int | None = None,
    card_id: int | None = None,
) -> Activity:
    """Add one row. The caller commits, so history cannot outlive a rolled-back change."""
    entry = Activity(
        workspace_id=workspace_id,
        board_id=board_id,
        card_id=card_id,
        actor_id=user.id if user else None,
        action=action,
        summary=summary[:500],
        )
    db.add(entry)
    return entry


def workspace_id_of_board(db: Session, board_id: int) -> int | None:
    return db.scalar(select(Board.workspace_id).where(Board.id == board_id))


def board_id_of_card(db: Session, card: Card) -> int | None:
    return db.scalar(select(Column.board_id).where(Column.id == card.column_id))


def for_board(
    db: Session, user: User, board_id: int, limit: int = 50, before_id: int | None = None
) -> list[Activity]:
    """Newest first. Any member of the workspace can read the board's history."""
    access = permissions.require_board(db, user, board_id)
    stmt = (
        select(Activity)
        .where(Activity.workspace_id == access.workspace_id, Activity.board_id == board_id)
        .order_by(Activity.id.desc())
        .limit(min(limit, 200))
    )
    if before_id is not None:
        stmt = stmt.where(Activity.id < before_id)
    return list(db.scalars(stmt))


def for_workspace(
    db: Session,
    user: User,
    workspace_id: int,
    limit: int = 50,
    before_id: int | None = None,
    board_id: int | None = None,
    actor_id: int | None = None,
) -> list[Activity]:
    permissions.require_workspace(db, user, workspace_id)
    stmt = (
        select(Activity)
        .where(Activity.workspace_id == workspace_id)
        .order_by(Activity.id.desc())
        .limit(min(limit, 200))
    )
    if before_id is not None:
        stmt = stmt.where(Activity.id < before_id)
    if board_id is not None:
        stmt = stmt.where(Activity.board_id == board_id)
    if actor_id is not None:
        stmt = stmt.where(Activity.actor_id == actor_id)
    return list(db.scalars(stmt))
