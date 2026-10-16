"""Request and response contracts for goals, their milestones and their links."""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from app.models.goal import GOAL_LINK_TYPES, GoalState

GoalTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
GoalDetail = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5_000)]
MilestoneTitle = GoalTitle
LinkType = Literal[GOAL_LINK_TYPES]  # type: ignore[valid-type]
Position = Annotated[int, Field(ge=0)]

MAX_MILESTONES_PER_REQUEST = 20


class GoalLinkOut(BaseModel):
    """A pointer at real work. `target_title` and `board_id` are resolved when the goal is read,
    so a renamed board renames its link and a deleted one comes back with an empty title."""

    id: int
    milestone_id: int | None
    target_type: str
    target_id: int
    target_title: str
    board_id: int | None


class GoalMilestoneOut(BaseModel):
    """A step towards the goal. Its numbers are derived from the work it links to, never set."""

    id: int
    goal_id: int
    title: str
    target_date: date | None
    position: int
    cards_total: int
    cards_done: int
    unresolved_links: int
    percent: int
    links: list[GoalLinkOut]


class GoalOut(BaseModel):
    id: int
    workspace_id: int
    title: str
    detail: str
    state: GoalState
    starts_on: date | None
    target_date: date | None
    created_at: datetime
    updated_at: datetime
    achieved_at: datetime | None

    # The mean of the goal's groups - one per milestone, plus one for its own direct links.
    percent: int
    cards_total: int
    cards_done: int
    unresolved_links: int
    # False while nothing is linked: there is no progress to report, which is not the same as
    # measuring 0%.
    has_evidence: bool
    milestones: list[GoalMilestoneOut]
    # The goal's own links, the ones not attached to a milestone.
    links: list[GoalLinkOut]


class GoalHit(BaseModel):
    """A goal found by search. Deliberately without its progress: the rollup reads the board,
    and a result row only needs enough to be recognised and opened."""

    id: int
    workspace_id: int
    title: str
    state: GoalState
    target_date: date | None


class GoalCreate(BaseModel):
    title: GoalTitle
    detail: GoalDetail = ""
    starts_on: date | None = None
    target_date: date | None = None
    # Milestone titles, created in the order given. Links are added afterwards.
    milestones: list[MilestoneTitle] = Field(
        default_factory=list, max_length=MAX_MILESTONES_PER_REQUEST
    )


class GoalUpdate(BaseModel):
    """Absent fields are left alone. A date sent as null clears it."""

    title: GoalTitle | None = None
    detail: GoalDetail | None = None
    starts_on: date | None = None
    target_date: date | None = None
    state: GoalState | None = None


class MilestoneCreate(BaseModel):
    title: MilestoneTitle
    target_date: date | None = None
    position: Position | None = None  # None appends


class MilestoneUpdate(BaseModel):
    title: MilestoneTitle | None = None
    target_date: date | None = None
    position: Position | None = None


class GoalLinkCreate(BaseModel):
    target_type: LinkType
    target_id: int
    # Omitted: the link hangs off the goal itself rather than one of its milestones.
    milestone_id: int | None = None
