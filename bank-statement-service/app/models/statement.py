import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Statement(Base):
    __tablename__ = "statements"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    file_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str | None] = mapped_column(String(120), unique=True)
    stored_path: Mapped[str] = mapped_column(Text)
    bank_name: Mapped[str] = mapped_column(String(120))
    account_holder_name: Mapped[str | None] = mapped_column(String(255))
    account_number: Mapped[str | None] = mapped_column(String(120))
    period_start: Mapped[date | None] = mapped_column(Date)
    period_end: Mapped[date | None] = mapped_column(Date)
    currency: Mapped[str | None] = mapped_column(String(8))
    opening_balance: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))
    closing_balance: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))
    total_debits: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))
    total_credits: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))
    issue_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(32), default="COMPLETED")
    review_required: Mapped[bool] = mapped_column(default=False)
    warnings_json: Mapped[str] = mapped_column(Text, default="[]")
    processing_duration_ms: Mapped[int] = mapped_column(Integer)
    incoming_count: Mapped[int] = mapped_column(Integer, default=0)
    review_count: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_count: Mapped[int] = mapped_column(Integer, default=0)
    calculated_credits: Mapped[Decimal] = mapped_column(Numeric(20, 2), default=Decimal("0"))
    calculated_debits: Mapped[Decimal] = mapped_column(Numeric(20, 2), default=Decimal("0"))
    credit_difference: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Discarded from the list but kept on record (rows, outcomes, name, file hash).
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    # Where the file came from: a manual upload, or the Gmail downloader (then received_at is when the email arrived).
    source: Mapped[str] = mapped_column(String(16), default="upload", server_default="upload")
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    links: Mapped[list["StatementTransaction"]] = relationship(
        back_populates="statement", cascade="all, delete-orphan"
    )


class StatementTransaction(Base):
    __tablename__ = "statement_transactions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    statement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("statements.id", ondelete="CASCADE"), index=True)
    transaction_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("transactions.id", ondelete="CASCADE"), index=True)
    source_row_number: Mapped[int | None] = mapped_column(Integer)
    duplicate_on_import: Mapped[bool] = mapped_column(default=False)

    statement: Mapped[Statement] = relationship(back_populates="links")
    transaction: Mapped["Transaction"] = relationship(back_populates="statement_links")

