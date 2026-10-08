"""Sprints: a named time box on one board, and the cards planned into it.

A board has at most one active sprint. Completing a sprint is a single transaction that decides
what happens to the work that did not finish, rather than leaving it half-moved.
"""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Card, Column, Sprint, SprintState, User, WorkspaceRole
from app.services import activity, product_analytics
from app.services.boards import board_for, card_for
from app.services.errors import Conflict, InvalidRequest, NotFound
from app.util.time import now

MEMBER = WorkspaceRole.MEMBER


def _sprint(db: Session, user: User, sprint_id: int, minimum: WorkspaceRole = WorkspaceRole.VIEWER):
    sprint = db.get(Sprint, sprint_id)
    if sprint is None:
        raise NotFound("Sprint")
    try:
        board = board_for(db, user, sprint.board_id, minimum)
    except NotFound:
        raise NotFound("Sprint") from None
    return sprint, board


def list_sprints(db: Session, user: User, board_id: int) -> list[Sprint]:
    board_for(db, user, board_id)
    return list(db.scalars(select(Sprint).where(Sprint.board_id == board_id).order_by(Sprint.id)))


def active_sprint(db: Session, board_id: int) -> Sprint | None:
    return db.scalar(
        select(Sprint).where(
            Sprint.board_id == board_id, Sprint.state == SprintState.ACTIVE.value
        )
    )


def create_sprint(
    db: Session,
    user: User,
    board_id: int,
    name: str,
    goal: str = "",
    starts_on: date | None = None,
    ends_on: date | None = None,
) -> Sprint:
    board = board_for(db, user, board_id, MEMBER)
    if starts_on and ends_on and ends_on < starts_on:
        raise InvalidRequest("A sprint cannot end before it starts")
    sprint = Sprint(
        board_id=board.id, name=name, goal=goal, starts_on=starts_on, ends_on=ends_on
    )
    db.add(sprint)
    db.commit()
    product_analytics.track(db, "sprint_created", user=user, workspace_id=board.workspace_id, properties={"board_id": board.id})
    db.commit()
    return sprint


def update_sprint(
    db: Session,
    user: User,
    sprint_id: int,
    name: str | None = None,
    goal: str | None = None,
    starts_on: date | None = None,
    ends_on: date | None = None,
) -> Sprint:
    sprint, _ = _sprint(db, user, sprint_id, MEMBER)
    if name is not None:
        sprint.name = name
    if goal is not None:
        sprint.goal = goal
    if starts_on is not None:
        sprint.starts_on = starts_on
    if ends_on is not None:
        sprint.ends_on = ends_on
    if sprint.starts_on and sprint.ends_on and sprint.ends_on < sprint.starts_on:
        raise InvalidRequest("A sprint cannot end before it starts")
    db.commit()
    return sprint


def delete_sprint(db: Session, user: User, sprint_id: int) -> None:
    """Cards planned into it fall back to the backlog; nothing is deleted with it."""
    sprint, _ = _sprint(db, user, sprint_id, MEMBER)
    db.delete(sprint)
    db.commit()


def start_sprint(db: Session, user: User, sprint_id: int) -> Sprint:
    sprint, board = _sprint(db, user, sprint_id, MEMBER)
    if sprint.state_enum is SprintState.COMPLETED:
        raise Conflict("That sprint is already finished")
    running = active_sprint(db, sprint.board_id)
    if running is not None and running.id != sprint.id:
        raise Conflict(f"“{running.name}” is still running; complete it first")
    sprint.state = SprintState.ACTIVE.value
    if sprint.starts_on is None:
        sprint.starts_on = now().date()
    activity.record(
        db, user, board.workspace_id, activity.SPRINT_STARTED,
        f"started the sprint “{sprint.name}”", board_id=board.id,
    )
    db.commit()
    return sprint


def complete_sprint(
    db: Session, user: User, sprint_id: int, move_unfinished_to: int | None = None
) -> Sprint:
    """Finish a sprint in one transaction.

    Unfinished cards (anything not in a done column) go to `move_unfinished_to` if given, or
    back to the backlog. They keep their column: what changes is the plan, not the board.
    """
    sprint, board = _sprint(db, user, sprint_id, MEMBER)
    if sprint.state_enum is SprintState.COMPLETED:
        raise Conflict("That sprint is already finished")

    target = None
    if move_unfinished_to is not None:
        target, _ = _sprint(db, user, move_unfinished_to, MEMBER)
        if target.board_id != sprint.board_id:
            raise InvalidRequest("The next sprint must be on the same board")
        if target.id == sprint.id:
            raise InvalidRequest("The next sprint must be a different one")
        if target.state_enum is SprintState.COMPLETED:
            raise InvalidRequest("The next sprint has already finished")

    unfinished = list(
        db.scalars(
            select(Card)
            .join(Column, Card.column_id == Column.id)
            .where(
                Card.sprint_id == sprint.id,
                Card.archived_at.is_(None),
                Column.is_done.is_(False),
            )
        )
    )
    for card in unfinished:
        card.sprint_id = target.id if target else None

    sprint.state = SprintState.COMPLETED.value
    sprint.completed_at = now()
    if sprint.ends_on is None:
        sprint.ends_on = now().date()
    where = f"moved to “{target.name}”" if target else "sent back to the backlog"
    activity.record(
        db, user, board.workspace_id, activity.SPRINT_COMPLETED,
        f"completed the sprint “{sprint.name}” ({len(unfinished)} unfinished {where})",
        board_id=board.id,
    )
    db.commit()
    return sprint


def set_card_sprint(db: Session, user: User, card_id: int, sprint_id: int | None) -> Card:
    """Plan a card into a sprint, or send it back to the backlog with None."""
    card = card_for(db, user, card_id, MEMBER)
    board_id = db.get(Column, card.column_id).board_id
    if sprint_id is not None:
        sprint, _ = _sprint(db, user, sprint_id, MEMBER)
        if sprint.board_id != board_id:
            raise InvalidRequest("That sprint belongs to a different board")
        if sprint.state_enum is SprintState.COMPLETED:
            raise InvalidRequest("That sprint has already finished")
    card.sprint_id = sprint_id
    board = board_for(db, user, board_id)
    activity.record(
        db, user, board.workspace_id, activity.CARD_UPDATED,
        f"planned “{card.title}” into a sprint" if sprint_id else f"moved “{card.title}” to the backlog",
        board_id=board_id, card_id=card.id,
    )
    db.commit()
    return card_for(db, user, card_id)


def sprint_progress(db: Session, user: User, sprint_id: int) -> dict:
    """Counts the board bar shows: how much of the plan is done."""
    sprint, _ = _sprint(db, user, sprint_id)
    rows = list(
        db.scalars(
            select(Card)
            .join(Column, Card.column_id == Column.id)
            .where(Card.sprint_id == sprint.id, Card.archived_at.is_(None))
        )
    )
    done = [c for c in rows if db.get(Column, c.column_id).is_done]
    return {
        "total": len(rows),
        "done": len(done),
        "estimate_total": sum(c.estimate or 0 for c in rows),
        "estimate_done": sum(c.estimate or 0 for c in done),
    }
