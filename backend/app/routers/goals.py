"""HTTP endpoints for goals. Thin: parse, delegate, return - the service decides everything."""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db import get_db
from app.schemas.goals import (
    GoalCreate,
    GoalLinkCreate,
    GoalOut,
    GoalUpdate,
    MilestoneCreate,
    MilestoneUpdate,
)
from app.services import goals as svc

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]


@router.get("/workspaces/{workspace_id}/goals", response_model=list[GoalOut])
def list_goals(
    workspace_id: int, user: CurrentUser, db: DbSession, include_archived: bool = False
):
    """Every goal in the workspace, each with the progress its linked work adds up to."""
    return svc.views(db, user, workspace_id, include_archived)


@router.post(
    "/workspaces/{workspace_id}/goals",
    response_model=GoalOut,
    status_code=status.HTTP_201_CREATED,
)
def create_goal(workspace_id: int, body: GoalCreate, user: CurrentUser, db: DbSession):
    goal = svc.create_goal(
        db,
        user,
        workspace_id,
        title=body.title,
        detail=body.detail,
        starts_on=body.starts_on,
        target_date=body.target_date,
        milestones=list(body.milestones),
    )
    return svc.view(db, goal)


@router.get("/goals/{goal_id}", response_model=GoalOut)
def get_goal(goal_id: int, user: CurrentUser, db: DbSession):
    return svc.view_for(db, user, goal_id)


@router.patch("/goals/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: int, body: GoalUpdate, user: CurrentUser, db: DbSession):
    """A date left out is kept; a date sent as null is cleared, which is why the dates read
    `model_fields_set` while the text fields treat null as "unchanged"."""
    sent = body.model_fields_set
    goal = svc.update_goal(
        db,
        user,
        goal_id,
        title=body.title if body.title is not None else svc.UNSET,
        detail=body.detail if body.detail is not None else svc.UNSET,
        starts_on=body.starts_on if "starts_on" in sent else svc.UNSET,
        target_date=body.target_date if "target_date" in sent else svc.UNSET,
        state=body.state.value if body.state is not None else svc.UNSET,
    )
    return svc.view(db, goal)


@router.delete("/goals/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(goal_id: int, user: CurrentUser, db: DbSession):
    """Hard delete. Archiving - `state: "archived"` on the PATCH above - is the reversible one."""
    svc.delete_goal(db, user, goal_id)


@router.post("/goals/{goal_id}/milestones", response_model=GoalOut)
def add_milestone(goal_id: int, body: MilestoneCreate, user: CurrentUser, db: DbSession):
    """Returns the whole goal: adding a milestone changes its progress."""
    return svc.view(db, svc.add_milestone(db, user, goal_id, body.title, body.target_date, body.position))


@router.patch("/goal-milestones/{milestone_id}", response_model=GoalOut)
def update_milestone(
    milestone_id: int, body: MilestoneUpdate, user: CurrentUser, db: DbSession
):
    sent = body.model_fields_set
    goal = svc.update_milestone(
        db,
        user,
        milestone_id,
        title=body.title if body.title is not None else svc.UNSET,
        target_date=body.target_date if "target_date" in sent else svc.UNSET,
        position=body.position,
    )
    return svc.view(db, goal)


@router.delete("/goal-milestones/{milestone_id}", response_model=GoalOut)
def delete_milestone(milestone_id: int, user: CurrentUser, db: DbSession):
    """Returns the goal rather than 204: its progress and milestone positions both change."""
    return svc.view(db, svc.delete_milestone(db, user, milestone_id))


@router.post("/goals/{goal_id}/links", response_model=GoalOut)
def add_link(goal_id: int, body: GoalLinkCreate, user: CurrentUser, db: DbSession):
    """Point the goal, or one of its milestones, at a board, a sprint or a card."""
    goal = svc.add_link(db, user, goal_id, body.target_type, body.target_id, body.milestone_id)
    return svc.view(db, goal)


@router.delete("/goal-links/{link_id}", response_model=GoalOut)
def remove_link(link_id: int, user: CurrentUser, db: DbSession):
    return svc.view(db, svc.remove_link(db, user, link_id))
