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


def _clean_name(value: str) -> str | None:
    value = _NON_NAME_SUFFIX.sub("", value).strip(" |-:")
    value = _SPACE.sub(" ", value)
    if len(value) < 3 or not re.search(r"[A-Za-z]", value):
        return None
    return value.title()


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
        primary = after_colon.split("|", 1)[0].strip()
        name = _clean_name(primary)
        extra_names: list[str] = []
        if "|" in after_colon:
            possible = _clean_name(after_colon.split("|", 1)[1])
            if possible:
                extra_names.append(possible)
        if name:
            return NameExtraction(
                name,
                "CASH_DEPOSIT_BK_YACU",
                False,
                None,
                "bk-yacu-primary-before-pipe-v1",
                {"additional_possible_names": extra_names},
            )
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

