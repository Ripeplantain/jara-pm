from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# Fixed palette: avatars pick from these, so the UI never renders an arbitrary value.
AVATAR_COLORS = (
    "indigo",
    "cyan",
    "emerald",
    "amber",
    "rose",
    "violet",
    "slate",
)


def avatar_color_for(email: str) -> str:
    """A stable colour per address, so the same person looks the same everywhere by default."""
    return AVATAR_COLORS[sum(email.encode()) % len(AVATAR_COLORS)]


def display_name_for(email: str) -> str:
    local = (email or "").split("@")[0].replace(".", " ").replace("_", " ").strip()
    return local.title() if local else "Someone"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Stored normalized (trimmed, lowercased).
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(120), default="")
    avatar_color: Mapped[str] = mapped_column(String(20), default=AVATAR_COLORS[0])
    # Deactivated accounts keep their data and their history, but cannot sign in.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    # Incremented when credentials change so previously issued backend tokens stop working.
    auth_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))

    @property
    def name(self) -> str:
        """What to show. Falls back to the email's local part for accounts made before 0005."""
        return self.display_name or display_name_for(self.email)

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None
