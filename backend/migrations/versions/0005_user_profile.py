"""display name, avatar colour and active flag on users

Backfills a readable name and a stable colour for every existing account.

Revision ID: 0005
Revises: 0004
"""
import sqlalchemy as sa
from alembic import op

from app.models.user import AVATAR_COLORS, avatar_color_for, display_name_for

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("display_name", sa.String(length=120), nullable=False, server_default=""))
        batch_op.add_column(
            sa.Column("avatar_color", sa.String(length=20), nullable=False, server_default=AVATAR_COLORS[0])
        )
        batch_op.add_column(sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))

    conn = op.get_bind()
    for user_id, email in conn.execute(sa.text("SELECT id, email FROM users")).fetchall():
        conn.execute(
            sa.text("UPDATE users SET display_name = :name, avatar_color = :color WHERE id = :id"),
            {"name": display_name_for(email), "color": avatar_color_for(email), "id": user_id},
        )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("is_active")
        batch_op.drop_column("avatar_color")
        batch_op.drop_column("display_name")
