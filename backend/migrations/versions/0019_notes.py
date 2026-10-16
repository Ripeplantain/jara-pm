"""notes, note blocks and note links

Revision ID: 0019
Revises: 0018

Three new tables plus two nullable columns on two existing ones. Nothing is dropped and nothing
is rewritten, so no table is rebuilt and the `PRAGMA foreign_keys` cascade trap documented in
agents.md cannot bite here. Existing board data is untouched.
"""
import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workspace_id", sa.Integer(), nullable=False),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        sa.Column("owner_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("icon", sa.String(length=8), nullable=False, server_default=""),
        sa.Column("visibility", sa.String(length=20), nullable=False, server_default="workspace"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_id"], ["notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("notes", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_notes_workspace_id"), ["workspace_id"])
        batch_op.create_index(batch_op.f("ix_notes_parent_id"), ["parent_id"])
        batch_op.create_index(batch_op.f("ix_notes_owner_id"), ["owner_id"])

    op.create_table(
        "note_blocks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("note_id", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False, server_default="paragraph"),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("checked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("indent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ref_card_id", sa.Integer(), nullable=True),
        sa.Column("ref_board_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("note_blocks", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_note_blocks_note_id"), ["note_id"])

    op.create_table(
        "note_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("note_id", sa.Integer(), nullable=False),
        sa.Column("target_type", sa.String(length=10), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("note_id", "target_type", "target_id", name="uq_note_link_target"),
    )
    with op.batch_alter_table("note_links", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_note_links_note_id"), ["note_id"])
        batch_op.create_index(batch_op.f("ix_note_links_target_id"), ["target_id"])

    # A generic subject for history and notifications, so the next surface needs no new column.
    # Plain ADD COLUMN on both: SQLite does this in place, without rebuilding the table.
    op.add_column("activities", sa.Column("entity_type", sa.String(length=20), nullable=True))
    op.add_column("activities", sa.Column("entity_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_activities_entity_type"), "activities", ["entity_type"])
    op.add_column("notifications", sa.Column("entity_type", sa.String(length=20), nullable=True))
    op.add_column("notifications", sa.Column("entity_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("notifications", "entity_id")
    op.drop_column("notifications", "entity_type")
    op.drop_index(op.f("ix_activities_entity_type"), table_name="activities")
    op.drop_column("activities", "entity_id")
    op.drop_column("activities", "entity_type")
    with op.batch_alter_table("note_links", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_note_links_target_id"))
        batch_op.drop_index(batch_op.f("ix_note_links_note_id"))
    op.drop_table("note_links")
    with op.batch_alter_table("note_blocks", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_note_blocks_note_id"))
    op.drop_table("note_blocks")
    with op.batch_alter_table("notes", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_notes_owner_id"))
        batch_op.drop_index(batch_op.f("ix_notes_parent_id"))
        batch_op.drop_index(batch_op.f("ix_notes_workspace_id"))
    op.drop_table("notes")
