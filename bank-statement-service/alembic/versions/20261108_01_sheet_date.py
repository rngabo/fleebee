"""Remember the date a synced payment was recorded under in the sheet."""

from alembic import op
import sqlalchemy as sa

revision = "20261108_01"
down_revision = "20261107_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("transactions", sa.Column("sheet_date", sa.Date()))


def downgrade() -> None:
    op.drop_column("transactions", "sheet_date")
