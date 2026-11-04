import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

import pdfplumber

from app.parsers.base_parser import ParsedStatement, ParsedTransaction, StatementMetadata
from app.services.name_extraction import extract_depositor
from app.services.pdf_extraction import extract_text_fallback


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONEY_RE = re.compile(r"^-?[\d,]+(?:\.\d{1,2})?$")


def _date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def _money(value: str | None) -> Decimal | None:
    if not value:
        return None
    try:
        return Decimal(value.replace(",", "")).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None


def _money_field(text: str, label: str) -> Decimal | None:
    match = re.search(rf"\b{re.escape(label)}\s*:\s*([\d,]+(?:\.\d{{1,2}})?)", text, re.I)
    return _money(match.group(1)) if match else None


class BankOfKigaliParser:
    bank_name = "Bank of Kigali"

    def detects(self, path: Path) -> bool:
        with pdfplumber.open(path) as pdf:
            text = "\n".join((page.extract_text() or "") for page in pdf.pages[:2])
        compact = text.upper().replace(" ", "")
        return "BANKOFKIGALI" in compact or ("BK" in text.upper() and "ACCOUNT" in text.upper())

    def parse(self, path: Path) -> ParsedStatement:
        pages_words: list[list[dict[str, object]]] = []
        page_texts: list[str] = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                page_words = page.extract_words(x_tolerance=2, y_tolerance=3, keep_blank_chars=False)
                pages_words.append(page_words)
                page_texts.append(page.extract_text(x_tolerance=2, y_tolerance=3) or "")
        if not any(page_texts):
            page_texts = extract_text_fallback(path)
        metadata = self._metadata("\n".join(page_texts))
        transactions = self._transactions(pages_words)
        warnings: list[str] = []
        if not transactions:
            warnings.append("No transaction rows were detected")
        return ParsedStatement(metadata=metadata, transactions=transactions, warnings=warnings)

    def _metadata(self, text: str) -> StatementMetadata:
        period_match = re.search(r"Period\s*:\s*(\d{4}-\d{2}-\d{2})\s+To\s+(\d{4}-\d{2}-\d{2})", text, re.I)
        account_match = re.search(r"Account\s+(?:No|Number)\s*:\s*([^\s]+)", text, re.I)
        issue_match = re.search(r"(?:Issue|Printed|Generation)\s+Date\s*:\s*(\d{4}-\d{2}-\d{2})", text, re.I)
        holder_match = re.search(r"Account\s+Name\s*:\s*(.+?)(?=\s+(?:Total\s+Debits|Account\s+Type)\s*:|$)", text, re.I | re.M)
        currency_match = re.search(r"Currency\s*:\s*([A-Z]{3})\b", text, re.I)
        return StatementMetadata(
            bank_name=self.bank_name,
            account_holder_name=holder_match.group(1).strip() if holder_match else None,
            account_number=account_match.group(1) if account_match else None,
            period_start=_date(period_match.group(1)) if period_match else None,
            period_end=_date(period_match.group(2)) if period_match else None,
            currency=currency_match.group(1).upper() if currency_match else None,
            opening_balance=_money_field(text, "Open Balance"),
            closing_balance=_money_field(text, "Closing Balance"),
            total_debits=_money_field(text, "Total Debits"),
            total_credits=_money_field(text, "Total Credits"),
            issue_date=_date(issue_match.group(1)) if issue_match else None,
        )

    def _transactions(self, pages_words: list[list[dict[str, object]]]) -> list[ParsedTransaction]:
        pages_rows: list[list[tuple[float, list[dict[str, object]]]]] = []
        for words in pages_words:
            rows: dict[float, list[dict[str, object]]] = {}
            for word in words:
                top = round(float(word["top"]) / 3) * 3
                rows.setdefault(top, []).append(word)
            pages_rows.append(
                [(top, sorted(row, key=lambda item: float(item["x0"]))) for top, row in sorted(rows.items())]
            )

        header = next(
            (
                row
                for page_rows in pages_rows
                for _, row in page_rows
                if {str(w["text"]) for w in row} >= {"Book", "Value", "Narration", "Debit", "Credit", "Balance"}
            ),
            None,
        )
        if not header:
            return []
        positions = self._column_positions(header)
        parsed: list[ParsedTransaction] = []
        source_number = 0
        for page_rows in pages_rows:
            starts: list[float] = []
            for top, row in page_rows:
                words = [str(word["text"]) for word in row]
                dates = [i for i, value in enumerate(words) if DATE_RE.match(value)]
                if len(dates) >= 2 and dates[1] == dates[0] + 1:
                    starts.append(top)
            for index, top in enumerate(starts):
                source_number += 1
                upper = (starts[index + 1] - 9) if index + 1 < len(starts) else top + 29
                block_rows = [
                    row
                    for row_top, row in page_rows
                    if top - 9 <= row_top < upper
                    and not self._is_header_or_footer([str(word["text"]) for word in row])
                ]
                transaction = self._parse_block(block_rows, positions, source_number)
                if transaction:
                    parsed.append(transaction)
        return parsed

    @staticmethod
    def _column_positions(header: list[dict[str, object]]) -> dict[str, float]:
        # BK's headings are centered while values are left-aligned. These offsets
        # convert the heading anchors into the actual column starts on A4 landscape.
        tokens = {str(word["text"]): float(word["x0"]) for word in header}
        return {
            "book": max(0, tokens["Book"] - 25),
            "value": tokens["Value"] - 25,
            "reference": tokens.get("Reference", 220.0) - 40,
            "narration": tokens["Narration"] - 125,
            "debit": tokens["Debit"] - 20,
            "credit": tokens["Credit"] - 20,
            "balance": tokens["Balance"] - 10,
        }

    @staticmethod
    def _is_header_or_footer(words: list[str]) -> bool:
        text = " ".join(words).lower()
        return any(marker in text for marker in ("account name", "total debits", "book date", "page ", "bank of kigali"))

    def _parse_block(
        self, rows: list[list[dict[str, object]]], positions: dict[str, float], number: int
    ) -> ParsedTransaction | None:
        columns: dict[str, list[str]] = {key: [] for key in positions}
        ordered = ["book", "value", "reference", "narration", "debit", "credit", "balance"]
        starts = [positions[key] for key in ordered]
        primary_index = next(
            (
                index
                for index, row in enumerate(rows)
                if sum(DATE_RE.match(str(word["text"])) is not None for word in row) >= 2
            ),
            -1,
        )
        for row_number, row in enumerate(rows):
            for word in row:
                x0 = float(word["x0"])
                if row_number != primary_index:
                    # Wrapped rows contain reference/narration only. Long phone or
                    # payment identifiers may visually extend into amount columns.
                    key = "reference" if x0 < positions["narration"] else "narration"
                else:
                    index = max(i for i, start in enumerate(starts) if x0 >= start)
                    key = ordered[index]
                columns[key].append(str(word["text"]))
        book_date = _date(columns["book"][0] if columns["book"] else None)
        value_date = _date(columns["value"][0] if columns["value"] else None)
        if not book_date:
            return None
        debit = _money("".join(columns["debit"])) or Decimal("0")
        credit = _money("".join(columns["credit"])) or Decimal("0")
        balance = _money("".join(columns["balance"]))
        narration = " ".join(columns["narration"]).strip()
        reference = " ".join(columns["reference"]).strip() or None
        parsed = ParsedTransaction(book_date, value_date, reference, narration, debit, credit, balance, number)
        if credit > 0:
            extraction = extract_depositor(narration)
            parsed.transaction_type = extraction.transaction_type
            parsed.depositor_name = extraction.depositor_name
            parsed.review_status = "REVIEW_REQUIRED" if extraction.review_required else "VALIDATED"
            parsed.review_reason = extraction.reason
            parsed.extraction_rule = extraction.rule_id
            parsed.extraction_metadata = extraction.metadata
        return parsed

