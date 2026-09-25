"""workspaces and workspace members

Every existing user gets a personal workspace they own, so no data becomes unreachable.

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("workspaces", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_workspaces_created_by_id"), ["created_by_id"])

    op.create_table(
        "workspace_members",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_member_workspace_user"),
    )
    with op.batch_alter_table("workspace_members", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_workspace_members_workspace_id"), ["workspace_id"])
        batch_op.create_index(batch_op.f("ix_workspace_members_user_id"), ["user_id"])

    _backfill()


def _backfill() -> None:
    """One owned workspace per existing user, named after the email's local part."""
    conn = op.get_bind()
    users = conn.execute(sa.text("SELECT id, email FROM users ORDER BY id")).fetchall()
    for user_id, email in users:
        local = (email or "").split("@")[0].strip() or "Personal"
        conn.execute(
            sa.text(
                "INSERT INTO workspaces (name, created_by_id, created_at) "
                "VALUES (:name, :uid, CURRENT_TIMESTAMP)"
            ),
            {"name": f"{local}'s workspace", "uid": user_id},
        )
        workspace_id = conn.execute(sa.text("SELECT last_insert_rowid()")).scalar_one()
        conn.execute(
            sa.text(
                "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) "
                "VALUES (:wid, :uid, 'owner', CURRENT_TIMESTAMP)"
            ),
            {"wid": workspace_id, "uid": user_id},
        )


def downgrade() -> None:
    with op.batch_alter_table("workspace_members", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_workspace_members_user_id"))
        batch_op.drop_index(batch_op.f("ix_workspace_members_workspace_id"))
    op.drop_table("workspace_members")
    with op.batch_alter_table("workspaces", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_workspaces_created_by_id"))
    op.drop_table("workspaces")
