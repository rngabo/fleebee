from dataclasses import dataclass, field
from decimal import Decimal

from app.parsers.base_parser import ParsedStatement


@dataclass(slots=True)
class ReconciliationResult:
    calculated_credits: Decimal
    calculated_debits: Decimal
    credit_difference: Decimal | None
    warnings: list[str] = field(default_factory=list)


def reconcile(parsed: ParsedStatement) -> ReconciliationResult:
    credits = sum((item.credit for item in parsed.transactions), Decimal("0"))
    debits = sum((item.debit for item in parsed.transactions), Decimal("0"))
    metadata = parsed.metadata
    difference = credits - metadata.total_credits if metadata.total_credits is not None else None
    warnings = list(parsed.warnings)
    if difference is not None and difference != 0:
        warnings.append(f"Calculated credits differ from reported total by {difference:.2f}")
    if metadata.total_debits is not None and debits != metadata.total_debits:
        warnings.append(f"Calculated debits differ from reported total by {(debits - metadata.total_debits):.2f}")
    if None not in (metadata.opening_balance, metadata.total_credits, metadata.total_debits, metadata.closing_balance):
        expected = metadata.opening_balance + metadata.total_credits - metadata.total_debits  # type: ignore[operator]
        if expected != metadata.closing_balance:
            warnings.append("Opening balance plus credits minus debits does not equal closing balance")
    return ReconciliationResult(credits, debits, difference, warnings)

