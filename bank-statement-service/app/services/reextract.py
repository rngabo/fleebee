"""Re-run name extraction on stored entries after the rules improve.

Only entries that are still PENDING and were never corrected by an operator are touched; anything already
synced, skipped or hand-corrected keeps its name. Usage: python -m app.services.reextract [--apply]
"""

import json
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.transaction import Transaction
from app.services.name_extraction import extract_depositor
from app.services.settlement import refresh_extraction


def reextract(db: Session, apply: bool = False) -> list[tuple[str, str | None, str | None]]:
    changes = []
    rows = db.scalars(
        select(Transaction).where(Transaction.credit > 0, Transaction.sync_status == "PENDING", Transaction.corrected_depositor_name.is_(None))
    )
    for transaction in rows:
        old_name = transaction.extracted_depositor_name
        narration = transaction.narration
        if apply:
            changed = refresh_extraction(transaction)
            new_name = transaction.extracted_depositor_name
        else:
            result = extract_depositor(narration)
            new_name = result.depositor_name
            changed = (
                new_name != old_name
                or result.rule_id != transaction.extraction_rule
                or json.dumps(result.metadata) != transaction.extraction_metadata_json
            )
        if changed:
            changes.append((narration, old_name, new_name))
    if apply:
        db.commit()
    return changes


if __name__ == "__main__":
    apply = "--apply" in sys.argv
    with SessionLocal() as session:
        changed = reextract(session, apply=apply)
    print(f"{'Updated' if apply else 'Would update'} {len(changed)} entries")
    for narration, old, new in changed[:40]:
        print(f"  {old!r} -> {new!r}   [{narration[-40:]}]")
