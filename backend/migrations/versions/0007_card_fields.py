"""assignee, priority, dates and estimates on cards; wip limit and done flag on columns

All additive, all nullable or defaulted, so existing cards keep working unchanged.

Revision ID: 0007
Revises: 0006
"""
import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("cards", schema=None) as batch_op:
        batch_op.add_column(sa.Column("assignee_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("created_by_id", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column("priority", sa.String(length=10), nullable=False, server_default="none")
        )
        batch_op.add_column(sa.Column("due_date", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("estimate", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_foreign_key(
            "fk_cards_assignee_id", "users", ["assignee_id"], ["id"], ondelete="SET NULL"
        )
        batch_op.create_foreign_key(
            "fk_cards_created_by_id", "users", ["created_by_id"], ["id"], ondelete="SET NULL"
        )
        batch_op.create_index(batch_op.f("ix_cards_assignee_id"), ["assignee_id"])

    # Existing cards have never been edited, so their updated_at is their created_at.
    op.get_bind().execute(sa.text("UPDATE cards SET updated_at = created_at WHERE updated_at IS NULL"))
    with op.batch_alter_table("cards", schema=None) as batch_op:
        batch_op.alter_column(
            "updated_at", existing_type=sa.DateTime(timezone=True), nullable=False
        )

    with op.batch_alter_table("columns", schema=None) as batch_op:
        batch_op.add_column(sa.Column("wip_limit", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column("is_done", sa.Boolean(), nullable=False, server_default=sa.false())
        )

    # The rightmost column of each board is almost always the done column; seed the flag there
    # so cycle time starts measuring something real without anyone configuring it first.
    op.get_bind().execute(
        sa.text(
            "UPDATE columns SET is_done = 1 WHERE id IN ("
            "  SELECT id FROM columns c WHERE c.position = ("
            "    SELECT MAX(position) FROM columns WHERE board_id = c.board_id"
            "  ) AND LOWER(c.title) IN ('done', 'complete', 'completed', 'shipped', 'closed')"
            ")"
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("columns", schema=None) as batch_op:
        batch_op.drop_column("is_done")
        batch_op.drop_column("wip_limit")
    with op.batch_alter_table("cards", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_cards_assignee_id"))
        batch_op.drop_constraint("fk_cards_created_by_id", type_="foreignkey")
        batch_op.drop_constraint("fk_cards_assignee_id", type_="foreignkey")
        for col in (
            "archived_at",
            "completed_at",
            "updated_at",
            "estimate",
            "due_date",
            "priority",
            "created_by_id",
            "assignee_id",
        ):
            batch_op.drop_column(col)
