import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    bank_name: Mapped[str] = mapped_column(String(120))
    account_number: Mapped[str | None] = mapped_column(String(120), index=True)
    book_date: Mapped[date] = mapped_column(Date, index=True)
    value_date: Mapped[date | None] = mapped_column(Date)
    reference: Mapped[str | None] = mapped_column(String(255), index=True)
    narration: Mapped[str] = mapped_column(Text)
    debit: Mapped[Decimal] = mapped_column(Numeric(20, 2), default=Decimal("0"))
    credit: Mapped[Decimal] = mapped_column(Numeric(20, 2), default=Decimal("0"), index=True)
    balance: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))
    currency: Mapped[str | None] = mapped_column(String(8))
    transaction_type: Mapped[str] = mapped_column(String(64), index=True)
    extracted_depositor_name: Mapped[str | None] = mapped_column(String(255), index=True)
    corrected_depositor_name: Mapped[str | None] = mapped_column(String(255), index=True)
    review_status: Mapped[str] = mapped_column(String(32), index=True)
    review_reason: Mapped[str | None] = mapped_column(Text)
    extraction_rule: Mapped[str] = mapped_column(String(100))
    extraction_metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    corrected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    correction_source: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    statement_links: Mapped[list["StatementTransaction"]] = relationship(back_populates="transaction")

    @property
    def depositor_name(self) -> str | None:
        return self.corrected_depositor_name or self.extracted_depositor_name


from app.models.statement import StatementTransaction  # noqa: E402
