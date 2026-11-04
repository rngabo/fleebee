"""Keep per-entry sync outcomes and statement completion time."""

from alembic import op
import sqlalchemy as sa

revision = "20261106_01"
down_revision = "20261105_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("statements", sa.Column("completed_at", sa.DateTime(timezone=True)))
    op.add_column("transactions", sa.Column("sync_status", sa.String(16), nullable=False, server_default="PENDING"))
    op.add_column("transactions", sa.Column("synced_biker_name", sa.String(255)))
    op.add_column("transactions", sa.Column("synced_at", sa.DateTime(timezone=True)))
    op.add_column("transactions", sa.Column("sheet_row", sa.Integer()))
    op.create_index("ix_transactions_sync_status", "transactions", ["sync_status"])


def downgrade() -> None:
    op.drop_index("ix_transactions_sync_status", table_name="transactions")
    op.drop_column("transactions", "sheet_row")
    op.drop_column("transactions", "synced_at")
    op.drop_column("transactions", "synced_biker_name")
    op.drop_column("transactions", "sync_status")
    op.drop_column("statements", "completed_at")
