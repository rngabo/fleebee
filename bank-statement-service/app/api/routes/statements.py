import csv
import io
import json
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import Settings, get_settings
from app.core.security import require_api_key, sha256_bytes
from app.db.session import get_db
from app.models.statement import Statement, StatementTransaction
from app.models.transaction import Transaction
from app.parsers.parser_factory import UnsupportedBankStatementError
from app.schemas.statement import StatementDetail, StatementPage, StatementSummary, UploadResponse
from app.schemas.transaction import SimpleIncomingTransaction, TransactionPage, TransactionResponse
from app.services.pdf_extraction import PdfValidationError
from app.services.statement_processor import DuplicateStatementError, process_statement

router = APIRouter(prefix="/api/v1/statements", tags=["statements"], dependencies=[Depends(require_api_key)])


def _transactions_for(db: Session, statement_id: uuid.UUID) -> list[Transaction]:
    return list(
        db.scalars(
            select(Transaction)
            .join(StatementTransaction)
            .where(StatementTransaction.statement_id == statement_id)
            .order_by(Transaction.book_date, StatementTransaction.source_row_number)
        )
    )


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_statement(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> UploadResponse:
    filename = Path(file.filename or "statement.pdf").name
    if Path(filename).suffix.lower() != ".pdf" or file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=415, detail="Only PDF files are supported")
    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="PDF exceeds the configured upload limit")
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty")
    file_hash = sha256_bytes(content)
    statement_id = uuid.uuid4()
    settings.storage_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    stored_path = settings.storage_dir / f"{statement_id}.pdf"
    stored_path.write_bytes(content)
    stored_path.chmod(0o600)
    try:
        statement, transactions = process_statement(db, stored_path, filename, file_hash)
    except DuplicateStatementError as exc:
        stored_path.unlink(missing_ok=True)
        raise HTTPException(status_code=409, detail={"message": str(exc), "statement_id": str(exc.statement_id)}) from exc
    except (PdfValidationError, UnsupportedBankStatementError) as exc:
        db.rollback()
        stored_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        stored_path.unlink(missing_ok=True)
        raise
    return UploadResponse(
        statement_id=statement.id,
        status=statement.status,
        review_required=statement.review_required,
        processing_duration_ms=statement.processing_duration_ms,
        duplicate_count=statement.duplicate_count,
        warnings=json.loads(statement.warnings_json),
        transactions=[
            SimpleIncomingTransaction(date=item.book_date, depositor_name=item.depositor_name, amount=item.credit)
            for item in transactions
        ],
    )


@router.get("", response_model=StatementPage)
def list_statements(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
) -> StatementPage:
    total = db.scalar(select(func.count()).select_from(Statement)) or 0
    items = list(db.scalars(select(Statement).order_by(Statement.created_at.desc()).offset((page - 1) * page_size).limit(page_size)))
    return StatementPage(items=[StatementSummary.model_validate(item) for item in items], total=total, page=page, page_size=page_size)


@router.get("/{statement_id}", response_model=StatementDetail)
def get_statement(statement_id: uuid.UUID, db: Session = Depends(get_db)) -> StatementDetail:
    statement = db.get(Statement, statement_id)
    if not statement:
        raise HTTPException(status_code=404, detail="Statement not found")
    data = StatementSummary.model_validate(statement).model_dump()
    return StatementDetail(
        **data,
        opening_balance=statement.opening_balance,
        closing_balance=statement.closing_balance,
        total_debits=statement.total_debits,
        total_credits=statement.total_credits,
        calculated_credits=statement.calculated_credits,
        calculated_debits=statement.calculated_debits,
        credit_difference=statement.credit_difference,
        warnings=json.loads(statement.warnings_json),
        transactions=[TransactionResponse.model_validate(item) for item in _transactions_for(db, statement_id)],
    )


@router.get("/{statement_id}/transactions", response_model=TransactionPage)
def statement_transactions(
    statement_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> TransactionPage:
    if not db.get(Statement, statement_id):
        raise HTTPException(status_code=404, detail="Statement not found")
    base = select(Transaction).join(StatementTransaction).where(StatementTransaction.statement_id == statement_id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = list(db.scalars(base.order_by(Transaction.book_date, StatementTransaction.source_row_number).offset((page - 1) * page_size).limit(page_size)))
    return TransactionPage(items=[TransactionResponse.model_validate(item) for item in items], total=total, page=page, page_size=page_size)


@router.get("/{statement_id}/export")
def export_statement(
    statement_id: uuid.UUID,
    format: str = Query("csv", pattern="^csv$"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    if not db.get(Statement, statement_id):
        raise HTTPException(status_code=404, detail="Statement not found")
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["Date", "Depositor Name", "Amount"])
    for item in _transactions_for(db, statement_id):
        writer.writerow([item.book_date.isoformat(), item.depositor_name or "", f"{item.credit:.2f}"])
    payload = io.BytesIO(output.getvalue().encode("utf-8-sig"))
    return StreamingResponse(payload, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="statement-{statement_id}.csv"'})

