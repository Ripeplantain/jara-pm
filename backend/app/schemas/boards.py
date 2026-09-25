from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

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


class CardCreate(BaseModel):
    title: CardTitle
    description: Description = ""
    position: Position | None = None  # None appends


class CardUpdate(BaseModel):
    title: CardTitle | None = None
    description: Description | None = None


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
    created_at: datetime


class ColumnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    board_id: int
    title: str
    position: int
    cards: list[CardOut] = []


class BoardSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    created_by_id: int | None
    title: str
    description: str
    created_at: datetime


class BoardOut(BoardSummary):
    columns: list[ColumnOut] = []
