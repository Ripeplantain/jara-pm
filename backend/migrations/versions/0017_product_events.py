"""privacy-conscious product analytics events

Revision ID: 0017
Revises: 0016
"""
import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_name", sa.String(length=80), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("workspace_id", sa.Integer(), nullable=True),
        sa.Column("properties_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("product_events", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_product_events_event_name"), ["event_name"])
        batch_op.create_index(batch_op.f("ix_product_events_occurred_at"), ["occurred_at"])
        batch_op.create_index(batch_op.f("ix_product_events_user_id"), ["user_id"])
        batch_op.create_index(batch_op.f("ix_product_events_workspace_id"), ["workspace_id"])


def downgrade() -> None:
    with op.batch_alter_table("product_events", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_product_events_workspace_id"))
        batch_op.drop_index(batch_op.f("ix_product_events_user_id"))
        batch_op.drop_index(batch_op.f("ix_product_events_occurred_at"))
        batch_op.drop_index(batch_op.f("ix_product_events_event_name"))
    op.drop_table("product_events")
