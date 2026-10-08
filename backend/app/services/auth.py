import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config
from app.auth.passwords import hash_password, verify_password
from app.models import AccountToken, AccountTokenKind, User
from app.models.user import AVATAR_COLORS, avatar_color_for, display_name_for
from app.services import email as email_service
from app.services import workspaces as workspace_service
from app.services.errors import Forbidden, InvalidRequest

logger = logging.getLogger(__name__)
TOKEN_TTL = timedelta(hours=24)


class EmailAlreadyRegistered(Exception):
    pass


def register_user(db: Session, email: str, password: str, invite_token: str | None = None) -> User:
    """Create the user and the personal workspace they own, in one transaction."""
    if invite_token:
        workspace_service.validate_invite_for_registration(db, email, invite_token)
    elif workspace_service.has_open_invites(db, email):
        raise InvalidRequest(
            "Use the invitation link sent to this email address to join the workspace"
        )
    user = User(
        email=email,
        password_hash=hash_password(password),
        display_name=display_name_for(email),
        avatar_color=avatar_color_for(email),
        email_verified_at=None,
    )
    db.add(user)
    try:
        db.flush()
        workspace_service.create_workspace(
            db, user, workspace_service.personal_workspace_name(email), commit=False
        )
        # A validated invitation link lets the new account join its open invitations.
        workspace_service.accept_open_invites(db, user, commit=False)
        raw_token = _issue_token(db, user, AccountTokenKind.EMAIL_VERIFICATION)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise EmailAlreadyRegistered from None
    _try_send(email_service.send_verification, user.email, raw_token)
    return user


def authenticate(db: Session, email: str, password: str) -> User | None:
    """Same failure for an unknown email, a wrong password and a deactivated account."""
    user = db.scalar(select(User).where(User.email == email))
    ok = verify_password(password, user.password_hash if user else None)
    if not ok or user is None or not user.is_active:
        return None
    if not user.email_verified and config.require_email_verification():
        return None
    return user


def update_profile(
    db: Session, user: User, display_name: str | None = None, avatar_color: str | None = None
) -> User:
    """Only ever the acting user's own profile: there is no endpoint to edit someone else's."""
    if display_name is not None:
        user.display_name = display_name
    if avatar_color is not None:
        if avatar_color not in AVATAR_COLORS:
            raise InvalidRequest(f"Avatar colour must be one of: {', '.join(AVATAR_COLORS)}")
        user.avatar_color = avatar_color
    db.commit()
    db.refresh(user)
    return user


def change_password(db: Session, user: User, current_password: str, new_password: str) -> None:
    """Requires the current password, so a stolen session cannot lock the owner out."""
    if not verify_password(current_password, user.password_hash):
        raise Forbidden("Current password is incorrect")
    user.password_hash = hash_password(new_password)
    user.auth_version += 1
    db.commit()


def _digest(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def _issue_token(db: Session, user: User, kind: AccountTokenKind) -> str:
    raw_token = secrets.token_urlsafe(32)
    db.add(
        AccountToken(
            user_id=user.id,
            kind=kind.value,
            token_hash=_digest(raw_token),
            expires_at=datetime.now(UTC) + TOKEN_TTL,
        )
    )
    return raw_token


def _consume_token(db: Session, raw_token: str, kind: AccountTokenKind) -> tuple[AccountToken, User]:
    token = db.scalar(
        select(AccountToken)
        .where(AccountToken.token_hash == _digest(raw_token), AccountToken.kind == kind.value)
    )
    if token is None or not token.is_open():
        raise InvalidRequest("This link is invalid or has expired")
    user = db.get(User, token.user_id)
    if user is None:
        raise InvalidRequest("This link is invalid or has expired")
    # SQLite does not provide row locks for SELECT ... FOR UPDATE. Claim the token with a
    # conditional UPDATE so two concurrent requests cannot both redeem the same link.
    now = datetime.now(UTC)
    claimed = db.execute(
        update(AccountToken)
        .where(
            AccountToken.id == token.id,
            AccountToken.used_at.is_(None),
            AccountToken.expires_at > now,
        )
        .values(used_at=now)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        db.rollback()
        raise InvalidRequest("This link is invalid or has expired")
    token.used_at = now
    return token, user


def verify_email(db: Session, raw_token: str) -> User:
    _token, user = _consume_token(db, raw_token, AccountTokenKind.EMAIL_VERIFICATION)
    user.email_verified_at = datetime.now(UTC)
    db.commit()
    return user


def resend_verification(db: Session, email_address: str) -> None:
    user = db.scalar(select(User).where(User.email == email_address.strip().lower()))
    if user is None or not user.is_active or user.email_verified:
        return
    raw_token = _issue_token(db, user, AccountTokenKind.EMAIL_VERIFICATION)
    db.commit()
    _try_send(email_service.send_verification, user.email, raw_token)


def request_password_reset(db: Session, email_address: str) -> None:
    user = db.scalar(select(User).where(User.email == email_address.strip().lower()))
    if user is None or not user.is_active:
        return
    raw_token = _issue_token(db, user, AccountTokenKind.PASSWORD_RESET)
    db.commit()
    _try_send(email_service.send_password_reset, user.email, raw_token)


def reset_password(db: Session, raw_token: str, new_password: str) -> None:
    _token, user = _consume_token(db, raw_token, AccountTokenKind.PASSWORD_RESET)
    user.password_hash = hash_password(new_password)
    user.auth_version += 1
    # A successful password reset is a strong proof of access to the account email.
    user.email_verified_at = user.email_verified_at or datetime.now(UTC)
    db.commit()


def deactivate_account(db: Session, user: User, password: str) -> None:
    if not verify_password(password, user.password_hash):
        raise Forbidden("Password is incorrect")
    user.is_active = False
    user.auth_version += 1
    db.commit()


def delete_account(db: Session, user: User, password: str) -> None:
    if not verify_password(password, user.password_hash):
        raise Forbidden("Password is incorrect")
    memberships = workspace_service.list_workspaces(db, user)
    owned_with_teammates = [
        workspace
        for workspace in memberships
        if workspace.created_by_id == user.id
        and any(member.user_id != user.id for member in workspace.members)
    ]
    if owned_with_teammates:
        raise InvalidRequest("Transfer workspace ownership before deleting your account")
    for workspace in memberships:
        if workspace.created_by_id == user.id:
            db.delete(workspace)
    db.delete(user)
    db.commit()


def _try_send(sender, address: str, token: str) -> None:
    try:
        sender(address, token)
    except email_service.EmailDeliveryError:
        # The account mutation is already committed. The user can request the message again.
        logger.warning("transactional email unavailable for account lifecycle message")
