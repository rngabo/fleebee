"""Remember why an entry was skipped (by hand, or in bulk when a statement was verified)."""

from alembic import op
import sqlalchemy as sa

revision = "20261110_01"
down_revision = "20261109_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("transactions", sa.Column("skip_reason", sa.String(16)))
    # Entries skipped together at the same instant came from one "Mark as verified"; single ones were skipped by hand.
    op.execute(
        """
        UPDATE transactions t
        SET skip_reason = CASE WHEN c.n >= 3 THEN 'VERIFY' ELSE 'MANUAL' END
        FROM (
            SELECT synced_at, COUNT(*) AS n FROM transactions
            WHERE sync_status = 'SKIPPED' GROUP BY synced_at
        ) c
        WHERE t.sync_status = 'SKIPPED' AND t.synced_at = c.synced_at
        """
    )
    op.execute("UPDATE transactions SET skip_reason = 'MANUAL' WHERE sync_status = 'SKIPPED' AND skip_reason IS NULL")


def downgrade() -> None:
    op.drop_column("transactions", "skip_reason")
