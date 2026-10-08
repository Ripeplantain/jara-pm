from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models.board import Priority
from app.schemas.auth import UserOut
from app.schemas.card_details import ChecklistItemOut
from app.schemas.labels import LabelOut

BoardTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ColumnTitle = BoardTitle
CardTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
Description = Annotated[str, StringConstraints(max_length=10_000)]
Position = Annotated[int, Field(ge=0)]


class BoardCreate(BaseModel):
    title: BoardTitle
    description: Description = ""
    # Omitted: the caller's oldest workspace (the personal one for a fresh account).
    workspace_id: int | None = None
    # Optional starter columns, created in order in the same transaction.
    columns: list[ColumnTitle] = Field(default_factory=list, max_length=50)


class BoardUpdate(BaseModel):
    title: BoardTitle | None = None
    description: Description | None = None


class ColumnCreate(BaseModel):
    title: ColumnTitle
    position: Position | None = None  # None appends


class ColumnUpdate(BaseModel):
    title: ColumnTitle | None = None
    position: Position | None = None
    # Sent as null, the limit is removed; left out, it is unchanged.
    wip_limit: Annotated[int, Field(ge=1, le=999)] | None = None
    is_done: bool | None = None


Estimate = Annotated[int, Field(ge=0, le=1000)]


class CardCreate(BaseModel):
    title: CardTitle
    description: Description = ""
    position: Position | None = None  # None appends
    assignee_id: int | None = None
    priority: Priority = Priority.NONE
    sprint_id: int | None = None
    due_date: datetime | None = None
    estimate: Estimate | None = None


class CardUpdate(BaseModel):
    """Absent fields are left alone. `assignee_id`, `due_date` and `estimate` sent as null are
    cleared, which `model_fields_set` lets the router tell apart from absent."""

    title: CardTitle | None = None
    description: Description | None = None
    assignee_id: int | None = None
    priority: Priority | None = None
    due_date: datetime | None = None
    estimate: Estimate | None = None


class CardMove(BaseModel):
    column_id: int
    position: Position | None = None  # None appends


class CardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    column_id: int
    title: str
    description: str
    position: int
    assignee_id: int | None = None
    assignee: UserOut | None = None
    created_by_id: int | None = None
    priority: Priority = Priority.NONE
    sprint_id: int | None = None
    due_date: datetime | None = None
    estimate: int | None = None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None
    archived_at: datetime | None = None
    labels: list[LabelOut] = []
    checklist: list[ChecklistItemOut] = []
    checklist_done: int = 0
    checklist_total: int = 0
    comment_count: int = 0


class ColumnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    board_id: int
    title: str
    position: int
    wip_limit: int | None = None
    is_done: bool = False
    card_count: int = 0
    # A soft ceiling: the API reports it, the UI shows it, nothing is ever refused for it.
    over_wip_limit: bool = False
    cards: list[CardOut] = []


class BoardSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    created_by_id: int | None
    title: str
    description: str
    created_at: datetime
    is_favorite: bool = False


class BoardOut(BoardSummary):
    columns: list[ColumnOut] = []


class CardHit(CardOut):
    """A card found by search: carries where it lives, since it is shown out of context."""

    board_id: int
    board_title: str
    column_title: str


class BoardFromTemplate(BaseModel):
    template: str
    title: BoardTitle | None = None  # None uses the template's own name
    workspace_id: int | None = None


class TemplateOut(BaseModel):
    key: str
    name: str
    description: str
    columns: list[str]
