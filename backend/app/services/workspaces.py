"""Workspace and membership mutations.

A workspace is the unit of sharing: boards, labels and members all hang off one. Membership is
the only source of permission, so every function here is careful about who may change what.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import User, Workspace, WorkspaceMember, WorkspaceRole
from app.services.errors import Conflict, Forbidden, InvalidRequest, NotFound


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


__all__ = [
    "Conflict",
    "Forbidden",
    "InvalidRequest",
    "NotFound",
    "count_owners",
    "create_workspace",
    "list_workspaces",
    "membership",
    "personal_workspace_name",
]
