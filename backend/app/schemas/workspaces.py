from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, StringConstraints, field_validator

from app.models import WorkspaceRole
from app.schemas.auth import UserOut

WorkspaceName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class WorkspaceCreate(BaseModel):
    name: WorkspaceName


class WorkspaceUpdate(BaseModel):
    name: WorkspaceName


class WorkspaceDelete(BaseModel):
    confirmation: str


class MemberAdd(BaseModel):
    email: EmailStr
    role: WorkspaceRole = WorkspaceRole.MEMBER

    @field_validator("email", mode="before")
    @classmethod
    def _normalize_email(cls, v):
        return v.strip().lower() if isinstance(v, str) else v


class RoleUpdate(BaseModel):
    role: WorkspaceRole


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    role: WorkspaceRole
    created_at: datetime
    user: UserOut


class WorkspaceSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_at: datetime


class WorkspaceOut(WorkspaceSummary):
    """A workspace plus the caller's own role, which the UI uses to hide what they cannot do."""

    my_role: WorkspaceRole
    members: list[MemberOut] = []


class InviteCreate(MemberAdd):
    """Same body as adding a member; the server decides which of the two happens."""


class InviteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    email: EmailStr
    role: WorkspaceRole
    invited_by_id: int | None
    created_at: datetime
    expires_at: datetime


class InvitePreview(BaseModel):
    email: EmailStr
    workspace_name: str
    role: WorkspaceRole
    expires_at: datetime


class InviteResult(BaseModel):
    """Inviting an address does one of two things, and the caller is told which.

    `member` when the address already had an account (they are in the workspace now), `invite`
    when it did not (they join automatically when they register).
    """

    kind: Literal["invite", "member"]
    invite: InviteOut | None = None
    member: MemberOut | None = None
