from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db import get_db
from app.models import Priority
from app.schemas.activity import ActivityOut
from app.schemas.analytics import BoardAnalytics
from app.schemas.boards import (
    BoardCreate,
    BoardFromTemplate,
    BoardOut,
    BoardSummary,
    BoardUpdate,
    CardCreate,
    CardMove,
    CardOut,
    CardUpdate,
    ColumnCreate,
    ColumnOut,
    ColumnUpdate,
    TemplateOut,
)
from app.schemas.card_details import (
    ChecklistItemCreate,
    ChecklistItemOut,
    ChecklistItemUpdate,
    CommentCreate,
    CommentOut,
)
from app.services import activity as activity_svc
from app.services import analytics as analytics_svc
from app.services import boards as svc
from app.services import card_details as detail_svc
from app.services import labels as label_svc
from app.services import search as search_svc
from app.services import templates as template_svc

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]


@router.get("/boards", response_model=list[BoardSummary])
def list_boards(user: CurrentUser, db: DbSession, workspace_id: int | None = None):
    """Favourites first, then by name: the order the dashboard shows them in."""
    favorites = svc.favorite_board_ids(db, user)
    boards = [
        BoardSummary.model_validate(board).model_copy(update={"is_favorite": board.id in favorites})
        for board in svc.list_boards(db, user, workspace_id)
    ]
    return sorted(boards, key=lambda b: (not b.is_favorite, b.title.lower()))


@router.put("/boards/{board_id}/favorite", response_model=BoardSummary)
def add_favorite(board_id: int, user: CurrentUser, db: DbSession):
    svc.set_favorite(db, user, board_id, True)
    return BoardSummary.model_validate(svc.get_board(db, user, board_id)).model_copy(
        update={"is_favorite": True}
    )


@router.delete("/boards/{board_id}/favorite", response_model=BoardSummary)
def remove_favorite(board_id: int, user: CurrentUser, db: DbSession):
    svc.set_favorite(db, user, board_id, False)
    return BoardSummary.model_validate(svc.get_board(db, user, board_id))


@router.get("/board-templates", response_model=list[TemplateOut])
def list_templates():
    """Static data: the shapes a new board can start from."""
    return [
        TemplateOut(
            key=t.key,
            name=t.name,
            description=t.description,
            columns=[title for title, _ in t.columns],
        )
        for t in template_svc.list_templates()
    ]


@router.post("/boards/from-template", response_model=BoardOut, status_code=status.HTTP_201_CREATED)
def create_from_template(body: BoardFromTemplate, user: CurrentUser, db: DbSession):
    return template_svc.create_board_from_template(
        db, user, body.template, body.title, body.workspace_id
    )


@router.post("/boards", response_model=BoardOut, status_code=status.HTTP_201_CREATED)
def create_board(body: BoardCreate, user: CurrentUser, db: DbSession):
    return svc.create_board(db, user, body.title, body.columns, body.workspace_id, body.description)


@router.get("/boards/{board_id}", response_model=BoardOut)
def get_board(board_id: int, user: CurrentUser, db: DbSession, include_archived: bool = False):
    return svc.get_board(db, user, board_id, include_archived)


@router.patch("/boards/{board_id}", response_model=BoardOut)
def update_board(board_id: int, body: BoardUpdate, user: CurrentUser, db: DbSession):
    return svc.update_board(db, user, board_id, body.title, body.description)


@router.delete("/boards/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_board(board_id: int, user: CurrentUser, db: DbSession):
    svc.delete_board(db, user, board_id)


@router.post("/boards/{board_id}/columns", response_model=ColumnOut, status_code=status.HTTP_201_CREATED)
def create_column(board_id: int, body: ColumnCreate, user: CurrentUser, db: DbSession):
    return svc.create_column(db, user, board_id, body.title, body.position)


@router.patch("/columns/{column_id}", response_model=ColumnOut)
def update_column(column_id: int, body: ColumnUpdate, user: CurrentUser, db: DbSession):
    sent = body.model_fields_set
    return svc.update_column(
        db,
        user,
        column_id,
        body.title,
        body.position,
        body.wip_limit if "wip_limit" in sent else svc.UNSET,
        body.is_done,
    )


@router.delete("/columns/{column_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_column(
    column_id: int,
    user: CurrentUser,
    db: DbSession,
    move_cards_to: int | None = None,
    delete_cards: bool = False,
):
    svc.delete_column(db, user, column_id, move_cards_to, delete_cards)


@router.post("/columns/{column_id}/cards", response_model=CardOut, status_code=status.HTTP_201_CREATED)
def create_card(column_id: int, body: CardCreate, user: CurrentUser, db: DbSession):
    return svc.create_card(
        db,
        user,
        column_id,
        body.title,
        body.description,
        body.position,
        body.assignee_id,
        body.priority,
        body.due_date,
        body.estimate,
    )


@router.patch("/cards/{card_id}", response_model=CardOut)
def update_card(card_id: int, body: CardUpdate, user: CurrentUser, db: DbSession):
    """A field the client did not send is left alone; sending null clears it."""
    sent = body.model_fields_set
    return svc.update_card(
        db,
        user,
        card_id,
        body.title,
        body.description,
        body.assignee_id if "assignee_id" in sent else svc.UNSET,
        body.priority,
        body.due_date if "due_date" in sent else svc.UNSET,
        body.estimate if "estimate" in sent else svc.UNSET,
    )


@router.post("/cards/{card_id}/move", response_model=CardOut)
def move_card(card_id: int, body: CardMove, user: CurrentUser, db: DbSession):
    return svc.move_card(db, user, card_id, body.column_id, body.position)


@router.post("/cards/{card_id}/archive", response_model=CardOut)
def archive_card(card_id: int, user: CurrentUser, db: DbSession):
    return svc.archive_card(db, user, card_id)


@router.post("/cards/{card_id}/unarchive", response_model=CardOut)
def unarchive_card(card_id: int, user: CurrentUser, db: DbSession):
    return svc.unarchive_card(db, user, card_id)


@router.get("/boards/{board_id}/archived-cards", response_model=list[CardOut])
def list_archived_cards(board_id: int, user: CurrentUser, db: DbSession):
    return svc.list_archived_cards(db, user, board_id)


@router.delete("/cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_card(card_id: int, user: CurrentUser, db: DbSession):
    """Permanent. Archiving is the reversible option the UI offers first."""
    svc.delete_card(db, user, card_id)


@router.post("/cards/{card_id}/labels/{label_id}", response_model=CardOut)
def add_label(card_id: int, label_id: int, user: CurrentUser, db: DbSession):
    return label_svc.add_label_to_card(db, user, card_id, label_id)


@router.delete("/cards/{card_id}/labels/{label_id}", response_model=CardOut)
def remove_label(card_id: int, label_id: int, user: CurrentUser, db: DbSession):
    return label_svc.remove_label_from_card(db, user, card_id, label_id)


# --- checklist ----------------------------------------------------------------------------------


@router.get("/cards/{card_id}/checklist", response_model=list[ChecklistItemOut])
def list_checklist(card_id: int, user: CurrentUser, db: DbSession):
    return detail_svc.list_checklist(db, user, card_id)


@router.post(
    "/cards/{card_id}/checklist",
    response_model=ChecklistItemOut,
    status_code=status.HTTP_201_CREATED,
)
def add_checklist_item(card_id: int, body: ChecklistItemCreate, user: CurrentUser, db: DbSession):
    return detail_svc.add_checklist_item(db, user, card_id, body.text, body.position)


@router.patch("/checklist-items/{item_id}", response_model=ChecklistItemOut)
def update_checklist_item(
    item_id: int, body: ChecklistItemUpdate, user: CurrentUser, db: DbSession
):
    return detail_svc.update_checklist_item(db, user, item_id, body.text, body.done, body.position)


@router.delete("/checklist-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_checklist_item(item_id: int, user: CurrentUser, db: DbSession):
    detail_svc.delete_checklist_item(db, user, item_id)


# --- comments -----------------------------------------------------------------------------------


@router.get("/cards/{card_id}/comments", response_model=list[CommentOut])
def list_comments(card_id: int, user: CurrentUser, db: DbSession):
    return detail_svc.list_comments(db, user, card_id)


@router.post(
    "/cards/{card_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED
)
def add_comment(card_id: int, body: CommentCreate, user: CurrentUser, db: DbSession):
    return detail_svc.add_comment(db, user, card_id, body.body)


@router.patch("/comments/{comment_id}", response_model=CommentOut)
def update_comment(comment_id: int, body: CommentCreate, user: CurrentUser, db: DbSession):
    return detail_svc.update_comment(db, user, comment_id, body.body)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(comment_id: int, user: CurrentUser, db: DbSession):
    detail_svc.delete_comment(db, user, comment_id)


@router.get("/boards/{board_id}/activity", response_model=list[ActivityOut])
def board_activity(
    board_id: int, user: CurrentUser, db: DbSession, limit: int = 50, before_id: int | None = None
):
    """Newest first. `before_id` pages backwards through the history."""
    return activity_svc.for_board(db, user, board_id, limit, before_id)


@router.get("/boards/{board_id}/cards", response_model=list[CardOut])
def filter_cards(
    board_id: int,
    user: CurrentUser,
    db: DbSession,
    q: str | None = None,
    assignee_id: int | None = None,
    label_id: int | None = None,
    priority: Priority | None = None,
    due_before: datetime | None = None,
    sprint_id: int | None = None,
    archived: bool = False,
    limit: int = 200,
):
    """Every filter is combined with AND; leaving one out means "any"."""
    return search_svc.filter_cards(
        db, user, board_id, q, assignee_id, label_id, priority, due_before, sprint_id, archived, limit
    )


@router.get("/boards/{board_id}/analytics", response_model=BoardAnalytics)
def board_analytics(board_id: int, user: CurrentUser, db: DbSession):
    return analytics_svc.board_analytics(db, user, board_id)
