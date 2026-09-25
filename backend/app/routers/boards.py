from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db import get_db
from app.schemas.boards import (
    BoardCreate,
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
)
from app.services import boards as svc

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]


@router.get("/boards", response_model=list[BoardSummary])
def list_boards(user: CurrentUser, db: DbSession, workspace_id: int | None = None):
    return svc.list_boards(db, user, workspace_id)


@router.post("/boards", response_model=BoardOut, status_code=status.HTTP_201_CREATED)
def create_board(body: BoardCreate, user: CurrentUser, db: DbSession):
    return svc.create_board(db, user, body.title, body.columns, body.workspace_id, body.description)


@router.get("/boards/{board_id}", response_model=BoardOut)
def get_board(board_id: int, user: CurrentUser, db: DbSession):
    return svc.get_board(db, user, board_id)


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
    return svc.update_column(db, user, column_id, body.title, body.position)


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
    return svc.create_card(db, user, column_id, body.title, body.description, body.position)


@router.patch("/cards/{card_id}", response_model=CardOut)
def update_card(card_id: int, body: CardUpdate, user: CurrentUser, db: DbSession):
    return svc.update_card(db, user, card_id, body.title, body.description)


@router.post("/cards/{card_id}/move", response_model=CardOut)
def move_card(card_id: int, body: CardMove, user: CurrentUser, db: DbSession):
    return svc.move_card(db, user, card_id, body.column_id, body.position)


@router.delete("/cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_card(card_id: int, user: CurrentUser, db: DbSession):
    svc.delete_card(db, user, card_id)
