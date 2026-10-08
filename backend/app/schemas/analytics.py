from typing import Literal

from pydantic import BaseModel

from app.schemas.activity import ActivityOut


class ColumnStat(BaseModel):
    column_id: int
    title: str
    count: int
    wip_limit: int | None
    over_wip_limit: bool
    is_done: bool


class WeekStat(BaseModel):
    week_starting: str
    completed: int


class WorkloadStat(BaseModel):
    user_id: int | None  # None is the unassigned bucket
    name: str
    avatar_color: str
    open_cards: int
    estimate: int


class BoardAnalytics(BaseModel):
    board_id: int
    total_cards: int
    open_cards: int
    completed_cards: int
    columns: list[ColumnStat]
    throughput: list[WeekStat]
    # None when nothing has been completed yet; `cycle_time_sample` says how many cards it is from.
    cycle_time_hours: float | None
    cycle_time_sample: int
    workload: list[WorkloadStat]
    overdue: int
    due_soon: int
    unestimated: int


class BoardStat(BaseModel):
    board_id: int
    title: str
    is_favorite: bool
    total_cards: int
    open_cards: int
    overdue: int


class WorkspaceSignal(BaseModel):
    """A deterministic prompt for the copilot, with evidence the UI can link to."""

    kind: str
    severity: Literal["info", "warning", "danger"]
    title: str
    detail: str
    board_id: int
    card_id: int | None = None


class SprintHealth(BaseModel):
    board_id: int
    board_title: str
    sprint_id: int
    name: str
    total: int
    done: int
    estimate_total: int
    estimate_done: int
    ends_on: str | None


class WorkspaceOverview(BaseModel):
    """Everything the dashboard shows, in one response."""

    workspace_id: int
    boards: list[BoardStat]
    my_open_cards: int
    my_overdue: int
    my_due_soon: int
    recent_activity: list[ActivityOut]
    signals: list[WorkspaceSignal]
    active_sprints: list[SprintHealth]
