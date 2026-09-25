"""Who may do what.

One rule, applied everywhere: the acting user comes from the verified token, and what they may
do comes from their `workspace_members` row. Nothing else - not `created_by_id`, not a
client-supplied id - grants access.

Two different failures, deliberately:
- `NotFound`: the user is not a member, so the resource must look like it does not exist.
- `Forbidden`: the user is a member but their role is too weak for this action.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Board, Card, Column, User, Workspace, WorkspaceMember, WorkspaceRole
from app.services.errors import Forbidden, NotFound

VIEWER = WorkspaceRole.VIEWER
MEMBER = WorkspaceRole.MEMBER
ADMIN = WorkspaceRole.ADMIN
OWNER = WorkspaceRole.OWNER

_WHAT_IT_TAKES = {
    VIEWER: "read access",
    MEMBER: "a member role",
    ADMIN: "an admin role",
    OWNER: "the workspace owner role",
}


@dataclass(frozen=True)
class Access:
    """The answer to "may this user do this here?", plus the context the caller needs next."""

    user: User
    workspace_id: int
    role: WorkspaceRole

    def at_least(self, minimum: WorkspaceRole) -> bool:
        return self.role.at_least(minimum)

    @property
    def can_write(self) -> bool:
        return self.at_least(MEMBER)

    @property
    def can_administer(self) -> bool:
        return self.at_least(ADMIN)


def role_in(db: Session, user: User, workspace_id: int) -> WorkspaceRole | None:
    row = db.scalar(
        select(WorkspaceMember.role).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user.id
        )
    )
    return WorkspaceRole(row) if row is not None else None


def require_workspace(
    db: Session, user: User, workspace_id: int, minimum: WorkspaceRole = VIEWER
) -> Access:
    """The gate every workspace-scoped action goes through."""
    role = role_in(db, user, workspace_id)
    if role is None or db.get(Workspace, workspace_id) is None:
        raise NotFound("Workspace")
    if not role.at_least(minimum):
        raise Forbidden(f"This action needs {_WHAT_IT_TAKES[minimum]} in this workspace")
    return Access(user=user, workspace_id=workspace_id, role=role)


def require_board(db: Session, user: User, board_id: int, minimum: WorkspaceRole = VIEWER) -> Access:
    board = db.get(Board, board_id)
    if board is None:
        raise NotFound("Board")
    try:
        return require_workspace(db, user, board.workspace_id, minimum)
    except NotFound:
        raise NotFound("Board") from None


def require_column(
    db: Session, user: User, column_id: int, minimum: WorkspaceRole = VIEWER
) -> Access:
    board_id = db.scalar(select(Column.board_id).where(Column.id == column_id))
    if board_id is None:
        raise NotFound("Column")
    try:
        return require_board(db, user, board_id, minimum)
    except NotFound:
        raise NotFound("Column") from None


def require_card(db: Session, user: User, card_id: int, minimum: WorkspaceRole = VIEWER) -> Access:
    column_id = db.scalar(select(Card.column_id).where(Card.id == card_id))
    if column_id is None:
        raise NotFound("Card")
    try:
        return require_column(db, user, column_id, minimum)
    except NotFound:
        raise NotFound("Card") from None
