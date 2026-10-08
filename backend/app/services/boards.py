"""Board, column and card mutations.

The only code that writes board data; used by the HTTP routers and the AI tools.
Every function takes the acting user and reaches columns and cards through their board and its
workspace, so anything in a workspace the user is not a member of is indistinguishable from a
missing one (NotFound).

Positions are contiguous integers 0..n-1 within a parent (board columns, column cards). Each
mutation renumbers the affected siblings and commits once, so it is atomic and gap-free.
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Board, BoardFavorite, Card, Column, User, WorkspaceMember, WorkspaceRole
from app.models.board import Priority
from app.services import activity, notifications, permissions, product_analytics
from app.services.errors import Conflict, Forbidden, InvalidRequest, NotFound

MEMBER = WorkspaceRole.MEMBER
VIEWER = WorkspaceRole.VIEWER

__all__ = ["Conflict", "Forbidden", "InvalidRequest", "NotFound"]


def _my_workspace_ids(user: User):
    """Subquery of every workspace the user is a member of. The basis of all board scoping."""
    return select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id)


def _fresh(stmt):
    """Reload from the DB: sessions keep expire_on_commit=False, so cached objects and their
    relationship collections would otherwise be stale after a renumber."""
    return stmt.execution_options(populate_existing=True)


# --- scoped lookups -------------------------------------------------------------------------


def _board(db: Session, user: User, board_id: int, minimum: WorkspaceRole = VIEWER) -> Board:
    """Load a board the user may act on. Not a member -> NotFound; role too weak -> Forbidden."""
    board = db.scalar(
        _fresh(
            select(Board).where(
                Board.id == board_id, Board.workspace_id.in_(_my_workspace_ids(user))
            )
        )
    )
    if board is None:
        raise NotFound("Board")
    permissions.require_workspace(db, user, board.workspace_id, minimum)
    return board


def _column(db: Session, user: User, column_id: int, minimum: WorkspaceRole = VIEWER) -> Column:
    column = db.scalar(
        _fresh(
            select(Column)
            .join(Board, Column.board_id == Board.id)
            .where(Column.id == column_id, Board.workspace_id.in_(_my_workspace_ids(user)))
        )
    )
    if column is None:
        raise NotFound("Column")
    _board(db, user, column.board_id, minimum)
    return column


def _card(db: Session, user: User, card_id: int, minimum: WorkspaceRole = VIEWER) -> Card:
    card = db.scalar(
        _fresh(
            select(Card)
            .join(Column, Card.column_id == Column.id)
            .join(Board, Column.board_id == Board.id)
            .where(Card.id == card_id, Board.workspace_id.in_(_my_workspace_ids(user)))
        )
    )
    if card is None:
        raise NotFound("Card")
    _column(db, user, card.column_id, minimum)
    return card


# Sibling services (labels, comments, activity...) need exactly these scoped lookups, so they
# are part of this module's public surface under readable names.
board_for = _board
column_for = _column
card_for = _card


# --- position helpers -----------------------------------------------------------------------


def _renumber(items: list) -> None:
    for i, item in enumerate(items):
        if item.position != i:
            item.position = i


def _insert(siblings: list, item, position: int | None) -> None:
    """Insert item into the ordered sibling list (which must not contain it) and renumber."""
    index = len(siblings) if position is None else min(position, len(siblings))
    siblings.insert(index, item)
    _renumber(siblings)


def _columns_of(db: Session, board_id: int) -> list[Column]:
    return list(
        db.scalars(select(Column).where(Column.board_id == board_id).order_by(Column.position, Column.id))
    )


def _cards_of(db: Session, column_id: int, include_archived: bool = False) -> list[Card]:
    """The ordered, live cards of a column. Archived cards are out of the ordering altogether,
    which is what keeps visible positions contiguous."""
    stmt = select(Card).where(Card.column_id == column_id).order_by(Card.position, Card.id)
    if not include_archived:
        stmt = stmt.where(Card.archived_at.is_(None))
    return list(db.scalars(stmt))


# --- card field helpers ---------------------------------------------------------------------

UNSET: Any = object()
"""Sentinel for "leave this field alone", so None can mean "clear it"."""


def _check_assignee(db: Session, board: Board, assignee_id: int | None) -> int | None:
    """A card can only be assigned to someone who can actually open it."""
    if assignee_id is None:
        return None
    member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == board.workspace_id,
            WorkspaceMember.user_id == assignee_id,
        )
    )
    if member is None:
        raise InvalidRequest("That person is not a member of this workspace")
    return assignee_id


def _sync_completion(db: Session, card: Card) -> None:
    """`completed_at` follows the column: set on arrival in a done column, cleared on the way
    out. It is never written directly, so cycle time cannot be faked by a field edit."""
    column = db.get(Column, card.column_id)
    if column is not None and column.is_done:
        if card.completed_at is None:
            card.completed_at = datetime.now(UTC)
    else:
        card.completed_at = None


# --- boards ---------------------------------------------------------------------------------


def list_boards(db: Session, user: User, workspace_id: int | None = None) -> list[Board]:
    """Every board the user can reach, optionally narrowed to one workspace."""
    stmt = select(Board).where(Board.workspace_id.in_(_my_workspace_ids(user)))
    if workspace_id is not None:
        stmt = stmt.where(Board.workspace_id == workspace_id)
    return list(db.scalars(stmt.order_by(Board.id)))


def favorite_board_ids(db: Session, user: User) -> set[int]:
    return set(
        db.scalars(select(BoardFavorite.board_id).where(BoardFavorite.user_id == user.id))
    )


def set_favorite(db: Session, user: User, board_id: int, favorite: bool) -> bool:
    """Personal and idempotent: favouriting twice is the same as once."""
    _board(db, user, board_id)  # visible to me, and only then
    existing = db.scalar(
        select(BoardFavorite).where(
            BoardFavorite.user_id == user.id, BoardFavorite.board_id == board_id
        )
    )
    if favorite and existing is None:
        db.add(BoardFavorite(user_id=user.id, board_id=board_id))
    elif not favorite and existing is not None:
        db.delete(existing)
    db.commit()
    return favorite


def default_workspace_id(db: Session, user: User) -> int:
    """The workspace a board lands in when the caller does not name one: the oldest they belong
    to, which for a fresh account is the personal workspace made at registration."""
    workspace_id = db.scalar(
        select(WorkspaceMember.workspace_id)
        .where(WorkspaceMember.user_id == user.id)
        .order_by(WorkspaceMember.workspace_id)
        .limit(1)
    )
    if workspace_id is None:
        raise NotFound("Workspace")
    return workspace_id


def _resolve_workspace(db: Session, user: User, workspace_id: int | None) -> int:
    """Where a new board goes, and whether this user may put one there."""
    if workspace_id is None:
        workspace_id = default_workspace_id(db, user)
    permissions.require_workspace(db, user, workspace_id, MEMBER)
    return workspace_id


def get_board(db: Session, user: User, board_id: int, include_archived: bool = False) -> Board:
    cards = Column.cards if include_archived else Column.cards.and_(Card.archived_at.is_(None))
    board = db.scalar(
        _fresh(
            select(Board)
            .where(Board.id == board_id, Board.workspace_id.in_(_my_workspace_ids(user)))
            .options(selectinload(Board.columns).selectinload(cards))
        )
    )
    if board is None:
        raise NotFound("Board")
    return board


def create_board(
    db: Session,
    user: User,
    title: str,
    columns: list[str] | None = None,
    workspace_id: int | None = None,
    description: str = "",
) -> Board:
    board = Board(
        workspace_id=_resolve_workspace(db, user, workspace_id),
        created_by_id=user.id,
        title=title,
        description=description,
    )
    board.columns = [Column(title=t, position=i) for i, t in enumerate(columns or [])]
    db.add(board)
    db.flush()
    activity.record(
        db, user, board.workspace_id, activity.BOARD_CREATED,
        f"created the board “{board.title}”", board_id=board.id,
    )
    product_analytics.track(db, "board_created", user=user, workspace_id=board.workspace_id, properties={"board_id": board.id})
    db.commit()
    return get_board(db, user, board.id)


def create_board_with_cards(
    db: Session,
    user: User,
    title: str,
    columns: list[tuple[str, list[str]]],
    workspace_id: int | None = None,
) -> Board:
    """Create a board with columns and starter cards in one transaction."""
    board = Board(
        workspace_id=_resolve_workspace(db, user, workspace_id),
        created_by_id=user.id,
        title=title,
    )
    board.columns = [
        Column(
            title=col_title,
            position=i,
            cards=[Card(title=t, position=j, created_by_id=user.id) for j, t in enumerate(cards)],
        )
        for i, (col_title, cards) in enumerate(columns)
    ]
    db.add(board)
    db.flush()
    activity.record(
        db, user, board.workspace_id, activity.BOARD_CREATED,
        f"created the board “{board.title}”", board_id=board.id,
    )
    product_analytics.track(db, "board_created", user=user, workspace_id=board.workspace_id, properties={"board_id": board.id})
    db.commit()
    return get_board(db, user, board.id)


def update_board(
    db: Session, user: User, board_id: int, title: str | None = None, description: str | None = None
) -> Board:
    board = _board(db, user, board_id, MEMBER)
    was = board.title
    if title is not None:
        board.title = title
    if description is not None:
        board.description = description
    what = f"renamed the board “{was}” to “{board.title}”" if title and title != was else f"updated the board “{board.title}”"
    activity.record(db, user, board.workspace_id, activity.BOARD_UPDATED, what, board_id=board.id)
    db.commit()
    return get_board(db, user, board_id)


def delete_board(db: Session, user: User, board_id: int) -> None:
    board = _board(db, user, board_id, MEMBER)
    activity.record(
        db, user, board.workspace_id, activity.BOARD_DELETED,
        f"deleted the board “{board.title}”",
    )
    db.delete(board)
    db.commit()


# --- columns --------------------------------------------------------------------------------


def create_column(db: Session, user: User, board_id: int, title: str, position: int | None = None) -> Column:
    board = _board(db, user, board_id, MEMBER)
    column = Column(board_id=board.id, title=title, position=0)
    siblings = _columns_of(db, board.id)
    db.add(column)
    _insert(siblings, column, position)
    activity.record(
        db, user, board.workspace_id, activity.COLUMN_CREATED,
        f"added the column “{title}”", board_id=board.id,
    )
    db.commit()
    return _column(db, user, column.id)


def update_column(
    db: Session,
    user: User,
    column_id: int,
    title: str | None = None,
    position: int | None = None,
    wip_limit: int | None = UNSET,
    is_done: bool | None = None,
) -> Column:
    column = _column(db, user, column_id, MEMBER)
    was = column.title
    if title is not None:
        column.title = title
    if wip_limit is not UNSET:
        if wip_limit is not None and wip_limit < 1:
            raise InvalidRequest("A WIP limit must be at least 1, or null for no limit")
        column.wip_limit = wip_limit
    if is_done is not None:
        column.is_done = is_done
        for card in _cards_of(db, column.id):
            _sync_completion(db, card)
    if position is not None:
        siblings = [c for c in _columns_of(db, column.board_id) if c.id != column.id]
        _insert(siblings, column, position)
    board = _board(db, user, column.board_id)
    what = (
        f"renamed the column “{was}” to “{column.title}”"
        if title and title != was
        else f"moved the column “{column.title}”"
    )
    activity.record(db, user, board.workspace_id, activity.COLUMN_UPDATED, what, board_id=board.id)
    db.commit()
    return _column(db, user, column_id)


def delete_column(
    db: Session,
    user: User,
    column_id: int,
    move_cards_to: int | None = None,
    delete_cards: bool = False,
) -> None:
    """Delete a column. A column with cards needs move_cards_to (same board) or delete_cards."""
    column = _column(db, user, column_id, MEMBER)
    if move_cards_to is not None and delete_cards:
        raise InvalidRequest("Use either move_cards_to or delete_cards, not both")
    cards = _cards_of(db, column.id)
    if cards and move_cards_to is None and not delete_cards:
        raise Conflict("Column has cards: move them to another column or confirm deleting them")
    if cards and move_cards_to is not None:
        target = _column(db, user, move_cards_to, MEMBER)
        if target.board_id != column.board_id:
            raise InvalidRequest("Target column must be on the same board")
        if target.id == column.id:
            raise InvalidRequest("Target column must differ from the deleted column")
        _insert_many(db, _cards_of(db, target.id), cards, target)
        db.flush()
        db.expire(column, ["cards"])  # cascade must not see the moved cards
    remaining = [c for c in _columns_of(db, column.board_id) if c.id != column.id]
    board = _board(db, user, column.board_id)
    activity.record(
        db, user, board.workspace_id, activity.COLUMN_DELETED,
        f"deleted the column “{column.title}”", board_id=board.id,
    )
    db.delete(column)
    _renumber(remaining)
    db.commit()


def _insert_many(db: Session, existing: list[Card], moving: list[Card], target: Column) -> None:
    for card in moving:
        card.column_id = target.id
        card.position = len(existing)
        existing.append(card)
        _sync_completion(db, card)


# --- cards ----------------------------------------------------------------------------------


def create_card(
    db: Session,
    user: User,
    column_id: int,
    title: str,
    description: str = "",
    position: int | None = None,
    assignee_id: int | None = None,
    priority: Priority = Priority.NONE,
    due_date: datetime | None = None,
    estimate: int | None = None,
) -> Card:
    column = _column(db, user, column_id, MEMBER)
    board = _board(db, user, column.board_id)
    card = Card(
        column_id=column.id,
        title=title,
        description=description,
        position=0,
        created_by_id=user.id,
        assignee_id=_check_assignee(db, board, assignee_id),
        priority=Priority(priority).value,
        due_date=due_date,
        estimate=estimate,
    )
    siblings = _cards_of(db, column.id)
    db.add(card)
    _insert(siblings, card, position)
    _sync_completion(db, card)
    db.flush()
    activity.record(
        db, user, board.workspace_id, activity.CARD_CREATED,
        f"added “{title}” to {column.title}", board_id=board.id, card_id=card.id,
    )
    notifications.notify(
        db, card.assignee_id, user, board.workspace_id, notifications.ASSIGNED,
        f"{user.name} assigned you “{card.title}”", board.title,
        board_id=board.id, card_id=card.id,
    )
    product_analytics.track(db, "card_created", user=user, workspace_id=board.workspace_id, properties={"board_id": board.id})
    db.commit()
    return _card(db, user, card.id)


def update_card(
    db: Session,
    user: User,
    card_id: int,
    title: str | None = None,
    description: str | None = None,
    assignee_id: int | None = UNSET,
    priority: Priority | None = None,
    due_date: datetime | None = UNSET,
    estimate: int | None = UNSET,
) -> Card:
    """Fields left out keep their value; `assignee_id`, `due_date` and `estimate` passed as None
    are cleared, which is why they default to a sentinel rather than to None."""
    card = _card(db, user, card_id, MEMBER)
    previous_assignee = card.assignee_id
    if title is not None:
        card.title = title
    if description is not None:
        card.description = description
    if assignee_id is not UNSET:
        board = _board(db, user, db.get(Column, card.column_id).board_id)
        card.assignee_id = _check_assignee(db, board, assignee_id)
    if priority is not None:
        card.priority = Priority(priority).value
    if due_date is not UNSET:
        card.due_date = due_date
    if estimate is not UNSET:
        if estimate is not None and estimate < 0:
            raise InvalidRequest("Estimate cannot be negative")
        card.estimate = estimate

    board = _board(db, user, db.get(Column, card.column_id).board_id)
    if assignee_id is not UNSET and card.assignee_id != previous_assignee:
        who = db.get(User, card.assignee_id).name if card.assignee_id else "nobody"
        activity.record(
            db, user, board.workspace_id, activity.CARD_ASSIGNED,
            f"assigned “{card.title}” to {who}", board_id=board.id, card_id=card.id,
        )
        notifications.notify(
            db, card.assignee_id, user, board.workspace_id, notifications.ASSIGNED,
            f"{user.name} assigned you “{card.title}”", board.title,
            board_id=board.id, card_id=card.id,
        )
    else:
        activity.record(
            db, user, board.workspace_id, activity.CARD_UPDATED,
            f"updated “{card.title}”", board_id=board.id, card_id=card.id,
        )
    db.commit()
    return _card(db, user, card_id)


def move_card(db: Session, user: User, card_id: int, column_id: int, position: int | None = None) -> Card:
    """Move a card within its column or to another column on the same board."""
    card = _card(db, user, card_id, MEMBER)
    source = _column(db, user, card.column_id)
    target = _column(db, user, column_id, MEMBER)
    if target.board_id != source.board_id:
        raise InvalidRequest("Target column must be on the same board")
    if target.id == source.id:
        siblings = [c for c in _cards_of(db, source.id) if c.id != card.id]
        _insert(siblings, card, position)
    else:
        _renumber([c for c in _cards_of(db, source.id) if c.id != card.id])  # close the gap
        card.column_id = target.id
        # autoflush may already list the card under the target, so exclude it explicitly
        _insert([c for c in _cards_of(db, target.id) if c.id != card.id], card, position)
    _sync_completion(db, card)
    board = _board(db, user, target.board_id)
    what = (
        f"moved “{card.title}” to {target.title}"
        if target.id != source.id
        else f"reordered “{card.title}” in {target.title}"
    )
    activity.record(
        db, user, board.workspace_id, activity.CARD_MOVED, what, board_id=board.id, card_id=card.id
    )
    if target.is_done and card.assignee_id is not None:
        notifications.notify(
            db, card.assignee_id, user, board.workspace_id, notifications.COMPLETED,
            f"{user.name} moved “{card.title}” to {target.title}", board.title,
            board_id=board.id, card_id=card.id,
        )
    db.commit()
    return _card(db, user, card_id)


def archive_card(db: Session, user: User, card_id: int) -> Card:
    """The everyday way to take a card off the board: reversible, and it keeps the history."""
    card = _card(db, user, card_id, MEMBER)
    if card.archived_at is not None:
        return card
    remaining = [c for c in _cards_of(db, card.column_id) if c.id != card.id]
    card.archived_at = datetime.now(UTC)
    _renumber(remaining)
    board = _board(db, user, db.get(Column, card.column_id).board_id)
    activity.record(
        db, user, board.workspace_id, activity.CARD_ARCHIVED,
        f"archived “{card.title}”", board_id=board.id, card_id=card.id,
    )
    db.commit()
    return _card(db, user, card_id)


def unarchive_card(db: Session, user: User, card_id: int) -> Card:
    """Comes back at the end of its column, because its old slot is long gone."""
    card = _card(db, user, card_id, MEMBER)
    if card.archived_at is None:
        return card
    card.archived_at = None
    siblings = [c for c in _cards_of(db, card.column_id) if c.id != card.id]
    _insert(siblings, card, None)
    board = _board(db, user, db.get(Column, card.column_id).board_id)
    activity.record(
        db, user, board.workspace_id, activity.CARD_UNARCHIVED,
        f"restored “{card.title}”", board_id=board.id, card_id=card.id,
    )
    db.commit()
    return _card(db, user, card_id)


def list_archived_cards(db: Session, user: User, board_id: int) -> list[Card]:
    _board(db, user, board_id)
    return list(
        db.scalars(
            select(Card)
            .join(Column, Card.column_id == Column.id)
            .where(Column.board_id == board_id, Card.archived_at.is_not(None))
            .order_by(Card.archived_at.desc())
        )
    )


def delete_card(db: Session, user: User, card_id: int) -> None:
    card = _card(db, user, card_id, MEMBER)
    remaining = [c for c in _cards_of(db, card.column_id) if c.id != card.id]
    board = _board(db, user, db.get(Column, card.column_id).board_id)
    activity.record(
        db, user, board.workspace_id, activity.CARD_DELETED,
        f"deleted “{card.title}”", board_id=board.id,
    )
    db.delete(card)
    _renumber(remaining)
    db.commit()
