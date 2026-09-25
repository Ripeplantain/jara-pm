from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.ai.agent import run_assistant
from app.ai.llm import LLMClient, get_llm_client
from app.auth.dependencies import CurrentUser
from app.db import get_db
from app.schemas.ai import AiRequest, AiResponse
from app.services import boards as svc

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
    result = run_assistant(db, user, board_id, body.message, body.history, llm)
    return AiResponse(
        reply=result.reply,
        changes=result.changes,
        pending=result.pending,
        board=svc.get_board(db, user, board_id),
    )
