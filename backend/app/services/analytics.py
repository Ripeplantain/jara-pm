"""Board analytics.

Everything here is derived from the same rows the board is drawn from: no separate counters to
drift out of step. Numbers a chart cannot honestly show are reported with their sample size
rather than rounded into something that looks authoritative.
"""

from collections import defaultdict
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Card, Column, Sprint, SprintState, User, WorkspaceMember
from app.services import permissions
from app.services.boards import board_for
from app.util.time import as_utc, now

DUE_SOON_DAYS = 7
THROUGHPUT_WEEKS = 8
STALE_DAYS = 14


def _live_cards(db: Session, board_id: int) -> list[Card]:
    return list(
        db.scalars(
            select(Card)
            .join(Column, Card.column_id == Column.id)
            .where(Column.board_id == board_id, Card.archived_at.is_(None))
        )
    )


def board_analytics(db: Session, user: User, board_id: int) -> dict:
    board = board_for(db, user, board_id)
    columns = list(
        db.scalars(select(Column).where(Column.board_id == board_id).order_by(Column.position))
    )
    cards = _live_cards(db, board_id)
    by_column = defaultdict(list)
    for card in cards:
        by_column[card.column_id].append(card)

    today = now()
    horizon = today + timedelta(days=DUE_SOON_DAYS)
    open_cards = [c for c in cards if c.completed_at is None]

    # Cycle time: only cards that have both ends of the measurement.
    finished = [c for c in cards if c.completed_at is not None]
    # Clamped at zero: a card created straight into a done column can finish a few microseconds
    # before its own created_at is written, and a negative cycle time is nonsense to show.
    durations = [
        max(0.0, (as_utc(c.completed_at) - as_utc(c.created_at)).total_seconds() / 3600)
        for c in finished
    ]

    # Throughput: completions per week, oldest week first, including empty weeks.
    weeks = []
    for index in range(THROUGHPUT_WEEKS - 1, -1, -1):
        end = today - timedelta(weeks=index)
        start = end - timedelta(weeks=1)
        weeks.append(
            {
                "week_starting": (start.date()).isoformat(),
                "completed": sum(
                    1 for c in finished if start < as_utc(c.completed_at) <= end
                ),
            }
        )

    members = list(
        db.scalars(
            select(WorkspaceMember)
            .where(WorkspaceMember.workspace_id == board.workspace_id)
            .order_by(WorkspaceMember.id)
        )
    )
    workload = [
        {
            "user_id": member.user_id,
            "name": member.user.name,
            "avatar_color": member.user.avatar_color,
            "open_cards": sum(1 for c in open_cards if c.assignee_id == member.user_id),
            "estimate": sum(c.estimate or 0 for c in open_cards if c.assignee_id == member.user_id),
        }
        for member in members
    ]
    workload.append(
        {
            "user_id": None,
            "name": "Unassigned",
            "avatar_color": "slate",
            "open_cards": sum(1 for c in open_cards if c.assignee_id is None),
            "estimate": sum(c.estimate or 0 for c in open_cards if c.assignee_id is None),
        }
    )

    return {
        "board_id": board_id,
        "total_cards": len(cards),
        "open_cards": len(open_cards),
        "completed_cards": len(finished),
        "columns": [
            {
                "column_id": column.id,
                "title": column.title,
                "count": len(by_column[column.id]),
                "wip_limit": column.wip_limit,
                "over_wip_limit": column.wip_limit is not None
                and len(by_column[column.id]) > column.wip_limit,
                "is_done": column.is_done,
            }
            for column in columns
        ],
        "throughput": weeks,
        "cycle_time_hours": round(sum(durations) / len(durations), 1) if durations else None,
        "cycle_time_sample": len(durations),
        "workload": workload,
        "overdue": sum(
            1 for c in open_cards if c.due_date is not None and as_utc(c.due_date) < today
        ),
        "due_soon": sum(
            1
            for c in open_cards
            if c.due_date is not None and today <= as_utc(c.due_date) <= horizon
        ),
        "unestimated": sum(1 for c in open_cards if c.estimate is None),
    }


def workspace_overview(db: Session, user: User, workspace_id: int) -> dict:
    """What the dashboard needs in one request: the boards, what is mine, what is late.

    One call rather than five, because the landing page is the most latency-sensitive screen in
    the app and its parts are useless separately.
    """
    from app.services import activity as activity_svc
    from app.services import boards as board_svc
    from app.services import search as search_svc

    permissions.require_workspace(db, user, workspace_id)
    boards = board_svc.list_boards(db, user, workspace_id)
    favorites = board_svc.favorite_board_ids(db, user)
    today = now()
    horizon = today + timedelta(days=DUE_SOON_DAYS)

    board_stats = []
    signals = []
    active_sprints = []
    stale_cutoff = today - timedelta(days=STALE_DAYS)
    for board in boards:
        cards = _live_cards(db, board.id)
        columns = list(db.scalars(select(Column).where(Column.board_id == board.id)))
        columns_by_id = {column.id: column for column in columns}
        sprint = db.scalar(
            select(Sprint).where(
                Sprint.board_id == board.id,
                Sprint.state == SprintState.ACTIVE.value,
            )
        )
        if sprint:
            sprint_cards = [card for card in cards if card.sprint_id == sprint.id]
            done_sprint_cards = [card for card in sprint_cards if columns_by_id[card.column_id].is_done]
            active_sprints.append({
                "board_id": board.id,
                "board_title": board.title,
                "sprint_id": sprint.id,
                "name": sprint.name,
                "total": len(sprint_cards),
                "done": len(done_sprint_cards),
                "estimate_total": sum(card.estimate or 0 for card in sprint_cards),
                "estimate_done": sum(card.estimate or 0 for card in done_sprint_cards),
                "ends_on": sprint.ends_on.isoformat() if sprint.ends_on else None,
            })
            if sprint.ends_on and sprint.ends_on < today.date() and len(done_sprint_cards) < len(sprint_cards):
                signals.append({
                    "kind": "sprint_spillover",
                    "severity": "warning",
                    "title": f"Sprint spillover on {board.title}",
                    "detail": "The active sprint is past its end date with unfinished work.",
                    "board_id": board.id,
                })
        open_cards = [c for c in cards if c.completed_at is None]
        overdue = sum(
            1 for c in open_cards if c.due_date is not None and as_utc(c.due_date) < today
        )
        stale = [c for c in open_cards if as_utc(c.updated_at) < stale_cutoff]
        blocked = [
            c for c in open_cards
            if "block" in columns_by_id[c.column_id].title.lower()
            or "blocked" in c.title.lower()
        ]
        over_limit = [
            column for column in columns
            if column.wip_limit is not None
            and sum(1 for card in open_cards if card.column_id == column.id) > column.wip_limit
        ]
        unassigned = [card for card in open_cards if card.assignee_id is None]
        board_stats.append(
            {
                "board_id": board.id,
                "title": board.title,
                "is_favorite": board.id in favorites,
                "total_cards": len(cards),
                "open_cards": len(open_cards),
                "overdue": overdue,
            }
        )
        if overdue:
            overdue_word = "card" if overdue == 1 else "cards"
            signals.append({
                "kind": "overdue",
                "severity": "danger",
                "title": f"{overdue} overdue {overdue_word}",
                "detail": f"Review due dates on {board.title} before planning more work.",
                "board_id": board.id,
            })
        if blocked:
            blocked_word = "card" if len(blocked) == 1 else "cards"
            signals.append({
                "kind": "blocked",
                "severity": "warning",
                "title": f"{len(blocked)} blocked {blocked_word}",
                "detail": "A blocked column or explicit blocked card title was detected.",
                "board_id": board.id,
                "card_id": blocked[0].id if len(blocked) == 1 else None,
            })
        if over_limit:
            column_word = " is" if len(over_limit) == 1 else "s are"
            signals.append({
                "kind": "wip",
                "severity": "warning",
                "title": "Work-in-progress pressure",
                "detail": f"{len(over_limit)} column{column_word} over its WIP limit.",
                "board_id": board.id,
            })
        if stale:
            stale_word = "card" if len(stale) == 1 else "cards"
            signals.append({
                "kind": "stale",
                "severity": "info",
                "title": f"{len(stale)} stale {stale_word}",
                "detail": f"No updates in the last {STALE_DAYS} days; check whether the work is still active.",
                "board_id": board.id,
                "card_id": stale[0].id if len(stale) == 1 else None,
            })
        if unassigned:
            card_word = "card" if len(unassigned) == 1 else "cards"
            signals.append({
                "kind": "missing_ownership",
                "severity": "info",
                "title": f"{len(unassigned)} unassigned {card_word}",
                "detail": "Give active work an owner so the team can make a clear commitment.",
                "board_id": board.id,
                "card_id": unassigned[0].id if len(unassigned) == 1 else None,
            })

    mine = search_svc.my_cards(db, user, workspace_id)
    from app.services import notifications as notification_svc

    notification_svc.sync_ai_signals(db, user, workspace_id, signals[:20])
    return {
        "workspace_id": workspace_id,
        "boards": board_stats,
        "my_open_cards": len(mine),
        "my_overdue": sum(
            1 for c in mine if c.due_date is not None and as_utc(c.due_date) < today
        ),
        "my_due_soon": sum(
            1 for c in mine if c.due_date is not None and today <= as_utc(c.due_date) <= horizon
        ),
        "recent_activity": activity_svc.for_workspace(db, user, workspace_id, limit=10),
        "signals": signals[:20],
        "active_sprints": active_sprints,
    }
