"""Notes: the writing surface beside the board.

A note is a page in a workspace. Pages nest, so `parent_id` points at another note and a
workspace's notes form a tree. The page's content is an ordered list of typed blocks, not a
blob of markdown: a todo block can be ticked, and an embed block points at a real card, which
would both be guesswork if the body were text.

Visibility is the one thing here that no other table in Kobi has. Everything else in a
workspace is readable by every member; a note marked `private` is readable only by its owner,
and `services/permissions.py` is what enforces that.
"""

from datetime import UTC, datetime
from enum import StrEnum
from typing import ClassVar

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _now() -> datetime:
    return datetime.now(UTC)


class NoteVisibility(StrEnum):
    """Stored as the string value, like `WorkspaceRole` and `Priority`."""

    WORKSPACE = "workspace"
    """Every member of the workspace can read it; writing still needs a member role."""

    PRIVATE = "private"
    """Only the owner, including against admins and owners. A non-owner gets a 404."""


# The fixed block vocabulary. Like `LABEL_COLORS`, a closed set keeps the UI from having to
# render something it has never heard of, and keeps the AI from inventing a block type.
BLOCK_TYPES = (
    "paragraph",
    "heading1",
    "heading2",
    "heading3",
    "bulleted",
    "numbered",
    "todo",
    "quote",
    "callout",
    "code",
    "divider",
    "card_embed",
    "board_embed",
)

EMBED_TYPES = ("card_embed", "board_embed")
"""Blocks that reference board work instead of carrying text."""

MAX_INDENT = 5


class Note(Base):
    """A page. `owner_id` is provenance for a workspace note and access for a private one."""

    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    # A subpage dies with its parent, the way a column's cards do.
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), index=True, default=None
    )
    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, default=None
    )
    title: Mapped[str] = mapped_column(String(200), default="")
    # A single emoji, picked in the UI. Empty means "use the default page icon".
    icon: Mapped[str] = mapped_column(String(8), default="")
    visibility: Mapped[str] = mapped_column(String(20), default=NoteVisibility.WORKSPACE.value)
    # Contiguous integers among siblings under the same parent, renumbered on every move.
    position: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    owner: Mapped["User | None"] = relationship(lazy="selectin")  # noqa: F821
    blocks: Mapped[list["NoteBlock"]] = relationship(
        back_populates="note", cascade="all, delete-orphan", order_by="NoteBlock.position"
    )
    children: Mapped[list["Note"]] = relationship(
        cascade="all, delete-orphan", order_by="Note.position"
    )

    @property
    def visibility_enum(self) -> NoteVisibility:
        return NoteVisibility(self.visibility)

    @property
    def is_private(self) -> bool:
        return self.visibility_enum is NoteVisibility.PRIVATE

    @property
    def is_archived(self) -> bool:
        return self.archived_at is not None


class NoteBlock(Base):
    """One line of a page. `indent` expresses nesting without a second tree to keep in order."""

    __tablename__ = "note_blocks"

    id: Mapped[int] = mapped_column(primary_key=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(20), default=BLOCK_TYPES[0])
    text: Mapped[str] = mapped_column(Text, default="")
    # Only meaningful on a todo block; left False everywhere else.
    checked: Mapped[bool] = mapped_column(Boolean, default=False)
    indent: Mapped[int] = mapped_column(Integer, default=0)
    # Contiguous 0..n-1 within the note, like cards in a column.
    position: Mapped[int] = mapped_column(default=0)
    # Set on an embed block. Plain integers validated by the service against the workspace, not
    # foreign keys: a deleted card should leave a dead embed, not cascade into the page.
    ref_card_id: Mapped[int | None] = mapped_column(Integer, default=None)
    ref_board_id: Mapped[int | None] = mapped_column(Integer, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    note: Mapped[Note] = relationship(back_populates="blocks")

    # Read-time only, so `ClassVar` keeps the ORM from mapping them as columns while each
    # instance still takes its own value.
    ref_title: ClassVar[str] = ""
    """The embedded card's or board's current title, filled in by `services/notes` when the page
    is read. Not a column: storing it would let the caption drift from the thing it names."""

    ref_card_board_id: ClassVar[int | None] = None
    """The board an embedded card sits on, so the UI can link straight to it. Also resolved on
    read, and deliberately not the mapped `ref_board_id` - writing to that would make SQLAlchemy
    persist a board id onto a card embed."""


class NoteLink(Base):
    """A note's reference to board work, derived from its blocks on every save.

    It exists so a card can answer "which pages mention me?" without reading every block in the
    workspace. `target_id` is a plain integer for the same reason `Activity.card_id` is.
    """

    __tablename__ = "note_links"
    __table_args__ = (
        UniqueConstraint("note_id", "target_type", "target_id", name="uq_note_link_target"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), index=True)
    target_type: Mapped[str] = mapped_column(String(10))
    target_id: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
