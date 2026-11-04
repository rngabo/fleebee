from app.services.name_extraction import extract_depositor


def test_ekash_uses_sender_after_pipe() -> None:
    result = extract_depositor("EKASH incoming transfer : ACCOUNT HOLDER | Olivier ISHIMWE250791740913316417")
    assert result.depositor_name == "Olivier Ishimwe"
    assert result.transaction_type == "EKASH_INCOMING"
    assert not result.review_required


def test_cash_deposit_uses_primary_visible_name() -> None:
    result = extract_depositor("Cash deposit-BK YACU : IGNACE HABINEZA | DEPOSIT 0788840030MUNYEMANA JEAN D")
    assert result.depositor_name == "Ignace Habineza"
    assert result.transaction_type == "CASH_DEPOSIT_BK_YACU"


def test_missing_ekash_sender_is_never_invented() -> None:
    result = extract_depositor("EKASH incoming transfer : ACCOUNT HOLDER")
    assert result.depositor_name is None
    assert result.review_required
    assert result.reason == "Sender name could not be reliably identified"

