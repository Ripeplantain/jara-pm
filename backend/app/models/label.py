from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# Labels pick a name from this palette, never a raw hex value: the UI maps each one to a token
# in globals.css, so labels stay legible in both light and dark themes.
LABEL_COLORS = (
    "slate",
    "indigo",
    "cyan",
    "emerald",
    "amber",
    "rose",
    "violet",
)


class Label(Base):
    """Workspace-scoped, so the same vocabulary ("bug", "needs design") works across boards."""

    __tablename__ = "labels"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_label_workspace_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(50))
    color: Mapped[str] = mapped_column(String(20), default=LABEL_COLORS[0])


class CardLabel(Base):
    """Join row. Cards reach their labels through `Card.labels`; this class is for writes."""

    __tablename__ = "card_labels"
    __table_args__ = (UniqueConstraint("card_id", "label_id", name="uq_card_label"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id", ondelete="CASCADE"), index=True)
    label_id: Mapped[int] = mapped_column(ForeignKey("labels.id", ondelete="CASCADE"), index=True)
