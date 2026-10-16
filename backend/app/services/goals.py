"""Goals, their milestones, and the progress both derive from real board state.

The only code that writes goal data; used by the HTTP routers and the AI tools, exactly as
`services/boards.py` is for boards.

**Progress is never written.** A link points at a board, a sprint or a card; the link resolves
to a set of live cards, and the share of those cards sitting in a column flagged `is_done` is
the progress. Nothing here stores a percentage, so a goal cannot drift away from the board it
describes, and moving a card is the only way to move a goal.

**How the rollup composes.** Each milestone is one group, and the goal's own direct links, if
it has any, are one more. A group's percentage is its done cards over its total cards, and the
goal's percentage is the mean of its groups' percentages - equal weight, so a milestone with
three cards counts as much as one with thirty. That is a deliberate choice: a milestone is a
step towards the goal, and steps are not comparable in card count. A goal with no groups at all
has no evidence, and says so rather than reporting 0% as though it were measured.

**Links are validated, then resolved loosely.** A link is checked against the workspace before
it is written, so a goal can never point at another tenant's board. Afterwards the target is a
plain integer (as in `NoteLink`), so a deleted card drops out of the rollup instead of cascading
into the goal; a link that no longer resolves is reported as unresolved rather than counted.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    GOAL_LINK_TYPES,
    Board,
    Card,
    Column,
    Goal,
    GoalLink,
    GoalMilestone,
    GoalState,
    Sprint,
    User,
    WorkspaceRole,
)
from app.services import activity, permissions
from app.services.boards import _fresh, _insert, _renumber, board_for
from app.services.errors import InvalidRequest, NotFound

VIEWER = WorkspaceRole.VIEWER
MEMBER = WorkspaceRole.MEMBER

MAX_MILESTONES = 20
"""A goal with more steps than this is a board, and Kobi already has boards."""

MAX_LINKS = 100
"""Per goal, counting its milestones' links. A ceiling on how much one rollup can read."""

UNSET: Any = object()
"""Sentinel for "leave this field alone", as in `services/boards`."""


# --- progress ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class CardSet:
    """The live cards one group of links resolves to, and what they add up to."""

    total: int
    done: int
    unresolved: int
    """Links that no longer point at live work: the board, sprint or card was deleted, or the
    card was archived, which takes it off the board and so out of the rollup. Reported to the
    caller so the UI can offer to clean them up, and never counted towards progress."""

    @property
    def percent(self) -> int:
        return round(self.done / self.total * 100) if self.total else 0


def _resolve(db: Session, workspace_id: int, links: list[GoalLink]) -> CardSet:
    """Turn links into one set of live cards. A card reached twice is counted once.

    Everything is scoped to the goal's workspace a second time here, not because a link could
    have been written across tenants - `_check_link` refuses that - but because a workspace id
    in the query is what keeps that true if a board is ever moved.
    """
    board_ids = {link.target_id for link in links if link.target_type == "board"}
    sprint_ids = {link.target_id for link in links if link.target_type == "sprint"}
    card_ids = {link.target_id for link in links if link.target_type == "card"}

    live_cards = (
        select(Card.id, Card.completed_at)
        .join(Column, Card.column_id == Column.id)
        .join(Board, Column.board_id == Board.id)
        .where(Board.workspace_id == workspace_id, Card.archived_at.is_(None))
    )
    reached: dict[int, bool] = {}

    def collect(condition) -> set[int]:
        """Add the cards this condition reaches, and say which ones they were."""
        found = set()
        for card_id, completed_at in db.execute(live_cards.where(condition)):
            reached[card_id] = completed_at is not None
            found.add(card_id)
        return found

    if board_ids:
        collect(Column.board_id.in_(board_ids))
    if sprint_ids:
        collect(Card.sprint_id.in_(sprint_ids))
    live_linked_cards = collect(Card.id.in_(card_ids)) if card_ids else set()

    # A board or sprint that exists but holds no cards is resolved and contributes nothing; one
    # that has been deleted is unresolved, and the UI says so instead of silently shrinking.
    live_boards = set(
        db.scalars(
            select(Board.id).where(Board.id.in_(board_ids), Board.workspace_id == workspace_id)
        )
    )
    live_sprints = set(
        db.scalars(
            select(Sprint.id)
            .join(Board, Sprint.board_id == Board.id)
            .where(Sprint.id.in_(sprint_ids), Board.workspace_id == workspace_id)
        )
    )
    unresolved = (
        len(board_ids - live_boards)
        + len(sprint_ids - live_sprints)
        + len(card_ids - live_linked_cards)
    )
    return CardSet(
        total=len(reached),
        done=sum(1 for done in reached.values() if done),
        unresolved=unresolved,
    )


@dataclass(frozen=True)
class LinkTargets:
    """What a goal's links currently point at, resolved on read rather than stored.

    Same reasoning as a note embed's caption: a renamed board renames its links, and a deleted
    one leaves an empty title that the UI shows as unavailable instead of a caption that lies.
    """

    titles: dict[tuple[str, int], str]
    board_of_card: dict[int, int]

    def view(self, link: GoalLink) -> dict:
        board_id = (
            link.target_id
            if link.target_type == "board"
            else self.board_of_card.get(link.target_id)
            if link.target_type == "card"
            else None
        )
        return {
            "id": link.id,
            "milestone_id": link.milestone_id,
            "target_type": link.target_type,
            "target_id": link.target_id,
            "target_title": self.titles.get((link.target_type, link.target_id), ""),
            # Where to go to see the work: a card's board, or the board itself.
            "board_id": board_id,
        }


def _targets(db: Session, links: list[GoalLink]) -> LinkTargets:
    """Current titles for every link target, and the board a linked card sits on."""
    titles: dict[tuple[str, int], str] = {}
    board_of_card: dict[int, int] = {}
    board_ids = {link.target_id for link in links if link.target_type == "board"}
    sprint_ids = {link.target_id for link in links if link.target_type == "sprint"}
    card_ids = {link.target_id for link in links if link.target_type == "card"}
    if board_ids:
        for board_id, title in db.execute(
            select(Board.id, Board.title).where(Board.id.in_(board_ids))
        ):
            titles[("board", board_id)] = title
    if sprint_ids:
        for sprint_id, name in db.execute(
            select(Sprint.id, Sprint.name).where(Sprint.id.in_(sprint_ids))
        ):
            titles[("sprint", sprint_id)] = name
    if card_ids:
        rows = db.execute(
            select(Card.id, Card.title, Column.board_id)
            .join(Column, Card.column_id == Column.id)
            .where(Card.id.in_(card_ids))
        )
        for card_id, title, board_id in rows:
            titles[("card", card_id)] = title
            board_of_card[card_id] = board_id
    return LinkTargets(titles=titles, board_of_card=board_of_card)


def view(db: Session, goal: Goal) -> dict:
    """A goal with its milestones, links and the progress all of it rolls up to.

    This is the one place progress is computed, so the goals page, the dashboard, the export and
    the AI all read the same numbers.
    """
    links = list(goal.links)
    targets = _targets(db, links)
    by_milestone: dict[int | None, list[GoalLink]] = {}
    for link in links:
        by_milestone.setdefault(link.milestone_id, []).append(link)

    groups: list[int] = []
    milestones = []
    for milestone in goal.milestones:
        own = by_milestone.get(milestone.id, [])
        cards = _resolve(db, goal.workspace_id, own)
        groups.append(cards.percent)
        milestones.append(
            {
                "id": milestone.id,
                "goal_id": goal.id,
                "title": milestone.title,
                "target_date": milestone.target_date,
                "position": milestone.position,
                "cards_total": cards.total,
                "cards_done": cards.done,
                "unresolved_links": cards.unresolved,
                "percent": cards.percent,
                "links": [targets.view(link) for link in own],
            }
        )

    direct = by_milestone.get(None, [])
    direct_cards = _resolve(db, goal.workspace_id, direct)
    if direct:
        groups.append(direct_cards.percent)

    everything = _resolve(db, goal.workspace_id, links)
    return {
        "id": goal.id,
        "workspace_id": goal.workspace_id,
        "title": goal.title,
        "detail": goal.detail,
        "state": goal.state,
        "starts_on": goal.starts_on,
        "target_date": goal.target_date,
        "created_at": goal.created_at,
        "updated_at": goal.updated_at,
        "achieved_at": goal.achieved_at,
        "percent": round(sum(groups) / len(groups)) if groups else 0,
        # Totals across every link, so the UI can say "14 of 22 cards" beside the percentage.
        "cards_total": everything.total,
        "cards_done": everything.done,
        "unresolved_links": everything.unresolved,
        # False when nothing is linked yet - including a goal that has milestones but no links
        # on any of them. There is then no progress to report, which is different from
        # measuring 0%, and the UI says so instead of drawing an empty bar.
        "has_evidence": bool(links),
        "milestones": milestones,
        "links": [targets.view(link) for link in direct],
    }


# --- scoped lookups ---------------------------------------------------------------------------


def goal_for(db: Session, user: User, goal_id: int, minimum: WorkspaceRole = VIEWER) -> Goal:
    """Load a goal the user may act on. `permissions.require_goal` is what decides."""
    access = permissions.require_goal(db, user, goal_id, minimum)
    goal = db.scalar(
        _fresh(select(Goal).where(Goal.id == goal_id, Goal.workspace_id == access.workspace_id))
    )
    if goal is None:
        raise NotFound("Goal")
    return goal


def list_goals(
    db: Session, user: User, workspace_id: int, include_archived: bool = False
) -> list[Goal]:
    """Every goal in the workspace: a goal is team-visible, like a board.

    Ordered by target date, soonest first, with undated goals last - a goals page is read as a
    schedule, so that is the order it is drawn in.
    """
    permissions.require_workspace(db, user, workspace_id)
    stmt = (
        select(Goal)
        .where(Goal.workspace_id == workspace_id)
        .order_by(Goal.target_date.is_(None), Goal.target_date, Goal.id)
    )
    if not include_archived:
        stmt = stmt.where(Goal.state != GoalState.ARCHIVED.value)
    return list(db.scalars(_fresh(stmt)))


def views(
    db: Session, user: User, workspace_id: int, include_archived: bool = False
) -> list[dict]:
    return [view(db, goal) for goal in list_goals(db, user, workspace_id, include_archived)]


def view_for(db: Session, user: User, goal_id: int) -> dict:
    return view(db, goal_for(db, user, goal_id))


def _milestone(
    db: Session, user: User, milestone_id: int, minimum: WorkspaceRole = MEMBER
) -> GoalMilestone:
    """A milestone is reached through its goal, which is what enforces membership and role."""
    milestone = db.get(GoalMilestone, milestone_id)
    if milestone is None:
        raise NotFound("Milestone")
    try:
        goal_for(db, user, milestone.goal_id, minimum)
    except NotFound:
        raise NotFound("Milestone") from None
    return milestone


def _milestones_of(db: Session, goal_id: int) -> list[GoalMilestone]:
    return list(
        db.scalars(
            _fresh(
                select(GoalMilestone)
                .where(GoalMilestone.goal_id == goal_id)
                .order_by(GoalMilestone.position, GoalMilestone.id)
            )
        )
    )


# --- history ----------------------------------------------------------------------------------


def _record(db: Session, user: User, goal: Goal, action: str, summary: str) -> None:
    """One history row per goal change. A goal is workspace-visible, so all of it is logged."""
    activity.record(
        db,
        user,
        goal.workspace_id,
        action,
        summary,
        entity_type=activity.GOAL,
        entity_id=goal.id,
    )


def _touch(goal: Goal) -> None:
    goal.updated_at = datetime.now(UTC)


# --- goals ------------------------------------------------------------------------------------


def create_goal(
    db: Session,
    user: User,
    workspace_id: int,
    title: str,
    detail: str = "",
    starts_on: date | None = None,
    target_date: date | None = None,
    milestones: list[str] | None = None,
) -> Goal:
    """Create a goal, optionally with its first milestones. One transaction."""
    permissions.require_workspace(db, user, workspace_id, MEMBER)
    steps = milestones or []
    if len(steps) > MAX_MILESTONES:
        raise InvalidRequest(f"A goal holds at most {MAX_MILESTONES} milestones")
    _check_dates(starts_on, target_date)

    goal = Goal(
        workspace_id=workspace_id,
        created_by_id=user.id,
        title=title,
        detail=detail,
        starts_on=starts_on,
        target_date=target_date,
    )
    db.add(goal)
    db.flush()
    for index, step in enumerate(steps):
        db.add(GoalMilestone(goal_id=goal.id, title=step, position=index))
    _record(db, user, goal, activity.GOAL_CREATED, f"set the goal “{goal.title}”")
    db.commit()
    return goal_for(db, user, goal.id)


def _check_dates(starts_on: date | None, target_date: date | None) -> None:
    if starts_on is not None and target_date is not None and target_date < starts_on:
        raise InvalidRequest("A goal's target date cannot be before it starts")


def update_goal(
    db: Session,
    user: User,
    goal_id: int,
    title: Any = UNSET,
    detail: Any = UNSET,
    starts_on: Any = UNSET,
    target_date: Any = UNSET,
    state: Any = UNSET,
) -> Goal:
    """Absent fields are left alone. `state` is the only way a goal is closed or archived."""
    goal = goal_for(db, user, goal_id, MEMBER)
    wanted_start = goal.starts_on if starts_on is UNSET else starts_on
    wanted_target = goal.target_date if target_date is UNSET else target_date
    _check_dates(wanted_start, wanted_target)

    renamed = title is not UNSET and title != goal.title
    if title is not UNSET:
        goal.title = title
    if detail is not UNSET:
        goal.detail = detail
    goal.starts_on = wanted_start
    goal.target_date = wanted_target

    if state is not UNSET:
        chosen = GoalState(state)
        if chosen is not goal.state_enum:
            goal.state = chosen.value
            # Stamped when the goal is closed and cleared if it is reopened, so the date always
            # belongs to the state it is shown with.
            goal.achieved_at = datetime.now(UTC) if chosen is GoalState.ACHIEVED else None
            _record(db, user, goal, _STATE_ACTIONS[chosen], _STATE_SUMMARIES[chosen](goal.title))
    elif renamed:
        _record(db, user, goal, activity.GOAL_UPDATED, f"renamed a goal to “{goal.title}”")
    _touch(goal)
    db.commit()
    return goal_for(db, user, goal.id)


_STATE_ACTIONS = {
    GoalState.ACTIVE: activity.GOAL_UPDATED,
    GoalState.ACHIEVED: activity.GOAL_ACHIEVED,
    GoalState.ARCHIVED: activity.GOAL_ARCHIVED,
}

_STATE_SUMMARIES = {
    GoalState.ACTIVE: lambda title: f"reopened the goal “{title}”",
    GoalState.ACHIEVED: lambda title: f"achieved the goal “{title}”",
    GoalState.ARCHIVED: lambda title: f"archived the goal “{title}”",
}


def delete_goal(db: Session, user: User, goal_id: int) -> None:
    """Hard delete, with the milestones and links under it. Archiving is the reversible option.

    The history row is written before the delete: `entity_id` is a plain integer precisely so
    the row outlives the goal it describes.
    """
    goal = goal_for(db, user, goal_id, MEMBER)
    _record(db, user, goal, activity.GOAL_DELETED, f"deleted the goal “{goal.title}”")
    db.delete(goal)
    db.commit()


# --- milestones -------------------------------------------------------------------------------


def add_milestone(
    db: Session,
    user: User,
    goal_id: int,
    title: str,
    target_date: date | None = None,
    position: int | None = None,
) -> Goal:
    goal = goal_for(db, user, goal_id, MEMBER)
    siblings = _milestones_of(db, goal.id)
    if len(siblings) >= MAX_MILESTONES:
        raise InvalidRequest(f"A goal holds at most {MAX_MILESTONES} milestones")
    milestone = GoalMilestone(goal_id=goal.id, title=title, target_date=target_date, position=0)
    db.add(milestone)
    db.flush()
    _insert(siblings, milestone, position)
    _touch(goal)
    _record(
        db,
        user,
        goal,
        activity.GOAL_UPDATED,
        f"added the milestone “{title}” to “{goal.title}”",
    )
    db.commit()
    return goal_for(db, user, goal.id)


def update_milestone(
    db: Session,
    user: User,
    milestone_id: int,
    title: Any = UNSET,
    target_date: Any = UNSET,
    position: int | None = None,
) -> Goal:
    """Rename, re-date or reorder one milestone. Siblings stay contiguous."""
    milestone = _milestone(db, user, milestone_id)
    goal = goal_for(db, user, milestone.goal_id, MEMBER)
    if title is not UNSET:
        milestone.title = title
    if target_date is not UNSET:
        milestone.target_date = target_date
    if position is not None:
        siblings = [m for m in _milestones_of(db, goal.id) if m.id != milestone.id]
        _insert(siblings, milestone, position)
    _touch(goal)
    db.commit()
    return goal_for(db, user, goal.id)


def delete_milestone(db: Session, user: User, milestone_id: int) -> Goal:
    """Removes the milestone and the links hanging off it; the goal's own links are untouched."""
    milestone = _milestone(db, user, milestone_id)
    goal = goal_for(db, user, milestone.goal_id, MEMBER)
    remaining = [m for m in _milestones_of(db, goal.id) if m.id != milestone.id]
    db.delete(milestone)
    _renumber(remaining)
    _touch(goal)
    db.commit()
    return goal_for(db, user, goal.id)


# --- links ------------------------------------------------------------------------------------


def _check_link(db: Session, user: User, goal: Goal, target_type: str, target_id: int) -> str:
    """Validate a link against real state before it is written, and name what it points at.

    The board, sprint or card has to exist, be in the goal's workspace, and be one the acting
    user can already reach - which `board_for` decides, so a goal can never become a way to
    learn about a board you are not a member of.
    """
    if target_type not in GOAL_LINK_TYPES:
        raise InvalidRequest(f"A goal links to a {', a '.join(GOAL_LINK_TYPES)}")
    if target_type == "board":
        board = board_for(db, user, target_id)
        if board.workspace_id != goal.workspace_id:
            raise InvalidRequest("That board belongs to a different workspace")
        return board.title
    if target_type == "sprint":
        sprint = db.get(Sprint, target_id)
        if sprint is None:
            raise NotFound("Sprint")
        board = board_for(db, user, sprint.board_id)
        if board.workspace_id != goal.workspace_id:
            raise InvalidRequest("That sprint belongs to a different workspace")
        return sprint.name
    card = db.get(Card, target_id)
    if card is None:
        raise NotFound("Card")
    board_id = activity.board_id_of_card(db, card)
    if board_id is None or board_for(db, user, board_id).workspace_id != goal.workspace_id:
        raise InvalidRequest("That card belongs to a different workspace")
    return card.title


def add_link(
    db: Session,
    user: User,
    goal_id: int,
    target_type: str,
    target_id: int,
    milestone_id: int | None = None,
) -> Goal:
    """Point a goal, or one of its milestones, at real work."""
    goal = goal_for(db, user, goal_id, MEMBER)
    if milestone_id is not None:
        milestone = _milestone(db, user, milestone_id)
        if milestone.goal_id != goal.id:
            raise InvalidRequest("That milestone belongs to a different goal")
    title = _check_link(db, user, goal, target_type, target_id)
    if len(goal.links) >= MAX_LINKS:
        raise InvalidRequest(f"A goal links to at most {MAX_LINKS} pieces of work")
    # Checked here rather than by a unique constraint: SQLite treats NULL milestone_ids as
    # distinct, so the constraint would miss exactly the goal-level duplicates.
    duplicate = db.scalar(
        select(GoalLink).where(
            GoalLink.goal_id == goal.id,
            GoalLink.milestone_id.is_(None)
            if milestone_id is None
            else GoalLink.milestone_id == milestone_id,
            GoalLink.target_type == target_type,
            GoalLink.target_id == target_id,
        )
    )
    if duplicate is not None:
        raise InvalidRequest("That work is already linked here")

    db.add(
        GoalLink(
            goal_id=goal.id,
            milestone_id=milestone_id,
            target_type=target_type,
            target_id=target_id,
        )
    )
    _touch(goal)
    _record(
        db, user, goal, activity.GOAL_UPDATED, f"linked “{title}” to the goal “{goal.title}”"
    )
    db.commit()
    return goal_for(db, user, goal.id)


def remove_link(db: Session, user: User, link_id: int) -> Goal:
    link = db.get(GoalLink, link_id)
    if link is None:
        raise NotFound("Link")
    try:
        goal = goal_for(db, user, link.goal_id, MEMBER)
    except NotFound:
        raise NotFound("Link") from None
    db.delete(link)
    _touch(goal)
    db.commit()
    return goal_for(db, user, goal.id)


__all__ = [
    "InvalidRequest",
    "NotFound",
    "add_link",
    "add_milestone",
    "create_goal",
    "delete_goal",
    "delete_milestone",
    "goal_for",
    "list_goals",
    "remove_link",
    "update_goal",
    "update_milestone",
    "view",
    "view_for",
    "views",
]
