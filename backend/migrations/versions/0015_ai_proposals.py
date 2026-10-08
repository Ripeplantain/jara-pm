"""single-use AI mutation proposals

Revision ID: 0015
Revises: 0014
"""
import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_proposals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("board_id", sa.Integer(), nullable=False),
        sa.Column("tool", sa.String(length=80), nullable=False),
        sa.Column("args_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["board_id"], ["boards.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    with op.batch_alter_table("ai_proposals", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_proposals_board_id"), ["board_id"])
        batch_op.create_index(batch_op.f("ix_ai_proposals_token_hash"), ["token_hash"])
        batch_op.create_index(batch_op.f("ix_ai_proposals_user_id"), ["user_id"])


def downgrade() -> None:
    with op.batch_alter_table("ai_proposals", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_ai_proposals_user_id"))
        batch_op.drop_index(batch_op.f("ix_ai_proposals_token_hash"))
        batch_op.drop_index(batch_op.f("ix_ai_proposals_board_id"))
    op.drop_table("ai_proposals")
