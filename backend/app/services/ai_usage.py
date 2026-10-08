"""Content-free workspace AI usage limits and operational counters."""

from datetime import UTC, date, datetime
from time import monotonic

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import config
from app.models import AiUsage, User
from app.services import permissions, product_analytics
from app.services.errors import InvalidRequest


def _month_start() -> date:
    return datetime.now(UTC).date().replace(day=1)


def _row(db: Session, workspace_id: int) -> AiUsage:
    month = _month_start()
    row = db.scalar(
        select(AiUsage).where(AiUsage.workspace_id == workspace_id, AiUsage.month_start == month)
    )
    if row is None:
        row = AiUsage(workspace_id=workspace_id, month_start=month)
        db.add(row)
        db.flush()
    return row


def reserve(db: Session, user: User, workspace_id: int) -> AiUsage:
    permissions.require_workspace(db, user, workspace_id)
    row = _row(db, workspace_id)
    if row.actions >= config.ai_monthly_action_limit():
        db.rollback()
        raise InvalidRequest("This workspace has reached its monthly AI action limit.")
    row.actions += 1
    db.commit()
    return row


def record_completion(
    db: Session,
    workspace_id: int,
    started: float,
    provider_calls: int,
    error: bool = False,
) -> None:
    row = _row(db, workspace_id)
    row.provider_calls += provider_calls
    row.latency_ms_total += (monotonic() - started) * 1000
    if error:
        row.errors += 1
    product_analytics.track(db, "ai_used", workspace_id=workspace_id, properties={"provider_calls": provider_calls})
    db.commit()


def snapshot(db: Session, user: User, workspace_id: int) -> dict[str, float | int]:
    permissions.require_workspace(db, user, workspace_id)
    row = db.scalar(
        select(AiUsage).where(AiUsage.workspace_id == workspace_id, AiUsage.month_start == _month_start())
    )
    if row is None:
        return {"actions": 0, "limit": config.ai_monthly_action_limit(), "provider_calls": 0, "errors": 0, "avg_latency_ms": 0.0}
    return {
        "actions": row.actions,
        "limit": config.ai_monthly_action_limit(),
        "provider_calls": row.provider_calls,
        "errors": row.errors,
        "avg_latency_ms": round(row.latency_ms_total / row.actions, 1) if row.actions else 0.0,
    }
