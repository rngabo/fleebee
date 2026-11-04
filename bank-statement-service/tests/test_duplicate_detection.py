from datetime import date
from decimal import Decimal

from app.parsers.base_parser import ParsedTransaction
from app.services.duplicate_detection import transaction_fingerprint


def test_fingerprint_is_stable_and_uses_more_than_reference() -> None:
    first = ParsedTransaction(date(2026, 11, 1), None, "REUSED", "Sender one", Decimal("0"), Decimal("100"), None, 1)
    second = ParsedTransaction(date(2026, 11, 1), None, "REUSED", "Sender two", Decimal("0"), Decimal("100"), None, 2)
    assert transaction_fingerprint("Bank of Kigali", "123", first) != transaction_fingerprint("Bank of Kigali", "123", second)

