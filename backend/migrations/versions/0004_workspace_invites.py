"""invitations for email addresses without an account yet

Revision ID: 0004
Revises: 0003
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_invites",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("invited_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    with op.batch_alter_table("workspace_invites", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_workspace_invites_workspace_id"), ["workspace_id"])
        batch_op.create_index(batch_op.f("ix_workspace_invites_email"), ["email"])


def downgrade() -> None:
    with op.batch_alter_table("workspace_invites", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_workspace_invites_email"))
        batch_op.drop_index(batch_op.f("ix_workspace_invites_workspace_id"))
    op.drop_table("workspace_invites")
