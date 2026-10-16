"""Request and response contracts for pages and their blocks."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models.note import BLOCK_TYPES, MAX_INDENT, NoteVisibility
from app.schemas.auth import UserOut

NoteTitle = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
"""A page may be untitled while it is being written, so unlike a card title this can be empty."""

NoteIcon = Annotated[str, StringConstraints(strip_whitespace=True, max_length=8)]
BlockText = Annotated[str, StringConstraints(max_length=10_000)]
BlockType = Literal[BLOCK_TYPES]  # type: ignore[valid-type]
Indent = Annotated[int, Field(ge=0, le=MAX_INDENT)]
Position = Annotated[int, Field(ge=0)]

MAX_BLOCKS_PER_REQUEST = 500
"""One request's worth. `services/notes.MAX_BLOCKS` caps what a whole page may hold."""


class NoteBlockIn(BaseModel):
    """A block on the way in. `id` keeps an existing row on a document save; omit it for a new
    block, and leave a block out of the save to delete it."""

    id: int | None = None
    type: BlockType = "paragraph"
    text: BlockText = ""
    checked: bool = False
    indent: Indent = 0
    ref_card_id: int | None = None
    ref_board_id: int | None = None


class NoteBlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    text: str
    checked: bool
    indent: int
    position: int
    ref_card_id: int | None
    ref_board_id: int | None
    # The embedded card's or board's current title; empty if it has since been deleted.
    ref_title: str = ""
    # The board an embedded card sits on, so the UI can link to it.
    ref_card_board_id: int | None = None


class NoteSummary(BaseModel):
    """What the page tree is drawn from. The body is not included."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    parent_id: int | None
    title: str
    icon: str
    visibility: NoteVisibility
    position: int
    owner: UserOut | None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


class NoteDetail(NoteSummary):
    blocks: list[NoteBlockOut]


class NoteHit(NoteSummary):
    """A page found by search, with a window around the match so the row says why it matched."""

    excerpt: str = ""


class NoteCreate(BaseModel):
    title: NoteTitle = ""
    icon: NoteIcon = ""
    parent_id: int | None = None
    # Omitted: inherited from the parent page, or workspace-visible at the top level. A subpage
    # of a private page is private whatever is asked for here.
    visibility: NoteVisibility | None = None
    position: Position | None = None  # None appends
    blocks: list[NoteBlockIn] = Field(default_factory=list, max_length=MAX_BLOCKS_PER_REQUEST)


class NoteUpdate(BaseModel):
    """Absent fields are left alone."""

    title: NoteTitle | None = None
    icon: NoteIcon | None = None


class NoteVisibilityUpdate(BaseModel):
    visibility: NoteVisibility


class NoteMove(BaseModel):
    """`parent_id` left out keeps the current parent; sent as null moves the page to the top."""

    parent_id: int | None = None
    position: Position | None = None


class NoteBlocksReplace(BaseModel):
    blocks: list[NoteBlockIn] = Field(default_factory=list, max_length=MAX_BLOCKS_PER_REQUEST)


class NoteBlocksAdd(BaseModel):
    blocks: list[NoteBlockIn] = Field(min_length=1, max_length=MAX_BLOCKS_PER_REQUEST)
    position: Position | None = None  # None appends


class NoteBlockPatch(BaseModel):
    """Absent fields are left alone. Ticking a todo is `{"checked": true}`."""

    type: BlockType | None = None
    text: BlockText | None = None
    checked: bool | None = None
    indent: Indent | None = None
