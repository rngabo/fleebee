import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import require_api_key
from app.db.session import get_db
from app.models.statement import Statement, StatementTransaction
from app.models.transaction import Transaction
from app.schemas.transaction import BikerSelection, ReopenSyncedRequest, SettleRequest, TransactionCorrection, TransactionPage, TransactionResponse
from app.services.settlement import reopen_synced_payment, reopen_transaction, settle_transaction

router = APIRouter(prefix="/api/v1/transactions", tags=["transactions"], dependencies=[Depends(require_api_key)])


@router.get("", response_model=TransactionPage)
def list_transactions(
    date_from: date | None = None,
    date_to: date | None = None,
    depositor_name: str | None = None,
    amount: Decimal | None = Query(default=None, ge=0),
    transaction_type: str | None = None,
    review_status: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
) -> TransactionPage:
    query = select(Transaction).where(Transaction.credit > 0)
    if date_from:
        query = query.where(Transaction.book_date >= date_from)
    if date_to:
        query = query.where(Transaction.book_date <= date_to)
    if depositor_name:
        term = f"%{depositor_name}%"
        query = query.where((Transaction.extracted_depositor_name.ilike(term)) | (Transaction.corrected_depositor_name.ilike(term)))
    if amount is not None:
        query = query.where(Transaction.credit == amount)
    if transaction_type:
        query = query.where(Transaction.transaction_type == transaction_type)
    if review_status:
        query = query.where(Transaction.review_status == review_status)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = list(db.scalars(query.order_by(Transaction.book_date.desc()).offset((page - 1) * page_size).limit(page_size)))
    return TransactionPage(items=[TransactionResponse.model_validate(item) for item in items], total=total, page=page, page_size=page_size)


@router.patch("/{transaction_id}", response_model=TransactionResponse)
def correct_transaction(
    transaction_id: uuid.UUID,
    correction: TransactionCorrection,
    db: Session = Depends(get_db),
) -> TransactionResponse:
    transaction = db.get(Transaction, transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    transaction.corrected_depositor_name = " ".join(correction.depositor_name.split())
    transaction.corrected_at = datetime.now(timezone.utc)
    transaction.correction_source = correction.correction_source
    transaction.review_status = "CORRECTED"
    db.commit()
    return TransactionResponse.model_validate(transaction)



@router.put("/{transaction_id}/biker", response_model=TransactionResponse)
def select_biker(transaction_id: uuid.UUID, selection: BikerSelection, db: Session = Depends(get_db)) -> TransactionResponse:
    transaction = db.get(Transaction, transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    transaction.selected_biker_id = selection.biker_id or None
    db.commit()
    return TransactionResponse.model_validate(transaction)


@router.post("/{transaction_id}/settle")
def settle(transaction_id: uuid.UUID, request: SettleRequest, db: Session = Depends(get_db)) -> dict:
    """Record the outcome of an entry (synced / already in sheet / skipped). The entry itself is kept."""
    transaction = db.get(Transaction, transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"statements": settle_transaction(db, transaction, request.outcome, request.biker_name, request.sheet_row, request.sheet_date)}


@router.post("/{transaction_id}/reopen")
def reopen(transaction_id: uuid.UUID, db: Session = Depends(get_db)) -> dict:
    """Undo a skip. Synced entries are reopened only through the payment-deleted route below."""
    transaction = db.get(Transaction, transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if transaction.sync_status not in ("SKIPPED", "IN_SHEET"):
        # SYNCED entries have a row written by the app and are reopened only when that row is deleted.
        raise HTTPException(status_code=409, detail="Only skipped or 'already in the sheet' entries can be reopened here.")
    return {"statements": reopen_transaction(db, transaction)}


@router.post("/reopen-synced")
def reopen_synced(request: ReopenSyncedRequest, db: Session = Depends(get_db)) -> dict:
    """A synced payment was deleted from the sheet; make its entry pending again."""
    return {"reopened": reopen_synced_payment(db, request.book_date, request.amount, request.biker_name, request.ref)}


@router.get("/synced")
def synced_entries(db: Session = Depends(get_db)) -> dict:
    """Entries synced by this app, with the statement they came from (used to link payments back)."""
    rows = db.execute(
        select(Transaction, Statement.id, Statement.display_name)
        .join(StatementTransaction, StatementTransaction.transaction_id == Transaction.id)
        .join(Statement, Statement.id == StatementTransaction.statement_id)
        .where(Transaction.sync_status == "SYNCED")
        .order_by(Transaction.synced_at.desc())
        .limit(1000)
    ).all()
    return {"items": [
        {
            "book_date": transaction.book_date.isoformat(),
            "amount": str(transaction.credit),
            "biker_name": transaction.synced_biker_name,
            "synced_at": transaction.synced_at.isoformat() if transaction.synced_at else None,
            "sheet_date": transaction.sheet_date.isoformat() if transaction.sheet_date else None,
            "ref": str(transaction.id)[:8],
            "statement_id": str(statement_id),
            "statement_name": name,
        }
        for transaction, statement_id, name in rows
    ]}
