"""Initial bank statement schema."""

from alembic import op
import sqlalchemy as sa

revision = "20261104_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "statements",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("file_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("stored_path", sa.Text(), nullable=False),
        sa.Column("bank_name", sa.String(120), nullable=False),
        sa.Column("account_holder_name", sa.String(255)), sa.Column("account_number", sa.String(120)),
        sa.Column("period_start", sa.Date()), sa.Column("period_end", sa.Date()), sa.Column("currency", sa.String(8)),
        sa.Column("opening_balance", sa.Numeric(20, 2)), sa.Column("closing_balance", sa.Numeric(20, 2)),
        sa.Column("total_debits", sa.Numeric(20, 2)), sa.Column("total_credits", sa.Numeric(20, 2)), sa.Column("issue_date", sa.Date()),
        sa.Column("status", sa.String(32), nullable=False), sa.Column("review_required", sa.Boolean(), nullable=False),
        sa.Column("warnings_json", sa.Text(), nullable=False), sa.Column("processing_duration_ms", sa.Integer(), nullable=False),
        sa.Column("incoming_count", sa.Integer(), nullable=False), sa.Column("review_count", sa.Integer(), nullable=False), sa.Column("duplicate_count", sa.Integer(), nullable=False),
        sa.Column("calculated_credits", sa.Numeric(20, 2), nullable=False), sa.Column("calculated_debits", sa.Numeric(20, 2), nullable=False), sa.Column("credit_difference", sa.Numeric(20, 2)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_statements_file_hash", "statements", ["file_hash"])
    op.create_table(
        "transactions",
        sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("fingerprint", sa.String(64), nullable=False, unique=True),
        sa.Column("bank_name", sa.String(120), nullable=False), sa.Column("account_number", sa.String(120)),
        sa.Column("book_date", sa.Date(), nullable=False), sa.Column("value_date", sa.Date()), sa.Column("reference", sa.String(255)),
        sa.Column("narration", sa.Text(), nullable=False), sa.Column("debit", sa.Numeric(20, 2), nullable=False), sa.Column("credit", sa.Numeric(20, 2), nullable=False), sa.Column("balance", sa.Numeric(20, 2)),
        sa.Column("currency", sa.String(8)), sa.Column("transaction_type", sa.String(64), nullable=False),
        sa.Column("extracted_depositor_name", sa.String(255)), sa.Column("corrected_depositor_name", sa.String(255)),
        sa.Column("review_status", sa.String(32), nullable=False), sa.Column("review_reason", sa.Text()), sa.Column("extraction_rule", sa.String(100), nullable=False), sa.Column("extraction_metadata_json", sa.Text(), nullable=False),
        sa.Column("corrected_at", sa.DateTime(timezone=True)), sa.Column("correction_source", sa.String(120)), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    for name in ("fingerprint", "account_number", "book_date", "reference", "credit", "transaction_type", "extracted_depositor_name", "corrected_depositor_name", "review_status"):
        op.create_index(f"ix_transactions_{name}", "transactions", [name])
    op.create_table(
        "statement_transactions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("statement_id", sa.Uuid(), sa.ForeignKey("statements.id", ondelete="CASCADE"), nullable=False),
        sa.Column("transaction_id", sa.Uuid(), sa.ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_row_number", sa.Integer()), sa.Column("duplicate_on_import", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_statement_transactions_statement_id", "statement_transactions", ["statement_id"])
    op.create_index("ix_statement_transactions_transaction_id", "statement_transactions", ["transaction_id"])


def downgrade() -> None:
    op.drop_table("statement_transactions")
    op.drop_table("transactions")
    op.drop_table("statements")

