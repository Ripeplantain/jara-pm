"""Habits: the repeating half of productivity, beside the board's one-off work.

A habit belongs to one person in one workspace. Unlike every other table in Kobi it is read by
nobody else at all - not an admin, not the owner - so there is no `visibility` column to get
wrong: `services/permissions.require_habit` compares `user_id` and nothing else, and a habit
somebody else owns is `NotFound`, exactly as somebody else's private page is.

Two consequences follow from that and are enforced in `services/habits.py`: a habit writes no
activity and sends no notification, because both are workspace-visible surfaces, and no role
above membership is ever required, because a habit affects nobody but its owner - the same
reasoning that lets a viewer favourite a board.

A check-in is the presence of a row for one date, not a boolean on one: ticking a day creates
the row and unticking it deletes the row, so the table is a log of what was done rather than a
grid of what was not. Streaks are derived from those rows in the service, never stored, so a
backfilled day repairs the streak it belongs to.
"""

from datetime import UTC, date, datetime
from enum import StrEnum

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.label import LABEL_COLORS


def _now() -> datetime:
    return datetime.now(UTC)


class HabitSchedule(StrEnum):
    """How often the habit is meant to happen. Stored as the string value, like every other
    enum here, and what each one means for a streak lives in `services/habits.py`."""

    DAILY = "daily"
    """Every day. The streak counts consecutive days."""

    WEEKLY = "weekly"
    """Once in a week, any day. The streak counts consecutive weeks."""

    TIMES_PER_WEEK = "times_per_week"
    """`target_per_week` times in a week, any days. The streak counts weeks that hit target."""


HABIT_COLORS = LABEL_COLORS
"""The same fixed palette labels use, for the same reason: the UI maps a name to a theme token,
so no raw hex ever crosses the API."""

MAX_TARGET_PER_WEEK = 7


class Habit(Base):
    """One habit, owned by one user. `user_id` is access, not provenance."""

    __tablename__ = "habits"

    id: Mapped[int] = mapped_column(primary_key=True)
    # A habit still hangs off a workspace, so it travels with the workspace it was made in and
    # dies with it, like everything else in Kobi.
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    # Why the habit exists, shown under its name. Optional, and never parsed.
    detail: Mapped[str] = mapped_column(String(500), default="")
    schedule: Mapped[str] = mapped_column(String(20), default=HabitSchedule.DAILY.value)
    # Only meaningful for `times_per_week`; `daily` and `weekly` imply their own target.
    target_per_week: Mapped[int] = mapped_column(Integer, default=1)
    color: Mapped[str] = mapped_column(String(20), default=HABIT_COLORS[1])
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    checkins: Mapped[list["HabitCheckin"]] = relationship(
        cascade="all, delete-orphan", order_by="HabitCheckin.on_date"
    )

    @property
    def schedule_enum(self) -> HabitSchedule:
        return HabitSchedule(self.schedule)

    @property
    def is_archived(self) -> bool:
        return self.archived_at is not None

    @property
    def week_target(self) -> int:
        """How many check-ins a week needs to count as met, per the schedule."""
        if self.schedule_enum is HabitSchedule.DAILY:
            return 7
        if self.schedule_enum is HabitSchedule.WEEKLY:
            return 1
        return max(1, min(self.target_per_week, MAX_TARGET_PER_WEEK))


class HabitCheckin(Base):
    """One done day. The unique constraint is what makes ticking a day idempotent."""

    __tablename__ = "habit_checkins"
    __table_args__ = (UniqueConstraint("habit_id", "on_date", name="uq_habit_checkin_day"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    habit_id: Mapped[int] = mapped_column(ForeignKey("habits.id", ondelete="CASCADE"), index=True)
    # A calendar day in UTC, not a timestamp: "did it on Tuesday" is the fact being recorded.
    on_date: Mapped[date] = mapped_column(Date, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
