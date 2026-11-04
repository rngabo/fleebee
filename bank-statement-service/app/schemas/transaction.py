import uuid
from datetime import date, datetime
from decimal import Decimal

import json

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
    extraction_metadata_json: str = Field(default="{}", exclude=True)
    selected_biker_id: str | None = None
    sync_status: str = "PENDING"
    synced_biker_name: str | None = None
    synced_at: datetime | None = None
    sheet_row: int | None = None
    sheet_date: date | None = None
    skip_reason: str | None = None

    @computed_field
    @property
    def depositor_name(self) -> str | None:
        return self.corrected_depositor_name or self.extracted_depositor_name

    @computed_field
    @property
    def name_hints(self) -> dict:
        """Other names found in the narration: the last text (usually the rider paid for) and extras."""
        try:
            data = json.loads(self.extraction_metadata_json or "{}")
        except ValueError:
            data = {}
        return {
            "trailing_name": data.get("trailing_name"),
            "sender_name": data.get("sender_name"),
            "payer_phone": data.get("payer_phone"),
        }

    @computed_field
    @property
    def amount(self) -> Decimal:
        return self.credit if self.credit > 0 else self.debit


class TransactionCorrection(BaseModel):
    depositor_name: str = Field(min_length=2, max_length=255)
    correction_source: str = Field(default="API", min_length=2, max_length=120)


class SettleRequest(BaseModel):
    outcome: str = Field(pattern="^(SYNCED|SKIPPED|IN_SHEET)$")
    biker_name: str | None = Field(default=None, max_length=255)
    sheet_row: int | None = None
    sheet_date: date | None = None


class ReopenSyncedRequest(BaseModel):
    book_date: date | None = None          # the date recorded in the sheet (or the bank date for older entries)
    amount: Decimal | None = None
    biker_name: str | None = Field(default=None, max_length=255)
    ref: str | None = Field(default=None, min_length=6, max_length=36)   # first characters of the entry id


class BikerSelection(BaseModel):
    biker_id: str | None = Field(default=None, max_length=64)


class SimpleIncomingTransaction(BaseModel):
    date: date
    depositor_name: str | None
    amount: Decimal


class TransactionPage(BaseModel):
    items: list[TransactionResponse]
    total: int
    page: int
    page_size: int

