from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Notification(Base):
    """Something that happened that one person should know about.

    Written by the service layer next to the activity row, and only ever for someone other than
    the actor: nobody needs telling what they just did themselves.
    """

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    # "card.assigned", "card.mentioned", "card.completed"
    kind: Mapped[str] = mapped_column(String(50))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(String(500), default="")
    board_id: Mapped[int | None] = mapped_column(default=None)
    card_id: Mapped[int | None] = mapped_column(default=None)
    actor_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), index=True
    )
