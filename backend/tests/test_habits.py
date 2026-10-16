"""Habits: the streak arithmetic, and the fact that nobody else can see them.

A habit is the first thing in Kobi that not even an admin may read, so ownership is tested on
every path separately rather than once in general. The streak maths is tested through the pure
`progress()` function with planted dates, because the interesting cases - a gap, an open today,
a week that just hit its target - are about which days exist, not about HTTP.
"""

from datetime import date, timedelta

import pytest

from app.models import Habit, HabitSchedule
from app.services import habits as svc

from .conftest import session_for


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def scene(client, register_and_login):
    """One workspace with an owner, an admin and a viewer, plus a second unrelated account."""
    tokens = {
        who: register_and_login(f"{who}@example.com")
        for who in ("owner", "admin", "viewer", "outsider")
    }
    board = client.post(
        "/api/boards", json={"title": "Board", "columns": ["Todo"]}, headers=headers(tokens["owner"])
    ).json()
    wid = board["workspace_id"]
    for who in ("admin", "viewer"):
        client.post(
            f"/api/workspaces/{wid}/invites",
            json={"email": f"{who}@example.com", "role": who},
            headers=headers(tokens["owner"]),
        )
    return {"wid": wid, "tokens": tokens, "board": board}


def make_habit(client, scene, who="owner", **body):
    body.setdefault("name", "Write every day")
    res = client.post(
        f"/api/workspaces/{scene['wid']}/habits", json=body, headers=headers(scene["tokens"][who])
    )
    assert res.status_code == 201, res.text
    return res.json()


def fake_habit(schedule=HabitSchedule.DAILY, target=1) -> Habit:
    """A habit that was never saved: `progress` only reads its schedule and target."""
    return Habit(name="x", schedule=schedule.value, target_per_week=target)


# --- the streak arithmetic -------------------------------------------------------------------


def test_a_daily_streak_counts_consecutive_days_up_to_today():
    today = date(2026, 10, 16)
    dates = {today, today - timedelta(days=1), today - timedelta(days=2)}
    state = svc.progress(fake_habit(), dates, today)
    assert (state.current_streak, state.done_today, state.due_today) == (3, True, False)
    assert state.unit == "day"


def test_today_being_unticked_does_not_break_a_daily_streak():
    """A streak must survive the morning: it anchors on yesterday until today is done."""
    today = date(2026, 10, 16)
    dates = {today - timedelta(days=1), today - timedelta(days=2)}
    state = svc.progress(fake_habit(), dates, today)
    assert state.current_streak == 2
    assert state.done_today is False
    assert state.due_today is True


def test_two_missed_days_break_a_daily_streak():
    today = date(2026, 10, 16)
    dates = {today - timedelta(days=2), today - timedelta(days=3)}
    state = svc.progress(fake_habit(), dates, today)
    assert state.current_streak == 0
    # The run that was broken is still the longest one on record.
    assert state.longest_streak == 2


def test_a_backfilled_day_repairs_the_streak_it_belongs_to():
    """Streaks are derived, so filling a gap mends it - a stored counter could not."""
    today = date(2026, 10, 16)
    broken = {today, today - timedelta(days=2), today - timedelta(days=3)}
    assert svc.progress(fake_habit(), broken, today).current_streak == 1
    repaired = broken | {today - timedelta(days=1)}
    assert svc.progress(fake_habit(), repaired, today).current_streak == 4


def test_a_weekly_streak_counts_weeks_not_days():
    """One tick a week keeps a weekly habit's streak alive, whichever day it falls on."""
    today = date(2026, 10, 16)  # a Friday
    dates = {today, today - timedelta(days=9), today - timedelta(days=13)}
    state = svc.progress(fake_habit(HabitSchedule.WEEKLY), dates, today)
    assert state.unit == "week"
    assert state.current_streak == 3
    assert (state.week_done, state.week_target) == (1, 1)
    assert state.due_today is False


def test_a_times_per_week_habit_is_due_until_the_week_hits_its_target():
    today = date(2026, 10, 16)
    habit = fake_habit(HabitSchedule.TIMES_PER_WEEK, target=3)
    monday = today - timedelta(days=today.weekday())
    two = {monday, monday + timedelta(days=1)}
    assert svc.progress(habit, two, today).due_today is True
    assert svc.progress(habit, two, today).current_streak == 0
    three = two | {monday + timedelta(days=2)}
    state = svc.progress(habit, three, today)
    assert (state.week_done, state.week_target, state.due_today) == (3, 3, False)
    assert state.current_streak == 1


def test_an_unmet_current_week_leaves_last_week_s_streak_standing():
    """The current week is open, so a weekly streak anchors on the last completed week."""
    today = date(2026, 10, 16)
    monday = today - timedelta(days=today.weekday())
    dates = {monday - timedelta(days=7), monday - timedelta(days=14)}
    state = svc.progress(fake_habit(HabitSchedule.WEEKLY), dates, today)
    assert state.current_streak == 2
    assert state.due_today is True


def test_history_is_limited_to_the_window_the_grid_draws():
    today = date(2026, 10, 16)
    dates = {today, today - timedelta(days=svc.HISTORY_DAYS + 5)}
    state = svc.progress(fake_habit(), dates, today)
    assert state.history == [today]
    # The older day still counts towards the total, which is the whole log.
    assert state.total_checkins == 2


# --- the habit itself -------------------------------------------------------------------------


def test_a_new_habit_starts_with_no_streak_and_is_due(client, scene):
    habit = make_habit(client, scene, name="Read 20 pages", detail="Any book")
    assert habit["name"] == "Read 20 pages"
    assert habit["detail"] == "Any book"
    assert habit["schedule"] == "daily"
    assert (habit["current_streak"], habit["done_today"], habit["due_today"]) == (0, False, True)
    assert habit["history"] == []


def test_checking_in_is_idempotent_and_reversible(client, scene):
    habit = make_habit(client, scene)
    owner = headers(scene["tokens"]["owner"])
    first = client.put(f"/api/habits/{habit['id']}/checkins", json={}, headers=owner).json()
    again = client.put(f"/api/habits/{habit['id']}/checkins", json={}, headers=owner).json()
    assert first["done_today"] is True
    assert (again["done_today"], again["total_checkins"]) == (True, 1)
    undone = client.put(
        f"/api/habits/{habit['id']}/checkins", json={"done": False}, headers=owner
    ).json()
    assert (undone["done_today"], undone["total_checkins"], undone["due_today"]) == (False, 0, True)


def test_a_day_can_be_backfilled_but_not_pre_dated(client, scene):
    habit = make_habit(client, scene)
    owner = headers(scene["tokens"]["owner"])
    yesterday = (svc.today() - timedelta(days=1)).isoformat()
    ok = client.put(
        f"/api/habits/{habit['id']}/checkins", json={"on_date": yesterday}, headers=owner
    )
    assert ok.status_code == 200
    assert ok.json()["current_streak"] == 1

    tomorrow = (svc.today() + timedelta(days=1)).isoformat()
    refused = client.put(
        f"/api/habits/{habit['id']}/checkins", json={"on_date": tomorrow}, headers=owner
    )
    assert refused.status_code == 422
    assert "has not happened yet" in refused.json()["detail"]


def test_changing_the_schedule_reinterprets_the_log_without_rewriting_it(client, scene):
    habit = make_habit(client, scene)
    owner = headers(scene["tokens"]["owner"])
    today = svc.today()
    monday = today - timedelta(days=today.weekday())
    client.put(
        f"/api/habits/{habit['id']}/checkins", json={"on_date": monday.isoformat()}, headers=owner
    )
    switched = client.patch(
        f"/api/habits/{habit['id']}", json={"schedule": "weekly"}, headers=owner
    )
    assert switched.status_code == 200
    body = switched.json()
    assert body["schedule"] == "weekly"
    assert body["total_checkins"] == 1
    assert (body["week_done"], body["week_target"]) == (1, 1)
    assert body["current_streak"] == 1


def test_a_times_per_week_habit_needs_a_target_in_range(client, scene):
    refused = client.post(
        f"/api/workspaces/{scene['wid']}/habits",
        json={"name": "Gym", "schedule": "times_per_week", "target_per_week": 9},
        headers=headers(scene["tokens"]["owner"]),
    )
    assert refused.status_code == 422


def test_an_unknown_colour_is_refused(client, scene):
    refused = client.post(
        f"/api/workspaces/{scene['wid']}/habits",
        json={"name": "Gym", "color": "#ff0000"},
        headers=headers(scene["tokens"]["owner"]),
    )
    assert refused.status_code == 422


def test_archiving_hides_a_habit_and_stops_it_asking_anything(client, scene):
    habit = make_habit(client, scene)
    owner = headers(scene["tokens"]["owner"])
    archived = client.post(f"/api/habits/{habit['id']}/archive", headers=owner).json()
    assert archived["archived_at"] is not None
    assert archived["due_today"] is False

    listed = client.get(f"/api/workspaces/{scene['wid']}/habits", headers=owner).json()
    assert listed == []
    with_archived = client.get(
        f"/api/workspaces/{scene['wid']}/habits?include_archived=true", headers=owner
    ).json()
    assert [h["id"] for h in with_archived] == [habit["id"]]

    refused = client.put(f"/api/habits/{habit['id']}/checkins", json={}, headers=owner)
    assert refused.status_code == 422

    restored = client.post(f"/api/habits/{habit['id']}/unarchive", headers=owner).json()
    assert restored["archived_at"] is None
    assert restored["due_today"] is True


def test_deleting_a_habit_takes_its_checkins_with_it(client, scene):
    habit = make_habit(client, scene)
    owner = headers(scene["tokens"]["owner"])
    client.put(f"/api/habits/{habit['id']}/checkins", json={}, headers=owner)
    assert client.delete(f"/api/habits/{habit['id']}", headers=owner).status_code == 204
    with session_for() as db:
        from app.models import HabitCheckin

        assert db.query(Habit).count() == 0
        assert db.query(HabitCheckin).count() == 0


def test_the_habit_count_is_capped(client, scene, monkeypatch):
    monkeypatch.setattr(svc, "MAX_HABITS", 2)
    make_habit(client, scene, name="One")
    make_habit(client, scene, name="Two")
    refused = client.post(
        f"/api/workspaces/{scene['wid']}/habits",
        json={"name": "Three"},
        headers=headers(scene["tokens"]["owner"]),
    )
    assert refused.status_code == 422


# --- who can see a habit ---------------------------------------------------------------------


def test_a_habit_is_invisible_to_everyone_else_including_an_admin(client, scene):
    habit = make_habit(client, scene, who="owner")
    for who in ("admin", "viewer", "outsider"):
        got = client.get(f"/api/habits/{habit['id']}", headers=headers(scene["tokens"][who]))
        # NotFound, never Forbidden: a 403 would confirm that the habit exists.
        assert got.status_code == 404, who
    for who in ("admin", "viewer"):
        listed = client.get(
            f"/api/workspaces/{scene['wid']}/habits", headers=headers(scene["tokens"][who])
        )
        # A member of the workspace sees their own habits there, which is none of them.
        assert listed.status_code == 200 and listed.json() == [], who
    # The outsider does not get as far as an empty list: the workspace itself is hidden.
    assert client.get(
        f"/api/workspaces/{scene['wid']}/habits", headers=headers(scene["tokens"]["outsider"])
    ).status_code == 404


def test_nobody_else_can_change_or_check_in_someone_s_habit(client, scene):
    habit = make_habit(client, scene, who="owner")
    for who in ("admin", "viewer", "outsider"):
        them = headers(scene["tokens"][who])
        assert client.patch(f"/api/habits/{habit['id']}", json={"name": "No"}, headers=them).status_code == 404
        assert client.put(f"/api/habits/{habit['id']}/checkins", json={}, headers=them).status_code == 404
        assert client.post(f"/api/habits/{habit['id']}/archive", headers=them).status_code == 404
        assert client.delete(f"/api/habits/{habit['id']}", headers=them).status_code == 404


def test_a_viewer_keeps_their_own_habits(client, scene):
    """A habit affects nobody else, so a read-only role is no reason to refuse one - the same
    reasoning that lets a viewer favourite a board."""
    habit = make_habit(client, scene, who="viewer", name="Review the roadmap")
    viewer = headers(scene["tokens"]["viewer"])
    assert client.put(f"/api/habits/{habit['id']}/checkins", json={}, headers=viewer).status_code == 200
    mine = client.get(f"/api/workspaces/{scene['wid']}/habits", headers=viewer).json()
    assert [h["name"] for h in mine] == ["Review the roadmap"]


def test_an_outsider_cannot_create_a_habit_in_a_workspace_they_are_not_in(client, scene):
    refused = client.post(
        f"/api/workspaces/{scene['wid']}/habits",
        json={"name": "Sneak"},
        headers=headers(scene["tokens"]["outsider"]),
    )
    assert refused.status_code == 404


def test_a_habit_writes_no_activity_and_no_notifications(client, scene):
    """Both surfaces are workspace-visible, so a personal one must not reach them at all."""
    habit = make_habit(client, scene)
    owner = headers(scene["tokens"]["owner"])
    client.put(f"/api/habits/{habit['id']}/checkins", json={}, headers=owner)
    client.patch(f"/api/habits/{habit['id']}", json={"name": "Renamed"}, headers=owner)
    client.post(f"/api/habits/{habit['id']}/archive", headers=owner)

    feed = client.get(f"/api/workspaces/{scene['wid']}/activity", headers=owner).json()
    assert not [row for row in feed if "habit" in row["action"]]
    with session_for() as db:
        from app.models import Notification

        assert db.query(Notification).count() == 0


# --- migration ---------------------------------------------------------------------------------


def test_migration_0020_adds_the_habit_tables_without_touching_board_data(client, scene):
    """0020 creates tables and rebuilds nothing, so the cascade trap in agents.md cannot bite."""
    import sqlalchemy as sa
    from alembic import command
    from alembic.config import Config

    from app.db import get_engine

    habit = make_habit(client, scene)
    owner = headers(scene["tokens"]["owner"])
    client.put(f"/api/habits/{habit['id']}/checkins", json={}, headers=owner)
    card = client.post(
        f"/api/columns/{scene['board']['columns'][0]['id']}/cards",
        json={"title": "Keep me"},
        headers=owner,
    ).json()

    command.downgrade(Config("alembic.ini"), "0019")
    command.upgrade(Config("alembic.ini"), "head")
    with get_engine().connect() as conn:
        assert conn.execute(sa.text("select count(*) from habits")).scalar() == 0
        assert conn.execute(sa.text("select count(*) from cards")).scalar() == 1
        kept = conn.execute(sa.text("select title from cards")).scalar()
    assert kept == card["title"]


# --- export ------------------------------------------------------------------------------------


def test_an_export_carries_my_habits_and_nobody_else_s(client, scene):
    """A habit is personal, so it is not the workspace's to hand out - not even to its owner."""
    mine = make_habit(client, scene, who="owner", name="Mine")
    make_habit(client, scene, who="admin", name="The admin's")
    owner = headers(scene["tokens"]["owner"])
    client.put(f"/api/habits/{mine['id']}/checkins", json={}, headers=owner)

    export = client.get(f"/api/workspaces/{scene['wid']}/export", headers=owner).json()
    assert [habit["name"] for habit in export["habits"]] == ["Mine"]
    assert len(export["habits"][0]["checkins"]) == 1

    admin_export = client.get(
        f"/api/workspaces/{scene['wid']}/export", headers=headers(scene["tokens"]["admin"])
    ).json()
    assert [habit["name"] for habit in admin_export["habits"]] == ["The admin's"]


def test_habits_are_not_in_workspace_search(client, scene):
    """Search is a workspace surface; a personal habit has no business turning up in it."""
    make_habit(client, scene, name="Searchable thing")
    found = client.get(
        f"/api/workspaces/{scene['wid']}/search?q=searchable",
        headers=headers(scene["tokens"]["owner"]),
    ).json()
    assert set(found) == {"cards", "notes", "goals"}


# --- the dashboard ----------------------------------------------------------------------------


def test_the_dashboard_overview_carries_my_habits_and_only_mine(client, scene):
    mine = make_habit(client, scene, who="owner", name="Mine")
    make_habit(client, scene, who="admin", name="The admin's")
    owner = headers(scene["tokens"]["owner"])

    overview = client.get(f"/api/workspaces/{scene['wid']}/overview", headers=owner).json()
    assert [habit["name"] for habit in overview["my_habits"]] == ["Mine"]
    assert overview["habits_due_today"] == 1

    client.put(f"/api/habits/{mine['id']}/checkins", json={}, headers=owner)
    after = client.get(f"/api/workspaces/{scene['wid']}/overview", headers=owner).json()
    assert after["habits_due_today"] == 0
    assert after["my_habits"][0]["done_today"] is True

    # The admin's dashboard shows the admin's habit, in the same workspace.
    theirs = client.get(
        f"/api/workspaces/{scene['wid']}/overview", headers=headers(scene["tokens"]["admin"])
    ).json()
    assert [habit["name"] for habit in theirs["my_habits"]] == ["The admin's"]
