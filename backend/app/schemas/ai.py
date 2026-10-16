from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from app.schemas.boards import BoardOut, CardDraft


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
    # Set when the change was to a page, a goal or a habit rather than to the board the chat is
    # open on. Each surface carries its own id so the UI knows where to send the user.
    note_id: int | None = None
    goal_id: int | None = None
    habit_id: int | None = None


class PendingAction(BaseModel):
    """A destructive change the model proposed. Nothing is deleted until the user confirms."""

    tool: str
    summary: str
    board_id: int
    column_id: int | None = None
    card_id: int | None = None
    move_cards_to: int | None = None
    delete_cards: bool = False
    proposal_token: str | None = None
    rationale: str | None = None
    operations: list[str] = Field(default_factory=list)


class AiResponse(BaseModel):
    reply: str
    changes: list[AppliedChange]
    pending: list[PendingAction]
    board: BoardOut  # fresh state, so the UI reconciles from the server


class AiConfirmRequest(BaseModel):
    proposal_token: Annotated[str, StringConstraints(strip_whitespace=True, min_length=20, max_length=200)]


class CardDraftRequest(BaseModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=12_000)]


class CardDraftResponse(BaseModel):
    """Proposed cards only. Nothing exists until the user creates the ones they keep."""

    drafts: list[CardDraft]
    note: str = ""  # what the model said when it drafted nothing


class WorkspaceAiRequest(BaseModel):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class WorkspaceAiEvidence(BaseModel):
    kind: str
    title: str
    board_id: int
    card_id: int | None = None


class WorkspaceAiResponse(BaseModel):
    answer: str
    next_actions: list[str]
    evidence: list[WorkspaceAiEvidence]
