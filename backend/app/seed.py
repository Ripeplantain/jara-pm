"""Demo data: one workspace, two people, two boards, labels, a running sprint.

    docker compose exec backend python -m app.seed

Everything goes through the service layer, exactly as the UI and the AI do, so the seeded state
is reachable state: the activity feed and the notifications are real, not backfilled.

It refuses to run against a database that already has the demo accounts, so re-running it is
safe and it will never quietly change data someone is using.
"""

import sys
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.db import get_engine
from app.models import Column, User, WorkspaceRole
from app.services import auth as auth_service
from app.services import boards as board_svc
from app.services import card_details as detail_svc
from app.services import labels as label_svc
from app.services import sprints as sprint_svc
from app.services import templates as template_svc
from app.services import workspaces as workspace_svc
from app.util.time import now

PASSWORD = "demo-password"
DANA = "dana@example.com"
SAM = "sam@example.com"


def _session() -> Session:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)()


def seed(db: Session) -> None:
    if db.scalar(select(User).where(User.email.in_([DANA, SAM]))):
        print("The demo accounts already exist; nothing to do.")
        return

    dana = auth_service.register_user(db, DANA, PASSWORD)
    sam = auth_service.register_user(db, SAM, PASSWORD)
    auth_service.update_profile(db, dana, "Dana Okoro", "indigo")
    auth_service.update_profile(db, sam, "Sam Patel", "emerald")

    workspace = workspace_svc.create_workspace(db, dana, "Orchid (demo)")
    workspace_svc.add_member(db, dana, workspace.id, SAM, WorkspaceRole.MEMBER)

    # A roadmap board from a template: columns, starter cards, labels and a done column.
    roadmap = template_svc.create_board_from_template(
        db, dana, "product-roadmap", "Orchid roadmap", workspace.id
    )
    labels = {lb.name: lb for lb in label_svc.list_labels(db, dana, workspace.id)}
    by_title = {c.title: c for c in roadmap.columns}

    now_col, next_col, shipped = by_title["Now"], by_title["Next"], by_title["Shipped"]
    board_svc.update_column(db, dana, by_title["Now"].id, wip_limit=2)

    onboarding = board_svc.create_card(
        db,
        dana,
        now_col.id,
        "Rewrite the onboarding flow",
        "Three steps instead of six. Measure completion, not clicks.",
        assignee_id=sam.id,
        priority="high",
        due_date=now() + timedelta(days=3),
        estimate=8,
    )
    label_svc.add_label_to_card(db, dana, onboarding.id, labels["strategic"].id)
    for step in ("Draft the three screens", "Review with support", "Ship behind a flag"):
        detail_svc.add_checklist_item(db, dana, onboarding.id, step)
    detail_svc.update_checklist_item(
        db, dana, detail_svc.list_checklist(db, dana, onboarding.id)[0].id, done=True
    )
    detail_svc.add_comment(db, sam, onboarding.id, "Started on this. @Dana Okoro, is copy final?")

    pricing = board_svc.create_card(
        db,
        dana,
        now_col.id,
        "Usage-based pricing",
        "Blocked on the billing provider's sandbox.",
        assignee_id=dana.id,
        priority="urgent",
        due_date=now() - timedelta(days=2),  # deliberately overdue, so Insights has something
        estimate=13,
    )
    label_svc.add_label_to_card(db, dana, pricing.id, labels["customer request"].id)

    for title, priority in (
        ("Bulk invite from CSV", "medium"),
        ("Keyboard shortcuts", "low"),
        ("Weekly digest email", "low"),
    ):
        board_svc.create_card(db, dana, next_col.id, title, priority=priority, estimate=3)

    shipped_card = board_svc.create_card(
        db, dana, shipped.id, "Dark mode", assignee_id=sam.id, estimate=5
    )

    # A sprint that is actually running, with the two cards in Now planned into it.
    sprint = sprint_svc.create_sprint(
        db,
        dana,
        roadmap.id,
        "Sprint 14",
        "Onboarding and pricing, nothing else.",
        starts_on=(now() - timedelta(days=4)).date(),
        ends_on=(now() + timedelta(days=6)).date(),
    )
    for card in (onboarding, pricing, shipped_card):
        sprint_svc.set_card_sprint(db, dana, card.id, sprint.id)
    sprint_svc.start_sprint(db, dana, sprint.id)

    # A second board, so the workspace switcher and the board list have something to show.
    triage = template_svc.create_board_from_template(
        db, sam, "bug-triage", "Bug triage", workspace.id
    )
    reported = next(c for c in triage.columns if c.title == "Reported")
    bug = board_svc.create_card(
        db,
        sam,
        reported.id,
        "Board drag drops the card in the wrong column on iOS",
        "Only at narrow widths, only in Safari.",
        assignee_id=dana.id,
        priority="urgent",
        due_date=now() + timedelta(days=1),
    )
    bug_labels = {lb.name: lb for lb in label_svc.list_labels(db, sam, workspace.id)}
    label_svc.add_label_to_card(db, sam, bug.id, bug_labels["critical"].id)
    board_svc.update_board(db, dana, roadmap.id, description="What we are building this quarter.")
    board_svc.set_favorite(db, dana, roadmap.id, True)

    print(f"Seeded the workspace “{workspace.name}”.")
    print(f"  Sign in as {DANA} (owner) or {SAM} (member), password: {PASSWORD}")
    print(f"  Boards: “{roadmap.title}” and “{triage.title}”")


def main() -> int:
    with _session() as db:
        # A missing table means migrations have not run; say so rather than half-seeding.
        if db.scalar(select(Column).limit(1)) is None and not _tables_exist(db):
            print("The database has no schema yet. Start the backend once, or run "
                  "`alembic upgrade head`, then seed.", file=sys.stderr)
            return 1
        seed(db)
    return 0


def _tables_exist(db: Session) -> bool:
    from sqlalchemy import inspect

    return "workspaces" in inspect(db.get_bind()).get_table_names()


if __name__ == "__main__":  # pragma: no cover - entry point
    raise SystemExit(main())
