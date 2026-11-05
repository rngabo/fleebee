const fs = require("node:fs");
const path = require("node:path");
const { env } = require("../config/env");
const { finishUpload, listBankStatements, requestService } = require("./bank-statement-service");

// Statements the Gmail downloader saved. Its state file says what arrived (subject, time, attachment name); the PDFs sit
// in <inbox>/YYYY-MM/bk-statement_<date>_<hash12>.pdf. Nothing here touches Gmail.
const HASH = /^[0-9a-f]{64}$/;
const SAFE_FILE = /^\d{4}-\d{2}\/bk-statement_\d{4}-\d{2}-\d{2}_[0-9a-f]{12}\.pdf$/;

const enabled = () => Boolean(env.BANK_EMAIL_STATE_FILE && env.BANK_EMAIL_INBOX_DIR);

function readState() {
  try {
    return JSON.parse(fs.readFileSync(env.BANK_EMAIL_STATE_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// "…FROM 2026-11-02 TO 2026-11-05" or "…FROM 02/11/2026 TO 05/11/2026" -> ISO dates
function periodFromSubject(subject) {
  const dates = [...String(subject || "").matchAll(/(\d{4})-(\d{2})-(\d{2})|(\d{2})\/(\d{2})\/(\d{4})/g)]
    .map((m) => (m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[5]}-${m[4]}`));
  return { period_start: dates[0] || null, period_end: dates[1] || dates[0] || null };
}

// The PDF's location inside the inbox folder, rebuilt from its last two path parts (the state file holds the home
// computer's absolute path, which differs inside a container) and checked against a strict pattern.
function pdfPath(entry) {
  const parts = String(entry.file || "").split(/[\\/]/).slice(-2);
  const relative = parts.join("/");
  if (!SAFE_FILE.test(relative)) return null;
  const full = path.join(env.BANK_EMAIL_INBOX_DIR, relative);
  return full.startsWith(path.resolve(env.BANK_EMAIL_INBOX_DIR) + path.sep) ? full : null;
}

async function openedStatements() {
  const response = await listBankStatements();
  if (response.statusCode >= 400) return null;
  return new Map((response.body?.items || []).filter((item) => item.file_hash).map((item) => [item.file_hash, item]));
}

async function listEmailStatements() {
  if (!enabled()) return { statusCode: 200, body: { enabled: false, items: [] } };
  const state = readState();
  const opened = await openedStatements();
  const items = Object.entries(state?.hashes || {})
    .filter(([hash, entry]) => HASH.test(hash) && pdfPath(entry))
    .map(([hash, entry]) => {
      const statement = opened?.get(hash);
      return {
        id: hash,
        name: entry.originalName || path.basename(entry.file),
        subject: entry.subject || "",
        received_at: entry.receivedAt || entry.savedAt || null,
        bytes: entry.bytes || null,
        ...periodFromSubject(entry.subject),
        status: statement ? "opened" : "new",
        statement_id: statement?.id || null,
        statement_name: statement?.display_name || null
      };
    })
    .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
  return { statusCode: 200, body: { enabled: true, items, new_count: items.filter((item) => item.status === "new").length } };
}

// Hands the saved PDF to the bank service exactly like a manual upload, tagged as coming from email.
async function openEmailStatement(id) {
  if (!enabled()) return { statusCode: 503, body: { error: "Statements from email are not set up on this server." } };
  if (!HASH.test(String(id))) return { statusCode: 400, body: { error: "Unknown statement." } };
  const entry = readState()?.hashes?.[id];
  const file = entry && pdfPath(entry);
  if (!file || !fs.existsSync(file)) return { statusCode: 404, body: { error: "This emailed statement is no longer available." } };

  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type: "application/pdf" }), entry.originalName || path.basename(file));
  form.append("source", "email");
  if (entry.receivedAt) form.append("received_at", entry.receivedAt);
  const response = await finishUpload(await requestService("/api/v1/statements/upload", { method: "POST", body: form }));
  return response.statusCode < 400 && response.body ? { ...response, body: { ...response.body, from_email: true } } : response;
}

module.exports = { listEmailStatements, openEmailStatement, periodFromSubject };
