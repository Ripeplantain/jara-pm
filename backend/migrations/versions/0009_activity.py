"""append-only activity log

Revision ID: 0009
Revises: 0008
"""
import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("board_id", sa.Integer(), nullable=True),
        sa.Column("card_id", sa.Integer(), nullable=True),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("summary", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("activities", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_activities_workspace_id"), ["workspace_id"])
        batch_op.create_index(batch_op.f("ix_activities_board_id"), ["board_id"])
        batch_op.create_index(batch_op.f("ix_activities_card_id"), ["card_id"])
        batch_op.create_index(batch_op.f("ix_activities_created_at"), ["created_at"])


def downgrade() -> None:
    with op.batch_alter_table("activities", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_activities_created_at"))
        batch_op.drop_index(batch_op.f("ix_activities_card_id"))
        batch_op.drop_index(batch_op.f("ix_activities_board_id"))
        batch_op.drop_index(batch_op.f("ix_activities_workspace_id"))
    op.drop_table("activities")
