import hashlib
from decimal import Decimal

from app.parsers.base_parser import ParsedTransaction


def transaction_fingerprint(
    bank_name: str, account_number: str | None, transaction: ParsedTransaction
) -> str:
    direction = "CREDIT" if transaction.credit > 0 else "DEBIT"
    amount: Decimal = transaction.credit if transaction.credit > 0 else transaction.debit
    parts = (
        bank_name.casefold().strip(),
        (account_number or "unknown").casefold().strip(),
        (transaction.reference or "").casefold().strip(),
        transaction.book_date.isoformat(),
        f"{amount:.2f}",
        direction,
        " ".join(transaction.narration.casefold().split()),
    )
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()

