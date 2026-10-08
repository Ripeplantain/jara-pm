"""hash invitation tokens at rest

Revision ID: 0018
Revises: 0017
"""
import hashlib
import secrets

import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workspace_invites", sa.Column("token_hash", sa.String(length=64), nullable=True))
    bind = op.get_bind()
    table = sa.table(
        "workspace_invites",
        sa.column("id", sa.Integer()),
        sa.column("token", sa.String(length=64)),
        sa.column("token_hash", sa.String(length=64)),
    )
    for row in bind.execute(sa.select(table.c.id, table.c.token)):
        bind.execute(
            table.update().where(table.c.id == row.id).values(
                token_hash=hashlib.sha256(row.token.encode()).hexdigest()
            )
        )
    with op.batch_alter_table("workspace_invites", schema=None) as batch_op:
        batch_op.drop_column("token")
        batch_op.alter_column("token_hash", nullable=False)
        batch_op.create_index(batch_op.f("ix_workspace_invites_token_hash"), ["token_hash"])
        batch_op.create_unique_constraint("uq_workspace_invites_token_hash", ["token_hash"])


def downgrade() -> None:
    # A downgrade cannot recover the old raw tokens. Rotate them so the older schema remains
    # structurally compatible while every previously issued invitation link is invalidated.
    op.add_column("workspace_invites", sa.Column("token", sa.String(length=64), nullable=True))
    bind = op.get_bind()
    table = sa.table(
        "workspace_invites",
        sa.column("id", sa.Integer()),
        sa.column("token", sa.String(length=64)),
    )
    for row in bind.execute(sa.select(table.c.id)):
        bind.execute(table.update().where(table.c.id == row.id).values(token=secrets.token_urlsafe(32)))
    with op.batch_alter_table("workspace_invites", schema=None) as batch_op:
        batch_op.drop_constraint("uq_workspace_invites_token_hash", type_="unique")
        batch_op.drop_index(batch_op.f("ix_workspace_invites_token_hash"))
        batch_op.drop_column("token_hash")
        batch_op.alter_column("token", nullable=False)
        batch_op.create_unique_constraint("uq_workspace_invites_token", ["token"])
