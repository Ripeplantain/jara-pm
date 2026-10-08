"""Workspace and membership mutations.

A workspace is the unit of sharing: boards, labels and members all hang off one. Membership is
the only source of permission, so every function here is careful about who may change what.
"""

import hashlib
import logging
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import User, Workspace, WorkspaceInvite, WorkspaceMember, WorkspaceRole
from app.models.invite import default_expiry, new_token
from app.services import email as email_service
from app.services import permissions, product_analytics
from app.services.errors import Conflict, Forbidden, InvalidRequest, NotFound

ADMIN = WorkspaceRole.ADMIN
OWNER = WorkspaceRole.OWNER
logger = logging.getLogger(__name__)


def personal_workspace_name(email: str) -> str:
    local = (email or "").split("@")[0].strip()
    return f"{local}'s workspace" if local else "Personal workspace"


def create_workspace(db: Session, user: User, name: str, commit: bool = True) -> Workspace:
    """Create a workspace with `user` as its owner."""
    workspace = Workspace(name=name, created_by_id=user.id)
    workspace.members = [
        WorkspaceMember(user_id=user.id, role=WorkspaceRole.OWNER.value)
    ]
    db.add(workspace)
    if commit:
        db.commit()
    else:
        db.flush()
    return workspace


def list_workspaces(db: Session, user: User) -> list[Workspace]:
    return list(
        db.scalars(
            select(Workspace)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
            .where(WorkspaceMember.user_id == user.id)
            .order_by(Workspace.id)
            .options(selectinload(Workspace.members).selectinload(WorkspaceMember.user))
        )
    )


def membership(db: Session, user: User, workspace_id: int) -> WorkspaceMember | None:
    return db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user.id
        )
    )


def count_owners(db: Session, workspace_id: int) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.role == WorkspaceRole.OWNER.value,
            )
        )
        or 0
    )


def get_workspace(db: Session, user: User, workspace_id: int) -> Workspace:
    permissions.require_workspace(db, user, workspace_id)
    return db.scalar(
        select(Workspace)
        .where(Workspace.id == workspace_id)
        .options(selectinload(Workspace.members).selectinload(WorkspaceMember.user))
    )


def rename_workspace(db: Session, user: User, workspace_id: int, name: str) -> Workspace:
    permissions.require_workspace(db, user, workspace_id, ADMIN)
    workspace = db.get(Workspace, workspace_id)
    workspace.name = name
    db.commit()
    return get_workspace(db, user, workspace_id)


def delete_workspace(db: Session, user: User, workspace_id: int) -> None:
    """Owner only, and never the last one you belong to: an account with no workspace has
    nowhere to put a board."""
    permissions.require_workspace(db, user, workspace_id, OWNER)
    if len(list_workspaces(db, user)) == 1:
        raise Conflict("This is your only workspace; create another one before deleting it")
    db.delete(db.get(Workspace, workspace_id))
    db.commit()


# --- members ---------------------------------------------------------------------------------


def list_members(db: Session, user: User, workspace_id: int) -> list[WorkspaceMember]:
    permissions.require_workspace(db, user, workspace_id)
    return list(
        db.scalars(
            select(WorkspaceMember)
            .where(WorkspaceMember.workspace_id == workspace_id)
            .order_by(WorkspaceMember.id)
            .options(selectinload(WorkspaceMember.user))
        )
    )


def _member_or_404(db: Session, workspace_id: int, user_id: int) -> WorkspaceMember:
    member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id
        )
    )
    if member is None:
        raise NotFound("Member")
    return member


def _guard_role_grant(actor_role: WorkspaceRole, granted: WorkspaceRole) -> None:
    """Nobody hands out a role above their own: an admin cannot mint an owner."""
    if not actor_role.at_least(granted):
        raise Forbidden(f"You cannot grant the {granted.value} role")


def add_member(
    db: Session, user: User, workspace_id: int, email: str, role: WorkspaceRole
) -> WorkspaceMember:
    """Add an existing account to the workspace. Unregistered emails go through invites (6.6)."""
    access = permissions.require_workspace(db, user, workspace_id, ADMIN)
    _guard_role_grant(access.role, role)
    invitee = db.scalar(select(User).where(User.email == email.strip().lower()))
    if invitee is None:
        raise NotFound("User")
    if membership(db, invitee, workspace_id) is not None:
        raise Conflict("That person is already a member of this workspace")
    member = WorkspaceMember(workspace_id=workspace_id, user_id=invitee.id, role=role.value)
    db.add(member)
    db.commit()
    return _member_or_404(db, workspace_id, invitee.id)


def change_role(
    db: Session, user: User, workspace_id: int, user_id: int, role: WorkspaceRole
) -> WorkspaceMember:
    access = permissions.require_workspace(db, user, workspace_id, ADMIN)
    _guard_role_grant(access.role, role)
    member = _member_or_404(db, workspace_id, user_id)
    current = member.role_enum
    if current is OWNER and not access.role.at_least(OWNER):
        raise Forbidden("Only an owner can change another owner's role")
    if current is OWNER and role is not OWNER and count_owners(db, workspace_id) == 1:
        raise Conflict("A workspace must keep at least one owner")
    member.role = role.value
    db.commit()
    return _member_or_404(db, workspace_id, user_id)


def remove_member(db: Session, user: User, workspace_id: int, user_id: int) -> None:
    """Admins remove others; anyone may remove themselves (leaving), except the last owner."""
    leaving = user_id == user.id
    minimum = WorkspaceRole.VIEWER if leaving else ADMIN
    access = permissions.require_workspace(db, user, workspace_id, minimum)
    member = _member_or_404(db, workspace_id, user_id)
    if member.role_enum is OWNER:
        if not access.role.at_least(OWNER) and not leaving:
            raise Forbidden("Only an owner can remove another owner")
        if count_owners(db, workspace_id) == 1:
            raise Conflict("A workspace must keep at least one owner")
    db.delete(member)
    db.commit()


# --- invitations -------------------------------------------------------------------------------


def list_invites(db: Session, user: User, workspace_id: int) -> list[WorkspaceInvite]:
    """Open invitations only: accepted and expired ones are history, not pending work."""
    permissions.require_workspace(db, user, workspace_id, ADMIN)
    invites = db.scalars(
        select(WorkspaceInvite)
        .where(WorkspaceInvite.workspace_id == workspace_id, WorkspaceInvite.accepted_at.is_(None))
        .order_by(WorkspaceInvite.id)
    )
    return [invite for invite in invites if invite.is_open()]


def invite_member(
    db: Session, user: User, workspace_id: int, email: str, role: WorkspaceRole
) -> WorkspaceInvite:
    """Invite an email address. If that person already has an account, add them outright."""
    access = permissions.require_workspace(db, user, workspace_id, ADMIN)
    _guard_role_grant(access.role, role)
    email = email.strip().lower()

    existing_user = db.scalar(select(User).where(User.email == email))
    if existing_user is not None:
        if membership(db, existing_user, workspace_id) is not None:
            raise Conflict("That person is already a member of this workspace")
        raise AlreadyRegistered(existing_user.id)

    open_invite = next(
        (i for i in list_invites(db, user, workspace_id) if i.email == email), None
    )
    if open_invite is not None:
        raise Conflict("That address already has an open invitation")

    raw_token = new_token()
    invite = WorkspaceInvite(
        workspace_id=workspace_id,
        email=email,
        role=role.value,
        invited_by_id=user.id,
        token_hash=_token_hash(raw_token),
    )
    db.add(invite)
    db.commit()
    product_analytics.track(db, "invitation_sent", user=user, workspace_id=workspace_id)
    db.commit()
    _try_send_invitation(invite, user, raw_token)
    return invite


def invite_for_token(db: Session, token: str) -> WorkspaceInvite:
    invite = db.scalar(select(WorkspaceInvite).where(WorkspaceInvite.token_hash == _token_hash(token)))
    if invite is None or not invite.is_open():
        raise InvalidRequest("This invitation is invalid or has expired")
    return invite


def has_open_invites(db: Session, email: str) -> bool:
    """Whether an address has an invitation that still needs its emailed link."""
    now = datetime.now(UTC)
    return (
        db.scalar(
            select(WorkspaceInvite.id)
            .where(
                WorkspaceInvite.email == email.strip().lower(),
                WorkspaceInvite.accepted_at.is_(None),
                WorkspaceInvite.expires_at > now,
            )
            .limit(1)
        )
        is not None
    )


def validate_invite_for_registration(db: Session, email: str, token: str) -> WorkspaceInvite:
    invite = invite_for_token(db, token)
    if invite.email != email.strip().lower():
        raise InvalidRequest("This invitation belongs to a different email address")
    return invite


def resend_invite(db: Session, user: User, workspace_id: int, invite_id: int) -> WorkspaceInvite:
    permissions.require_workspace(db, user, workspace_id, ADMIN)
    invite = db.scalar(
        select(WorkspaceInvite).where(
            WorkspaceInvite.id == invite_id, WorkspaceInvite.workspace_id == workspace_id
        )
    )
    if invite is None:
        raise NotFound("Invitation")
    if invite.accepted_at is not None:
        raise Conflict("That invitation has already been accepted")
    raw_token = new_token()
    invite.token_hash = _token_hash(raw_token)
    invite.expires_at = default_expiry()
    db.commit()
    _try_send_invitation(invite, user, raw_token)
    return invite


def revoke_invite(db: Session, user: User, workspace_id: int, invite_id: int) -> None:
    permissions.require_workspace(db, user, workspace_id, ADMIN)
    invite = db.scalar(
        select(WorkspaceInvite).where(
            WorkspaceInvite.id == invite_id, WorkspaceInvite.workspace_id == workspace_id
        )
    )
    if invite is None:
        raise NotFound("Invitation")
    db.delete(invite)
    db.commit()


def _token_hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def _try_send_invitation(invite: WorkspaceInvite, inviter: User, raw_token: str) -> None:
    try:
        email_service.send_invitation(
            invite.email,
            invite.workspace.name,
            inviter.name,
            invite.role,
            raw_token,
        )
    except email_service.EmailDeliveryError:
        # The invitation is already committed. Resend remains available from the members page.
        logger.warning("transactional invitation email unavailable")


def accept_open_invites(db: Session, user: User, commit: bool = True) -> list[WorkspaceMember]:
    """Called after a validated invite-link registration to turn open invites into membership."""
    invites = db.scalars(
        select(WorkspaceInvite)
        .where(WorkspaceInvite.email == user.email, WorkspaceInvite.accepted_at.is_(None))
        .order_by(WorkspaceInvite.id)
    )
    now = datetime.now(UTC)
    accepted: list[WorkspaceMember] = []
    for invite in invites:
        if not invite.is_open(now) or membership(db, user, invite.workspace_id) is not None:
            continue
        member = WorkspaceMember(
            workspace_id=invite.workspace_id, user_id=user.id, role=invite.role
        )
        db.add(member)
        invite.accepted_at = now
        accepted.append(member)
    if commit:
        db.commit()
    else:
        db.flush()
    return accepted


class AlreadyRegistered(Exception):
    """The invited address has an account, so the caller should add them as a member instead."""

    def __init__(self, user_id: int):
        super().__init__("That address already has an account")
        self.user_id = user_id


__all__ = [
    "AlreadyRegistered",
    "Conflict",
    "Forbidden",
    "InvalidRequest",
    "NotFound",
    "accept_open_invites",
    "add_member",
    "change_role",
    "count_owners",
    "create_workspace",
    "delete_workspace",
    "get_workspace",
    "has_open_invites",
    "invite_for_token",
    "invite_member",
    "list_invites",
    "list_members",
    "list_workspaces",
    "membership",
    "personal_workspace_name",
    "remove_member",
    "rename_workspace",
    "resend_invite",
    "revoke_invite",
    "validate_invite_for_registration",
]
