"""Filtering cards on a board, and searching across a workspace.

SQL `LIKE` over title and description. SQLite has FTS5, but a board's worth of cards is small
and an FTS table is another thing to keep in step with writes; this stays correct and simple
until the numbers say otherwise.
"""

from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Board,
    Card,
    CardLabel,
    Column,
    Goal,
    GoalState,
    Note,
    NoteBlock,
    Priority,
    User,
)
from app.services import permissions
from app.services.boards import _my_workspace_ids, board_for


def _like(term: str) -> str:
    """Escape the wildcards, so searching for "50%" does not match everything."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _text_filter(stmt, q: str | None):
    if not q:
        return stmt
    pattern = _like(q.strip())
    return stmt.where(
        or_(Card.title.like(pattern, escape="\\"), Card.description.like(pattern, escape="\\"))
    )


def filter_cards(
    db: Session,
    user: User,
    board_id: int,
    q: str | None = None,
    assignee_id: int | None = None,
    label_id: int | None = None,
    priority: Priority | None = None,
    due_before: datetime | None = None,
    sprint_id: int | None = None,
    archived: bool = False,
    limit: int = 200,
) -> list[Card]:
    """Every filter is an AND. `archived` picks which side of the board you are looking at."""
    board_for(db, user, board_id)
    stmt = (
        select(Card)
        .join(Column, Card.column_id == Column.id)
        .where(Column.board_id == board_id)
        .order_by(Column.position, Card.position, Card.id)
        .limit(min(limit, 500))
    )
    stmt = stmt.where(Card.archived_at.is_not(None) if archived else Card.archived_at.is_(None))
    stmt = _text_filter(stmt, q)
    if assignee_id is not None:
        stmt = stmt.where(Card.assignee_id == assignee_id)
    if label_id is not None:
        stmt = stmt.where(
            Card.id.in_(select(CardLabel.card_id).where(CardLabel.label_id == label_id))
        )
    if priority is not None:
        stmt = stmt.where(Card.priority == Priority(priority).value)
    if due_before is not None:
        stmt = stmt.where(Card.due_date.is_not(None), Card.due_date <= due_before)
    if sprint_id is not None:
        stmt = stmt.where(Card.sprint_id == sprint_id)
    return list(db.scalars(stmt))


def search_workspace(
    db: Session, user: User, workspace_id: int, q: str, limit: int = 50
) -> list[Card]:
    """Cards across every board in one workspace. Archived cards stay out of search."""
    permissions.require_workspace(db, user, workspace_id)
    if not q.strip():
        return []
    stmt = (
        select(Card)
        .join(Column, Card.column_id == Column.id)
        .join(Board, Column.board_id == Board.id)
        .where(Board.workspace_id == workspace_id, Card.archived_at.is_(None))
        .order_by(Card.updated_at.desc())
        .limit(min(limit, 200))
    )
    return list(db.scalars(_text_filter(stmt, q)))


def my_cards(db: Session, user: User, workspace_id: int | None = None) -> list[Card]:
    """Everything assigned to me that is still open, across every workspace I belong to."""
    stmt = (
        select(Card)
        .join(Column, Card.column_id == Column.id)
        .join(Board, Column.board_id == Board.id)
        .where(
            Card.assignee_id == user.id,
            Card.archived_at.is_(None),
            Card.completed_at.is_(None),
            Board.workspace_id.in_(_my_workspace_ids(user)),
        )
        .order_by(Card.due_date.is_(None), Card.due_date, Card.id)
    )
    if workspace_id is not None:
        permissions.require_workspace(db, user, workspace_id)
        stmt = stmt.where(Board.workspace_id == workspace_id)
    return list(db.scalars(stmt))


# --- notes ------------------------------------------------------------------------------------


def search_notes(db: Session, user: User, workspace_id: int, q: str, limit: int = 50) -> list[Note]:
    """Pages whose title or body matches, most recently edited first.

    Someone else's private page is not filtered out of the results afterwards - the query never
    selects it, because it composes `permissions.note_visibility_filter`, the same expression
    every other note read uses.
    """
    permissions.require_workspace(db, user, workspace_id)
    if not q.strip():
        return []
    pattern = _like(q.strip())
    return list(
        db.scalars(
            select(Note)
            .options(selectinload(Note.blocks))
            .where(
                Note.workspace_id == workspace_id,
                Note.archived_at.is_(None),
                permissions.note_visibility_filter(user),
                or_(
                    Note.title.like(pattern, escape="\\"),
                    Note.id.in_(
                        select(NoteBlock.note_id).where(
                            NoteBlock.text.like(pattern, escape="\\")
                        )
                    ),
                ),
            )
            .order_by(Note.updated_at.desc(), Note.id)
            .limit(min(limit, 200))
        )
    )


def note_excerpt(note: Note, q: str, width: int = 160) -> str:
    """A readable window around the first match, so a result row shows why it matched."""
    term = q.strip().lower()
    if not term:
        return ""
    for text in [note.title, *(block.text for block in note.blocks)]:
        at = text.lower().find(term)
        if at < 0:
            continue
        start = max(at - width // 3, 0)
        end = start + width
        return f"{'…' if start else ''}{text[start:end].strip()}{'…' if end < len(text) else ''}"
    return ""


# --- goals ------------------------------------------------------------------------------------


def search_goals(db: Session, user: User, workspace_id: int, q: str, limit: int = 50) -> list[Goal]:
    """Goals whose title or detail matches, soonest target first.

    A goal is workspace-visible, so there is no visibility filter here - membership, checked
    once by `require_workspace`, is the whole rule. Archived goals stay out of search, the way
    archived cards do. Progress is deliberately not computed for a search hit: the rollup reads
    the board, and a result row only needs somewhere to go.
    """
    permissions.require_workspace(db, user, workspace_id)
    if not q.strip():
        return []
    pattern = _like(q.strip())
    return list(
        db.scalars(
            select(Goal)
            .where(
                Goal.workspace_id == workspace_id,
                Goal.state != GoalState.ARCHIVED.value,
                or_(
                    Goal.title.like(pattern, escape="\\"),
                    Goal.detail.like(pattern, escape="\\"),
                ),
            )
            .order_by(Goal.target_date.is_(None), Goal.target_date, Goal.id)
            .limit(min(limit, 200))
        )
    )
