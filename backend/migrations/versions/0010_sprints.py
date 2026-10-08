"""sprints, and the column that puts a card in one

Revision ID: 0010
Revises: 0009
"""
import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sprints",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("board_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("goal", sa.Text(), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=True),
        sa.Column("ends_on", sa.Date(), nullable=True),
        sa.Column("state", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["board_id"], ["boards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("sprints", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_sprints_board_id"), ["board_id"])

    with op.batch_alter_table("cards", schema=None) as batch_op:
        batch_op.add_column(sa.Column("sprint_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_cards_sprint_id", "sprints", ["sprint_id"], ["id"], ondelete="SET NULL"
        )
        batch_op.create_index(batch_op.f("ix_cards_sprint_id"), ["sprint_id"])


def downgrade() -> None:
    with op.batch_alter_table("cards", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_cards_sprint_id"))
        batch_op.drop_constraint("fk_cards_sprint_id", type_="foreignkey")
        batch_op.drop_column("sprint_id")
    with op.batch_alter_table("sprints", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_sprints_board_id"))
    op.drop_table("sprints")
