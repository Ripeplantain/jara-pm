from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Activity(Base):
    """Append-only record of what happened, written by the service layer.

    Because the AI and the UI call the same service functions, an AI edit and a human edit
    produce the same row - only `actor_id` differs. Rows are never edited or backdated.

    `board_id` and `card_id` are nullable and deliberately *not* foreign keys with a cascade:
    history outlives the thing it describes, so deleting a card must not erase the record that
    it existed. They are plain integers pointing at what was there at the time.
    """

    __tablename__ = "activities"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    board_id: Mapped[int | None] = mapped_column(index=True, default=None)
    card_id: Mapped[int | None] = mapped_column(index=True, default=None)
    actor_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    # A stable machine name ("card.moved") plus a sentence already written for a human.
    action: Mapped[str] = mapped_column(String(50))
    summary: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), index=True
    )

    actor: Mapped["User | None"] = relationship(lazy="selectin")  # noqa: F821
