import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, computed_field


class TransactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    book_date: date
    value_date: date | None
    reference: str | None
    narration: str
    debit: Decimal
    credit: Decimal
    balance: Decimal | None
    currency: str | None
    transaction_type: str
    extracted_depositor_name: str | None
    corrected_depositor_name: str | None
    review_status: str
    review_reason: str | None
    extraction_rule: str

    @computed_field
    @property
    def depositor_name(self) -> str | None:
        return self.corrected_depositor_name or self.extracted_depositor_name

    @computed_field
    @property
    def amount(self) -> Decimal:
        return self.credit if self.credit > 0 else self.debit


class TransactionCorrection(BaseModel):
    depositor_name: str = Field(min_length=2, max_length=255)
    correction_source: str = Field(default="API", min_length=2, max_length=120)


class SimpleIncomingTransaction(BaseModel):
    date: date
    depositor_name: str | None
    amount: Decimal


class TransactionPage(BaseModel):
    items: list[TransactionResponse]
    total: int
    page: int
    page_size: int

