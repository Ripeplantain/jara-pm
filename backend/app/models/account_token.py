import secrets
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.util.time import as_utc


class AccountTokenKind(StrEnum):
    EMAIL_VERIFICATION = "email_verification"
    PASSWORD_RESET = "password_reset"


def _now() -> datetime:
    return datetime.now(UTC)


def new_raw_token() -> str:
    return secrets.token_urlsafe(32)


class AccountToken(Base):
    """A single-use, hashed token for an account lifecycle action."""

    __tablename__ = "account_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped["User"] = relationship()  # noqa: F821

    def is_open(self, now: datetime | None = None) -> bool:
        return self.used_at is None and as_utc(self.expires_at) > (now or _now())


__all__ = ["AccountToken", "AccountTokenKind", "new_raw_token"]
