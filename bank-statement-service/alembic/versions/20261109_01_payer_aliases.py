"""Remember which rider a non-rider payer name stands for."""

from alembic import op
import sqlalchemy as sa

revision = "20261109_01"
down_revision = "20261108_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payer_aliases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name_key", sa.String(255), nullable=False, unique=True),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("biker_id", sa.String(64), nullable=False),
        sa.Column("biker_name", sa.String(255), nullable=False),
        sa.Column("use_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_payer_aliases_name_key", "payer_aliases", ["name_key"])


def downgrade() -> None:
    op.drop_table("payer_aliases")
