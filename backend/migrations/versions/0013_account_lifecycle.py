"""account lifecycle tokens and auth invalidation

Revision ID: 0013
Revises: 0012
"""
import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("auth_version", sa.Integer(), nullable=False, server_default="0"))

    op.create_table(
        "account_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    with op.batch_alter_table("account_tokens", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_account_tokens_user_id"), ["user_id"])
        batch_op.create_index(batch_op.f("ix_account_tokens_kind"), ["kind"])
        batch_op.create_index(batch_op.f("ix_account_tokens_token_hash"), ["token_hash"])
        batch_op.create_index(batch_op.f("ix_account_tokens_expires_at"), ["expires_at"])


def downgrade() -> None:
    with op.batch_alter_table("account_tokens", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_account_tokens_expires_at"))
        batch_op.drop_index(batch_op.f("ix_account_tokens_token_hash"))
        batch_op.drop_index(batch_op.f("ix_account_tokens_kind"))
        batch_op.drop_index(batch_op.f("ix_account_tokens_user_id"))
    op.drop_table("account_tokens")
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("auth_version")
        batch_op.drop_column("email_verified_at")
