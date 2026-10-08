"""checklist items and comments on cards

Revision ID: 0008
Revises: 0007
"""
import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "checklist_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("text", sa.String(length=300), nullable=False),
        sa.Column("done", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["card_id"], ["cards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("checklist_items", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_checklist_items_card_id"), ["card_id"])

    op.create_table(
        "comments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["card_id"], ["cards.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("comments", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_comments_card_id"), ["card_id"])


def downgrade() -> None:
    with op.batch_alter_table("comments", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_comments_card_id"))
    op.drop_table("comments")
    with op.batch_alter_table("checklist_items", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_checklist_items_card_id"))
    op.drop_table("checklist_items")
