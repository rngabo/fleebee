from pathlib import Path

from app.parsers.bank_of_kigali import BankOfKigaliParser
from app.parsers.base_parser import BankStatementParser


class UnsupportedBankStatementError(ValueError):
    pass


PARSERS: tuple[BankStatementParser, ...] = (BankOfKigaliParser(),)


def parser_for(path: Path) -> BankStatementParser:
    for parser in PARSERS:
        if parser.detects(path):
            return parser
    raise UnsupportedBankStatementError("Unsupported bank statement format")
