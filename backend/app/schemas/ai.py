from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from app.schemas.boards import BoardOut


class ChatMessage(BaseModel):
    # Only user/assistant text is accepted from the client: no system or tool messages.
    role: Literal["user", "assistant"]
    content: Annotated[str, StringConstraints(max_length=4000)]


class AiRequest(BaseModel):
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)


class AppliedChange(BaseModel):
    kind: str  # the tool that ran, e.g. "move_card"
    summary: str
    board_id: int
    column_id: int | None = None
    card_id: int | None = None


class PendingAction(BaseModel):
    """A destructive change the model proposed. Nothing is deleted until the user confirms."""

    tool: Literal["delete_board", "delete_column", "delete_card"]
    summary: str
    board_id: int
    column_id: int | None = None
    card_id: int | None = None
    move_cards_to: int | None = None
    delete_cards: bool = False


class AiResponse(BaseModel):
    reply: str
    changes: list[AppliedChange]
    pending: list[PendingAction]
    board: BoardOut  # fresh state, so the UI reconciles from the server
