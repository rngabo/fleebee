import re
from datetime import date

MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def bank_code(bank_name: str) -> str:
    initials = "".join(word[0] for word in re.split(r"\W+", bank_name or "") if word and word.lower() not in {"of", "the"})
    return (initials or "BANK").upper()[:4]


def period_label(start: date | None, end: date | None, today: date | None = None) -> str:
    """e.g. 'may-oct'; years are added only when the period is not in the current year."""
    today = today or date.today()
    if not start and not end:
        return "undated"
    start = start or end
    end = end or start
    if start.year != end.year:
        return f"{MONTHS[start.month - 1]}{start.year % 100:02d}-{MONTHS[end.month - 1]}{end.year % 100:02d}"
    label = f"{MONTHS[start.month - 1]}-{MONTHS[end.month - 1]}"
    return label if start.year == today.year else f"{label}_{start.year}"


def base_statement_name(bank_name: str, account_number: str | None, start: date | None, end: date | None) -> str:
    digits = re.sub(r"\D", "", account_number or "")
    prefix = f"{bank_code(bank_name)}-{digits[-4:]}" if digits else bank_code(bank_name)
    return f"{prefix}_{period_label(start, end)}"


def unique_name(base: str, taken: set[str]) -> str:
    if base not in taken:
        return base
    counter = 2
    while f"{base}-{counter}" in taken:
        counter += 1
    return f"{base}-{counter}"


def alias_key(name: str) -> str:
    """Order-, case- and accent-insensitive key for a person's name ("Fabien NYANDWI" == "Nyandwi Fabien")."""
    import unicodedata

    text = unicodedata.normalize("NFD", name or "").lower()
    text = "".join(char for char in text if not unicodedata.combining(char))
    return " ".join(sorted(re.sub(r"[^a-z0-9]+", " ", text).split()))
