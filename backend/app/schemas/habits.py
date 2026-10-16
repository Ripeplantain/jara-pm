"""Request and response contracts for habits and their check-ins."""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from app.models.habit import HABIT_COLORS, MAX_TARGET_PER_WEEK, HabitSchedule

HabitName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
HabitDetail = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
HabitColor = Literal[HABIT_COLORS]  # type: ignore[valid-type]
WeeklyTarget = Annotated[int, Field(ge=1, le=MAX_TARGET_PER_WEEK)]


class HabitOut(BaseModel):
    """A habit and its derived state. Everything after `archived_at` is computed on read from
    the check-in log - none of it is stored, so none of it can disagree with the log."""

    id: int
    workspace_id: int
    name: str
    detail: str
    schedule: HabitSchedule
    target_per_week: int
    color: str
    created_at: datetime
    archived_at: datetime | None

    done_today: bool
    due_today: bool
    current_streak: int
    longest_streak: int
    # "day" or "week": what this habit's streak counts, given its schedule.
    streak_unit: str
    week_done: int
    week_target: int
    total_checkins: int
    # The ticked days inside the window the grid draws, oldest first.
    history: list[date]


class HabitCreate(BaseModel):
    name: HabitName
    detail: HabitDetail = ""
    schedule: HabitSchedule = HabitSchedule.DAILY
    # Only read for the `times_per_week` schedule; the others imply their own target.
    target_per_week: WeeklyTarget = 1
    color: HabitColor = "indigo"


class HabitUpdate(BaseModel):
    """Absent fields are left alone."""

    name: HabitName | None = None
    detail: HabitDetail | None = None
    schedule: HabitSchedule | None = None
    target_per_week: WeeklyTarget | None = None
    color: HabitColor | None = None


class HabitCheckinUpdate(BaseModel):
    """Tick or untick one day. `on_date` omitted means today; a future day is refused."""

    on_date: date | None = None
    done: bool = True
