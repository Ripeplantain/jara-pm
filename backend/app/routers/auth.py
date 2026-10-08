from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import CurrentUser
from app.auth.tokens import create_access_token
from app.config import ACCESS_TOKEN_MINUTES
from app.db import get_db
from app.schemas.auth import (
    AccountDeactivate,
    AccountDelete,
    EmailTokenRequest,
    LoginRequest,
    PasswordChange,
    PasswordResetConfirm,
    PasswordResetRequest,
    ProfileUpdate,
    RegisterRequest,
    TokenResponse,
    UserOut,
)
from app.schemas.workspaces import InvitePreview
from app.services import auth as auth_service

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]


@router.post("/auth/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: DbSession) -> UserOut:
    try:
        user = auth_service.register_user(db, body.email, body.password, body.invite_token)
    except auth_service.EmailAlreadyRegistered:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Email already registered") from None
    return UserOut.model_validate(user)


@router.get("/auth/invites/{token}", response_model=InvitePreview)
def invite_preview(token: str, db: DbSession) -> InvitePreview:
    invite = auth_service.workspace_service.invite_for_token(db, token)
    return InvitePreview(
        email=invite.email,
        workspace_name=invite.workspace.name,
        role=invite.role,
        expires_at=invite.expires_at,
    )


@router.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest, db: DbSession) -> TokenResponse:
    user = auth_service.authenticate(db, body.email, body.password)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return TokenResponse(
        access_token=create_access_token(user.id, user.auth_version),
        expires_in=ACCESS_TOKEN_MINUTES * 60,
        user=UserOut.model_validate(user),
    )


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut)
def update_me(body: ProfileUpdate, user: CurrentUser, db: DbSession) -> UserOut:
    updated = auth_service.update_profile(db, user, body.display_name, body.avatar_color)
    return UserOut.model_validate(updated)


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: PasswordChange, user: CurrentUser, db: DbSession) -> None:
    """Changing the password invalidates access tokens issued before the change."""
    auth_service.change_password(db, user, body.current_password, body.new_password)


@router.post("/auth/verify-email", response_model=UserOut)
def verify_email(body: EmailTokenRequest, db: DbSession) -> UserOut:
    return UserOut.model_validate(auth_service.verify_email(db, body.token))


@router.post("/auth/verification-email", status_code=status.HTTP_202_ACCEPTED)
def verification_email(body: PasswordResetRequest, db: DbSession) -> None:
    auth_service.resend_verification(db, body.email)


@router.post("/auth/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
def password_reset_request(body: PasswordResetRequest, db: DbSession) -> None:
    """Always return the same response so account existence is not disclosed."""
    auth_service.request_password_reset(db, body.email)


@router.post("/auth/password-reset/confirm", status_code=status.HTTP_204_NO_CONTENT)
def password_reset_confirm(body: PasswordResetConfirm, db: DbSession) -> None:
    auth_service.reset_password(db, body.token, body.new_password)


@router.post("/me/deactivate", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_me(body: AccountDeactivate, user: CurrentUser, db: DbSession) -> None:
    auth_service.deactivate_account(db, user, body.password)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(body: AccountDelete, user: CurrentUser, db: DbSession) -> None:
    auth_service.delete_account(db, user, body.password)
