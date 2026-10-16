from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.auth import UserOut


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int
    board_id: int | None
    card_id: int | None
    actor_id: int | None
    actor: UserOut | None
    # The subject when it is neither a board nor a card - a note or a goal (migration 0019 added
    # the pair so a new surface needs no new column).
    entity_type: str | None = None
    entity_id: int | None = None
    action: str
    summary: str
    created_at: datetime
