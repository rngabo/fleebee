"""Archive (soft-discard) verified statements."""

from alembic import op
import sqlalchemy as sa

revision = "20261107_01"
down_revision = "20261106_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("statements", sa.Column("archived_at", sa.DateTime(timezone=True)))
    op.create_index("ix_statements_archived_at", "statements", ["archived_at"])


def downgrade() -> None:
    op.drop_index("ix_statements_archived_at", table_name="statements")
    op.drop_column("statements", "archived_at")
