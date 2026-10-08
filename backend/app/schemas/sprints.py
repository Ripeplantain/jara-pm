from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.models import SprintState

SprintName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Goal = Annotated[str, StringConstraints(max_length=2000)]


class SprintCreate(BaseModel):
    name: SprintName
    goal: Goal = ""
    starts_on: date | None = None
    ends_on: date | None = None


class SprintUpdate(BaseModel):
    name: SprintName | None = None
    goal: Goal | None = None
    starts_on: date | None = None
    ends_on: date | None = None


class SprintComplete(BaseModel):
    # None sends unfinished cards back to the backlog.
    move_unfinished_to: int | None = None


class CardSprint(BaseModel):
    sprint_id: int | None = None


class SprintProgress(BaseModel):
    total: int
    done: int
    estimate_total: int
    estimate_done: int


class SprintOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    board_id: int
    name: str
    goal: str
    starts_on: date | None
    ends_on: date | None
    state: SprintState
    created_at: datetime
    completed_at: datetime | None
