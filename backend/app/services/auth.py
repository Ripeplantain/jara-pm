from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.passwords import hash_password, verify_password
from app.models import User
from app.services import workspaces as workspace_service


class EmailAlreadyRegistered(Exception):
    pass


def register_user(db: Session, email: str, password: str) -> User:
    """Create the user and the personal workspace they own, in one transaction."""
    user = User(email=email, password_hash=hash_password(password))
    db.add(user)
    try:
        db.flush()
        workspace_service.create_workspace(
            db, user, workspace_service.personal_workspace_name(email), commit=False
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise EmailAlreadyRegistered from None
    return user


def authenticate(db: Session, email: str, password: str) -> User | None:
    """Same failure for unknown email and wrong password."""
    user = db.scalar(select(User).where(User.email == email))
    ok = verify_password(password, user.password_hash if user else None)
    return user if ok and user else None
