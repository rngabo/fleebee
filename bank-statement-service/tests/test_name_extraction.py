from app.services.name_extraction import extract_depositor


def test_ekash_uses_sender_after_pipe() -> None:
    result = extract_depositor("EKASH incoming transfer : ACCOUNT HOLDER | Olivier ISHIMWE250791740913316417")
    assert result.depositor_name == "Olivier Ishimwe"
    assert result.transaction_type == "EKASH_INCOMING"
    assert not result.review_required


def test_cash_deposit_returns_the_last_text_and_keeps_the_sender_as_a_hint() -> None:
    result = extract_depositor("Cash deposit-BK YACU : IGNACE HABINEZA | DEPOSIT 0788840030MUNYEMANA JEAN D")
    assert result.depositor_name == "Munyemana Jean D"
    assert result.transaction_type == "CASH_DEPOSIT_BK_YACU"
    assert result.rule_id == "bk-yacu-trailing-name-v1"
    assert result.metadata["sender_name"] == "Ignace Habineza"
    assert result.metadata["payer_phone"] == "0788840030"
    assert not result.review_required


def test_trailing_name_with_a_line_break_before_the_phone() -> None:
    result = extract_depositor("Cash deposit-BK YACU : SYLVESTRE NSANZI | VERSEMENT\n0782357977HARAGIRIMANA E")
    assert result.depositor_name == "Haragirimana E"
    assert result.metadata["sender_name"] == "Sylvestre Nsanzi"


def test_cash_deposit_without_a_trailing_name_falls_back_to_the_sender() -> None:
    for narration in (
        "Cash deposit-BK YACU : IGNACE HABINEZA | DEPOSIT",
        "Cash deposit-BK YACU : IGNACE HABINEZA | DEPOSIT 0788840030",
    ):
        result = extract_depositor(narration)
        assert result.depositor_name == "Ignace Habineza"
        assert result.metadata["trailing_name"] is None


def test_words_after_the_last_pipe_count_as_the_last_text_when_there_is_no_phone() -> None:
    result = extract_depositor("Cash deposit-BK YACU : IGNACE HABINEZA | VERSEMENT HAKORIMANA BENJA")
    assert result.depositor_name == "Hakorimana Benja"


def test_filler_words_are_never_taken_as_a_name() -> None:
    result = extract_depositor("Cash deposit-BK YACU : IGNACE HABINEZA | VERSEMENT")
    assert result.depositor_name == "Ignace Habineza"
    assert result.metadata["trailing_name"] is None


def test_missing_ekash_sender_is_never_invented() -> None:
    result = extract_depositor("EKASH incoming transfer : ACCOUNT HOLDER")
    assert result.depositor_name is None
    assert result.review_required
    assert result.reason == "Sender name could not be reliably identified"

