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
    action: str
    summary: str
    created_at: datetime
