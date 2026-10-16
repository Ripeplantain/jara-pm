"""goals, goal milestones and goal links

Revision ID: 0021
Revises: 0020

Three new tables. Goal progress is derived from board state at read time, so there is no
progress column to backfill and nothing to keep in step with later card moves. No existing
table is touched, so nothing is rebuilt.
"""
import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "goals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
        sa.Column("state", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("starts_on", sa.Date(), nullable=True),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("achieved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("goals", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_goals_workspace_id"), ["workspace_id"])
        batch_op.create_index(batch_op.f("ix_goals_created_by_id"), ["created_by_id"])

    op.create_table(
        "goal_milestones",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("goal_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["goal_id"], ["goals.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("goal_milestones", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_goal_milestones_goal_id"), ["goal_id"])

    op.create_table(
        "goal_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("goal_id", sa.Integer(), nullable=False),
        sa.Column("milestone_id", sa.Integer(), nullable=True),
        sa.Column("target_type", sa.String(length=10), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["goal_id"], ["goals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["milestone_id"], ["goal_milestones.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("goal_links", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_goal_links_goal_id"), ["goal_id"])
        batch_op.create_index(batch_op.f("ix_goal_links_milestone_id"), ["milestone_id"])
        batch_op.create_index(batch_op.f("ix_goal_links_target_id"), ["target_id"])


def downgrade() -> None:
    with op.batch_alter_table("goal_links", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_goal_links_target_id"))
        batch_op.drop_index(batch_op.f("ix_goal_links_milestone_id"))
        batch_op.drop_index(batch_op.f("ix_goal_links_goal_id"))
    op.drop_table("goal_links")
    with op.batch_alter_table("goal_milestones", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_goal_milestones_goal_id"))
    op.drop_table("goal_milestones")
    with op.batch_alter_table("goals", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_goals_created_by_id"))
        batch_op.drop_index(batch_op.f("ix_goals_workspace_id"))
    op.drop_table("goals")
