"""Deterministic workspace answers used by the AI copilot before an LLM is involved.

The facts come from analytics and search. This keeps counts and evidence authoritative while a
future model can explain the same result in a more conversational way.
"""

from sqlalchemy.orm import Session

from app.models import User
from app.schemas.ai import WorkspaceAiEvidence, WorkspaceAiResponse
from app.services import analytics, search
from app.services.errors import InvalidRequest


def answer_workspace_question(
    db: Session, user: User, workspace_id: int, question: str
) -> WorkspaceAiResponse:
    overview = analytics.workspace_overview(db, user, workspace_id)
    normalized = question.casefold()
    if "next" in normalized or "work on" in normalized:
        mine = search.my_cards(db, user, workspace_id)
        if mine:
            first = mine[0]
            answer = f"Start with “{first.title}” on {first.board_title}; it is your most time-sensitive open card."
            evidence = [WorkspaceAiEvidence(
                kind="next_work", title=first.title, board_id=first.board_id, card_id=first.id
            )]
            actions = ["Open the card and confirm its next concrete step.", "Update the due date or estimate if the plan changed."]
        else:
            answer = "You have no open cards assigned to you. Pick up an unassigned card or plan the next product bet."
            evidence = []
            actions = ["Review favorite boards for unassigned work.", "Invite a teammate if ownership is unclear."]
    elif "blocked" in normalized or "blocker" in normalized:
        signals = [signal for signal in overview["signals"] if signal["kind"] == "blocked"]
        answer = "I found the following blocked-work signals." if signals else "I found no explicit blocked-column or blocked-title signals."
        evidence = [WorkspaceAiEvidence(**signal) for signal in signals]
        actions = ["Open the linked card or board and record the dependency in a comment."] if signals else ["Ask the team whether any work is waiting on an external decision."]
    elif "risk" in normalized or "at risk" in normalized or "overdue" in normalized:
        signals = [signal for signal in overview["signals"] if signal["kind"] in {"overdue", "wip", "stale"}]
        answer = "The workspace has work that deserves attention." if signals else "No deterministic overdue, WIP or stale-work signals were found."
        evidence = [WorkspaceAiEvidence(**signal) for signal in signals]
        actions = ["Open the evidence links and reduce scope before adding new work."] if signals else ["Keep the current plan moving and review it at the next stand-up."]
    elif "sprint" in normalized:
        sprints = overview["active_sprints"]
        answer = "There is an active sprint to review." if sprints else "There is no active sprint in this workspace."
        evidence = [WorkspaceAiEvidence(kind="sprint", title=sprint["name"], board_id=sprint["board_id"]) for sprint in sprints]
        actions = ["Review unfinished cards against the sprint goal."] if sprints else ["Create a sprint from the highest-value backlog cards."]
    else:
        raise InvalidRequest("Ask about next work, blocked work, risk, or sprint health")
    return WorkspaceAiResponse(answer=answer, next_actions=actions, evidence=evidence)
