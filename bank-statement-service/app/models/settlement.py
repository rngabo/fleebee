from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class SettledTransaction(Base):
    """Hash-only memory of an entry that was synced or skipped, so overlapping statements never resurface it."""

    __tablename__ = "settled_transactions"

    fingerprint: Mapped[str] = mapped_column(String(64), primary_key=True)
    outcome: Mapped[str] = mapped_column(String(16))
    settled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CompletedStatement(Base):
    """Tiny record of a fully processed file, kept only to refuse re-uploading it."""

    __tablename__ = "completed_statements"

    file_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(120), unique=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    period_start: Mapped[date | None] = mapped_column(Date)
    period_end: Mapped[date | None] = mapped_column(Date)
    entry_count: Mapped[int] = mapped_column(Integer, default=0)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
