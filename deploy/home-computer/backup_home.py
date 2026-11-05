#!/usr/bin/env python3
"""Daily backup of the Fleebee home computer (runs from a systemd user timer).

Writes ~/fleebee/backups/daily/<YYYY-MM-DD>/ (folder mode 700, files mode 600):
  fleebee.db, bank-statements.db   consistent copies made with SQLite's backup API (safe while the apps run)
  gmail-state.json                 the downloader's records (what was handled, hashes); NOT the Gmail token
  statements-inbox.tgz             the PDFs fetched from Gmail
  config.tgz                       the .env files (secrets stay inside this private folder)
Old days beyond the retention are removed. Finishes by writing backups/backup-status.json for the control center.
Backups on the same disk protect against mistakes and corruption, not against losing the computer: copy them off
the machine too (see DEPLOYMENT.md).
"""
import json
import os
import shutil
import sqlite3
import sys
import tarfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

RETENTION_DAYS = 14


def private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    path.chmod(0o700)


def copy_sqlite(source: Path, target: Path) -> None:
    """A consistent snapshot even if the app is writing at that moment."""
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    try:
        dst = sqlite3.connect(target)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    target.chmod(0o600)


def make_tar(target: Path, files: list[tuple[Path, str]]) -> int:
    count = 0
    with tarfile.open(target, "w:gz") as archive:
        for path, arcname in files:
            if path.is_file():
                archive.add(path, arcname=arcname)
                count += 1
    target.chmod(0o600)
    return count


def inbox_files(inbox: Path) -> list[tuple[Path, str]]:
    return [(path, str(path.relative_to(inbox.parent))) for path in sorted(inbox.rglob("*.pdf"))] if inbox.exists() else []


def prune(daily: Path, keep_days: int, today: date) -> list[str]:
    removed = []
    if not daily.exists():
        return removed
    cutoff = today - timedelta(days=keep_days)
    for folder in sorted(daily.iterdir()):
        try:
            day = date.fromisoformat(folder.name)
        except ValueError:
            continue                                   # never touch anything that is not a dated backup folder
        if day < cutoff and folder.is_dir():
            shutil.rmtree(folder)
            removed.append(folder.name)
    return removed


def run(home: Path, today: date | None = None, keep_days: int = RETENTION_DAYS) -> dict:
    today = today or date.today()
    shared = home / "fleebee" / "shared"
    backups = home / "fleebee" / "backups"
    daily = backups / "daily"
    target = daily / today.isoformat()
    private_dir(backups)
    private_dir(daily)
    private_dir(target)

    done, problems = [], []

    def step(name: str, action) -> None:
        try:
            action()
            done.append(name)
        except Exception as error:                     # one failing part must not stop the others
            problems.append(f"{name}: {error}")

    for name in ("fleebee.db", "bank-statements.db"):
        source = shared / name
        if source.exists():
            step(name, lambda s=source, n=name: copy_sqlite(s, target / n))
        else:
            problems.append(f"{name}: not found")
    state = shared / "gmail" / "state.json"
    if state.exists():
        step("gmail-state.json", lambda: (shutil.copy2(state, target / "gmail-state.json"), (target / "gmail-state.json").chmod(0o600)))
    step("statements-inbox.tgz", lambda: make_tar(target / "statements-inbox.tgz", inbox_files(shared / "bank-statements" / "inbox")))
    step("config.tgz", lambda: make_tar(target / "config.tgz", [(path, path.name) for path in sorted({*shared.glob("*.env"), shared / ".env"})]))

    removed = prune(daily, keep_days, today)
    size = sum(path.stat().st_size for path in target.iterdir() if path.is_file())
    status = {
        "finishedAt": datetime.now(timezone.utc).isoformat(),
        "ok": not problems,
        "folder": str(target),
        "parts": done,
        "bytes": size,
        "copiesKept": len([f for f in daily.iterdir() if f.is_dir()]),
        "keepDays": keep_days,
        "removedOld": removed,
        "problems": problems,
    }
    status_file = backups / "backup-status.json"
    temp = status_file.with_suffix(".tmp")
    temp.write_text(json.dumps(status, indent=2) + "\n")
    temp.chmod(0o600)
    os.replace(temp, status_file)
    return status


if __name__ == "__main__":
    result = run(Path(os.environ.get("FLEEBEE_BACKUP_HOME", Path.home())))
    print(f"backup {'ok' if result['ok'] else 'WITH PROBLEMS'}: {len(result['parts'])} parts, {result['bytes']} bytes, {result['copiesKept']} copies kept")
    for problem in result["problems"]:
        print("  problem:", problem, file=sys.stderr)
    sys.exit(0 if result["ok"] else 1)
