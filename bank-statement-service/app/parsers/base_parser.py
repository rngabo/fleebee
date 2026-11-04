from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class StatementMetadata:
    bank_name: str
    account_holder_name: str | None = None
    account_number: str | None = None
    period_start: date | None = None
    period_end: date | None = None
    currency: str | None = None
    opening_balance: Decimal | None = None
    closing_balance: Decimal | None = None
    total_debits: Decimal | None = None
    total_credits: Decimal | None = None
    issue_date: date | None = None


@dataclass(slots=True)
class ParsedTransaction:
    book_date: date
    value_date: date | None
    reference: str | None
    narration: str
    debit: Decimal
    credit: Decimal
    balance: Decimal | None
    source_row_number: int
    transaction_type: str = "OTHER"
    depositor_name: str | None = None
    review_status: str = "VALIDATED"
    review_reason: str | None = None
    extraction_rule: str = "unclassified-v1"
    extraction_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ParsedStatement:
    metadata: StatementMetadata
    transactions: list[ParsedTransaction]
    warnings: list[str] = field(default_factory=list)


class BankStatementParser(ABC):
    @abstractmethod
    def detects(self, path: Path) -> bool: ...

    @abstractmethod
    def parse(self, path: Path) -> ParsedStatement: ...

