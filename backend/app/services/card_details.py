"""Checklist items and comments.

Both hang off a card, so both are reached through `card_for`, which is what enforces workspace
membership and role. Checklist positions follow the same contiguous scheme as cards.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Card, ChecklistItem, Comment, User, WorkspaceRole
from app.services import activity, notifications, permissions
from app.services.boards import _insert, _renumber, card_for
from app.services.errors import Forbidden, NotFound

MEMBER = WorkspaceRole.MEMBER
ADMIN = WorkspaceRole.ADMIN


# --- checklist ---------------------------------------------------------------------------------


def _items_of(db: Session, card_id: int) -> list[ChecklistItem]:
    return list(
        db.scalars(
            select(ChecklistItem)
            .where(ChecklistItem.card_id == card_id)
            .order_by(ChecklistItem.position, ChecklistItem.id)
        )
    )


def _item(db: Session, user: User, item_id: int, minimum: WorkspaceRole = MEMBER) -> ChecklistItem:
    item = db.get(ChecklistItem, item_id)
    if item is None:
        raise NotFound("Checklist item")
    try:
        card_for(db, user, item.card_id, minimum)
    except NotFound:
        raise NotFound("Checklist item") from None
    return item


def list_checklist(db: Session, user: User, card_id: int) -> list[ChecklistItem]:
    card_for(db, user, card_id)
    return _items_of(db, card_id)


def add_checklist_item(
    db: Session, user: User, card_id: int, text: str, position: int | None = None
) -> ChecklistItem:
    card = card_for(db, user, card_id, MEMBER)
    item = ChecklistItem(card_id=card.id, text=text, position=0)
    siblings = _items_of(db, card.id)
    db.add(item)
    _insert(siblings, item, position)
    db.commit()
    return item


def update_checklist_item(
    db: Session,
    user: User,
    item_id: int,
    text: str | None = None,
    done: bool | None = None,
    position: int | None = None,
) -> ChecklistItem:
    item = _item(db, user, item_id)
    if text is not None:
        item.text = text
    if done is not None:
        item.done = done
    if position is not None:
        siblings = [i for i in _items_of(db, item.card_id) if i.id != item.id]
        _insert(siblings, item, position)
    db.commit()
    return item


def delete_checklist_item(db: Session, user: User, item_id: int) -> None:
    item = _item(db, user, item_id)
    remaining = [i for i in _items_of(db, item.card_id) if i.id != item.id]
    db.delete(item)
    _renumber(remaining)
    db.commit()


# --- comments ----------------------------------------------------------------------------------


def list_comments(db: Session, user: User, card_id: int) -> list[Comment]:
    card_for(db, user, card_id)
    return list(
        db.scalars(select(Comment).where(Comment.card_id == card_id).order_by(Comment.id))
    )


def add_comment(db: Session, user: User, card_id: int, body: str) -> Comment:
    card = card_for(db, user, card_id, MEMBER)
    comment = Comment(card_id=card.id, author_id=user.id, body=body)
    db.add(comment)
    board = card.column.board
    activity.record(
        db, user, board.workspace_id, activity.CARD_COMMENTED,
        f"commented on “{card.title}”", board_id=board.id, card_id=card.id,
    )

    # Whoever was named with @ hears about it; so does the assignee, once.
    told = set()
    for mentioned in notifications.mentioned_members(db, board.workspace_id, body):
        notifications.notify(
            db, mentioned.id, user, board.workspace_id, notifications.MENTIONED,
            f"{user.name} mentioned you on “{card.title}”", body,
            board_id=board.id, card_id=card.id,
        )
        told.add(mentioned.id)
    if card.assignee_id is not None and card.assignee_id not in told:
        notifications.notify(
            db, card.assignee_id, user, board.workspace_id, notifications.COMMENTED,
            f"{user.name} commented on “{card.title}”", body,
            board_id=board.id, card_id=card.id,
        )
    db.commit()
    return comment


def _comment(db: Session, user: User, comment_id: int) -> Comment:
    """A comment the user can at least see. Anything else looks like it is not there."""
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise NotFound("Comment")
    try:
        card_for(db, user, comment.card_id)
    except NotFound:
        raise NotFound("Comment") from None
    return comment


def update_comment(db: Session, user: User, comment_id: int, body: str) -> Comment:
    """Only the author edits their own words - not even an admin rewrites someone else's."""
    comment = _comment(db, user, comment_id)
    if comment.author_id != user.id:
        raise Forbidden("Only the author can edit a comment")
    comment.body = body
    db.commit()
    return comment


def delete_comment(db: Session, user: User, comment_id: int) -> None:
    """The author can retract a comment; an admin can moderate anyone's."""
    comment = _comment(db, user, comment_id)
    if comment.author_id != user.id:
        board_id = db.get(Card, comment.card_id).column.board_id
        if not permissions.require_board(db, user, board_id).can_administer:
            raise Forbidden("Only the author or a workspace admin can delete this comment")
    db.delete(comment)
    db.commit()
