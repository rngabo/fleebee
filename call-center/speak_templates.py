"""Synthesize Fleebee SMS templates as Kinyarwanda speech.

This is what a call will actually say: the operator's existing SMS templates,
with placeholders filled per biker, spoken by facebook/mms-tts-kin.

Template sources, in order:
  1. The Fleebee SQLite database (real, possibly operator-edited templates).
  2. templates.snapshot.json — a snapshot of the real production templates
     copied from the dashboard (keep it updated when the operator edits them).
  3. DEFAULT_SMS_TEMPLATES from fllee-backend/src/data/workflow-defaults.js
     (via node) as a last resort.

Usage:
    .venv/bin/python speak_templates.py                  # all active templates
    .venv/bin/python speak_templates.py --list           # list, don't synthesize
    .venv/bin/python speak_templates.py --stage PREPARATION
    .venv/bin/python speak_templates.py --first-name Eric --plate "RAC 123 B"

Output WAVs go to samples/templates/<stage>-<category>-<urgency>.wav
"""

import argparse
import json
import re
import sqlite3
import subprocess
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "fllee-backend"
DB_PATH = BACKEND_DIR / "fleebee.db"
DEFAULTS_JS = BACKEND_DIR / "src" / "data" / "workflow-defaults.js"
SNAPSHOT_JSON = Path(__file__).resolve().parent / "templates.snapshot.json"
OUT_DIR = Path(__file__).parent / "samples" / "templates"

# Sample values for {{placeholders}} — override per biker via CLI flags.
DEFAULT_CONTEXT = {
    "firstName": "Eric",
    "plate": "RAC 123 B",
    "fineAmount": "5000",
    "fineReason": "gutinda gutanga raporo",
    "nextPaymentDate": "2026-08-01",
    "batchName": "Kimironko",
}


def load_templates_from_db():
    if not DB_PATH.exists():
        return []
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        rows = db.execute(
            "SELECT stage, category, urgency, title, body FROM SmsTemplate "
            "WHERE isActive = 1 ORDER BY stage, category, urgency"
        ).fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        db.close()
    return [dict(r) for r in rows]


def load_templates_from_snapshot():
    if not SNAPSHOT_JSON.exists():
        return []
    data = json.loads(SNAPSHOT_JSON.read_text())
    return [t for t in data.get("templates", []) if t.get("isActive", True)]


def load_templates_from_defaults():
    out = subprocess.check_output([
        "node", "-e",
        "console.log(JSON.stringify("
        f"require({json.dumps(str(DEFAULTS_JS))}).DEFAULT_SMS_TEMPLATES))",
    ])
    return [t for t in json.loads(out) if t.get("isActive", True)]


def load_templates():
    templates = load_templates_from_db()
    if templates:
        print(f"Loaded {len(templates)} active templates from {DB_PATH}")
        return templates
    templates = load_templates_from_snapshot()
    if templates:
        print(f"Database empty — loaded {len(templates)} production templates "
              f"from {SNAPSHOT_JSON.name}")
        return templates
    templates = load_templates_from_defaults()
    print(f"Database and snapshot empty — loaded {len(templates)} default "
          f"templates from workflow-defaults.js")
    return templates


def render_body(body, context):
    # Mirrors renderTemplateBody() in fllee-backend/src/services/workflow-support.js
    rendered = re.sub(
        r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}",
        lambda m: str(context.get(m.group(1), "")).strip(),
        str(body or ""),
    )
    return re.sub(r"[ \t]+\n", "\n", rendered).strip()


def slug(template):
    return "-".join(
        str(template[k]).lower().replace(" ", "_")
        for k in ("stage", "category", "urgency")
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="list templates only")
    parser.add_argument("--stage", help="filter by workflow stage")
    parser.add_argument("--category", help="filter by category")
    parser.add_argument("--urgency", help="filter by urgency")
    for key in DEFAULT_CONTEXT:
        flag = "--" + re.sub(r"([A-Z])", r"-\1", key).lower()
        parser.add_argument(flag, dest=key, default=DEFAULT_CONTEXT[key])
    args = parser.parse_args()

    context = {k: getattr(args, k) for k in DEFAULT_CONTEXT}
    templates = load_templates()
    for field in ("stage", "category", "urgency"):
        value = getattr(args, field)
        if value:
            templates = [t for t in templates
                         if str(t[field]).lower() == value.lower()]
    if not templates:
        print("No templates matched.")
        return

    if args.list:
        for t in templates:
            print(f"\n[{slug(t)}] {t['title']}\n  {render_body(t['body'], context)}")
        return

    # Import lazily so --list works without loading the model.
    from synthesize import load_model, synthesize

    model, tokenizer = load_model()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    for t in templates:
        text = render_body(t["body"], context)
        synthesize(model, tokenizer, text, str(OUT_DIR / f"{slug(t)}.wav"))
    print(f"\n{len(templates)} templates synthesized in {time.time() - t0:.1f}s "
          f"-> {OUT_DIR}")


if __name__ == "__main__":
    main()
