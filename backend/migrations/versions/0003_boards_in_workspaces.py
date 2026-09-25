"""boards belong to a workspace

`owner_id` becomes `created_by_id` (provenance only); access now comes from workspace membership.
Existing boards move into their owner's personal workspace, created in 0002.

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def _boards_table(owner_column: str) -> sa.Table:
    """The boards table as it stands, described explicitly.

    Batch mode is given this instead of reflecting, so the rebuilt table gets the foreign key we
    want (`ON DELETE SET NULL`: deleting a user must never delete a shared board) rather than the
    `ON DELETE CASCADE` inherited from the single-user schema.
    """
    return sa.Table(
        "boards",
        sa.MetaData(),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            owner_column,
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "workspace_id",
            sa.Integer(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
    )


def upgrade() -> None:
    # 1. Add the new columns nullable so existing rows survive the add.
    with op.batch_alter_table("boards", schema=None) as batch_op:
        batch_op.add_column(sa.Column("workspace_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("description", sa.Text(), nullable=False, server_default=""))
    op.drop_index("ix_boards_owner_id", table_name="boards")

    # 2. Every board moves into its owner's personal workspace (created in 0002).
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE boards SET workspace_id = ("
            "  SELECT m.workspace_id FROM workspace_members m"
            "  WHERE m.user_id = boards.owner_id AND m.role = 'owner'"
            "  ORDER BY m.workspace_id LIMIT 1"
            ")"
        )
    )
    orphans = conn.execute(
        sa.text("SELECT COUNT(*) FROM boards WHERE workspace_id IS NULL")
    ).scalar_one()
    if orphans:  # pragma: no cover - only reachable on a hand-edited database
        raise RuntimeError(
            f"{orphans} board(s) have no owning workspace; fix the data before migrating"
        )

    # 3. Rebuild with the final shape: workspace_id required, owner_id renamed.
    with op.batch_alter_table(
        "boards", schema=None, copy_from=_boards_table("owner_id")
    ) as batch_op:
        batch_op.alter_column("workspace_id", existing_type=sa.Integer(), nullable=False)
        batch_op.alter_column(
            "owner_id", new_column_name="created_by_id", existing_type=sa.Integer(), nullable=True
        )

    op.create_index(op.f("ix_boards_workspace_id"), "boards", ["workspace_id"])
    op.create_index(op.f("ix_boards_created_by_id"), "boards", ["created_by_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_boards_created_by_id"), table_name="boards")
    op.drop_index(op.f("ix_boards_workspace_id"), table_name="boards")
    with op.batch_alter_table(
        "boards", schema=None, copy_from=_boards_table("created_by_id")
    ) as batch_op:
        batch_op.alter_column(
            "created_by_id", new_column_name="owner_id", existing_type=sa.Integer(), nullable=False
        )
        batch_op.drop_column("workspace_id")
        batch_op.drop_column("description")
    op.create_index("ix_boards_owner_id", "boards", ["owner_id"])
