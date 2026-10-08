from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class OnboardingProfile(Base):
    """The immutable first-run setup record for an account."""

    __tablename__ = "onboarding_profiles"
    __table_args__ = (UniqueConstraint("user_id", name="uq_onboarding_user"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    team_size: Mapped[int] = mapped_column(Integer)
    product_context: Mapped[str] = mapped_column(Text, default="")
    board_id: Mapped[int | None] = mapped_column(
        ForeignKey("boards.id", ondelete="SET NULL"), default=None
    )
    sprint_id: Mapped[int | None] = mapped_column(
        ForeignKey("sprints.id", ondelete="SET NULL"), default=None
    )
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


__all__ = ["OnboardingProfile"]
