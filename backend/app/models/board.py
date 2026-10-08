from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _now() -> datetime:
    return datetime.now(UTC)


class Priority(StrEnum):
    """Ordered weakest to strongest; `rank` is what sorting and filtering compare."""

    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"

    @property
    def rank(self) -> int:
        return list(Priority).index(self)


class Board(Base):
    """A board lives in a workspace. Access comes from workspace membership, never from
    `created_by_id`, which is provenance only."""

    __tablename__ = "boards"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    columns: Mapped[list["Column"]] = relationship(
        back_populates="board", cascade="all, delete-orphan", order_by="Column.position"
    )


class BoardFavorite(Base):
    """One row per (user, board). Favourites are personal: they never affect anyone else."""

    __tablename__ = "board_favorites"
    __table_args__ = (UniqueConstraint("user_id", "board_id", name="uq_favorite_user_board"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"), index=True)


class Column(Base):
    __tablename__ = "columns"

    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    # Contiguous integers, renumbered on every move (decided in Phase 2).
    position: Mapped[int] = mapped_column()
    # A soft ceiling: going over is a warning in the response, never a refusal.
    wip_limit: Mapped[int | None] = mapped_column(Integer, default=None)
    # Cards that reach a done column get a completed_at, which is what cycle time measures.
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)

    board: Mapped[Board] = relationship(back_populates="columns")
    cards: Mapped[list["Card"]] = relationship(
        back_populates="column", cascade="all, delete-orphan", order_by="Card.position"
    )

    @property
    def card_count(self) -> int:
        """Live cards only: archived ones are off the board and do not count against WIP."""
        return sum(1 for card in self.cards if card.archived_at is None)

    @property
    def over_wip_limit(self) -> bool:
        return self.wip_limit is not None and self.card_count > self.wip_limit


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    column_id: Mapped[int] = mapped_column(ForeignKey("columns.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    position: Mapped[int] = mapped_column()

    # Who and when. `assignee_id` must be a member of the board's workspace; the service checks
    # it, because a card assigned to someone who cannot see it is a dead end.
    assignee_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, default=None
    )
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )

    priority: Mapped[str] = mapped_column(String(10), default=Priority.NONE.value)
    # Null means the backlog: not planned into any sprint yet.
    sprint_id: Mapped[int | None] = mapped_column(
        ForeignKey("sprints.id", ondelete="SET NULL"), index=True, default=None
    )
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    estimate: Mapped[int | None] = mapped_column(Integer, default=None)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    # Set when the card lands in a column flagged `is_done`, cleared when it leaves.
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    @property
    def priority_enum(self) -> Priority:
        return Priority(self.priority)

    @property
    def is_archived(self) -> bool:
        return self.archived_at is not None

    column: Mapped[Column] = relationship(back_populates="cards")
    # Two foreign keys point at users (assignee and creator), so the join must be spelled out.
    assignee: Mapped["User | None"] = relationship(  # noqa: F821
        foreign_keys=[assignee_id], lazy="selectin"
    )
    labels: Mapped[list["Label"]] = relationship(  # noqa: F821
        secondary="card_labels", order_by="Label.name", viewonly=False, lazy="selectin"
    )
    checklist: Mapped[list["ChecklistItem"]] = relationship(  # noqa: F821
        cascade="all, delete-orphan", order_by="ChecklistItem.position", lazy="selectin"
    )
    comments: Mapped[list["Comment"]] = relationship(  # noqa: F821
        cascade="all, delete-orphan", order_by="Comment.id", lazy="selectin"
    )

    @property
    def checklist_total(self) -> int:
        return len(self.checklist)

    @property
    def checklist_done(self) -> int:
        return sum(1 for item in self.checklist if item.done)

    @property
    def comment_count(self) -> int:
        return len(self.comments)
