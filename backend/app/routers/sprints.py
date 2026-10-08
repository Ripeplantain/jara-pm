from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db import get_db
from app.schemas.boards import CardOut
from app.schemas.sprints import (
    CardSprint,
    SprintComplete,
    SprintCreate,
    SprintOut,
    SprintProgress,
    SprintUpdate,
)
from app.services import sprints as svc

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]


@router.get("/boards/{board_id}/sprints", response_model=list[SprintOut])
def list_sprints(board_id: int, user: CurrentUser, db: DbSession):
    return svc.list_sprints(db, user, board_id)


@router.post(
    "/boards/{board_id}/sprints", response_model=SprintOut, status_code=status.HTTP_201_CREATED
)
def create_sprint(board_id: int, body: SprintCreate, user: CurrentUser, db: DbSession):
    return svc.create_sprint(db, user, board_id, body.name, body.goal, body.starts_on, body.ends_on)


@router.patch("/sprints/{sprint_id}", response_model=SprintOut)
def update_sprint(sprint_id: int, body: SprintUpdate, user: CurrentUser, db: DbSession):
    return svc.update_sprint(
        db, user, sprint_id, body.name, body.goal, body.starts_on, body.ends_on
    )


@router.delete("/sprints/{sprint_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sprint(sprint_id: int, user: CurrentUser, db: DbSession):
    svc.delete_sprint(db, user, sprint_id)


@router.post("/sprints/{sprint_id}/start", response_model=SprintOut)
def start_sprint(sprint_id: int, user: CurrentUser, db: DbSession):
    return svc.start_sprint(db, user, sprint_id)


@router.post("/sprints/{sprint_id}/complete", response_model=SprintOut)
def complete_sprint(sprint_id: int, body: SprintComplete, user: CurrentUser, db: DbSession):
    return svc.complete_sprint(db, user, sprint_id, body.move_unfinished_to)


@router.get("/sprints/{sprint_id}/progress", response_model=SprintProgress)
def sprint_progress(sprint_id: int, user: CurrentUser, db: DbSession):
    return svc.sprint_progress(db, user, sprint_id)


@router.put("/cards/{card_id}/sprint", response_model=CardOut)
def set_card_sprint(card_id: int, body: CardSprint, user: CurrentUser, db: DbSession):
    return svc.set_card_sprint(db, user, card_id, body.sprint_id)
