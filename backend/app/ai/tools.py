"""Typed AI tools. Each has a Pydantic argument schema and calls the same service functions as the
HTTP endpoints. IDs are validated against the board being edited before any service call, so a
model can never reach another board, let alone another user's data. Delete tools never execute:
they return a pending confirmation for the user.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field, ValidationError, model_validator
from sqlalchemy.orm import Session

from app.models import Board, Card, Column, User
from app.schemas.ai import AppliedChange, PendingAction
from app.schemas.boards import BoardTitle, CardTitle, ColumnTitle, Description, Position
from app.services import boards as svc


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


@dataclass
class ToolResult:
    data: dict[str, Any]
    change: AppliedChange | None = None
    pending: PendingAction | None = None


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
    ]
}


def tool_definitions() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {"name": t.name, "description": t.description, "parameters": t.args.model_json_schema()},
        }
        for t in TOOLS.values()
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
    except (svc.Conflict, svc.InvalidRequest) as exc:
        raise ToolError(str(exc)) from None
