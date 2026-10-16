"""habits and habit check-ins

Revision ID: 0020
Revises: 0019

Two new tables, nothing else. No existing table is touched, so nothing is rebuilt and the
`PRAGMA foreign_keys` cascade trap documented in agents.md cannot bite here.
"""
import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "habits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("detail", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("schedule", sa.String(length=20), nullable=False, server_default="daily"),
        sa.Column("target_per_week", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("color", sa.String(length=20), nullable=False, server_default="indigo"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("habits", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_habits_workspace_id"), ["workspace_id"])
        batch_op.create_index(batch_op.f("ix_habits_user_id"), ["user_id"])

    op.create_table(
        "habit_checkins",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("habit_id", sa.Integer(), nullable=False),
        sa.Column("on_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["habit_id"], ["habits.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("habit_id", "on_date", name="uq_habit_checkin_day"),
    )
    with op.batch_alter_table("habit_checkins", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_habit_checkins_habit_id"), ["habit_id"])
        batch_op.create_index(batch_op.f("ix_habit_checkins_on_date"), ["on_date"])


def downgrade() -> None:
    with op.batch_alter_table("habit_checkins", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_habit_checkins_on_date"))
        batch_op.drop_index(batch_op.f("ix_habit_checkins_habit_id"))
    op.drop_table("habit_checkins")
    with op.batch_alter_table("habits", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_habits_user_id"))
        batch_op.drop_index(batch_op.f("ix_habits_workspace_id"))
    op.drop_table("habits")
