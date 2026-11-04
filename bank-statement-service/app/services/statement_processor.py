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
from app.services.naming import base_statement_name, unique_name
from app.services.settlement import refresh_completion, refresh_extraction, reopen_skipped
from app.services.pdf_extraction import validate_pdf
from app.services.reconciliation import reconcile

logger = logging.getLogger(__name__)


class CompletedStatementError(ValueError):
    """The file (or every entry in it) was already fully synced earlier."""

    def __init__(self, display_name: str, completed_at, reason: str):
        super().__init__(reason)
        self.display_name = display_name
        self.completed_at = completed_at


class DuplicateStatementError(ValueError):
    def __init__(self, statement_id: uuid.UUID):
        super().__init__("This statement has already been processed")
        self.statement_id = statement_id


def process_statement(
    db: Session, path: Path, original_filename: str, file_hash: str
) -> tuple[Statement, list[Transaction]]:
    existing_statement = db.scalar(select(Statement).where(Statement.file_hash == file_hash))
    if existing_statement:
        if existing_statement.completed_at:
            # "Complete" because everything was skipped in bulk when another statement was verified is not really done:
            # bring those entries back so the file can be worked on.
            if reopen_skipped(db, existing_statement, only_bulk=True):
                existing_statement.archived_at = None
                db.commit()
                raise DuplicateStatementError(existing_statement.id)
            raise CompletedStatementError(
                existing_statement.display_name or existing_statement.original_filename,
                existing_statement.completed_at,
                "This statement was already fully handled; nothing is left to do.",
            )
        if existing_statement.archived_at is not None:
            # Discarded from the list earlier but not finished: uploading the file again brings it back.
            existing_statement.archived_at = None
            db.commit()
        raise DuplicateStatementError(existing_statement.id)
    started = time.perf_counter()
    validate_pdf(path)
    parsed = parser_for(path).parse(path)
    result = reconcile(parsed)
    incoming = [item for item in parsed.transactions if item.credit > 0]
    fingerprints = {id(item): transaction_fingerprint(parsed.metadata.bank_name, parsed.metadata.account_number, item) for item in incoming}

    taken = set(db.scalars(select(Statement.display_name)))
    display_name = unique_name(
        base_statement_name(parsed.metadata.bank_name, parsed.metadata.account_number, parsed.metadata.period_start, parsed.metadata.period_end),
        {name for name in taken if name},
    )
    review_count = sum(item.review_status == "REVIEW_REQUIRED" for item in incoming)
    duration_ms = round((time.perf_counter() - started) * 1000)
    statement = Statement(
        file_hash=file_hash,
        original_filename=original_filename,
        display_name=display_name,
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
        fingerprint = fingerprints[id(item)]
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
        if duplicate and transaction.sync_status == "SKIPPED" and transaction.skip_reason == "VERIFY":
            # Skipped only because an earlier statement was closed in bulk: it was never really decided.
            transaction.sync_status = "PENDING"
            transaction.skip_reason = None
            transaction.synced_at = None
        if duplicate and transaction.sync_status == "PENDING":
            refresh_extraction(transaction)      # an older row follows the same (last text first) rules as a new one
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
    db.flush()
    # A file whose entries were all handled by earlier uploads is complete straight away.
    refresh_completion(db, statement)
    db.commit()
    logger.info("statement_processed statement_id=%s incoming=%d reviews=%d duplicates=%d duration_ms=%d", statement.id, len(incoming), review_count, duplicate_count, duration_ms)
    return statement, transactions

