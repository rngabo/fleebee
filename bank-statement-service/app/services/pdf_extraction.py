from datetime import datetime, timedelta, timezone
from pathlib import Path

import fitz
import pdfplumber


class PdfValidationError(ValueError):
    pass


def validate_pdf(path: Path) -> None:
    try:
        with path.open("rb") as handle:
            if handle.read(5) != b"%PDF-":
                raise PdfValidationError("Uploaded file is not a PDF")
        with pdfplumber.open(path) as pdf:
            if not pdf.pages:
                raise PdfValidationError("PDF has no pages")
            if getattr(pdf.doc, "is_encrypted", False):
                raise PdfValidationError("Encrypted PDFs are not supported")
    except PdfValidationError:
        raise
    except Exception as exc:
        raise PdfValidationError("PDF is corrupted or unreadable") from exc


def extract_text_fallback(path: Path) -> list[str]:
    document = fitz.open(path)
    try:
        return [page.get_text("text") for page in document]
    finally:
        document.close()


def delete_expired_statement_files(storage_dir: Path, retention_days: int) -> int:
    if retention_days <= 0 or not storage_dir.exists():
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    deleted = 0
    for path in storage_dir.glob("*.pdf"):
        modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        if modified < cutoff and path.is_file() and not path.is_symlink():
            path.unlink()
            deleted += 1
    return deleted

