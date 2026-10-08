from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.auth import UserOut

ItemText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
CommentBody = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
Position = Annotated[int, Field(ge=0)]


class ChecklistItemCreate(BaseModel):
    text: ItemText
    position: Position | None = None  # None appends


class ChecklistItemUpdate(BaseModel):
    text: ItemText | None = None
    done: bool | None = None
    position: Position | None = None


class ChecklistItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    card_id: int
    text: str
    done: bool
    position: int


class CommentCreate(BaseModel):
    body: CommentBody


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    card_id: int
    author_id: int | None
    author: UserOut | None
    body: str
    created_at: datetime
    updated_at: datetime
    edited: bool
