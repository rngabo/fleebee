import io
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import Settings, get_settings
from app.core.security import sha256_bytes
from app.db.session import Base, get_db
from app.main import app
from app.models import Statement, StatementTransaction, Transaction

KEY = "test-api-key-at-least-sixteen-characters"
HEADERS = {"X-API-Key": KEY}


@pytest.fixture()
def client(tmp_path):
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = Session(engine)
    settings = Settings(api_key=KEY, database_url="sqlite://", storage_dir=tmp_path)
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_settings] = lambda: settings
    yield TestClient(app), session, tmp_path
    app.dependency_overrides.clear()
    session.close()


def seed(session, tmp_path, entries=2):
    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    statement = Statement(
        file_hash="hash-a", original_filename="a.pdf", display_name="BK-3215_may-oct", stored_path=str(pdf), bank_name="Bank of Kigali",
        period_start=date(2026, 5, 1), period_end=date(2026, 10, 30), status="COMPLETED", warnings_json="[]",
        processing_duration_ms=1, incoming_count=entries,
    )
    session.add(statement)
    session.flush()
    ids = []
    for index in range(entries):
        transaction = Transaction(
            fingerprint=f"fp{index}", bank_name="Bank of Kigali", book_date=date(2026, 10, 1 + index), narration="n",
            credit=Decimal("500"), transaction_type="T", review_status="OK", extraction_rule="r",
        )
        session.add(transaction)
        session.flush()
        session.add(StatementTransaction(statement_id=statement.id, transaction_id=transaction.id, source_row_number=index, duplicate_on_import=False))
        ids.append(str(transaction.id))
    session.commit()
    return statement, ids, pdf


def test_list_shows_friendly_name_and_progress_counts(client):
    api, session, tmp_path = client
    _, ids, _ = seed(session, tmp_path)
    api.post(f"/api/v1/transactions/{ids[0]}/settle", json={"outcome": "SYNCED", "biker_name": "A B", "sheet_row": 9}, headers=HEADERS)
    item = api.get("/api/v1/statements", headers=HEADERS).json()["items"][0]
    assert item["display_name"] == "BK-3215_may-oct"
    assert (item["remaining_count"], item["synced_count"], item["skipped_count"]) == (1, 1, 0)
    assert item["can_discard"] is True and item["completed_at"] is None


def test_finished_statement_keeps_every_entry_and_its_outcome(client):
    api, session, tmp_path = client
    statement, ids, pdf = seed(session, tmp_path)
    api.post(f"/api/v1/transactions/{ids[0]}/settle", json={"outcome": "SYNCED", "biker_name": "A B", "sheet_row": 9}, headers=HEADERS)
    api.post(f"/api/v1/transactions/{ids[1]}/settle", json={"outcome": "SKIPPED"}, headers=HEADERS)
    assert not pdf.exists()
    detail = api.get(f"/api/v1/statements/{statement.id}", headers=HEADERS).json()
    assert detail["completed_at"] is not None
    states = {item["id"]: (item["sync_status"], item["synced_biker_name"], item["sheet_row"]) for item in detail["transactions"]}
    assert states[ids[0]] == ("SYNCED", "A B", 9) and states[ids[1]][0] == "SKIPPED"


def test_uploading_a_completed_statement_is_denied_but_an_unfinished_one_reopens(client):
    api, session, tmp_path = client
    statement, ids, _ = seed(session, tmp_path)
    content = b"%PDF-1.4 same"
    statement.file_hash = sha256_bytes(content)
    session.commit()
    upload = lambda: api.post("/api/v1/statements/upload", files={"file": ("a.pdf", io.BytesIO(content), "application/pdf")}, headers=HEADERS)
    reopened = upload()
    assert reopened.status_code == 409 and reopened.json()["detail"]["statement_id"] == str(statement.id)
    for transaction_id in ids:
        api.post(f"/api/v1/transactions/{transaction_id}/settle", json={"outcome": "SKIPPED"}, headers=HEADERS)
    denied = upload()
    assert denied.status_code == 409 and denied.json()["detail"]["code"] == "completed"
    assert denied.json()["detail"]["display_name"] == "BK-3215_may-oct"


def test_undo_skip_and_payment_deleted_reopen_entries(client):
    api, session, tmp_path = client
    statement, ids, _ = seed(session, tmp_path)
    api.post(f"/api/v1/transactions/{ids[0]}/settle", json={"outcome": "SKIPPED"}, headers=HEADERS)
    assert api.post(f"/api/v1/transactions/{ids[0]}/reopen", headers=HEADERS).status_code == 200
    api.post(f"/api/v1/transactions/{ids[1]}/settle", json={"outcome": "SYNCED", "biker_name": "Eric Mugisha", "sheet_row": 4}, headers=HEADERS)
    assert api.post(f"/api/v1/transactions/{ids[1]}/reopen", headers=HEADERS).status_code == 409
    done = api.post("/api/v1/transactions/reopen-synced", json={"book_date": "2026-10-02", "amount": "500", "biker_name": "eric mugisha"}, headers=HEADERS)
    assert done.json()["reopened"] == 1
    listed = api.get("/api/v1/statements", headers=HEADERS).json()["items"][0]
    assert listed["remaining_count"] == 2


def test_discarding_a_partly_synced_statement_archives_it_and_keeps_what_is_in_the_sheet(client):
    api, session, tmp_path = client
    statement, ids, pdf = seed(session, tmp_path, entries=3)
    api.post(f"/api/v1/transactions/{ids[0]}/settle", json={"outcome": "SYNCED", "biker_name": "A B", "sheet_row": 4}, headers=HEADERS)
    listed = api.get("/api/v1/statements", headers=HEADERS).json()["items"][0]
    assert listed["can_discard"] is True and listed["completed_at"] is None
    assert api.delete(f"/api/v1/statements/{statement.id}", headers=HEADERS).json() == {"mode": "archived"}
    assert not pdf.exists()
    assert api.get("/api/v1/statements", headers=HEADERS).json()["items"] == []
    detail = api.get(f"/api/v1/statements/{statement.id}", headers=HEADERS).json()
    states = sorted(item["sync_status"] for item in detail["transactions"])
    assert states == ["PENDING", "PENDING", "SYNCED"]                      # synced row kept, pending rows still pending
    assert api.get("/api/v1/transactions/synced", headers=HEADERS).json()["items"][0]["statement_name"] == "BK-3215_may-oct"


def test_uploading_a_discarded_unfinished_file_again_brings_it_back_into_the_list(client):
    api, session, tmp_path = client
    statement, ids, _ = seed(session, tmp_path)
    content = b"%PDF-1.4 discarded and back"
    statement.file_hash = sha256_bytes(content)
    session.commit()
    api.post(f"/api/v1/transactions/{ids[0]}/settle", json={"outcome": "SYNCED", "biker_name": "A B"}, headers=HEADERS)
    api.delete(f"/api/v1/statements/{statement.id}", headers=HEADERS)
    assert api.get("/api/v1/statements", headers=HEADERS).json()["items"] == []
    again = api.post("/api/v1/statements/upload", files={"file": ("a.pdf", io.BytesIO(content), "application/pdf")}, headers=HEADERS)
    assert again.status_code == 409 and again.json()["detail"]["statement_id"] == str(statement.id)   # reopened, not refused
    assert len(api.get("/api/v1/statements", headers=HEADERS).json()["items"]) == 1


def test_discarding_a_verified_statement_hides_it_but_keeps_rows_name_and_hash(client):
    api, session, tmp_path = client
    statement, ids, _ = seed(session, tmp_path)
    content = b"%PDF-1.4 verified"
    statement.file_hash = sha256_bytes(content)
    session.commit()
    api.post(f"/api/v1/transactions/{ids[0]}/settle", json={"outcome": "SYNCED", "biker_name": "A B", "sheet_row": 3}, headers=HEADERS)
    api.post(f"/api/v1/transactions/{ids[1]}/settle", json={"outcome": "SKIPPED"}, headers=HEADERS)
    assert api.delete(f"/api/v1/statements/{statement.id}", headers=HEADERS).json() == {"mode": "archived"}

    assert api.get("/api/v1/statements", headers=HEADERS).json()["items"] == []        # hidden from the list
    detail = api.get(f"/api/v1/statements/{statement.id}", headers=HEADERS).json()      # but still on record
    assert {item["sync_status"] for item in detail["transactions"]} == {"SYNCED", "SKIPPED"}
    assert detail["display_name"] == "BK-3215_may-oct"
    denied = api.post("/api/v1/statements/upload", files={"file": ("a.pdf", io.BytesIO(content), "application/pdf")}, headers=HEADERS)
    assert denied.status_code == 409 and denied.json()["detail"]["code"] == "completed"   # same file stays blocked
    synced = api.get("/api/v1/transactions/synced", headers=HEADERS).json()["items"]
    assert synced[0]["statement_name"] == "BK-3215_may-oct"                                # payment still links back


def test_reopening_a_row_of_an_archived_statement_does_not_bring_it_back_but_restore_does(client):
    api, session, tmp_path = client
    statement, ids, _ = seed(session, tmp_path, entries=1)
    api.post(f"/api/v1/transactions/{ids[0]}/settle", json={"outcome": "SKIPPED"}, headers=HEADERS)
    api.delete(f"/api/v1/statements/{statement.id}", headers=HEADERS)
    api.post(f"/api/v1/transactions/{ids[0]}/reopen", headers=HEADERS)
    assert api.get("/api/v1/statements", headers=HEADERS).json()["items"] == []            # stays hidden
    assert api.post(f"/api/v1/statements/{statement.id}/restore", headers=HEADERS).json() == {"restored": True}
    assert len(api.get("/api/v1/statements", headers=HEADERS).json()["items"]) == 1


def test_unverified_statement_with_nothing_in_the_sheet_is_deleted_for_good(client):
    api, session, tmp_path = client
    statement, ids, pdf = seed(session, tmp_path)
    assert api.delete(f"/api/v1/statements/{statement.id}", headers=HEADERS).json() == {"mode": "deleted"}
    assert not pdf.exists()
    assert api.get(f"/api/v1/statements/{statement.id}", headers=HEADERS).status_code == 404


def test_selected_biker_is_saved_with_the_entry(client):
    api, session, tmp_path = client
    statement, ids, _ = seed(session, tmp_path)
    api.put(f"/api/v1/transactions/{ids[0]}/biker", json={"biker_id": "biker-1"}, headers=HEADERS)
    detail = api.get(f"/api/v1/statements/{statement.id}", headers=HEADERS).json()
    assert detail["transactions"][0]["selected_biker_id"] == "biker-1"


def test_verifying_closes_a_half_done_statement(client):
    api, session, tmp_path = client
    statement, ids, pdf = seed(session, tmp_path, entries=3)
    api.post(f"/api/v1/transactions/{ids[0]}/settle", json={"outcome": "SYNCED", "biker_name": "A B", "sheet_row": 4}, headers=HEADERS)
    result = api.post(f"/api/v1/statements/{statement.id}/verify", headers=HEADERS).json()
    assert result["skipped_now"] == 2 and result["completed"] is True
    assert not pdf.exists()
    listed = api.get("/api/v1/statements", headers=HEADERS).json()["items"][0]
    assert (listed["synced_count"], listed["skipped_count"], listed["remaining_count"]) == (1, 2, 0)
    assert listed["completed_at"] is not None
    # the closed statement cannot be uploaded again, and "Undo skip" on a row reopens it
    api.post(f"/api/v1/transactions/{ids[1]}/reopen", headers=HEADERS)
    assert api.get("/api/v1/statements", headers=HEADERS).json()["items"][0]["completed_at"] is None


def _fake_statement(rows, start, end):
    from app.parsers.base_parser import ParsedStatement, ParsedTransaction, StatementMetadata
    metadata = StatementMetadata("Bank of Kigali", account_number="100006693215", period_start=start, period_end=end, currency="RWF")
    items = [
        ParsedTransaction(day, None, ref, narration, Decimal("0"), Decimal(amount), None, index + 1,
                          transaction_type="INCOMING", depositor_name=name, review_status="VALIDATED", extraction_rule="test")
        for index, (day, ref, narration, amount, name) in enumerate(rows)
    ]
    return ParsedStatement(metadata, items)


def test_new_overlapping_upload_skips_handled_rows_and_shows_only_what_is_needed(client, monkeypatch):
    from app.services import statement_processor

    api, session, tmp_path = client
    old_rows = [
        (date(2026, 10, 1), "R1", "EKASH from A", "1000", "Alice A"),
        (date(2026, 10, 2), "R2", "EKASH from B", "2000", "Bob B"),
    ]
    new_rows = old_rows + [(date(2026, 10, 3), "R3", "EKASH from C", "3000", "Carol C")]
    parsed = {"value": _fake_statement(old_rows, date(2026, 10, 1), date(2026, 10, 2))}

    class FakeParser:
        def parse(self, path):
            return parsed["value"]

    monkeypatch.setattr(statement_processor, "parser_for", lambda path: FakeParser())
    monkeypatch.setattr(statement_processor, "validate_pdf", lambda path: None)

    def upload(content):
        return api.post("/api/v1/statements/upload", files={"file": ("s.pdf", io.BytesIO(content), "application/pdf")}, headers=HEADERS)

    first = upload(b"%PDF-1.4 first")
    assert first.status_code == 201
    first_id = first.json()["statement_id"]
    entries = api.get(f"/api/v1/statements/{first_id}", headers=HEADERS).json()["transactions"]
    api.post(f"/api/v1/transactions/{entries[0]['id']}/settle", json={"outcome": "SYNCED", "biker_name": "Alice A", "sheet_row": 7}, headers=HEADERS)
    api.post(f"/api/v1/transactions/{entries[1]['id']}/settle", json={"outcome": "SKIPPED"}, headers=HEADERS)
    assert api.post(f"/api/v1/statements/{first_id}/verify", headers=HEADERS).status_code == 200
    assert api.delete(f"/api/v1/statements/{first_id}", headers=HEADERS).json() == {"mode": "archived"}

    parsed["value"] = _fake_statement(new_rows, date(2026, 10, 1), date(2026, 10, 3))
    second = upload(b"%PDF-1.4 second, overlapping")
    assert second.status_code == 201
    detail = api.get(f"/api/v1/statements/{second.json()['statement_id']}", headers=HEADERS).json()
    by_name = {item["depositor_name"]: item["sync_status"] for item in detail["transactions"]}
    assert by_name == {"Alice A": "SYNCED", "Bob B": "SKIPPED", "Carol C": "PENDING"}   # only Carol still needs work
    assert detail["duplicate_count"] == 2 and detail["completed_at"] is None
    assert detail["remaining_count"] == 1
    listed = api.get("/api/v1/statements", headers=HEADERS).json()["items"]
    assert [item["display_name"] for item in listed] == [detail["display_name"]]       # archived one stays hidden


def test_back_dated_sync_keeps_both_dates_and_can_be_reopened_by_reference(client):
    api, session, tmp_path = client
    statement, ids, _ = seed(session, tmp_path)
    settle = api.post(
        f"/api/v1/transactions/{ids[0]}/settle",
        json={"outcome": "SYNCED", "biker_name": "Eric Mugisha", "sheet_row": 12, "sheet_date": "2026-09-30"},
        headers=HEADERS,
    )
    assert settle.status_code == 200
    entry = next(item for item in api.get(f"/api/v1/statements/{statement.id}", headers=HEADERS).json()["transactions"] if item["id"] == ids[0])
    assert entry["book_date"] == "2026-10-01" and entry["sheet_date"] == "2026-09-30"   # real bank date and recorded date

    synced = api.get("/api/v1/transactions/synced", headers=HEADERS).json()["items"][0]
    assert synced["sheet_date"] == "2026-09-30" and synced["ref"] == ids[0].replace("-", "")[:8]

    # someone edited the date in the sheet: the reference code still finds the entry
    reopened = api.post("/api/v1/transactions/reopen-synced", json={"ref": synced["ref"]}, headers=HEADERS)
    assert reopened.json()["reopened"] == 1
    again = next(item for item in api.get(f"/api/v1/statements/{statement.id}", headers=HEADERS).json()["transactions"] if item["id"] == ids[0])
    assert again["sync_status"] == "PENDING" and again["sheet_date"] is None


def test_reopen_without_reference_uses_the_recorded_sheet_date(client):
    api, session, tmp_path = client
    _, ids, _ = seed(session, tmp_path)
    api.post(f"/api/v1/transactions/{ids[0]}/settle", json={"outcome": "SYNCED", "biker_name": "Eric Mugisha", "sheet_date": "2026-09-30"}, headers=HEADERS)
    wrong = api.post("/api/v1/transactions/reopen-synced", json={"book_date": "2026-10-01", "amount": "500", "biker_name": "eric mugisha"}, headers=HEADERS)
    assert wrong.json()["reopened"] == 0                       # the bank date is no longer what the sheet holds
    right = api.post("/api/v1/transactions/reopen-synced", json={"book_date": "2026-09-30", "amount": "500", "biker_name": "eric mugisha"}, headers=HEADERS)
    assert right.json()["reopened"] == 1


def test_an_already_synced_entry_is_not_downgraded_by_a_later_already_in_sheet(client):
    api, session, tmp_path = client
    statement, ids, _ = seed(session, tmp_path)
    api.post(f"/api/v1/transactions/{ids[0]}/settle", json={"outcome": "SYNCED", "biker_name": "A B", "sheet_row": 5, "sheet_date": "2026-09-30"}, headers=HEADERS)
    api.post(f"/api/v1/transactions/{ids[0]}/settle", json={"outcome": "IN_SHEET", "biker_name": "A B"}, headers=HEADERS)
    entry = next(item for item in api.get(f"/api/v1/statements/{statement.id}", headers=HEADERS).json()["transactions"] if item["id"] == ids[0])
    assert (entry["sync_status"], entry["sheet_row"], entry["sheet_date"]) == ("SYNCED", 5, "2026-09-30")


def test_a_payer_name_is_remembered_and_can_be_corrected_or_removed(client):
    api, _, _ = client
    saved = api.put("/api/v1/aliases", json={"name": "Olivier ISHIMWE", "biker_id": "b-sindi", "biker_name": "Sindikubwayo Jean Claude"}, headers=HEADERS)
    assert saved.status_code == 200 and saved.json()["name_key"] == "ishimwe olivier"
    again = api.put("/api/v1/aliases", json={"name": "ishimwe olivier", "biker_id": "b-other", "biker_name": "Other Rider"}, headers=HEADERS)
    assert again.json()["id"] == saved.json()["id"]                       # same person, word order and case ignored
    items = api.get("/api/v1/aliases", headers=HEADERS).json()["items"]
    assert len(items) == 1 and items[0]["biker_id"] == "b-other"          # the correction replaced the old rider
    assert api.delete(f"/api/v1/aliases/{saved.json()['id']}", headers=HEADERS).status_code == 204
    assert api.get("/api/v1/aliases", headers=HEADERS).json()["items"] == []


def test_reopen_skipped_brings_back_skipped_entries_and_the_reason_is_recorded(client):
    api, session, tmp_path = client
    statement, ids, _ = seed(session, tmp_path, entries=3)
    api.post(f"/api/v1/transactions/{ids[0]}/settle", json={"outcome": "SKIPPED"}, headers=HEADERS)            # by hand
    api.post(f"/api/v1/statements/{statement.id}/verify", headers=HEADERS)                                      # the other two, in bulk
    detail = api.get(f"/api/v1/statements/{statement.id}", headers=HEADERS).json()
    reasons = {item["id"]: item["skip_reason"] for item in detail["transactions"]}
    assert reasons[ids[0]] == "MANUAL" and reasons[ids[1]] == "VERIFY" and reasons[ids[2]] == "VERIFY"

    only_bulk = api.post(f"/api/v1/statements/{statement.id}/reopen-skipped?only_bulk=true", headers=HEADERS).json()
    assert only_bulk["reopened"] == 2                                                                           # the hand-made skip stays
    listed = api.get("/api/v1/statements", headers=HEADERS).json()["items"][0]
    assert (listed["remaining_count"], listed["skipped_count"]) == (2, 1) and listed["completed_at"] is None
    assert api.post(f"/api/v1/statements/{statement.id}/reopen-skipped", headers=HEADERS).json()["reopened"] == 1


def test_bulk_skipped_entries_come_back_as_pending_when_a_new_statement_contains_them(client, monkeypatch):
    from app.services import statement_processor

    api, session, tmp_path = client
    old_rows = [
        (date(2026, 8, 1), "R1", "EKASH incoming transfer : ACCOUNT HOLDER | Olivier ISHIMWE250791740913316417", "30000", "Olivier Ishimwe"),
        (date(2026, 8, 2), "R2", "EKASH incoming transfer : ACCOUNT HOLDER | Mupenzi JEAN250791740913316418", "36000", "Mupenzi Jean"),
    ]
    parsed = {"value": _fake_statement(old_rows, date(2026, 8, 1), date(2026, 8, 2))}

    class FakeParser:
        def parse(self, path):
            return parsed["value"]

    monkeypatch.setattr(statement_processor, "parser_for", lambda path: FakeParser())
    monkeypatch.setattr(statement_processor, "validate_pdf", lambda path: None)
    upload = lambda content: api.post("/api/v1/statements/upload", files={"file": ("s.pdf", io.BytesIO(content), "application/pdf")}, headers=HEADERS)
    first = upload(b"%PDF-1.4 first").json()["statement_id"]
    api.post(f"/api/v1/statements/{first}/verify", headers=HEADERS)                                              # closes both in bulk

    parsed["value"] = _fake_statement(old_rows + [(date(2026, 8, 3), "R3", "EKASH incoming transfer : ACCOUNT HOLDER | Newcomer PERSON250791740913316419", "5000", "Newcomer")], date(2026, 8, 1), date(2026, 8, 3))
    second = upload(b"%PDF-1.4 second").json()["statement_id"]
    states = {item["depositor_name"]: item["sync_status"] for item in api.get(f"/api/v1/statements/{second}", headers=HEADERS).json()["transactions"]}
    assert set(states.values()) == {"PENDING"} and len(states) == 3


def test_uploading_a_file_that_only_looks_complete_because_of_bulk_skips_brings_it_back(client):
    api, session, tmp_path = client
    statement, ids, _ = seed(session, tmp_path, entries=2)
    content = b"%PDF-1.4 looked complete"
    statement.file_hash = sha256_bytes(content)
    session.commit()
    api.post(f"/api/v1/statements/{statement.id}/verify", headers=HEADERS)                    # both rows skipped in bulk
    api.delete(f"/api/v1/statements/{statement.id}", headers=HEADERS)                         # and discarded
    assert api.get("/api/v1/statements", headers=HEADERS).json()["items"] == []
    again = api.post("/api/v1/statements/upload", files={"file": ("a.pdf", io.BytesIO(content), "application/pdf")}, headers=HEADERS)
    assert again.status_code == 409 and again.json()["detail"].get("code") != "completed"    # reopened, not refused
    listed = api.get("/api/v1/statements", headers=HEADERS).json()["items"][0]
    assert (listed["remaining_count"], listed["completed_at"]) == (2, None)


def test_a_file_that_is_really_done_is_still_refused(client):
    api, session, tmp_path = client
    statement, ids, _ = seed(session, tmp_path, entries=2)
    content = b"%PDF-1.4 really done"
    statement.file_hash = sha256_bytes(content)
    session.commit()
    api.post(f"/api/v1/transactions/{ids[0]}/settle", json={"outcome": "SYNCED", "biker_name": "A B"}, headers=HEADERS)
    api.post(f"/api/v1/transactions/{ids[1]}/settle", json={"outcome": "SKIPPED"}, headers=HEADERS)   # skipped by hand
    refused = api.post("/api/v1/statements/upload", files={"file": ("a.pdf", io.BytesIO(content), "application/pdf")}, headers=HEADERS)
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "completed"


def test_a_reopened_row_is_read_again_with_the_current_rules_so_the_last_text_wins(client):
    import uuid

    api, session, tmp_path = client
    statement, ids, _ = seed(session, tmp_path, entries=1)
    transaction = session.get(Transaction, uuid.UUID(ids[0]))
    transaction.narration = "Cash deposit-BK YACU : IGNACE HABINEZA | DEPOSIT 0788840030MUNYEMANA JEAN D"
    transaction.extracted_depositor_name = "Ignace Habineza"               # what an older rule stored
    transaction.extraction_rule = "bk-yacu-primary-before-pipe-v1"
    session.commit()
    api.post(f"/api/v1/statements/{statement.id}/verify", headers=HEADERS)                           # skipped in bulk
    api.post(f"/api/v1/statements/{statement.id}/reopen-skipped?only_bulk=true", headers=HEADERS)
    entry = api.get(f"/api/v1/statements/{statement.id}", headers=HEADERS).json()["transactions"][0]
    assert entry["sync_status"] == "PENDING"
    assert entry["depositor_name"] == "Munyemana Jean D"                                              # last text first
    assert entry["name_hints"]["sender_name"] == "Ignace Habineza"


def test_an_entry_wrongly_marked_already_in_sheet_can_be_reopened(client):
    api, session, tmp_path = client
    statement, ids, _ = seed(session, tmp_path)
    api.post(f"/api/v1/transactions/{ids[0]}/settle", json={"outcome": "IN_SHEET", "biker_name": "A B"}, headers=HEADERS)
    assert api.post(f"/api/v1/transactions/{ids[0]}/reopen", headers=HEADERS).status_code == 200
    entry = next(item for item in api.get(f"/api/v1/statements/{statement.id}", headers=HEADERS).json()["transactions"] if item["id"] == ids[0])
    assert entry["sync_status"] == "PENDING"
    api.post(f"/api/v1/transactions/{ids[1]}/settle", json={"outcome": "SYNCED", "biker_name": "A B"}, headers=HEADERS)
    assert api.post(f"/api/v1/transactions/{ids[1]}/reopen", headers=HEADERS).status_code == 409      # a row the app wrote stays protected
