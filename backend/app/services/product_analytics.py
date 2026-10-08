"""Minimal product analytics without collecting card text, prompts or email content."""

import json
from datetime import timedelta

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from app.models import ProductEvent, User
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
