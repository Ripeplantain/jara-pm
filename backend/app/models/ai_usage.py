from datetime import UTC, date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AiUsage(Base):
    """Monthly, content-free AI usage counters for a workspace."""

    __tablename__ = "ai_usage"
    __table_args__ = (UniqueConstraint("workspace_id", "month_start", name="uq_ai_usage_workspace_month"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    month_start: Mapped[date] = mapped_column(Date, index=True)
    actions: Mapped[int] = mapped_column(Integer, default=0)
    provider_calls: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms_total: Mapped[float] = mapped_column(Float, default=0.0)
    errors: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC)
    )


__all__ = ["AiUsage"]
