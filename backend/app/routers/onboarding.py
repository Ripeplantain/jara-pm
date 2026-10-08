from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db import get_db
from app.models import OnboardingProfile
from app.schemas.onboarding import OnboardingOut, OnboardingRequest, OnboardingStatus
from app.services import onboarding as svc

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]


def _out(profile: OnboardingProfile | None) -> OnboardingStatus:
    if profile is None:
        return OnboardingStatus(completed=False)
    return OnboardingOut(
        completed=True,
        workspace_id=profile.workspace_id,
        board_id=profile.board_id,
        sprint_id=profile.sprint_id,
        completed_at=profile.completed_at,
    )


@router.get("/onboarding", response_model=OnboardingStatus)
def onboarding_status(user: CurrentUser, db: DbSession):
    return _out(svc.status(db, user))


@router.post("/onboarding", response_model=OnboardingOut, status_code=status.HTTP_201_CREATED)
def complete_onboarding(body: OnboardingRequest, user: CurrentUser, db: DbSession):
    return _out(svc.complete(db, user, body))


@router.post("/onboarding/demo", response_model=OnboardingOut, status_code=status.HTTP_201_CREATED)
def complete_demo(user: CurrentUser, db: DbSession):
    return _out(svc.complete_demo(db, user))
