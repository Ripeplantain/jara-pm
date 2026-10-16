"""Who may do what.

One rule, applied everywhere: the acting user comes from the verified token, and what they may
do comes from their `workspace_members` row. Nothing else - not `created_by_id`, not a
client-supplied id - grants access.

Two different failures, deliberately:
- `NotFound`: the user is not a member, so the resource must look like it does not exist.
- `Forbidden`: the user is a member but their role is too weak for this action.
"""

from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import (
    Board,
    Card,
    Column,
    Goal,
    Habit,
    Note,
    NoteVisibility,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceRole,
)
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


# --- notes ------------------------------------------------------------------------------------
#
# Notes are the one thing in a workspace that is not automatically readable by every member. A
# note marked `private` belongs to its owner alone - against admins and owners too - and a
# non-owner must not even learn that it exists, so it reads as NotFound rather than Forbidden,
# the same way a workspace you are not in does.


def note_visibility_filter(user: User):
    """The single condition every note read must compose.

    It lives here, not in `services/notes.py`, because this module is the only place allowed to
    decide access - and because a listing, a search, an export and the AI context builder that
    each wrote their own version of this is exactly how a private page leaks.
    """
    return or_(
        Note.visibility == NoteVisibility.WORKSPACE.value,
        Note.owner_id == user.id,
    )


def may_read_note(user: User, note: Note) -> bool:
    """The in-Python twin of `note_visibility_filter`, for a note already loaded."""
    return not note.is_private or note.owner_id == user.id


def require_note(db: Session, user: User, note_id: int, minimum: WorkspaceRole = VIEWER) -> Access:
    """Membership, then visibility, then the role - in that order, deliberately.

    Visibility is settled before `minimum` is applied, because a Forbidden for someone else's
    private note would confirm that the note exists. Anything a user may not see is NotFound
    first; only a note they can see can produce a role error.
    """
    note = db.get(Note, note_id)
    if note is None:
        raise NotFound("Note")
    try:
        access = require_workspace(db, user, note.workspace_id)
    except NotFound:
        raise NotFound("Note") from None
    if not may_read_note(user, note):
        raise NotFound("Note")
    if not access.at_least(minimum):
        raise Forbidden(f"This action needs {_WHAT_IT_TAKES[minimum]} in this workspace")
    return access


# --- habits and goals -------------------------------------------------------------------------


def require_habit(db: Session, user: User, habit_id: int) -> Access:
    """A habit is its owner's alone, so there is no role to check - only who you are.

    Everyone else gets `NotFound`, including an admin and the workspace owner: a `Forbidden`
    would confirm that the habit exists, which is the same reasoning `require_note` applies to
    somebody else's private page. There is no `minimum` parameter because a habit affects
    nobody else, so membership is the whole requirement - exactly like favouriting a board.
    """
    habit = db.get(Habit, habit_id)
    if habit is None:
        raise NotFound("Habit")
    try:
        access = require_workspace(db, user, habit.workspace_id)
    except NotFound:
        raise NotFound("Habit") from None
    if habit.user_id != user.id:
        raise NotFound("Habit")
    return access


def require_goal(db: Session, user: User, goal_id: int, minimum: WorkspaceRole = VIEWER) -> Access:
    """A goal is ordinary workspace data: every member reads it, `minimum` decides who writes."""
    goal = db.get(Goal, goal_id)
    if goal is None:
        raise NotFound("Goal")
    try:
        return require_workspace(db, user, goal.workspace_id, minimum)
    except NotFound:
        raise NotFound("Goal") from None
