from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.tokens import decode_access_token
from app.db import get_db
from app.models import User

_bearer = HTTPBearer(auto_error=False)
_UNAUTHENTICATED = HTTPException(
    status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    """The only source of the acting user: the verified Bearer token."""
    if creds is None:
        raise _UNAUTHENTICATED
    claims = decode_access_token(creds.credentials)
    user = db.get(User, claims.user_id) if claims is not None else None
    if user is None or not user.is_active or user.auth_version != claims.auth_version:
        raise _UNAUTHENTICATED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
