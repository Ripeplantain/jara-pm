"""Typed AI tools. Each has a Pydantic argument schema and calls the same service functions as the
HTTP endpoints. IDs are validated against the board being edited before any service call, so a
model can never reach another board, let alone another user's data. Delete tools never execute:
they return a pending confirmation for the user.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, Field, StringConstraints, ValidationError, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Board, Card, Column, Priority, User, WorkspaceMember
from app.schemas.ai import AppliedChange, PendingAction
from app.schemas.boards import BoardTitle, CardTitle, ColumnTitle, Description, Position
from app.services import ai_proposals, permissions
from app.services import analytics as analytics_svc
from app.services import boards as svc
from app.services import card_details as detail_svc
from app.services import labels as label_svc
from app.services import sprints as sprint_svc
from app.services import templates as template_svc
from app.services.errors import Forbidden


class ToolError(Exception):
    """Returned to the model as an error result so it can correct itself."""


@dataclass
class ToolContext:
    db: Session
    user: User
    board_id: int

    def board(self) -> Board:
        return svc.get_board(self.db, self.user, self.board_id)

    def column(self, column_id: int) -> Column:
        for col in self.board().columns:
            if col.id == column_id:
                return col
        raise ToolError(f"Column {column_id} does not exist on this board.")

    def card(self, card_id: int) -> Card:
        for col in self.board().columns:
            for card in col.cards:
                if card.id == card_id:
                    return card
        raise ToolError(f"Card {card_id} does not exist on this board.")

    def workspace_id(self) -> int:
        return self.board().workspace_id


@dataclass
class ToolResult:
    data: dict[str, Any]
    change: AppliedChange | None = None
    pending: PendingAction | None = None
    changes: list[AppliedChange] = field(default_factory=list)


# --- argument schemas -----------------------------------------------------------------------


class _Args(BaseModel):
    model_config = {"extra": "forbid"}


class ColumnSpec(_Args):
    title: ColumnTitle
    cards: list[CardTitle] = Field(default_factory=list, max_length=20, description="Starter card titles")


class CreateBoardArgs(_Args):
    title: BoardTitle
    columns: list[ColumnSpec] = Field(default_factory=list, max_length=12)


class RenameBoardArgs(_Args):
    title: BoardTitle


class AddColumnArgs(_Args):
    title: ColumnTitle
    position: Position | None = Field(None, description="0-based index; omit to append")


class RenameColumnArgs(_Args):
    column_id: int
    title: ColumnTitle


class MoveColumnArgs(_Args):
    column_id: int
    position: Position = Field(description="New 0-based index among the board's columns")


class DeleteColumnArgs(_Args):
    column_id: int
    move_cards_to: int | None = Field(None, description="Column id (same board) to receive the cards")
    delete_cards: bool = Field(False, description="True to delete the column's cards too")


class CreateCardArgs(_Args):
    column_id: int
    title: CardTitle
    description: Description = ""
    position: Position | None = Field(None, description="0-based index; omit to append")


class UpdateCardArgs(_Args):
    card_id: int
    title: CardTitle | None = None
    description: Description | None = None

    @model_validator(mode="after")
    def _something_to_change(self):
        if self.title is None and self.description is None:
            raise ValueError("provide title and/or description")
        return self


class MoveCardArgs(_Args):
    card_id: int
    column_id: int = Field(description="Destination column (may be the card's current column)")
    position: Position | None = Field(None, description="0-based index in the destination; omit to append")


class SetCardFieldsArgs(_Args):
    """Only the fields present are changed; send null to clear one."""

    card_id: int
    assignee_id: int | None = Field(None, description="A workspace member's user id; null clears it")
    priority: Priority | None = Field(None, description="none, low, medium, high or urgent")
    due_date: datetime | None = Field(None, description="ISO date or datetime; null clears it")
    estimate: int | None = Field(None, ge=0, le=1000, description="Points; null clears it")

    @model_validator(mode="after")
    def _something_to_change(self):
        if not self.model_fields_set - {"card_id"}:
            raise ValueError("provide at least one field to change")
        return self


class CardLabelArgs(_Args):
    card_id: int
    label_id: int = Field(description="A label id from the workspace labels in the board state")


class ChecklistArgs(_Args):
    card_id: int
    items: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]] = Field(
        min_length=1, max_length=20, description="Checklist item texts, added in order"
    )


class CommentArgs(_Args):
    card_id: int
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]


class ArchiveCardArgs(_Args):
    card_id: int


class CreateSprintArgs(_Args):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    goal: Annotated[str, StringConstraints(max_length=2000)] = ""
    card_ids: list[int] = Field(default_factory=list, max_length=100, description="Cards to plan into it")


class SprintArgs(_Args):
    sprint_id: int


class CompleteSprintArgs(_Args):
    sprint_id: int
    move_unfinished_to: int | None = Field(
        None, description="Another sprint id on this board; omit to send unfinished cards to the backlog"
    )


class AddToSprintArgs(_Args):
    sprint_id: int | None = Field(description="Sprint id, or null to move the cards to the backlog")
    card_ids: list[int] = Field(min_length=1, max_length=100)


class CreateFromTemplateArgs(_Args):
    template: str = Field(description="One of the template keys listed in the board state")
    title: BoardTitle | None = Field(None, description="Omit to use the template's own name")


class BoardStatsArgs(_Args):
    pass


class CardAuthoringArgs(_Args):
    card_id: int
    title: CardTitle | None = None
    description: Description | None = None
    acceptance_criteria: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]] = Field(
        default_factory=list, max_length=20
    )
    subtasks: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]] = Field(
        default_factory=list, max_length=20
    )
    assignee_id: int | None = None
    priority: Priority | None = None
    due_date: datetime | None = None
    estimate: int | None = Field(None, ge=0, le=1000)
    label_ids: list[int] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def _has_change(self):
        if not self.model_fields_set - {"card_id"}:
            raise ValueError("provide at least one authoring change")
        return self


class BatchCardAuthoringArgs(_Args):
    changes: list[CardAuthoringArgs] = Field(min_length=1, max_length=20)
    rationale: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)] = ""


class DeleteCardArgs(_Args):
    card_id: int


class DeleteBoardArgs(_Args):
    pass


# --- handlers -------------------------------------------------------------------------------


def _change(ctx: ToolContext, kind: str, summary: str, **ids: int | None) -> AppliedChange:
    return AppliedChange(kind=kind, summary=summary, board_id=ids.pop("board_id", None) or ctx.board_id, **ids)


def _card_data(card: Card) -> dict[str, Any]:
    return {"id": card.id, "title": card.title, "column_id": card.column_id, "position": card.position}


def _create_board(ctx: ToolContext, a: CreateBoardArgs) -> ToolResult:
    board = svc.create_board_with_cards(
        ctx.db, ctx.user, a.title, [(c.title, list(c.cards)) for c in a.columns]
    )
    n_cards = sum(len(c.cards) for c in board.columns)
    return ToolResult(
        {
            "ok": True,
            "board_id": board.id,
            "note": "A new board was created. It is separate from the current board and cannot be "
            "edited in this conversation; tell the user they can open it.",
        },
        _change(
            ctx,
            "create_board",
            f"Created board “{board.title}” with {len(board.columns)} columns and {n_cards} cards",
            board_id=board.id,
        ),
    )


def _rename_board(ctx: ToolContext, a: RenameBoardArgs) -> ToolResult:
    board = svc.update_board(ctx.db, ctx.user, ctx.board_id, a.title)
    return ToolResult({"ok": True}, _change(ctx, "rename_board", f"Renamed the board to “{board.title}”"))


def _add_column(ctx: ToolContext, a: AddColumnArgs) -> ToolResult:
    col = svc.create_column(ctx.db, ctx.user, ctx.board_id, a.title, a.position)
    return ToolResult(
        {"ok": True, "column": {"id": col.id, "title": col.title, "position": col.position}},
        _change(ctx, "add_column", f"Added column “{col.title}”", column_id=col.id),
    )


def _rename_column(ctx: ToolContext, a: RenameColumnArgs) -> ToolResult:
    old = ctx.column(a.column_id).title
    col = svc.update_column(ctx.db, ctx.user, a.column_id, title=a.title)
    return ToolResult(
        {"ok": True},
        _change(ctx, "rename_column", f"Renamed column “{old}” to “{col.title}”", column_id=col.id),
    )


def _move_column(ctx: ToolContext, a: MoveColumnArgs) -> ToolResult:
    ctx.column(a.column_id)
    col = svc.update_column(ctx.db, ctx.user, a.column_id, position=a.position)
    return ToolResult(
        {"ok": True, "position": col.position},
        _change(ctx, "reorder_columns", f"Moved column “{col.title}” to position {col.position + 1}", column_id=col.id),
    )


def _create_card(ctx: ToolContext, a: CreateCardArgs) -> ToolResult:
    col = ctx.column(a.column_id)
    card = svc.create_card(ctx.db, ctx.user, col.id, a.title, a.description, a.position)
    return ToolResult(
        {"ok": True, "card": _card_data(card)},
        _change(ctx, "create_card", f"Added card “{card.title}” to “{col.title}”", column_id=col.id, card_id=card.id),
    )


def _update_card(ctx: ToolContext, a: UpdateCardArgs) -> ToolResult:
    old = ctx.card(a.card_id)
    old_title = old.title
    card = svc.update_card(ctx.db, ctx.user, a.card_id, a.title, a.description)
    summary = (
        f"Renamed card “{old_title}” to “{card.title}”" if a.title is not None else f"Updated card “{card.title}”"
    )
    return ToolResult(
        {"ok": True, "card": _card_data(card)},
        _change(ctx, "update_card", summary, column_id=card.column_id, card_id=card.id),
    )


def _move_card(ctx: ToolContext, a: MoveCardArgs) -> ToolResult:
    ctx.card(a.card_id)
    target = ctx.column(a.column_id)
    card = svc.move_card(ctx.db, ctx.user, a.card_id, target.id, a.position)
    return ToolResult(
        {"ok": True, "card": _card_data(card)},
        _change(
            ctx, "move_card", f"Moved card “{card.title}” to “{target.title}”", column_id=target.id, card_id=card.id
        ),
    )


# --- rich card fields, labels, checklists, comments, archiving -------------------------------


def _set_card_fields(ctx: ToolContext, a: SetCardFieldsArgs) -> ToolResult:
    card = ctx.card(a.card_id)
    sent = a.model_fields_set
    card = svc.update_card(
        ctx.db,
        ctx.user,
        a.card_id,
        assignee_id=a.assignee_id if "assignee_id" in sent else svc.UNSET,
        priority=a.priority,
        due_date=a.due_date if "due_date" in sent else svc.UNSET,
        estimate=a.estimate if "estimate" in sent else svc.UNSET,
    )
    changed = ", ".join(sorted(sent - {"card_id"}))
    return ToolResult(
        {"ok": True, "card": _card_data(card)},
        _change(
            ctx, "set_card_fields", f"Updated {changed} on “{card.title}”",
            column_id=card.column_id, card_id=card.id,
        ),
    )


def _add_label(ctx: ToolContext, a: CardLabelArgs) -> ToolResult:
    card = ctx.card(a.card_id)
    card = label_svc.add_label_to_card(ctx.db, ctx.user, card.id, a.label_id)
    names = ", ".join(label.name for label in card.labels)
    return ToolResult(
        {"ok": True, "labels": names},
        _change(ctx, "add_label", f"Labelled “{card.title}”", column_id=card.column_id, card_id=card.id),
    )


def _remove_label(ctx: ToolContext, a: CardLabelArgs) -> ToolResult:
    card = ctx.card(a.card_id)
    card = label_svc.remove_label_from_card(ctx.db, ctx.user, card.id, a.label_id)
    return ToolResult(
        {"ok": True},
        _change(ctx, "remove_label", f"Removed a label from “{card.title}”", column_id=card.column_id, card_id=card.id),
    )


def _add_checklist(ctx: ToolContext, a: ChecklistArgs) -> ToolResult:
    card = ctx.card(a.card_id)
    for text in a.items:
        detail_svc.add_checklist_item(ctx.db, ctx.user, card.id, text)
    return ToolResult(
        {"ok": True, "added": len(a.items)},
        _change(
            ctx, "add_checklist_items",
            f"Added {len(a.items)} checklist {'item' if len(a.items) == 1 else 'items'} to “{card.title}”",
            column_id=card.column_id, card_id=card.id,
        ),
    )


def _comment(ctx: ToolContext, a: CommentArgs) -> ToolResult:
    card = ctx.card(a.card_id)
    detail_svc.add_comment(ctx.db, ctx.user, card.id, a.body)
    return ToolResult(
        {"ok": True},
        _change(ctx, "comment", f"Commented on “{card.title}”", column_id=card.column_id, card_id=card.id),
    )


def _archive_card(ctx: ToolContext, a: ArchiveCardArgs) -> ToolResult:
    """Archiving runs immediately: it is reversible, so it is not a destructive action."""
    card = ctx.card(a.card_id)
    svc.archive_card(ctx.db, ctx.user, card.id)
    return ToolResult(
        {"ok": True, "note": "Archived, not deleted. It can be restored from the archive."},
        _change(ctx, "archive_card", f"Archived “{card.title}”", column_id=card.column_id, card_id=card.id),
    )


# --- sprints and planning ---------------------------------------------------------------------


def _create_sprint(ctx: ToolContext, a: CreateSprintArgs) -> ToolResult:
    sprint = sprint_svc.create_sprint(ctx.db, ctx.user, ctx.board_id, a.name, a.goal)
    for card_id in a.card_ids:
        ctx.card(card_id)  # must be on this board
        sprint_svc.set_card_sprint(ctx.db, ctx.user, card_id, sprint.id)
    return ToolResult(
        {"ok": True, "sprint_id": sprint.id, "planned": len(a.card_ids)},
        _change(
            ctx, "create_sprint",
            f"Planned the sprint “{sprint.name}” with {len(a.card_ids)} cards",
        ),
    )


def _add_to_sprint(ctx: ToolContext, a: AddToSprintArgs) -> ToolResult:
    for card_id in a.card_ids:
        ctx.card(card_id)
        sprint_svc.set_card_sprint(ctx.db, ctx.user, card_id, a.sprint_id)
    where = "the backlog" if a.sprint_id is None else "the sprint"
    return ToolResult(
        {"ok": True, "moved": len(a.card_ids)},
        _change(ctx, "plan_cards", f"Moved {len(a.card_ids)} cards to {where}"),
    )


def _start_sprint(ctx: ToolContext, a: SprintArgs) -> ToolResult:
    sprint = sprint_svc.start_sprint(ctx.db, ctx.user, a.sprint_id)
    return ToolResult(
        {"ok": True, "state": sprint.state},
        _change(ctx, "start_sprint", f"Started the sprint “{sprint.name}”"),
    )


def _complete_sprint(ctx: ToolContext, a: CompleteSprintArgs) -> ToolResult:
    sprint = sprint_svc.complete_sprint(ctx.db, ctx.user, a.sprint_id, a.move_unfinished_to)
    return ToolResult(
        {"ok": True, "state": sprint.state},
        _change(ctx, "complete_sprint", f"Completed the sprint “{sprint.name}”"),
    )


def _create_from_template(ctx: ToolContext, a: CreateFromTemplateArgs) -> ToolResult:
    board = template_svc.create_board_from_template(
        ctx.db, ctx.user, a.template, a.title, ctx.workspace_id()
    )
    return ToolResult(
        {
            "ok": True,
            "board_id": board.id,
            "note": "A new board was created in this workspace. It is separate from the current "
            "board and cannot be edited in this conversation; tell the user they can open it.",
        },
        _change(ctx, "create_board", f"Created board “{board.title}” from a template", board_id=board.id),
    )


def _board_stats(ctx: ToolContext, _a: BoardStatsArgs) -> ToolResult:
    """Read-only: the same numbers the insights page shows, for answering questions."""
    stats = analytics_svc.board_analytics(ctx.db, ctx.user, ctx.board_id)
    return ToolResult(
        {
            "open_cards": stats["open_cards"],
            "completed_cards": stats["completed_cards"],
            "overdue": stats["overdue"],
            "due_soon": stats["due_soon"],
            "unestimated": stats["unestimated"],
            "cycle_time_hours": stats["cycle_time_hours"],
            "columns": [
                {"title": c["title"], "count": c["count"], "over_wip_limit": c["over_wip_limit"]}
                for c in stats["columns"]
            ],
            "workload": [
                {"name": w["name"], "open_cards": w["open_cards"]} for w in stats["workload"]
            ],
            "throughput": stats["throughput"][-4:],
        }
    )


def _validate_authoring(ctx: ToolContext, a: CardAuthoringArgs) -> Card:
    permissions.require_board(ctx.db, ctx.user, ctx.board_id, permissions.MEMBER)
    card = ctx.card(a.card_id)
    if a.assignee_id is not None:
        member = ctx.db.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == ctx.workspace_id(),
                WorkspaceMember.user_id == a.assignee_id,
            )
        )
        if member is None:
            raise ToolError("The suggested assignee is not a member of this workspace.")
    if a.label_ids:
        available = {label.id for label in label_svc.list_labels(ctx.db, ctx.user, ctx.workspace_id())}
        missing = sorted(set(a.label_ids) - available)
        if missing:
            raise ToolError(f"Labels do not exist in this workspace: {missing}")
    return card


def _authoring_summary(ctx: ToolContext, a: CardAuthoringArgs) -> tuple[str, list[str]]:
    card = _validate_authoring(ctx, a)
    operations: list[str] = []
    if a.title is not None:
        operations.append(f"Change title to “{a.title}”")
    if a.description is not None:
        operations.append("Improve the description")
    if a.acceptance_criteria:
        operations.append(f"Add {len(a.acceptance_criteria)} acceptance criteria")
    if a.subtasks:
        operations.append(f"Add {len(a.subtasks)} subtasks")
    if a.assignee_id is not None:
        operations.append(f"Suggest assignee {a.assignee_id}")
    if a.priority is not None:
        operations.append(f"Set priority to {a.priority.value}")
    if a.due_date is not None:
        operations.append(f"Set due date to {a.due_date.date().isoformat()}")
    if a.estimate is not None:
        operations.append(f"Set estimate to {a.estimate} points")
    if a.label_ids:
        operations.append(f"Attach {len(a.label_ids)} label(s)")
    return f"Update “{card.title}” with {len(operations)} proposed change(s)", operations


def _suggest_card_authoring(ctx: ToolContext, a: CardAuthoringArgs) -> ToolResult:
    summary, operations = _authoring_summary(ctx, a)
    token = ai_proposals.create(
        ctx.db, ctx.user, ctx.board_id, "apply_card_authoring", a.model_dump(mode="json")
    )
    return ToolResult(
        {"ok": True, "status": "pending_user_confirmation", "operations": operations},
        pending=PendingAction(
            tool="suggest_card_authoring",
            summary=summary,
            board_id=ctx.board_id,
            card_id=a.card_id,
            proposal_token=token,
            rationale="Review the proposed product-writing changes before they are applied.",
            operations=operations,
        ),
    )


def _apply_card_authoring(ctx: ToolContext, a: CardAuthoringArgs) -> ToolResult:
    card = _validate_authoring(ctx, a)
    sent = a.model_fields_set
    if sent & {"title", "description", "assignee_id", "priority", "due_date", "estimate"}:
        card = svc.update_card(
            ctx.db,
            ctx.user,
            a.card_id,
            title=a.title if "title" in sent else None,
            description=a.description if "description" in sent else None,
            assignee_id=a.assignee_id if "assignee_id" in sent else svc.UNSET,
            priority=a.priority if "priority" in sent else None,
            due_date=a.due_date if "due_date" in sent else svc.UNSET,
            estimate=a.estimate if "estimate" in sent else svc.UNSET,
        )
    for text in [*a.acceptance_criteria, *a.subtasks]:
        detail_svc.add_checklist_item(ctx.db, ctx.user, a.card_id, text)
    for label_id in a.label_ids:
        label_svc.add_label_to_card(ctx.db, ctx.user, a.card_id, label_id)
    card = ctx.card(a.card_id)
    return ToolResult(
        {"ok": True, "card": _card_data(card)},
        _change(ctx, "apply_card_authoring", f"Applied proposed changes to “{card.title}”", column_id=card.column_id, card_id=card.id),
    )


def _suggest_batch_authoring(ctx: ToolContext, a: BatchCardAuthoringArgs) -> ToolResult:
    operations: list[str] = []
    for change in a.changes:
        summary, change_operations = _authoring_summary(ctx, change)
        operations.extend([f"{summary}: {operation}" for operation in change_operations])
    token = ai_proposals.create(
        ctx.db, ctx.user, ctx.board_id, "apply_batch_card_authoring", a.model_dump(mode="json")
    )
    return ToolResult(
        {"ok": True, "status": "pending_user_confirmation", "operations": operations},
        pending=PendingAction(
            tool="batch_card_authoring",
            summary=f"Apply {len(operations)} proposed change(s) across {len(a.changes)} card(s)",
            board_id=ctx.board_id,
            proposal_token=token,
            rationale=a.rationale or "Review the complete batch before applying any changes.",
            operations=operations,
        ),
    )


def _apply_batch_authoring(ctx: ToolContext, a: BatchCardAuthoringArgs) -> ToolResult:
    # Validate the whole batch before the first write so stale or invalid ids fail clearly.
    for change in a.changes:
        _validate_authoring(ctx, change)
    applied: list[AppliedChange] = []
    for change in a.changes:
        outcome = _apply_card_authoring(ctx, change)
        if outcome.change:
            applied.append(outcome.change)
    return ToolResult(
        {"ok": True, "applied": len(applied)},
        change=applied[0] if len(applied) == 1 else None,
        changes=applied,
    )


def _delete_card(ctx: ToolContext, a: DeleteCardArgs) -> ToolResult:
    card = ctx.card(a.card_id)
    pending = PendingAction(
        tool="delete_card",
        summary=f"Delete card “{card.title}”",
        board_id=ctx.board_id,
        column_id=card.column_id,
        card_id=card.id,
    )
    return ToolResult(_awaiting(pending.summary), pending=pending)


def _delete_column(ctx: ToolContext, a: DeleteColumnArgs) -> ToolResult:
    col = ctx.column(a.column_id)
    if a.move_cards_to is not None and a.delete_cards:
        raise ToolError("Use either move_cards_to or delete_cards, not both.")
    n = len(col.cards)
    if n and a.move_cards_to is None and not a.delete_cards:
        raise ToolError(
            f"Column {col.id} has {n} cards. Set move_cards_to to another column id on this board, "
            "or delete_cards to true."
        )
    if n and a.move_cards_to is not None:
        if a.move_cards_to == col.id:
            raise ToolError("move_cards_to must differ from the deleted column.")
        dest = ctx.column(a.move_cards_to)
        summary = f"Delete column “{col.title}” and move its {n} cards to “{dest.title}”"
    elif n:
        summary = f"Delete column “{col.title}” and its {n} cards"
    else:
        summary = f"Delete empty column “{col.title}”"
    pending = PendingAction(
        tool="delete_column",
        summary=summary,
        board_id=ctx.board_id,
        column_id=col.id,
        move_cards_to=a.move_cards_to if n else None,
        delete_cards=bool(n and a.delete_cards),
    )
    return ToolResult(_awaiting(summary), pending=pending)


def _delete_board(ctx: ToolContext, _a: DeleteBoardArgs) -> ToolResult:
    board = ctx.board()
    pending = PendingAction(
        tool="delete_board", summary=f"Delete board “{board.title}” and everything on it", board_id=board.id
    )
    return ToolResult(_awaiting(pending.summary), pending=pending)


def _awaiting(summary: str) -> dict[str, Any]:
    return {
        "ok": True,
        "status": "pending_user_confirmation",
        "note": f"NOT deleted yet. The user must confirm: {summary}. Tell them to confirm or cancel.",
    }


# --- registry -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    args: type[BaseModel]
    run: Callable[[ToolContext, Any], ToolResult]
    exposed: bool = True


TOOLS: dict[str, Tool] = {
    t.name: t
    for t in [
        Tool("create_board", "Create a NEW board with suggested columns and starter cards.", CreateBoardArgs, _create_board),
        Tool("rename_board", "Rename the current board.", RenameBoardArgs, _rename_board),
        Tool("add_column", "Add a column to the current board.", AddColumnArgs, _add_column),
        Tool("rename_column", "Rename a column.", RenameColumnArgs, _rename_column),
        Tool("reorder_columns", "Move a column to a new position on the board.", MoveColumnArgs, _move_column),
        Tool("delete_column", "Propose deleting a column. The user must confirm.", DeleteColumnArgs, _delete_column),
        Tool("create_card", "Add a card to a column.", CreateCardArgs, _create_card),
        Tool("update_card", "Change a card's title and/or description.", UpdateCardArgs, _update_card),
        Tool("move_card", "Move a card to a column and position (reorders within a column too).", MoveCardArgs, _move_card),
        Tool("delete_card", "Propose deleting a card. The user must confirm.", DeleteCardArgs, _delete_card),
        Tool("delete_board", "Propose deleting the current board. The user must confirm.", DeleteBoardArgs, _delete_board),
        Tool(
            "set_card_fields",
            "Set a card's assignee, priority, due date or estimate. Only the fields you send change.",
            SetCardFieldsArgs,
            _set_card_fields,
        ),
        Tool("add_label", "Put a workspace label on a card.", CardLabelArgs, _add_label),
        Tool("remove_label", "Take a label off a card.", CardLabelArgs, _remove_label),
        Tool("add_checklist_items", "Add checklist items to a card.", ChecklistArgs, _add_checklist),
        Tool("comment_on_card", "Write a comment on a card, as the user.", CommentArgs, _comment),
        Tool(
            "archive_card",
            "Archive a card: it leaves the board but can be restored. Prefer this over deleting.",
            ArchiveCardArgs,
            _archive_card,
        ),
        Tool("create_sprint", "Plan a new sprint on this board, optionally with cards in it.", CreateSprintArgs, _create_sprint),
        Tool("plan_cards", "Move cards into a sprint, or back to the backlog with sprint_id null.", AddToSprintArgs, _add_to_sprint),
        Tool("start_sprint", "Start a planned sprint. Only one sprint runs at a time.", SprintArgs, _start_sprint),
        Tool(
            "complete_sprint",
            "Finish a sprint and decide where unfinished cards go.",
            CompleteSprintArgs,
            _complete_sprint,
        ),
        Tool(
            "create_board_from_template",
            "Create a NEW board in this workspace from one of the listed templates.",
            CreateFromTemplateArgs,
            _create_from_template,
        ),
        Tool(
            "board_stats",
            "Read the board's numbers: open and completed cards, overdue, workload, cycle time, "
            "WIP limits. Use this to answer questions about progress or what is blocked.",
            BoardStatsArgs,
            _board_stats,
        ),
        Tool(
            "suggest_card_authoring",
            "Propose improvements to a card's title, description, acceptance criteria, subtasks, estimate, labels, priority, due date or assignee. The user must review and confirm.",
            CardAuthoringArgs,
            _suggest_card_authoring,
        ),
        Tool(
            "batch_card_authoring",
            "Propose a reviewed batch of card authoring changes. The user must confirm the complete list before anything changes.",
            BatchCardAuthoringArgs,
            _suggest_batch_authoring,
        ),
        Tool("apply_card_authoring", "Internal confirmed card authoring operation.", CardAuthoringArgs, _apply_card_authoring, False),
        Tool("apply_batch_card_authoring", "Internal confirmed batch operation.", BatchCardAuthoringArgs, _apply_batch_authoring, False),
    ]
}


def tool_definitions() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {"name": t.name, "description": t.description, "parameters": t.args.model_json_schema()},
        }
        for t in TOOLS.values()
        if t.exposed
    ]


def execute(ctx: ToolContext, name: str, args: Any) -> ToolResult:
    """Validate and run one tool call. Every failure becomes a ToolError for the model."""
    tool = TOOLS.get(name)
    if tool is None:
        raise ToolError(f"Unknown tool '{name}'. Available: {', '.join(TOOLS)}.")
    try:
        parsed = tool.args.model_validate(args)
    except ValidationError as exc:  # keep the message short for the model
        detail = "; ".join(f"{'.'.join(map(str, e['loc'])) or 'arguments'}: {e['msg']}" for e in exc.errors()[:5])
        raise ToolError(f"Invalid arguments: {detail}") from None
    try:
        return tool.run(ctx, parsed)
    except svc.NotFound as exc:
        raise ToolError(str(exc)) from None
    except Forbidden as exc:
        # A viewer asked the assistant to change something. The service refused, as it would for
        # the HTTP API; the model is told so it can explain rather than retry.
        raise ToolError(f"{exc} The assistant cannot do this for you.") from None
    except (svc.Conflict, svc.InvalidRequest) as exc:
        raise ToolError(str(exc)) from None
