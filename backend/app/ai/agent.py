"""The tool loop: model turn -> validated tool calls -> results back to the model, with a cap."""

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app.ai.context import build_context
from app.ai.llm import LLMClient
from app.ai.tools import ToolContext, ToolError, execute, tool_definitions
from app.config import AI_MAX_TOOL_ITERATIONS
from app.models import User
from app.schemas.ai import AppliedChange, ChatMessage, PendingAction
from app.services import boards as svc

log = logging.getLogger("app.ai")


@dataclass
class AgentResult:
    reply: str
    changes: list[AppliedChange] = field(default_factory=list)
    pending: list[PendingAction] = field(default_factory=list)
    llm_calls: int = 0


def run_assistant(
    db: Session,
    user: User,
    board_id: int,
    message: str,
    history: list[ChatMessage],
    llm: LLMClient,
) -> AgentResult:
    board = svc.get_board(db, user, board_id)  # 404 unless the user owns it
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": build_context(board, db, user)},
        *({"role": m.role, "content": m.content} for m in history),
        {"role": "user", "content": message},
    ]
    tools = tool_definitions()
    ctx = ToolContext(db=db, user=user, board_id=board_id)
    result = AgentResult(reply="")

    for _ in range(AI_MAX_TOOL_ITERATIONS):
        result.llm_calls += 1
        turn = llm.complete(messages, tools)
        if not turn.tool_calls:
            result.reply = (turn.content or "").strip()
            break
        messages.append(
            {
                "role": "assistant",
                "content": turn.content,
                "tool_calls": [
                    {"id": tc.id, "type": "function", "function": {"name": tc.name, "arguments": tc.arguments}}
                    for tc in turn.tool_calls
                ],
            }
        )
        for tc in turn.tool_calls:
            payload = _run_tool(ctx, tc.name, tc.arguments, result)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(payload)})
    else:
        result.reply = f"I stopped after {AI_MAX_TOOL_ITERATIONS} steps. Check the board and ask me to continue."

    if not result.reply:
        result.reply = "Done." if result.changes or result.pending else "I'm not sure how to help with that."
    return result


def _run_tool(ctx: ToolContext, name: str, raw_args: str, result: AgentResult) -> dict[str, Any]:
    try:
        try:
            args = json.loads(raw_args or "{}")
        except json.JSONDecodeError:
            raise ToolError("Arguments must be a valid JSON object.") from None
        outcome = execute(ctx, name, args)
    except ToolError as exc:
        log.info("ai tool=%s error=%s args=%.200s", name, exc, raw_args)
        return {"error": str(exc)}
    log.info("ai tool=%s ok args=%.200s", name, raw_args)
    if outcome.change:
        result.changes.append(outcome.change)
    if outcome.changes:
        result.changes.extend(outcome.changes)
    if outcome.pending:
        result.pending.append(outcome.pending)
    return outcome.data
