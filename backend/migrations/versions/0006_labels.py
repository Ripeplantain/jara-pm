"""workspace labels and the card join table

Revision ID: 0006
Revises: 0005
"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "labels",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("color", sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "name", name="uq_label_workspace_name"),
    )
    with op.batch_alter_table("labels", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_labels_workspace_id"), ["workspace_id"])

    op.create_table(
        "card_labels",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("label_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["card_id"], ["cards.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["label_id"], ["labels.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("card_id", "label_id", name="uq_card_label"),
    )
    with op.batch_alter_table("card_labels", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_card_labels_card_id"), ["card_id"])
        batch_op.create_index(batch_op.f("ix_card_labels_label_id"), ["label_id"])


def downgrade() -> None:
    with op.batch_alter_table("card_labels", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_card_labels_label_id"))
        batch_op.drop_index(batch_op.f("ix_card_labels_card_id"))
    op.drop_table("card_labels")
    with op.batch_alter_table("labels", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_labels_workspace_id"))
    op.drop_table("labels")
