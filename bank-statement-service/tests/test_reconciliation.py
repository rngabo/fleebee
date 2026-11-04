from datetime import date
from decimal import Decimal

from app.parsers.base_parser import ParsedStatement, ParsedTransaction, StatementMetadata
from app.services.reconciliation import reconcile


def transaction(debit: str = "0", credit: str = "0") -> ParsedTransaction:
    return ParsedTransaction(date(2026, 11, 1), date(2026, 11, 1), "REF", "Narration", Decimal(debit), Decimal(credit), Decimal("100"), 1)


def test_balanced_statement_has_no_warning() -> None:
    parsed = ParsedStatement(
        StatementMetadata(
            "Bank of Kigali", opening_balance=Decimal("100"), closing_balance=Decimal("125"),
            total_debits=Decimal("25"), total_credits=Decimal("50"),
        ),
        [transaction(credit="50"), transaction(debit="25")],
    )
    result = reconcile(parsed)
    assert result.credit_difference == Decimal("0")
    assert result.warnings == []


def test_difference_marks_reconciliation_warning() -> None:
    parsed = ParsedStatement(StatementMetadata("Bank of Kigali", total_credits=Decimal("60")), [transaction(credit="50")])
    assert reconcile(parsed).warnings

