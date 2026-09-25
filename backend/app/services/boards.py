"""Board, column and card mutations.

The only code that writes board data; used by the HTTP routers and the AI tools.
Every function takes the acting user and reaches columns and cards through their board and its
workspace, so anything in a workspace the user is not a member of is indistinguishable from a
missing one (NotFound).

Positions are contiguous integers 0..n-1 within a parent (board columns, column cards). Each
mutation renumbers the affected siblings and commits once, so it is atomic and gap-free.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Board, Card, Column, User, WorkspaceMember, WorkspaceRole
from app.services import permissions
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


def _cards_of(db: Session, column_id: int) -> list[Card]:
    return list(db.scalars(select(Card).where(Card.column_id == column_id).order_by(Card.position, Card.id)))


# --- boards ---------------------------------------------------------------------------------


def list_boards(db: Session, user: User, workspace_id: int | None = None) -> list[Board]:
    """Every board the user can reach, optionally narrowed to one workspace."""
    stmt = select(Board).where(Board.workspace_id.in_(_my_workspace_ids(user)))
    if workspace_id is not None:
        stmt = stmt.where(Board.workspace_id == workspace_id)
    return list(db.scalars(stmt.order_by(Board.id)))


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


def get_board(db: Session, user: User, board_id: int) -> Board:
    board = db.scalar(
        _fresh(
            select(Board)
            .where(Board.id == board_id, Board.workspace_id.in_(_my_workspace_ids(user)))
            .options(selectinload(Board.columns).selectinload(Column.cards))
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
        Column(title=col_title, position=i, cards=[Card(title=t, position=j) for j, t in enumerate(cards)])
        for i, (col_title, cards) in enumerate(columns)
    ]
    db.add(board)
    db.commit()
    return get_board(db, user, board.id)


def update_board(
    db: Session, user: User, board_id: int, title: str | None = None, description: str | None = None
) -> Board:
    board = _board(db, user, board_id, MEMBER)
    if title is not None:
        board.title = title
    if description is not None:
        board.description = description
    db.commit()
    return get_board(db, user, board_id)


def delete_board(db: Session, user: User, board_id: int) -> None:
    db.delete(_board(db, user, board_id, MEMBER))
    db.commit()


# --- columns --------------------------------------------------------------------------------


def create_column(db: Session, user: User, board_id: int, title: str, position: int | None = None) -> Column:
    board = _board(db, user, board_id, MEMBER)
    column = Column(board_id=board.id, title=title, position=0)
    siblings = _columns_of(db, board.id)
    db.add(column)
    _insert(siblings, column, position)
    db.commit()
    return _column(db, user, column.id)


def update_column(
    db: Session, user: User, column_id: int, title: str | None = None, position: int | None = None
) -> Column:
    column = _column(db, user, column_id, MEMBER)
    if title is not None:
        column.title = title
    if position is not None:
        siblings = [c for c in _columns_of(db, column.board_id) if c.id != column.id]
        _insert(siblings, column, position)
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
        _insert_many(_cards_of(db, target.id), cards, target)
        db.flush()
        db.expire(column, ["cards"])  # cascade must not see the moved cards
    remaining = [c for c in _columns_of(db, column.board_id) if c.id != column.id]
    db.delete(column)
    _renumber(remaining)
    db.commit()


def _insert_many(existing: list[Card], moving: list[Card], target: Column) -> None:
    for card in moving:
        card.column_id = target.id
        card.position = len(existing)
        existing.append(card)


# --- cards ----------------------------------------------------------------------------------


def create_card(
    db: Session,
    user: User,
    column_id: int,
    title: str,
    description: str = "",
    position: int | None = None,
) -> Card:
    column = _column(db, user, column_id, MEMBER)
    card = Card(column_id=column.id, title=title, description=description, position=0)
    siblings = _cards_of(db, column.id)
    db.add(card)
    _insert(siblings, card, position)
    db.commit()
    return _card(db, user, card.id)


def update_card(
    db: Session, user: User, card_id: int, title: str | None = None, description: str | None = None
) -> Card:
    card = _card(db, user, card_id, MEMBER)
    if title is not None:
        card.title = title
    if description is not None:
        card.description = description
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
    db.commit()
    return _card(db, user, card_id)


def delete_card(db: Session, user: User, card_id: int) -> None:
    card = _card(db, user, card_id, MEMBER)
    remaining = [c for c in _cards_of(db, card.column_id) if c.id != card.id]
    db.delete(card)
    _renumber(remaining)
    db.commit()
