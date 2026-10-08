from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    kind: str
    title: str
    body: str
    board_id: int | None
    card_id: int | None
    actor_id: int | None
    read_at: datetime | None
    created_at: datetime


class UnreadCount(BaseModel):
    unread: int
