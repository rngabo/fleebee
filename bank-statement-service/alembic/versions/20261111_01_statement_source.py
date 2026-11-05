"""Remember whether a statement was uploaded by hand or came from the Gmail downloader."""

from alembic import op
import sqlalchemy as sa

revision = "20261111_01"
down_revision = "20261110_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("statements", sa.Column("source", sa.String(16), nullable=False, server_default="upload"))
    op.add_column("statements", sa.Column("received_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("statements", "received_at")
    op.drop_column("statements", "source")
