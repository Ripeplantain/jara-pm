import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.util.time import as_utc

INVITE_TTL_DAYS = 14


def _now() -> datetime:
    return datetime.now(UTC)


def default_expiry() -> datetime:
    return _now() + timedelta(days=INVITE_TTL_DAYS)


def new_token() -> str:
    return secrets.token_urlsafe(32)


class WorkspaceInvite(Base):
    """An invitation for an email address that has no account yet.

    Accepted when the invited address registers through the emailed link. Only a SHA-256 token
    hash is stored; the raw single-use link exists briefly in the transactional email handoff.
    """

    __tablename__ = "workspace_invites"

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    email: Mapped[str] = mapped_column(String(320), index=True)
    role: Mapped[str] = mapped_column(String(20))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    invited_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=default_expiry)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    workspace: Mapped["Workspace"] = relationship()  # noqa: F821

    def is_open(self, now: datetime | None = None) -> bool:
        if self.accepted_at is not None:
            return False
        return as_utc(self.expires_at) > (now or _now())
