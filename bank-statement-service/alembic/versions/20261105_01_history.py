"""Statement display names, settled entries and completed-file records."""

from alembic import op
import sqlalchemy as sa

revision = "20261105_01"
down_revision = "20261104_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.services.naming import base_statement_name, unique_name

    op.add_column("statements", sa.Column("display_name", sa.String(120)))
    op.add_column("transactions", sa.Column("selected_biker_id", sa.String(64)))
    op.create_table(
        "settled_transactions",
        sa.Column("fingerprint", sa.String(64), primary_key=True),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "completed_statements",
        sa.Column("file_hash", sa.String(64), primary_key=True),
        sa.Column("display_name", sa.String(120), nullable=False, unique=True),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("period_start", sa.Date()), sa.Column("period_end", sa.Date()),
        sa.Column("entry_count", sa.Integer(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # Give existing statements a friendly name too.
    bind = op.get_bind()
    taken: set[str] = set()
    rows = bind.execute(sa.text("SELECT id, bank_name, account_number, period_start, period_end FROM statements ORDER BY created_at")).fetchall()
    for row in rows:
        name = unique_name(base_statement_name(row.bank_name, row.account_number, row.period_start, row.period_end), taken)
        taken.add(name)
        bind.execute(sa.text("UPDATE statements SET display_name = :name WHERE id = :id"), {"name": name, "id": row.id})
    op.create_unique_constraint("uq_statements_display_name", "statements", ["display_name"])


def downgrade() -> None:
    op.drop_constraint("uq_statements_display_name", "statements", type_="unique")
    op.drop_table("completed_statements")
    op.drop_table("settled_transactions")
    op.drop_column("transactions", "selected_biker_id")
    op.drop_column("statements", "display_name")
