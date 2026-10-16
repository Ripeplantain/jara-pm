"""Habits and their check-ins.

The only code that writes habit data; used by the HTTP routers and the AI tools, exactly as
`services/boards.py` is for boards.

Three things are worth stating up front.

**Ownership is the whole access rule.** A habit belongs to one person, and
`permissions.require_habit` is the single place that decides it. Every query here also filters
on `Habit.user_id`, so a caller that somehow skipped the permission check still cannot load
somebody else's habit.

**No history and no notifications.** The activity feed and the notification list are
workspace-visible, and rows in them are never edited or filtered after the fact, so a personal
surface cannot write to them at all - the same conclusion `services/notes.py` reached for a
private page. Nothing in this module calls `activity.record` or `notifications.notify`.

**Streaks are derived, never stored.** They are computed from the check-in rows on every read,
so backfilling a missed day repairs the streak it belongs to instead of leaving a stored counter
that disagrees with the log. The computation is a pure function of a set of dates, which is what
makes it testable and what keeps a page of habits to one query.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    HABIT_COLORS,
    MAX_TARGET_PER_WEEK,
    Habit,
    HabitCheckin,
    HabitSchedule,
    User,
)
from app.services import permissions
from app.services.boards import _fresh
from app.services.errors import InvalidRequest, NotFound

HISTORY_DAYS = 70
"""Ten weeks: what the check-in grid draws, and the window the API returns dates for."""

STREAK_WINDOW_DAYS = 365
"""How far back a streak is computed. A deliberate cap: a streak is a motivation device, not an
audit trail, and bounding it keeps one read to one small query however old the habit is."""

MAX_BACKFILL_DAYS = 365
"""How far back a day can be ticked. Matches the streak window, so nothing outside it matters."""

MAX_HABITS = 50
"""Per person per workspace. A habit list is a short list; this stops a runaway client."""

UNSET: Any = object()
"""Sentinel for "leave this field alone", as in `services/boards`."""

DAY = "day"
WEEK = "week"


def today() -> date:
    """The calendar day the server is in. Check-ins are UTC days (see `HabitCheckin`)."""
    return datetime.now(UTC).date()


def _week_start(day: date) -> date:
    """The Monday of that day's week. Weeks are the unit for the weekly schedules."""
    return day - timedelta(days=day.weekday())


# --- progress ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class HabitProgress:
    """What a habit's check-ins add up to right now. Pure output: nothing here is stored."""

    done_today: bool
    due_today: bool
    """Still outstanding today. A weekly habit is due on any day the week's target is unmet."""
    current_streak: int
    longest_streak: int
    unit: str
    """What a streak counts, `day` or `week`, so the UI can say "5 weeks" and not "5"."""
    week_done: int
    week_target: int
    total_checkins: int
    history: list[date]


def _daily_streak(dates: set[date], day: date) -> int:
    """Consecutive days up to today, or up to yesterday while today is still open.

    Today being unticked at 9am must not read as a broken streak, so the count anchors on
    yesterday until today is done. Two missed days in a row is a broken streak.
    """
    anchor = day if day in dates else day - timedelta(days=1)
    if anchor not in dates:
        return 0
    length = 0
    while anchor in dates:
        length += 1
        anchor -= timedelta(days=1)
    return length


def _longest_daily(dates: set[date]) -> int:
    longest = 0
    run = 0
    previous: date | None = None
    for day in sorted(dates):
        run = run + 1 if previous is not None and day - previous == timedelta(days=1) else 1
        previous = day
        longest = max(longest, run)
    return longest


def _weekly_streak(met: set[date], week: date) -> int:
    """The same shape as `_daily_streak`, a week at a time: the current week stays open."""
    anchor = week if week in met else week - timedelta(days=7)
    if anchor not in met:
        return 0
    length = 0
    while anchor in met:
        length += 1
        anchor -= timedelta(days=7)
    return length


def _longest_weekly(met: set[date]) -> int:
    longest = 0
    run = 0
    previous: date | None = None
    for week in sorted(met):
        run = run + 1 if previous is not None and week - previous == timedelta(days=7) else 1
        previous = week
        longest = max(longest, run)
    return longest


def progress(habit: Habit, dates: set[date], day: date | None = None) -> HabitProgress:
    """Turn a habit's check-in dates into its current state.

    `dates` is expected to hold the last `STREAK_WINDOW_DAYS`, which is what `_checkin_dates`
    reads; anything older simply cannot extend a streak.
    """
    day = day or today()
    week = _week_start(day)
    target = habit.week_target
    week_done = sum(1 for seen in dates if _week_start(seen) == week)

    if habit.schedule_enum is HabitSchedule.DAILY:
        unit = DAY
        current = _daily_streak(dates, day)
        longest = _longest_daily(dates)
        due = day not in dates
    else:
        unit = WEEK
        counts: dict[date, int] = {}
        for seen in dates:
            start = _week_start(seen)
            counts[start] = counts.get(start, 0) + 1
        met = {start for start, count in counts.items() if count >= target}
        current = _weekly_streak(met, week)
        longest = _longest_weekly(met)
        due = week_done < target

    since = day - timedelta(days=HISTORY_DAYS - 1)
    return HabitProgress(
        done_today=day in dates,
        # An archived habit is not asking anything of you today.
        due_today=due and not habit.is_archived,
        current_streak=current,
        longest_streak=max(longest, current),
        unit=unit,
        week_done=week_done,
        week_target=target,
        total_checkins=len(dates),
        history=sorted(seen for seen in dates if seen >= since),
    )


def _checkin_dates(
    db: Session, habit_ids: list[int], day: date
) -> dict[int, set[date]]:
    """Every habit's check-in days inside the streak window, in one query.

    One query for the whole page rather than one per habit: a habit list is read on the habits
    page and again on the dashboard, and N+1 there would be felt.
    """
    found: dict[int, set[date]] = {habit_id: set() for habit_id in habit_ids}
    if not habit_ids:
        return found
    rows = db.execute(
        select(HabitCheckin.habit_id, HabitCheckin.on_date).where(
            HabitCheckin.habit_id.in_(habit_ids),
            HabitCheckin.on_date >= day - timedelta(days=STREAK_WINDOW_DAYS),
            HabitCheckin.on_date <= day,
        )
    )
    for habit_id, on_date in rows:
        found[habit_id].add(on_date)
    return found


def view(habit: Habit, dates: set[date], day: date | None = None) -> dict:
    """One habit plus its derived progress, which is what the API returns."""
    state = progress(habit, dates, day)
    return {
        "id": habit.id,
        "workspace_id": habit.workspace_id,
        "name": habit.name,
        "detail": habit.detail,
        "schedule": habit.schedule,
        "target_per_week": habit.target_per_week,
        "color": habit.color,
        "created_at": habit.created_at,
        "archived_at": habit.archived_at,
        "done_today": state.done_today,
        "due_today": state.due_today,
        "current_streak": state.current_streak,
        "longest_streak": state.longest_streak,
        "streak_unit": state.unit,
        "week_done": state.week_done,
        "week_target": state.week_target,
        "total_checkins": state.total_checkins,
        "history": state.history,
    }


# --- scoped lookups ---------------------------------------------------------------------------


def habit_for(db: Session, user: User, habit_id: int) -> Habit:
    """Load a habit the user owns. `permissions.require_habit` is what decides."""
    permissions.require_habit(db, user, habit_id)
    habit = db.scalar(
        _fresh(select(Habit).where(Habit.id == habit_id, Habit.user_id == user.id))
    )
    if habit is None:
        raise NotFound("Habit")
    return habit


def list_habits(
    db: Session, user: User, workspace_id: int, include_archived: bool = False
) -> list[Habit]:
    """The caller's own habits in this workspace. There is no way to list anyone else's.

    Membership is the only requirement: a habit affects nobody but its owner, so a viewer keeps
    their own habits in a workspace they can only read, the way they keep their own favourites.
    """
    permissions.require_workspace(db, user, workspace_id)
    stmt = (
        select(Habit)
        .where(Habit.workspace_id == workspace_id, Habit.user_id == user.id)
        .order_by(Habit.archived_at.is_not(None), Habit.id)
    )
    if not include_archived:
        stmt = stmt.where(Habit.archived_at.is_(None))
    return list(db.scalars(_fresh(stmt)))


def views(
    db: Session, user: User, workspace_id: int, include_archived: bool = False
) -> list[dict]:
    """The habits page and the dashboard's "today" list, in one query plus one."""
    habits = list_habits(db, user, workspace_id, include_archived)
    day = today()
    dates = _checkin_dates(db, [habit.id for habit in habits], day)
    return [view(habit, dates[habit.id], day) for habit in habits]


def view_for(db: Session, user: User, habit_id: int) -> dict:
    habit = habit_for(db, user, habit_id)
    day = today()
    return view(habit, _checkin_dates(db, [habit.id], day)[habit.id], day)


# --- validation -------------------------------------------------------------------------------


def _check_schedule(schedule: str, target_per_week: int) -> None:
    """Validated here as well as in the schema, because the AI tools call the service."""
    try:
        chosen = HabitSchedule(schedule)
    except ValueError:
        raise InvalidRequest(f"Unknown habit schedule “{schedule}”") from None
    if chosen is HabitSchedule.TIMES_PER_WEEK and not 1 <= target_per_week <= MAX_TARGET_PER_WEEK:
        raise InvalidRequest(f"A weekly target is between 1 and {MAX_TARGET_PER_WEEK} times")


def _check_color(color: str) -> None:
    if color not in HABIT_COLORS:
        raise InvalidRequest(f"Unknown colour “{color}”")


# --- habits -----------------------------------------------------------------------------------


def create_habit(
    db: Session,
    user: User,
    workspace_id: int,
    name: str,
    detail: str = "",
    schedule: str = HabitSchedule.DAILY.value,
    target_per_week: int = 1,
    color: str = HABIT_COLORS[1],
) -> Habit:
    permissions.require_workspace(db, user, workspace_id)
    _check_schedule(schedule, target_per_week)
    _check_color(color)
    live = sum(1 for habit in list_habits(db, user, workspace_id) if not habit.is_archived)
    if live >= MAX_HABITS:
        raise InvalidRequest(f"You can track {MAX_HABITS} habits at a time in one workspace")
    habit = Habit(
        workspace_id=workspace_id,
        user_id=user.id,
        name=name,
        detail=detail,
        schedule=HabitSchedule(schedule).value,
        target_per_week=target_per_week,
        color=color,
    )
    db.add(habit)
    db.commit()
    return habit


def update_habit(
    db: Session,
    user: User,
    habit_id: int,
    name: Any = UNSET,
    detail: Any = UNSET,
    schedule: Any = UNSET,
    target_per_week: Any = UNSET,
    color: Any = UNSET,
) -> Habit:
    """Absent fields are left alone. Changing the schedule re-reads the streak, never rewrites
    the log: the check-ins stay as they were and the new schedule interprets them."""
    habit = habit_for(db, user, habit_id)
    wanted_schedule = habit.schedule if schedule is UNSET else schedule
    wanted_target = habit.target_per_week if target_per_week is UNSET else target_per_week
    _check_schedule(wanted_schedule, wanted_target)
    if color is not UNSET:
        _check_color(color)
        habit.color = color
    if name is not UNSET:
        habit.name = name
    if detail is not UNSET:
        habit.detail = detail
    habit.schedule = HabitSchedule(wanted_schedule).value
    habit.target_per_week = wanted_target
    db.commit()
    return habit


def archive_habit(db: Session, user: User, habit_id: int) -> Habit:
    """Stop tracking without losing the log. Reversible, so it needs no confirmation."""
    habit = habit_for(db, user, habit_id)
    if habit.archived_at is None:
        habit.archived_at = datetime.now(UTC)
        db.commit()
    return habit


def unarchive_habit(db: Session, user: User, habit_id: int) -> Habit:
    habit = habit_for(db, user, habit_id)
    if habit.archived_at is not None:
        habit.archived_at = None
        db.commit()
    return habit


def delete_habit(db: Session, user: User, habit_id: int) -> None:
    """Hard delete, with the check-ins under it. Only the owner can reach it at all."""
    habit = habit_for(db, user, habit_id)
    db.delete(habit)
    db.commit()


# --- check-ins --------------------------------------------------------------------------------


def set_checkin(
    db: Session, user: User, habit_id: int, on_date: date | None = None, done: bool = True
) -> Habit:
    """Tick or untick one day. Idempotent: the row's presence *is* the check-in.

    Returns the habit so the caller can recompute progress from one response, which is what the
    grid needs after a tap.
    """
    habit = habit_for(db, user, habit_id)
    if habit.is_archived:
        raise InvalidRequest("Restore this habit before checking it in")
    day = today()
    when = on_date or day
    if when > day:
        raise InvalidRequest("A habit cannot be checked in for a day that has not happened yet")
    if when < day - timedelta(days=MAX_BACKFILL_DAYS):
        raise InvalidRequest(f"Check-ins can be backfilled up to {MAX_BACKFILL_DAYS} days")

    existing = db.scalar(
        select(HabitCheckin).where(
            HabitCheckin.habit_id == habit.id, HabitCheckin.on_date == when
        )
    )
    if done and existing is None:
        db.add(HabitCheckin(habit_id=habit.id, on_date=when))
    elif not done and existing is not None:
        db.delete(existing)
    db.commit()
    return habit


__all__ = [
    "InvalidRequest",
    "NotFound",
    "archive_habit",
    "create_habit",
    "delete_habit",
    "habit_for",
    "list_habits",
    "progress",
    "set_checkin",
    "unarchive_habit",
    "update_habit",
    "view",
    "view_for",
    "views",
]
