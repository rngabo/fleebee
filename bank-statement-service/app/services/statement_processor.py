import json
import logging
import time
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.statement import Statement, StatementTransaction
from app.models.transaction import Transaction
from app.parsers.parser_factory import parser_for
from app.services.duplicate_detection import transaction_fingerprint
from app.services.pdf_extraction import validate_pdf
from app.services.reconciliation import reconcile

logger = logging.getLogger(__name__)


class DuplicateStatementError(ValueError):
    def __init__(self, statement_id: uuid.UUID):
        super().__init__("This statement has already been processed")
        self.statement_id = statement_id


def process_statement(
    db: Session, path: Path, original_filename: str, file_hash: str
) -> tuple[Statement, list[Transaction]]:
    existing_statement = db.scalar(select(Statement).where(Statement.file_hash == file_hash))
    if existing_statement:
        raise DuplicateStatementError(existing_statement.id)
    started = time.perf_counter()
    validate_pdf(path)
    parsed = parser_for(path).parse(path)
    result = reconcile(parsed)
    incoming = [item for item in parsed.transactions if item.credit > 0]
    review_count = sum(item.review_status == "REVIEW_REQUIRED" for item in incoming)
    duration_ms = round((time.perf_counter() - started) * 1000)
    statement = Statement(
        file_hash=file_hash,
        original_filename=original_filename,
        stored_path=str(path),
        bank_name=parsed.metadata.bank_name,
        account_holder_name=parsed.metadata.account_holder_name,
        account_number=parsed.metadata.account_number,
        period_start=parsed.metadata.period_start,
        period_end=parsed.metadata.period_end,
        currency=parsed.metadata.currency,
        opening_balance=parsed.metadata.opening_balance,
        closing_balance=parsed.metadata.closing_balance,
        total_debits=parsed.metadata.total_debits,
        total_credits=parsed.metadata.total_credits,
        issue_date=parsed.metadata.issue_date,
        review_required=bool(review_count or result.warnings),
        warnings_json=json.dumps(result.warnings),
        processing_duration_ms=duration_ms,
        incoming_count=len(incoming),
        review_count=review_count,
        calculated_credits=result.calculated_credits,
        calculated_debits=result.calculated_debits,
        credit_difference=result.credit_difference,
    )
    db.add(statement)
    db.flush()

    transactions: list[Transaction] = []
    duplicate_count = 0
    for item in incoming:
        fingerprint = transaction_fingerprint(parsed.metadata.bank_name, parsed.metadata.account_number, item)
        transaction = db.scalar(select(Transaction).where(Transaction.fingerprint == fingerprint))
        duplicate = transaction is not None
        if duplicate:
            duplicate_count += 1
        else:
            transaction = Transaction(
                fingerprint=fingerprint,
                bank_name=parsed.metadata.bank_name,
                account_number=parsed.metadata.account_number,
                book_date=item.book_date,
                value_date=item.value_date,
                reference=item.reference,
                narration=item.narration,
                debit=item.debit,
                credit=item.credit,
                balance=item.balance,
                currency=parsed.metadata.currency,
                transaction_type=item.transaction_type,
                extracted_depositor_name=item.depositor_name,
                review_status=item.review_status,
                review_reason=item.review_reason,
                extraction_rule=item.extraction_rule,
                extraction_metadata_json=json.dumps(item.extraction_metadata),
            )
            db.add(transaction)
            db.flush()
        db.add(
            StatementTransaction(
                statement_id=statement.id,
                transaction_id=transaction.id,
                source_row_number=item.source_row_number,
                duplicate_on_import=duplicate,
            )
        )
        transactions.append(transaction)
    statement.duplicate_count = duplicate_count
    db.commit()
    logger.info("statement_processed statement_id=%s incoming=%d reviews=%d duplicates=%d duration_ms=%d", statement.id, len(incoming), review_count, duplicate_count, duration_ms)
    return statement, transactions

