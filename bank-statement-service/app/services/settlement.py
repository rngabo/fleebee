import logging
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import json

from sqlalchemy import String, cast, func, select
from sqlalchemy.orm import Session

from app.models.statement import Statement, StatementTransaction
from app.models.transaction import Transaction
from app.services.name_extraction import extract_depositor

logger = logging.getLogger("bank_statement_service")

OUTCOMES = {"SYNCED", "SKIPPED", "IN_SHEET"}
IN_SHEET_STATES = ("SYNCED", "IN_SHEET")


class StatementLockedError(ValueError):
    """The statement already has payments in the sheet, so it cannot be discarded."""


def status_counts(db: Session, statement_id: uuid.UUID) -> dict[str, int]:
    rows = db.execute(
        select(Transaction.sync_status, func.count())
        .join(StatementTransaction, StatementTransaction.transaction_id == Transaction.id)
        .where(StatementTransaction.statement_id == statement_id)
        .group_by(Transaction.sync_status)
    ).all()
    counts = {status: count for status, count in rows}
    return {
        "pending": counts.get("PENDING", 0),
        "synced": counts.get("SYNCED", 0) + counts.get("IN_SHEET", 0),
        "skipped": counts.get("SKIPPED", 0),
    }


def remaining_count(db: Session, statement_id: uuid.UUID) -> int:
    return status_counts(db, statement_id)["pending"]


def refresh_extraction(transaction: Transaction) -> bool:
    """Read the narration again with the current rules (last text first). Operator corrections are never touched.

    Entries that were skipped or reused from an older statement still carry the name an older rule produced; whenever
    one becomes pending again it is re-read, so every row in a table follows the same logic.
    """
    if transaction.corrected_depositor_name:
        return False
    result = extract_depositor(transaction.narration)
    metadata = json.dumps(result.metadata)
    changed_name = result.depositor_name != transaction.extracted_depositor_name
    if not changed_name and result.rule_id == transaction.extraction_rule and metadata == transaction.extraction_metadata_json:
        return False
    transaction.extracted_depositor_name = result.depositor_name
    transaction.transaction_type = result.transaction_type
    transaction.extraction_rule = result.rule_id
    transaction.extraction_metadata_json = metadata
    transaction.review_status = "REVIEW_REQUIRED" if result.review_required else "VALIDATED"
    transaction.review_reason = result.reason
    if changed_name:
        transaction.selected_biker_id = None     # a rider picked for the old reading no longer applies
    return True


def _delete_file(path: str) -> None:
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        logger.warning("could not delete stored statement file")


def refresh_completion(db: Session, statement: Statement) -> bool:
    """A statement is complete when nothing is pending. Completing it removes the stored PDF only;
    every entry and its outcome stays for history."""
    counts = status_counts(db, statement.id)
    total = counts["pending"] + counts["synced"] + counts["skipped"]
    complete = total > 0 and counts["pending"] == 0
    if complete and statement.completed_at is None:
        statement.completed_at = datetime.now(timezone.utc)
        _delete_file(statement.stored_path)
    elif not complete:
        # Reopened (e.g. Undo skip): no longer complete. An archived statement stays hidden even so: rows are shared
        # between overlapping statements, and acting on one must not bring old, discarded statements back.
        statement.completed_at = None
    return complete


def _statements_of(db: Session, transaction: Transaction) -> list[Statement]:
    ids = list(db.scalars(select(StatementTransaction.statement_id).where(StatementTransaction.transaction_id == transaction.id).distinct()))
    return [statement for statement in (db.get(Statement, item) for item in ids) if statement]


def _summaries(db: Session, statements: list[Statement]) -> list[dict]:
    results = []
    for statement in statements:
        complete = refresh_completion(db, statement)
        results.append({
            "statement_id": statement.id,
            "display_name": statement.display_name,
            "remaining": remaining_count(db, statement.id),
            "completed": complete,
        })
    return results


def settle_transaction(db: Session, transaction: Transaction, outcome: str, biker_name: str | None = None, sheet_row: int | None = None, sheet_date: date | None = None) -> list[dict]:
    if outcome not in OUTCOMES:
        raise ValueError("Unknown outcome")
    if outcome == "IN_SHEET" and transaction.sync_status == "SYNCED":
        # Already synced by this app: a later "already in the sheet" must not downgrade it or lose its details.
        results = _summaries(db, _statements_of(db, transaction))
        db.commit()
        return results
    transaction.sync_status = outcome
    transaction.skip_reason = "MANUAL" if outcome == "SKIPPED" else None
    transaction.synced_at = datetime.now(timezone.utc)
    if outcome != "SKIPPED":
        transaction.synced_biker_name = biker_name or transaction.synced_biker_name
        transaction.sheet_row = sheet_row or transaction.sheet_row
        transaction.sheet_date = sheet_date or transaction.sheet_date
    db.flush()
    results = _summaries(db, _statements_of(db, transaction))
    db.commit()
    return results


def reopen_transaction(db: Session, transaction: Transaction) -> list[dict]:
    """Back to pending (undo a skip, or the payment was deleted from the sheet)."""
    transaction.sync_status = "PENDING"
    transaction.skip_reason = None
    transaction.synced_at = None
    transaction.synced_biker_name = None
    transaction.sheet_row = None
    transaction.sheet_date = None
    db.flush()
    results = _summaries(db, _statements_of(db, transaction))
    db.commit()
    return results


def reopen_synced_payment(db: Session, book_date: date | None, amount: Decimal | None, biker_name: str | None, ref: str | None = None) -> int:
    """The payment was deleted from the sheet: make the matching entry pending again.

    Matched by the reference code in the sheet note when there is one (it survives manual date edits), otherwise by
    the date recorded in the sheet, the amount and the biker name.
    """
    if ref:
        entry = db.scalar(select(Transaction).where(Transaction.sync_status == "SYNCED", cast(Transaction.id, String).like(f"{ref.lower()}%")))
        if entry:
            reopen_transaction(db, entry)
            return 1
    if book_date is None or amount is None or not biker_name:
        return 0
    wanted = " ".join(biker_name.lower().split())
    candidates = db.scalars(
        select(Transaction).where(
            Transaction.sync_status == "SYNCED",
            Transaction.credit == amount,
            (Transaction.sheet_date == book_date) | ((Transaction.sheet_date.is_(None)) & (Transaction.book_date == book_date)),
        )
    )
    for transaction in candidates:
        if " ".join((transaction.synced_biker_name or "").lower().split()) == wanted:
            reopen_transaction(db, transaction)
            return 1
    return 0


def discard_statement(db: Session, statement: Statement) -> str:
    """Discard a statement from the list. Always allowed.

    - Nothing synced yet and not verified (e.g. a wrong file): deleted completely, so it can be uploaded again.
    - Anything already in the sheet, or verified: archived. It leaves the list, its stored PDF is removed, but every
      row and what happened to it stays on record: handled rows are skipped by later overlapping uploads, rows still
      pending show up again in a statement that contains them, and the same file reopens where it was.
    """
    linked = list(db.scalars(select(StatementTransaction.transaction_id).where(StatementTransaction.statement_id == statement.id)))
    in_sheet = bool(linked) and bool(db.scalar(
        select(func.count()).select_from(Transaction).where(Transaction.id.in_(linked), Transaction.sync_status.in_(IN_SHEET_STATES))
    ))
    if statement.completed_at is not None or in_sheet:
        statement.archived_at = datetime.now(timezone.utc)
        _delete_file(statement.stored_path)
        db.commit()
        return "archived"
    _delete_file(statement.stored_path)
    db.delete(statement)
    db.flush()
    for transaction_id in linked:
        if not db.scalar(select(func.count()).select_from(StatementTransaction).where(StatementTransaction.transaction_id == transaction_id)):
            orphan = db.get(Transaction, transaction_id)
            if orphan:
                db.delete(orphan)
    db.commit()
    return "deleted"


def verify_statement(db: Session, statement: Statement) -> dict:
    """Operator says this statement is done (e.g. half of it was handled before). Entries still pending
    are recorded as skipped, so overlapping statements do not bring them back, and the PDF is removed."""
    pending = list(db.scalars(
        select(Transaction)
        .join(StatementTransaction, StatementTransaction.transaction_id == Transaction.id)
        .where(StatementTransaction.statement_id == statement.id, Transaction.sync_status == "PENDING")
    ))
    now = datetime.now(timezone.utc)
    for transaction in pending:
        transaction.sync_status = "SKIPPED"
        transaction.skip_reason = "VERIFY"
        transaction.synced_at = now
    db.flush()
    complete = refresh_completion(db, statement)
    if not complete and statement.completed_at is None:
        # A statement without any entries can still be closed by hand.
        statement.completed_at = now
        _delete_file(statement.stored_path)
    db.commit()
    return {"statement_id": statement.id, "display_name": statement.display_name, "skipped_now": len(pending), "completed": True}


def reopen_skipped(db: Session, statement: Statement, only_bulk: bool = False) -> int:
    """Put skipped entries of a statement back to pending (all of them, or only those closed in bulk)."""
    query = (
        select(Transaction)
        .join(StatementTransaction, StatementTransaction.transaction_id == Transaction.id)
        .where(StatementTransaction.statement_id == statement.id, Transaction.sync_status == "SKIPPED")
    )
    if only_bulk:
        query = query.where(Transaction.skip_reason == "VERIFY")
    reopened = 0
    touched: dict = {}
    for transaction in list(db.scalars(query)):
        transaction.sync_status = "PENDING"
        transaction.skip_reason = None
        transaction.synced_at = None
        refresh_extraction(transaction)
        reopened += 1
        for other in _statements_of(db, transaction):
            touched[other.id] = other
    db.flush()
    for other in touched.values():
        refresh_completion(db, other)
    db.commit()
    return reopened
