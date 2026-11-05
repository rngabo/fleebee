"""Copy statement history (statements, transactions, remembered payers) from one bank-statement database to another.

  python scripts/history_copy.py export --out history.json
  python scripts/history_copy.py import --in history.json --source-riders local.json --target-riders home.json [--apply]

Riders have different ids in each Fleebee app (each imports the sheet on its own), so rider ids are translated by name:
  *-riders.json is {"<rider id>": "<rider full name>"} for the source and the target app.
A rider that cannot be matched by name is not guessed: its remembered payer is skipped and a selected rider is cleared.
Import is repeatable (rows already there are left alone) and only changes anything with --apply (otherwise a dry run).
The history file holds financial data: keep it out of Git and delete it afterwards.
"""
import argparse
import json
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.core.config import get_settings
from app.models import PayerAlias, Statement, StatementTransaction, Transaction
from app.services.naming import alias_key

TABLES = [("statements", Statement), ("transactions", Transaction), ("statement_transactions", StatementTransaction), ("payer_aliases", PayerAlias)]


def to_json(value):
    if isinstance(value, (uuid.UUID, Decimal)):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def from_json(column, value):
    if value is None:
        return None
    kind = column.type.python_type
    if kind is uuid.UUID:
        return uuid.UUID(value)
    if kind is datetime:
        return datetime.fromisoformat(value)
    if kind is date:
        return date.fromisoformat(value)
    if kind is Decimal:
        return Decimal(value)
    return value


def export_rows(session: Session) -> dict:
    data = {}
    for name, model in TABLES:
        columns = [column.key for column in model.__table__.columns]
        data[name] = [{key: to_json(getattr(row, key)) for key in columns} for row in session.scalars(select(model))]
    return data


def build(model, row: dict):
    return model(**{column.key: from_json(column, row.get(column.key)) for column in model.__table__.columns if column.key in row})


def import_rows(session: Session, data: dict, source_riders: dict, target_riders: dict) -> dict:
    target_by_key = {alias_key(name): rider_id for rider_id, name in target_riders.items()}

    def translate(source_id):
        name = source_riders.get(source_id) if source_id else None
        return target_by_key.get(alias_key(name)) if name else None

    report = {"statements": 0, "transactions": 0, "links": 0, "aliases": 0, "aliases_skipped": [], "riders_cleared": 0}

    have_statements = {(row.id, row.file_hash, row.display_name) for row in session.scalars(select(Statement))}
    ids = {item[0] for item in have_statements}
    hashes = {item[1] for item in have_statements}
    names = {item[2] for item in have_statements}
    imported_statements = set()
    for row in data["statements"]:
        if uuid.UUID(row["id"]) in ids or row["file_hash"] in hashes or row["display_name"] in names:
            continue
        item = build(Statement, {**row, "stored_path": "(copied from another computer; the PDF is not kept)"})
        session.add(item)
        imported_statements.add(row["id"])
        report["statements"] += 1
    session.flush()

    have_tx_ids = set(session.scalars(select(Transaction.id)))
    have_prints = set(session.scalars(select(Transaction.fingerprint)))
    imported_tx = set()
    for row in data["transactions"]:
        if uuid.UUID(row["id"]) in have_tx_ids or row["fingerprint"] in have_prints:
            continue
        selected = row.get("selected_biker_id")
        mapped = translate(selected)
        if selected and not mapped:
            report["riders_cleared"] += 1
        session.add(build(Transaction, {**row, "selected_biker_id": mapped}))
        imported_tx.add(row["id"])
        report["transactions"] += 1
    session.flush()

    have_links = {(link.statement_id, link.transaction_id) for link in session.scalars(select(StatementTransaction))}
    for row in data["statement_transactions"]:
        key = (uuid.UUID(row["statement_id"]), uuid.UUID(row["transaction_id"]))
        # a link belongs with a statement or transaction that is now present (either just copied, or already there)
        if key in have_links or (row["statement_id"] not in imported_statements and row["transaction_id"] not in imported_tx):
            continue
        session.add(build(StatementTransaction, {k: v for k, v in row.items() if k != "id"}))
        have_links.add(key)
        report["links"] += 1

    have_aliases = set(session.scalars(select(PayerAlias.name_key)))
    for row in data["payer_aliases"]:
        if row["name_key"] in have_aliases:
            continue
        target = translate(row["biker_id"]) or target_by_key.get(alias_key(row["biker_name"]))
        if not target:
            report["aliases_skipped"].append(f'{row["display_name"]} -> {row["biker_name"]}')
            continue
        session.add(build(PayerAlias, {**row, "biker_id": target}))
        report["aliases"] += 1
    session.flush()
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    out = sub.add_parser("export")
    out.add_argument("--out", required=True)
    into = sub.add_parser("import")
    into.add_argument("--in", dest="source", required=True)
    into.add_argument("--source-riders", required=True)
    into.add_argument("--target-riders", required=True)
    into.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    engine = create_engine(get_settings().database_url)
    with Session(engine) as session:
        if args.command == "export":
            data = export_rows(session)
            with open(args.out, "w") as handle:
                json.dump(data, handle)
            print({name: len(rows) for name, rows in data.items()})
            return
        data = json.load(open(args.source))
        report = import_rows(session, data, json.load(open(args.source_riders)), json.load(open(args.target_riders)))
        print(json.dumps(report, indent=2))
        if args.apply:
            session.commit()
            print("APPLIED")
        else:
            session.rollback()
            print("DRY RUN - nothing was changed (add --apply to copy)")


if __name__ == "__main__":
    main()
