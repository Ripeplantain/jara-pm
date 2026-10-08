from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, EmailStr, Field, StringConstraints

from app.models import WorkspaceRole

Context = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
OnboardingWorkspaceName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


class OnboardingInvite(BaseModel):
    email: EmailStr
    role: WorkspaceRole = WorkspaceRole.MEMBER


class OnboardingRequest(BaseModel):
    workspace_name: OnboardingWorkspaceName
    product_context: Context = ""
    team_size: int = Field(ge=1, le=10)
    board_template: str = Field(min_length=1, max_length=50)
    sprint_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)] = "Sprint 1"
    sprint_goal: Annotated[str, StringConstraints(max_length=2000)] = ""
    starts_on: date | None = None
    ends_on: date | None = None
    invites: list[OnboardingInvite] = Field(default_factory=list, max_length=9)


class OnboardingStatus(BaseModel):
    completed: bool
    workspace_id: int | None = None
    workspace_name: str | None = None
    board_id: int | None = None
    sprint_id: int | None = None


class OnboardingOut(OnboardingStatus):
    completed_at: datetime | None = None

