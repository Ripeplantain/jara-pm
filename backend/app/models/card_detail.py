"""Things that hang off a single card: checklist items and comments."""

from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.util.time import as_utc


def _now() -> datetime:
    return datetime.now(UTC)


class ChecklistItem(Base):
    __tablename__ = "checklist_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(String(300))
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    # Contiguous 0..n-1 within the card, renumbered on every change, like cards in a column.
    position: Mapped[int] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id", ondelete="CASCADE"), index=True)
    # Comments outlive their author's account: the text stays, the attribution goes.
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    author: Mapped["User | None"] = relationship(lazy="selectin")  # noqa: F821

    @property
    def edited(self) -> bool:
        """True once the body has been changed after posting (one second of slack for the
        round trip between insert and the first read)."""
        return (as_utc(self.updated_at) - as_utc(self.created_at)).total_seconds() > 1
