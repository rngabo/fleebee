import sys
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import history_copy  # noqa: E402

from app.db.session import Base  # noqa: E402
from app.models import PayerAlias, Statement, StatementTransaction, Transaction  # noqa: E402


def memory_session():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return Session(engine)


def seed(session):
    statement = Statement(
        id=uuid.uuid4(), file_hash="h1", original_filename="a.pdf", display_name="BK-3215_aug-nov", stored_path="/local/a.pdf", bank_name="Bank of Kigali",
        period_start=date(2026, 8, 1), period_end=date(2026, 11, 4), status="COMPLETED", warnings_json="[]", processing_duration_ms=5, incoming_count=2,
        completed_at=datetime(2026, 11, 5, 9, 0, tzinfo=timezone.utc), source="upload",
    )
    session.add(statement)
    synced, pending = uuid.uuid4(), uuid.uuid4()
    for tx_id, fingerprint, rider, status in ((synced, "f1", "local-1", "SYNCED"), (pending, "f2", "local-9", "PENDING")):
        session.add(Transaction(
            id=tx_id, fingerprint=fingerprint, bank_name="Bank of Kigali", book_date=date(2026, 10, 1), narration="x", credit=Decimal("36000.00"), debit=Decimal("0"),
            transaction_type="CREDIT", review_status="OK", extraction_rule="r", selected_biker_id=rider, sync_status=status,
            synced_biker_name="Nyandwi Fabien" if status == "SYNCED" else None, sheet_row=42 if status == "SYNCED" else None, sheet_date=date(2026, 10, 1) if status == "SYNCED" else None,
        ))
    session.flush()
    for number, tx_id in enumerate((synced, pending), start=1):
        session.add(StatementTransaction(statement_id=statement.id, transaction_id=tx_id, source_row_number=number))
    session.add(PayerAlias(name_key="ishimwe olivier", display_name="Olivier Ishimwe", biker_id="local-1", biker_name="Nyandwi Fabien", use_count=3))
    session.add(PayerAlias(name_key="gone person", display_name="Gone Person", biker_id="local-404", biker_name="Nobody Known", use_count=1))
    session.commit()


SOURCE_RIDERS = {"local-1": "Nyandwi Fabien", "local-9": "Hakorimana Benjamin"}
TARGET_RIDERS = {"home-A": "Fabien NYANDWI"}          # same person, different id and word order; Benjamin does not exist at home


def test_history_is_copied_with_riders_translated_by_name_and_unknown_riders_never_guessed():
    source, target = memory_session(), memory_session()
    seed(source)
    data = history_copy.export_rows(source)
    report = history_copy.import_rows(target, data, SOURCE_RIDERS, TARGET_RIDERS)
    target.commit()
    assert (report["statements"], report["transactions"], report["links"], report["aliases"]) == (1, 2, 2, 1)
    assert report["aliases_skipped"] == ["Gone Person -> Nobody Known"]
    assert report["riders_cleared"] == 1                                  # Benjamin has no match at home: cleared, not guessed
    synced = target.scalars(select(Transaction).where(Transaction.fingerprint == "f1")).one()
    assert (synced.selected_biker_id, synced.sync_status, synced.sheet_row) == ("home-A", "SYNCED", 42)
    assert target.scalars(select(Transaction).where(Transaction.fingerprint == "f2")).one().selected_biker_id is None
    alias = target.scalars(select(PayerAlias)).one()
    assert (alias.biker_id, alias.use_count) == ("home-A", 3)
    statement = target.scalars(select(Statement)).one()
    assert statement.completed_at is not None and statement.display_name == "BK-3215_aug-nov"
    assert statement.stored_path.startswith("(copied")                    # the local file path means nothing on the other computer


def test_importing_twice_adds_nothing_and_existing_rows_are_left_alone():
    source, target = memory_session(), memory_session()
    seed(source)
    data = history_copy.export_rows(source)
    history_copy.import_rows(target, data, SOURCE_RIDERS, TARGET_RIDERS)
    target.commit()
    again = history_copy.import_rows(target, data, SOURCE_RIDERS, TARGET_RIDERS)
    assert (again["statements"], again["transactions"], again["links"], again["aliases"]) == (0, 0, 0, 0)
    assert target.scalar(select(func.count()).select_from(Transaction)) == 2


def test_a_dry_run_changes_nothing():
    source, target = memory_session(), memory_session()
    seed(source)
    history_copy.import_rows(target, history_copy.export_rows(source), SOURCE_RIDERS, TARGET_RIDERS)
    target.rollback()
    assert target.scalar(select(func.count()).select_from(Statement)) == 0
