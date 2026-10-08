from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.db import get_db
from app.schemas.notifications import NotificationOut, UnreadCount
from app.services import notifications as svc

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]


@router.get("/notifications", response_model=list[NotificationOut])
def list_notifications(
    user: CurrentUser, db: DbSession, unread_only: bool = False, limit: int = 50
):
    """Only ever the caller's own; there is no way to read someone else's."""
    return svc.list_for(db, user, unread_only, limit)


@router.get("/notifications/unread-count", response_model=UnreadCount)
def unread_count(user: CurrentUser, db: DbSession):
    return UnreadCount(unread=svc.unread_count(db, user))


@router.post("/notifications/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: int, user: CurrentUser, db: DbSession):
    return svc.mark_read(db, user, notification_id)


@router.post("/notifications/read-all", response_model=UnreadCount)
def mark_all_read(user: CurrentUser, db: DbSession):
    """Returns how many were cleared, so the UI can say so."""
    return UnreadCount(unread=svc.mark_all_read(db, user))
