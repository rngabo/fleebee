import os
from decimal import Decimal
from pathlib import Path

import pytest

from app.parsers.bank_of_kigali import BankOfKigaliParser


@pytest.mark.skipif(not os.getenv("BK_SAMPLE_PDF"), reason="Set BK_SAMPLE_PDF for local real-statement validation")
def test_real_bk_sample_extracts_and_reconciles_all_rows() -> None:
    parser = BankOfKigaliParser()
    path = Path(os.environ["BK_SAMPLE_PDF"])
    result = parser.parse(path)
    assert parser.detects(path)
    assert len(result.transactions) == 52
    assert sum((row.credit for row in result.transactions), Decimal("0")) == result.metadata.total_credits
    assert sum((row.debit for row in result.transactions), Decimal("0")) == result.metadata.total_debits
    assert any(row.transaction_type == "EKASH_INCOMING" for row in result.transactions)
    assert any(row.transaction_type == "CASH_DEPOSIT_BK_YACU" for row in result.transactions)

