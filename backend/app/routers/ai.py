from time import monotonic
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.ai.agent import draft_cards, run_assistant
from app.ai.llm import LLMClient, get_llm_client
from app.ai.tools import ToolContext, ToolError, execute
from app.auth.dependencies import CurrentUser
from app.db import get_db
from app.schemas.ai import (
    AiConfirmRequest,
    AiRequest,
    AiResponse,
    CardDraftRequest,
    CardDraftResponse,
)
from app.services import ai_proposals, ai_usage
from app.services import boards as svc
from app.services.errors import InvalidRequest

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]


@router.post("/boards/{board_id}/ai", response_model=AiResponse)
def chat(
    board_id: int,
    body: AiRequest,
    user: CurrentUser,
    db: DbSession,
    llm: Annotated[LLMClient, Depends(get_llm_client)],
):
    board = svc.get_board(db, user, board_id)
    ai_usage.reserve(db, user, board.workspace_id)
    started = monotonic()
    try:
        result = run_assistant(db, user, board_id, body.message, body.history, llm)
    except Exception:
        ai_usage.record_completion(db, board.workspace_id, started, 0, error=True)
        raise
    ai_usage.record_completion(db, board.workspace_id, started, result.llm_calls)
    return AiResponse(
        reply=result.reply,
        changes=result.changes,
        pending=result.pending,
        board=svc.get_board(db, user, board_id),
    )


@router.post("/boards/{board_id}/ai/draft-cards", response_model=CardDraftResponse)
def draft(
    board_id: int,
    body: CardDraftRequest,
    user: CurrentUser,
    db: DbSession,
    llm: Annotated[LLMClient, Depends(get_llm_client)],
):
    # A viewer could not create the cards, so they are refused before the budget is touched.
    board = svc.board_for(db, user, board_id, svc.MEMBER)
    ai_usage.reserve(db, user, board.workspace_id)
    started = monotonic()
    try:
        result = draft_cards(db, user, board_id, body.text, llm)
    except Exception:
        ai_usage.record_completion(db, board.workspace_id, started, 0, error=True)
        raise
    ai_usage.record_completion(db, board.workspace_id, started, result.llm_calls)
    return CardDraftResponse(drafts=result.drafts, note=result.note)


@router.post("/boards/{board_id}/ai/confirm", response_model=AiResponse)
def confirm(board_id: int, body: AiConfirmRequest, user: CurrentUser, db: DbSession):
    tool_name, args = ai_proposals.consume(db, user, board_id, body.proposal_token)
    try:
        outcome = execute(ToolContext(db=db, user=user, board_id=board_id), tool_name, args)
    except ToolError as exc:
        raise InvalidRequest(str(exc)) from None
    changes = list(outcome.changes)
    if outcome.change and not changes:
        changes = [outcome.change]
    return AiResponse(
        reply="Applied the confirmed changes.",
        changes=changes,
        pending=[outcome.pending] if outcome.pending else [],
        board=svc.get_board(db, user, board_id),
    )
