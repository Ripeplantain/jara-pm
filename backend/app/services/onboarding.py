"""First-run setup: workspace context, a starter board, sprint and optional teammates."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import OnboardingProfile, User, WorkspaceRole
from app.schemas.onboarding import OnboardingRequest
from app.services import product_analytics, sprints, templates, workspaces
from app.services.errors import Conflict
from app.util.time import now


def status(db: Session, user: User) -> OnboardingProfile | None:
    return db.scalar(select(OnboardingProfile).where(OnboardingProfile.user_id == user.id))


def complete(db: Session, user: User, body: OnboardingRequest) -> OnboardingProfile:
    existing = status(db, user)
    if existing is not None:
        raise Conflict("Onboarding is already complete")

    workspace = next(
        workspace
        for workspace in workspaces.list_workspaces(db, user)
        if workspaces.membership(db, user, workspace.id).role_enum.at_least(WorkspaceRole.ADMIN)
    )
    workspace.name = body.workspace_name
    db.commit()

    board = templates.create_board_from_template(
        db, user, body.board_template, body.workspace_name, workspace.id
    )
    starts_on = body.starts_on or datetime.now(UTC).date()
    ends_on = body.ends_on or starts_on + timedelta(days=14)
    sprint = sprints.create_sprint(
        db, user, board.id, body.sprint_name, body.sprint_goal, starts_on, ends_on
    )

    for invite in body.invites:
        try:
            workspaces.invite_member(db, user, workspace.id, invite.email, invite.role)
        except workspaces.AlreadyRegistered:
            workspaces.add_member(db, user, workspace.id, invite.email, invite.role)

    profile = OnboardingProfile(
        user_id=user.id,
        workspace_id=workspace.id,
        team_size=body.team_size,
        product_context=body.product_context,
        board_id=board.id,
        sprint_id=sprint.id,
        completed_at=now(),
    )
    db.add(profile)
    product_analytics.track(db, "onboarding_completed", user=user, workspace_id=workspace.id)
    db.commit()
    db.refresh(profile)
    return profile


def complete_demo(db: Session, user: User) -> OnboardingProfile:
    return complete(
        db,
        user,
        OnboardingRequest(
            workspace_name="My product",
            product_context="A small product team turning customer needs into focused releases.",
            team_size=3,
            board_template="product-roadmap",
            sprint_name="First sprint",
            sprint_goal="Turn the clearest product opportunity into a shippable slice.",
        ),
    )


__all__ = ["complete", "complete_demo", "status"]
