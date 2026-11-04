import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import require_api_key
from app.db.session import get_db
from app.models.transaction import Transaction
from app.schemas.transaction import TransactionCorrection, TransactionPage, TransactionResponse

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

