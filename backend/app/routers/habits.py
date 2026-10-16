"""HTTP endpoints for habits. Thin: parse, delegate, return - the service decides everything.

Every route here is about the caller's own habits. There is no endpoint that takes a user id,
because a habit nobody else can read needs no way to ask for somebody else's.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db import get_db
from app.schemas.habits import HabitCheckinUpdate, HabitCreate, HabitOut, HabitUpdate
from app.services import habits as svc

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]


@router.get("/workspaces/{workspace_id}/habits", response_model=list[HabitOut])
def list_habits(
    workspace_id: int, user: CurrentUser, db: DbSession, include_archived: bool = False
):
    """My habits in this workspace, each with its streak and this week's progress."""
    return svc.views(db, user, workspace_id, include_archived)


@router.post(
    "/workspaces/{workspace_id}/habits",
    response_model=HabitOut,
    status_code=status.HTTP_201_CREATED,
)
def create_habit(workspace_id: int, body: HabitCreate, user: CurrentUser, db: DbSession):
    habit = svc.create_habit(
        db,
        user,
        workspace_id,
        name=body.name,
        detail=body.detail,
        schedule=body.schedule.value,
        target_per_week=body.target_per_week,
        color=body.color,
    )
    return svc.view_for(db, user, habit.id)


@router.get("/habits/{habit_id}", response_model=HabitOut)
def get_habit(habit_id: int, user: CurrentUser, db: DbSession):
    return svc.view_for(db, user, habit_id)


@router.patch("/habits/{habit_id}", response_model=HabitOut)
def update_habit(habit_id: int, body: HabitUpdate, user: CurrentUser, db: DbSession):
    """A field sent as null is left alone."""
    svc.update_habit(
        db,
        user,
        habit_id,
        name=body.name if body.name is not None else svc.UNSET,
        detail=body.detail if body.detail is not None else svc.UNSET,
        schedule=body.schedule.value if body.schedule is not None else svc.UNSET,
        target_per_week=body.target_per_week if body.target_per_week is not None else svc.UNSET,
        color=body.color if body.color is not None else svc.UNSET,
    )
    return svc.view_for(db, user, habit_id)


@router.post("/habits/{habit_id}/archive", response_model=HabitOut)
def archive_habit(habit_id: int, user: CurrentUser, db: DbSession):
    svc.archive_habit(db, user, habit_id)
    return svc.view_for(db, user, habit_id)


@router.post("/habits/{habit_id}/unarchive", response_model=HabitOut)
def unarchive_habit(habit_id: int, user: CurrentUser, db: DbSession):
    svc.unarchive_habit(db, user, habit_id)
    return svc.view_for(db, user, habit_id)


@router.delete("/habits/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_habit(habit_id: int, user: CurrentUser, db: DbSession):
    svc.delete_habit(db, user, habit_id)


@router.put("/habits/{habit_id}/checkins", response_model=HabitOut)
def set_checkin(habit_id: int, body: HabitCheckinUpdate, user: CurrentUser, db: DbSession):
    """Idempotent by design: the same tick twice is one check-in, and `done: false` unticks."""
    svc.set_checkin(db, user, habit_id, body.on_date, body.done)
    return svc.view_for(db, user, habit_id)
