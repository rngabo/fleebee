import re
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class NameExtraction:
    depositor_name: str | None
    transaction_type: str
    review_required: bool
    reason: str | None
    rule_id: str
    metadata: dict[str, object] = field(default_factory=dict)


_SPACE = re.compile(r"\s+")
_NON_NAME_SUFFIX = re.compile(r"(?i)(?:\d|DEPOSIT\b|APCRW\b|FTCM\b).*$")


_FILLER_ONLY = re.compile(r"(?i)^(?:deposit|versement|apcrw|ftcm|cash|payment|mobile wallet transfer\w*)$")


def _clean_name(value: str) -> str | None:
    value = _NON_NAME_SUFFIX.sub("", value).strip(" |-:")
    value = _SPACE.sub(" ", value)
    if len(value) < 3 or not re.search(r"[A-Za-z]", value) or _FILLER_ONLY.match(value):
        return None
    return value.title()


# "... | DEPOSIT 0788840030MUNYEMANA JEAN D": a phone number, then the rider's name (often cut short).
_TRAILING_NAME_AFTER_PHONE = re.compile(r"(?<!\d)(07\d{8})\s*([A-Za-z][A-Za-z '.\-]*)$")
_FILLER_WORDS = re.compile(r"(?i)^(?:deposit|versement|apcrw|ftcm)\b[\s:|-]*")


def _trailing_name(narration: str) -> tuple[str | None, str | None]:
    """The last text of a narration is the most reliable name, so look there first."""
    match = _TRAILING_NAME_AFTER_PHONE.search(narration)
    if match:
        name = _clean_name(match.group(2))
        if name:
            return name, match.group(1)
    # No phone number: use readable words after the last pipe, ignoring filler such as DEPOSIT / VERSEMENT.
    tail = narration.rsplit("|", 1)[-1].strip() if "|" in narration else ""
    tail = _FILLER_WORDS.sub("", tail).strip()
    if tail and not re.search(r"\d", tail):
        name = _clean_name(tail)
        if name:
            return name, None
    return None, None


def extract_depositor(narration: str) -> NameExtraction:
    normalized = _SPACE.sub(" ", narration).strip()
    lower = normalized.lower()

    if "ekash incoming transfer" in lower:
        after_colon = normalized.split(":", 1)[1].strip() if ":" in normalized else ""
        parts = [part.strip() for part in after_colon.split("|")]
        if len(parts) >= 2:
            name = _clean_name(parts[1])
            if name:
                return NameExtraction(name, "EKASH_INCOMING", False, None, "bk-ekash-pipe-sender-v1")
        return NameExtraction(
            None,
            "EKASH_INCOMING",
            True,
            "Sender name could not be reliably identified",
            "bk-ekash-missing-sender-v1",
        )

    if "cash deposit-bk yacu" in lower:
        after_colon = normalized.split(":", 1)[1].strip() if ":" in normalized else ""
        sender = _clean_name(after_colon.split("|", 1)[0].strip())
        trailing, payer_phone = _trailing_name(normalized)
        # The last text of the narration (usually the rider paid for, often cut short) is the name returned.
        # The sender before the pipe is kept as a hint; the app prefers whichever resembles a registered rider.
        metadata = {"sender_name": sender, "trailing_name": trailing, "payer_phone": payer_phone}
        if trailing:
            return NameExtraction(trailing, "CASH_DEPOSIT_BK_YACU", False, None, "bk-yacu-trailing-name-v1", metadata)
        if sender:
            return NameExtraction(sender, "CASH_DEPOSIT_BK_YACU", False, None, "bk-yacu-primary-before-pipe-v1", metadata)
        return NameExtraction(
            None,
            "CASH_DEPOSIT_BK_YACU",
            True,
            "Primary depositor name could not be reliably identified",
            "bk-yacu-missing-primary-v1",
        )

    return NameExtraction(
        None,
        "OTHER_CREDIT",
        True,
        "Unsupported incoming transaction narration",
        "bk-unclassified-credit-v1",
    )

