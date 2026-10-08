"""Workspace labels, and attaching them to cards.

Labels are workspace-scoped so one vocabulary covers every board. Members create and attach
them while working; renaming or deleting one changes every board at once, so that needs an
admin.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Card, CardLabel, Label, User, WorkspaceRole
from app.models.label import LABEL_COLORS
from app.services import permissions
from app.services.boards import board_for, card_for
from app.services.errors import Conflict, InvalidRequest, NotFound

MEMBER = WorkspaceRole.MEMBER
ADMIN = WorkspaceRole.ADMIN


def _check_color(color: str) -> str:
    if color not in LABEL_COLORS:
        raise InvalidRequest(f"Label colour must be one of: {', '.join(LABEL_COLORS)}")
    return color


def list_labels(db: Session, user: User, workspace_id: int) -> list[Label]:
    permissions.require_workspace(db, user, workspace_id)
    return list(
        db.scalars(select(Label).where(Label.workspace_id == workspace_id).order_by(Label.name))
    )


def _label(db: Session, user: User, label_id: int, minimum: WorkspaceRole) -> Label:
    label = db.get(Label, label_id)
    if label is None:
        raise NotFound("Label")
    try:
        permissions.require_workspace(db, user, label.workspace_id, minimum)
    except NotFound:
        raise NotFound("Label") from None
    return label


def create_label(db: Session, user: User, workspace_id: int, name: str, color: str) -> Label:
    permissions.require_workspace(db, user, workspace_id, MEMBER)
    _check_color(color)
    if db.scalar(
        select(Label).where(Label.workspace_id == workspace_id, Label.name == name)
    ):
        raise Conflict(f"A label called “{name}” already exists in this workspace")
    label = Label(workspace_id=workspace_id, name=name, color=color)
    db.add(label)
    db.commit()
    return label


def update_label(
    db: Session, user: User, label_id: int, name: str | None = None, color: str | None = None
) -> Label:
    label = _label(db, user, label_id, ADMIN)
    if name is not None and name != label.name:
        if db.scalar(
            select(Label).where(Label.workspace_id == label.workspace_id, Label.name == name)
        ):
            raise Conflict(f"A label called “{name}” already exists in this workspace")
        label.name = name
    if color is not None:
        label.color = _check_color(color)
    db.commit()
    return label


def delete_label(db: Session, user: User, label_id: int) -> None:
    """Removes the label from every card it is on, across the whole workspace."""
    db.delete(_label(db, user, label_id, ADMIN))
    db.commit()


# --- on cards ----------------------------------------------------------------------------------


def _label_for_card(db: Session, user: User, card: Card, label_id: int) -> Label:
    """A card may only carry labels from its own workspace."""
    label = _label(db, user, label_id, MEMBER)
    board = board_for(db, user, card.column.board_id)
    if label.workspace_id != board.workspace_id:
        raise InvalidRequest("That label belongs to a different workspace")
    return label


def add_label_to_card(db: Session, user: User, card_id: int, label_id: int) -> Card:
    card = card_for(db, user, card_id, MEMBER)
    label = _label_for_card(db, user, card, label_id)
    if not db.scalar(
        select(CardLabel).where(CardLabel.card_id == card.id, CardLabel.label_id == label.id)
    ):
        db.add(CardLabel(card_id=card.id, label_id=label.id))
        db.commit()
    return card_for(db, user, card_id)


def remove_label_from_card(db: Session, user: User, card_id: int, label_id: int) -> Card:
    card = card_for(db, user, card_id, MEMBER)
    link = db.scalar(
        select(CardLabel).where(CardLabel.card_id == card.id, CardLabel.label_id == label_id)
    )
    if link is None:
        raise NotFound("Label on this card")
    db.delete(link)
    db.commit()
    return card_for(db, user, card_id)
