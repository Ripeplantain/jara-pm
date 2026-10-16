"""Minimal product analytics without collecting card text, prompts or email content.

Each event is written twice: a row in `product_events`, which backs the seven-day rollup on
`GET /api/health/metrics`, and a queued PostHog event, which backs the funnels and retention
reports. Both happen inside the caller's transaction, so a rolled-back change produces
neither. `services/posthog_client.py` is the only sink; this is the only funnel through which
product milestones reach it.
"""

import json
from datetime import timedelta

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from app.models import ProductEvent, User
from app.services import posthog_client
from app.util.time import now

EVENTS = {
    "onboarding_completed",
    "board_created",
    "card_created",
    "sprint_created",
    "invitation_sent",
    "ai_used",
}


def track(
    db: Session,
    event_name: str,
    *,
    user: User | None = None,
    workspace_id: int | None = None,
    properties: dict | None = None,
) -> None:
    if event_name not in EVENTS:
        raise ValueError(f"Unsupported product event: {event_name}")
    # Callers may attach counts/ids, but never card text, prompts, emails or token values.
    safe_properties = {key: value for key, value in (properties or {}).items() if key.endswith("_id") or key in {"count"}}
    db.add(
        ProductEvent(
            event_name=event_name,
            user_id=user.id if user else None,
            workspace_id=workspace_id,
            properties_json=json.dumps(safe_properties),
        )
    )
    # Workspace-scoped events (an AI call behind a budget) have no acting user, so they are sent
    # personless rather than inventing a person profile for a workspace.
    posthog_client.capture(
        db,
        event_name,
        distinct_id=(
            posthog_client.user_distinct_id(user.id)
            if user
            else posthog_client.workspace_distinct_id(workspace_id or 0)
        ),
        properties={**safe_properties, "workspace_id": workspace_id},
        person=user is not None,
    )


def snapshot(db: Session) -> dict[str, int]:
    cutoff = now() - timedelta(days=7)
    active_workspaces = db.scalar(
        select(func.count(distinct(ProductEvent.workspace_id))).where(
            ProductEvent.workspace_id.is_not(None), ProductEvent.occurred_at >= cutoff
        )
    ) or 0
    values = {name: 0 for name in EVENTS}
    for name, count in db.execute(
        select(ProductEvent.event_name, func.count(ProductEvent.id))
        .where(ProductEvent.occurred_at >= cutoff)
        .group_by(ProductEvent.event_name)
    ):
        if name in values:
            values[name] = count
    return {"weekly_active_workspaces": active_workspaces, **values}
