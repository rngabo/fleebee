from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models import Statement, StatementTransaction, Transaction
from app.services.naming import base_statement_name, period_label, unique_name
from app.services.settlement import discard_statement, reopen_synced_payment, reopen_transaction, settle_transaction, status_counts


@pytest.fixture()
def db(tmp_path):
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def make_statement(db, tmp_path, entries=2, name="BK-3215_mar-oct", file_hash="h1"):
    pdf = tmp_path / f"{file_hash}.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    statement = Statement(
        file_hash=file_hash, original_filename="s.pdf", display_name=name, stored_path=str(pdf), bank_name="Bank of Kigali",
        period_start=date(2026, 3, 1), period_end=date(2026, 10, 26), status="COMPLETED", warnings_json="[]",
        processing_duration_ms=1, incoming_count=entries,
    )
    db.add(statement)
    db.flush()
    transactions = []
    for index in range(entries):
        transaction = Transaction(
            fingerprint=f"{file_hash}-fp{index}", bank_name="Bank of Kigali", book_date=date(2026, 10, 1 + index), narration="n",
            credit=Decimal("1000"), transaction_type="T", review_status="OK", extraction_rule="r",
        )
        db.add(transaction)
        db.flush()
        db.add(StatementTransaction(statement_id=statement.id, transaction_id=transaction.id, source_row_number=index, duplicate_on_import=False))
        transactions.append(transaction)
    db.commit()
    return statement, transactions, pdf


def test_naming_is_short_and_readable() -> None:
    today = date(2026, 11, 4)
    assert period_label(date(2026, 5, 2), date(2026, 10, 30), today) == "may-oct"
    assert period_label(date(2025, 11, 1), date(2026, 2, 1), today) == "nov25-feb26"
    assert period_label(date(2025, 3, 1), date(2025, 8, 1), today) == "mar-aug_2025"
    assert base_statement_name("Bank of Kigali", "100006693215", date(2026, 5, 2), date(2026, 10, 30)) == "BK-3215_may-oct"
    assert unique_name("a", {"a", "a-2"}) == "a-3"


def test_settling_keeps_entries_and_completes_the_statement_by_removing_only_the_pdf(db, tmp_path) -> None:
    statement, transactions, pdf = make_statement(db, tmp_path)
    first = settle_transaction(db, transactions[0], "SYNCED", biker_name="Eric Mugisha", sheet_row=182)
    assert first[0]["remaining"] == 1 and first[0]["completed"] is False
    assert pdf.exists()
    last = settle_transaction(db, transactions[1], "SKIPPED")
    assert last[0]["completed"] is True

    assert not pdf.exists(), "only the stored PDF is deleted once nothing is pending"
    db.refresh(statement)
    assert statement.completed_at is not None
    assert len(list(db.scalars(select(Transaction)))) == 2, "entries and their outcomes are kept"
    assert status_counts(db, statement.id) == {"pending": 0, "synced": 1, "skipped": 1}
    kept = db.get(Transaction, transactions[0].id)
    assert kept.sync_status == "SYNCED" and kept.synced_biker_name == "Eric Mugisha" and kept.sheet_row == 182


def test_undoing_a_skip_reopens_the_statement(db, tmp_path) -> None:
    statement, transactions, _ = make_statement(db, tmp_path, entries=1)
    settle_transaction(db, transactions[0], "SKIPPED")
    db.refresh(statement)
    assert statement.completed_at is not None
    result = reopen_transaction(db, transactions[0])
    assert result[0]["completed"] is False and result[0]["remaining"] == 1
    db.refresh(statement)
    assert statement.completed_at is None


def test_deleting_a_synced_payment_makes_its_entry_pending_again(db, tmp_path) -> None:
    statement, transactions, _ = make_statement(db, tmp_path, entries=1)
    settle_transaction(db, transactions[0], "SYNCED", biker_name="Eric  Mugisha", sheet_row=5)
    assert reopen_synced_payment(db, transactions[0].book_date, Decimal("1000"), "eric mugisha") == 1
    assert db.get(Transaction, transactions[0].id).sync_status == "PENDING"
    assert reopen_synced_payment(db, transactions[0].book_date, Decimal("1000"), "eric mugisha") == 0


def test_discard_archives_when_anything_is_in_the_sheet_and_keeps_every_row(db, tmp_path) -> None:
    statement, transactions, pdf = make_statement(db, tmp_path)
    settle_transaction(db, transactions[0], "SYNCED", biker_name="A B")
    assert discard_statement(db, statement) == "archived"
    assert not pdf.exists()
    db.refresh(statement)
    assert statement.archived_at is not None and len(list(db.scalars(select(Transaction)))) == 2


def test_discard_removes_a_statement_with_nothing_synced(db, tmp_path) -> None:
    statement, transactions, pdf = make_statement(db, tmp_path)
    settle_transaction(db, transactions[0], "SKIPPED")
    assert discard_statement(db, statement) == "deleted"
    assert not pdf.exists()
    assert db.scalar(select(Transaction)) is None


def test_entry_shared_by_two_statements_updates_both(db, tmp_path) -> None:
    first, transactions, _ = make_statement(db, tmp_path, entries=1, name="one", file_hash="h1")
    second = Statement(
        file_hash="h2", original_filename="t.pdf", display_name="two", stored_path=str(tmp_path / "h2.pdf"), bank_name="Bank of Kigali",
        status="COMPLETED", warnings_json="[]", processing_duration_ms=1, incoming_count=1,
    )
    db.add(second)
    db.flush()
    db.add(StatementTransaction(statement_id=second.id, transaction_id=transactions[0].id, source_row_number=1, duplicate_on_import=True))
    db.commit()
    results = settle_transaction(db, transactions[0], "SYNCED", biker_name="X Y")
    assert len(results) == 2 and all(item["completed"] for item in results)


def test_reextract_updates_only_pending_uncorrected_entries(db, tmp_path) -> None:
    from app.services.reextract import reextract

    statement, transactions, _ = make_statement(db, tmp_path, entries=3)
    narration = "Cash deposit-BK YACU : | VERSEMENT 0782357977HARAGIRIMANA E"
    for index, transaction in enumerate(transactions):
        transaction.narration = narration
        transaction.extracted_depositor_name = "Sylvestre Nsanzi"
        transaction.extraction_rule = "bk-yacu-primary-before-pipe-v1"
    transactions[0].selected_biker_id = "old-pick"                       # stale once the name changes
    transactions[1].corrected_depositor_name = "Hand Corrected"       # operator edit must survive
    settle_transaction(db, transactions[2], "SKIPPED")                 # handled entries must survive
    db.commit()

    assert len(reextract(db, apply=True)) == 1
    db.refresh(transactions[0]); db.refresh(transactions[1]); db.refresh(transactions[2])
    assert transactions[0].extracted_depositor_name == "Haragirimana E" and transactions[0].selected_biker_id is None
    assert transactions[1].extracted_depositor_name == "Sylvestre Nsanzi" and transactions[1].corrected_depositor_name == "Hand Corrected"
    assert transactions[2].extracted_depositor_name == "Sylvestre Nsanzi"
