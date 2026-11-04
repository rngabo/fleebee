import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.schemas.transaction import SimpleIncomingTransaction, TransactionResponse


class StatementSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    bank_name: str
    account_holder_name: str | None
    account_number: str | None
    period_start: date | None
    period_end: date | None
    currency: str | None
    status: str
    review_required: bool
    incoming_count: int
    review_count: int
    duplicate_count: int
    processing_duration_ms: int
    created_at: datetime


class StatementDetail(StatementSummary):
    opening_balance: Decimal | None
    closing_balance: Decimal | None
    total_debits: Decimal | None
    total_credits: Decimal | None
    calculated_credits: Decimal
    calculated_debits: Decimal
    credit_difference: Decimal | None
    warnings: list[str]
    transactions: list[TransactionResponse]


class UploadResponse(BaseModel):
    statement_id: uuid.UUID
    status: str
    review_required: bool
    processing_duration_ms: int
    duplicate_count: int
    warnings: list[str]
    transactions: list[SimpleIncomingTransaction]


class StatementPage(BaseModel):
    items: list[StatementSummary]
    total: int
    page: int
    page_size: int

