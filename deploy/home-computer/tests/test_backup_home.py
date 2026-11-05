import json
import sqlite3
import sys
import tarfile
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backup_home  # noqa: E402


def make_home(tmp: Path) -> Path:
    shared = tmp / "fleebee" / "shared"
    (shared / "gmail").mkdir(parents=True)
    (shared / "bank-statements" / "inbox" / "2026-11").mkdir(parents=True)
    for name in ("fleebee.db", "bank-statements.db"):
        connection = sqlite3.connect(shared / name)
        connection.execute("create table t (v text)")
        connection.execute("insert into t values (?)", (name,))
        connection.commit()
        connection.close()
    (shared / "gmail" / "state.json").write_text('{"hashes":{}}')
    (shared / "gmail" / "token.json").write_text("SECRET-TOKEN")
    (shared / "bank-statements" / "inbox" / "2026-11" / "a.pdf").write_bytes(b"%PDF-1.4 a")
    (shared / ".env").write_text("A=1\n")
    (shared / "bank-statement.env").write_text("B=2\n")
    return tmp


class BackupTests(unittest.TestCase):
    def test_everything_is_backed_up_privately_and_the_gmail_token_is_left_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = make_home(Path(tmp))
            status = backup_home.run(home, today=date(2026, 11, 5))
            self.assertTrue(status["ok"], status["problems"])
            folder = home / "fleebee" / "backups" / "daily" / "2026-11-05"
            self.assertEqual(sorted(path.name for path in folder.iterdir()), ["bank-statements.db", "config.tgz", "fleebee.db", "gmail-state.json", "statements-inbox.tgz"])
            self.assertEqual(sqlite3.connect(folder / "fleebee.db").execute("select v from t").fetchone()[0], "fleebee.db")
            with tarfile.open(folder / "statements-inbox.tgz") as archive:
                self.assertEqual(archive.getnames(), ["inbox/2026-11/a.pdf"])
            with tarfile.open(folder / "config.tgz") as archive:
                self.assertEqual(sorted(archive.getnames()), [".env", "bank-statement.env"])
            self.assertNotIn("SECRET-TOKEN", "".join(path.read_bytes().decode("latin1") for path in folder.iterdir()))
            self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
            for path in folder.iterdir():
                self.assertEqual(path.stat().st_mode & 0o777, 0o600, path.name)
            written = json.loads((home / "fleebee" / "backups" / "backup-status.json").read_text())
            self.assertTrue(written["ok"])
            self.assertEqual(written["copiesKept"], 1)

    def test_old_days_are_removed_but_nothing_else_is_touched(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = make_home(Path(tmp))
            daily = home / "fleebee" / "backups" / "daily"
            for name in ("2026-10-01", "2026-10-25", "keep-me"):
                (daily / name).mkdir(parents=True)
            manual = home / "fleebee" / "backups" / "fleebee-before-x.db"
            manual.write_bytes(b"x")
            status = backup_home.run(home, today=date(2026, 11, 5), keep_days=14)
            self.assertEqual(status["removedOld"], ["2026-10-01"])
            self.assertTrue((daily / "2026-10-25").exists())
            self.assertTrue((daily / "keep-me").exists())      # not a dated folder
            self.assertTrue(manual.exists())                   # manual backups are never pruned

    def test_a_missing_database_is_reported_and_the_rest_still_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = make_home(Path(tmp))
            (home / "fleebee" / "shared" / "bank-statements.db").unlink()
            status = backup_home.run(home, today=date(2026, 11, 5))
            self.assertFalse(status["ok"])
            self.assertIn("bank-statements.db: not found", status["problems"])
            self.assertIn("fleebee.db", status["parts"])


if __name__ == "__main__":
    unittest.main()
