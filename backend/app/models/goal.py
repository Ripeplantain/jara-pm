"""Goals: what the boards are for.

A goal is workspace data in the ordinary way - every member reads it, a member writes it, and
every change is in the activity feed - so there is no visibility rule here. What is unusual is
that a goal's progress is never stored. It is computed from the work the goal points at: a
milestone links to boards, sprints or cards, and its progress is the share of those cards that
sit in a column flagged `is_done`. That is the same signal cycle time is measured from, so a
goal cannot claim progress that the board does not show.

`GoalLink.target_id` is a plain integer rather than a foreign key, like `Activity.card_id` and
`NoteLink.target_id`: a deleted card should drop quietly out of a goal's rollup, not cascade
into the goal itself. `services/goals.py` resolves every link against live state on read, and
reports the ones that no longer resolve instead of counting them.
"""

from datetime import UTC, date, datetime
from enum import StrEnum

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _now() -> datetime:
    return datetime.now(UTC)


class GoalState(StrEnum):
    """One field rather than a state enum plus an archive flag, like `Sprint.state`."""

    ACTIVE = "active"
    ACHIEVED = "achieved"
    """Closed by a person. Progress keeps being computed, because the board keeps moving."""

    ARCHIVED = "archived"
    """Off the goals page, reversible, and the reason there is no delete in the AI's reach."""


GOAL_LINK_TYPES = ("board", "sprint", "card")
"""What a goal or a milestone may point at. A closed set, so a link can always be resolved."""


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, default=None
    )
    title: Mapped[str] = mapped_column(String(200))
    detail: Mapped[str] = mapped_column(Text, default="")
    state: Mapped[str] = mapped_column(String(20), default=GoalState.ACTIVE.value)
    starts_on: Mapped[date | None] = mapped_column(Date, default=None)
    target_date: Mapped[date | None] = mapped_column(Date, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
    achieved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    milestones: Mapped[list["GoalMilestone"]] = relationship(
        cascade="all, delete-orphan", order_by="GoalMilestone.position", lazy="selectin"
    )
    links: Mapped[list["GoalLink"]] = relationship(
        cascade="all, delete-orphan", order_by="GoalLink.id", lazy="selectin"
    )

    @property
    def state_enum(self) -> GoalState:
        return GoalState(self.state)

    @property
    def is_archived(self) -> bool:
        return self.state_enum is GoalState.ARCHIVED


class GoalMilestone(Base):
    """A named step towards the goal. It is never ticked by hand - it links to work, and the
    work's state is its progress."""

    __tablename__ = "goal_milestones"

    id: Mapped[int] = mapped_column(primary_key=True)
    goal_id: Mapped[int] = mapped_column(ForeignKey("goals.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    target_date: Mapped[date | None] = mapped_column(Date, default=None)
    # Contiguous 0..n-1 within the goal, renumbered like a card's checklist.
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class GoalLink(Base):
    """A goal's (or a milestone's) pointer at real work.

    `milestone_id` null means the link hangs off the goal itself. There is deliberately no
    unique constraint across it: SQLite treats NULLs as distinct, so the constraint would not
    cover the goal-level rows it most needs to - `services/goals.py` rejects a duplicate
    instead, in one place, for both cases.
    """

    __tablename__ = "goal_links"

    id: Mapped[int] = mapped_column(primary_key=True)
    goal_id: Mapped[int] = mapped_column(ForeignKey("goals.id", ondelete="CASCADE"), index=True)
    milestone_id: Mapped[int | None] = mapped_column(
        ForeignKey("goal_milestones.id", ondelete="CASCADE"), index=True, default=None
    )
    target_type: Mapped[str] = mapped_column(String(10))
    target_id: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
