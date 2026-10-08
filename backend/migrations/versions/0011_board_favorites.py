"""personal board favourites

Revision ID: 0011
Revises: 0010
"""
import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "board_favorites",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("board_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["board_id"], ["boards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "board_id", name="uq_favorite_user_board"),
    )
    with op.batch_alter_table("board_favorites", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_board_favorites_user_id"), ["user_id"])
        batch_op.create_index(batch_op.f("ix_board_favorites_board_id"), ["board_id"])


def downgrade() -> None:
    with op.batch_alter_table("board_favorites", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_board_favorites_board_id"))
        batch_op.drop_index(batch_op.f("ix_board_favorites_user_id"))
    op.drop_table("board_favorites")
