"""first-run onboarding state

Revision ID: 0014
Revises: 0013
"""
import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "onboarding_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("team_size", sa.Integer(), nullable=False),
        sa.Column("product_context", sa.Text(), nullable=False),
        sa.Column("board_id", sa.Integer(), nullable=True),
        sa.Column("sprint_id", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["board_id"], ["boards.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["sprint_id"], ["sprints.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_onboarding_user"),
    )
    with op.batch_alter_table("onboarding_profiles", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_onboarding_profiles_user_id"), ["user_id"])
        batch_op.create_index(batch_op.f("ix_onboarding_profiles_workspace_id"), ["workspace_id"])


def downgrade() -> None:
    with op.batch_alter_table("onboarding_profiles", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_onboarding_profiles_workspace_id"))
        batch_op.drop_index(batch_op.f("ix_onboarding_profiles_user_id"))
    op.drop_table("onboarding_profiles")
