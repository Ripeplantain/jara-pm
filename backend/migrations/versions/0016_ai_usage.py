"""monthly AI usage counters

Revision ID: 0016
Revises: 0015
"""
import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_usage",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("month_start", sa.Date(), nullable=False),
        sa.Column("actions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("provider_calls", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("latency_ms_total", sa.Float(), nullable=False, server_default="0"),
        sa.Column("errors", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "month_start", name="uq_ai_usage_workspace_month"),
    )
    with op.batch_alter_table("ai_usage", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_usage_month_start"), ["month_start"])
        batch_op.create_index(batch_op.f("ix_ai_usage_workspace_id"), ["workspace_id"])


def downgrade() -> None:
    with op.batch_alter_table("ai_usage", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_ai_usage_workspace_id"))
        batch_op.drop_index(batch_op.f("ix_ai_usage_month_start"))
    op.drop_table("ai_usage")
