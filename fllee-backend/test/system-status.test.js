const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { env } = require("../src/config/env");
const { gmailCard } = require("../src/services/system-status-service");

function withStatus(status) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gmail-status-"));
  env.BANK_EMAIL_STATE_FILE = path.join(dir, "state.json");
  env.BANK_EMAIL_INBOX_DIR = "";
  if (status) fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status));
}
const fresh = (extra = {}) => ({
  checkedAt: new Date(Date.now() - 90 * 1000).toISOString(), outcome: "ok", auth: "ok", authorizedAt: "2026-11-05T14:08:27.000Z",
  label: "Fleebee/BankStatements", sender: "bkebanking@bk.rw", since: "2026-11-05T14:08:27.834Z",
  summary: { saved: 1, duplicates: 0, rejected: 0, errors: 0, labelFound: true }, totals: { pdfsSaved: 2, emailsRejected: 0 }, ...extra
});
const value = (card, label) => card.details.find((item) => item.label === label)?.value;

test("a recent successful check shows as running, with access, last result and totals", async () => {
  withStatus(fresh());
  const card = await gmailCard();
  assert.equal(card.state, "ok");
  assert.equal(card.headline, "Checking mail");
  assert.match(value(card, "Gmail access"), /active, read-only \(granted 2026-11-05\)/);
  assert.equal(value(card, "Last result"), "1 saved, 0 duplicate, 0 rejected, 0 errors");
  assert.equal(value(card, "PDFs saved so far"), "2");
});

test("a lost authorization is reported as down with the reason", async () => {
  withStatus(fresh({ outcome: "error", auth: "needs-authorization", message: "Google token endpoint refused the request: invalid_grant. Run \"npm run authorize\" again." }));
  const card = await gmailCard();
  assert.equal(card.state, "down");
  assert.equal(card.headline, "Authorization needed");
  assert.match(value(card, "Problem"), /invalid_grant/);
});

test("when no check has run for several intervals the timer is considered stopped", async () => {
  withStatus(fresh({ checkedAt: new Date(Date.now() - 40 * 60000).toISOString() }));
  const card = await gmailCard();
  assert.equal(card.state, "down");
  assert.match(card.headline, /timer stopped/);
});

test("no heartbeat yet is a warning, and an unconfigured server shows the card as off", async () => {
  withStatus(null);
  assert.equal((await gmailCard()).state, "warn");
  env.BANK_EMAIL_STATE_FILE = "";
  assert.equal((await gmailCard()).state, "off");
});

test("a pass where some emails failed is flagged as a warning", async () => {
  withStatus(fresh({ outcome: "partial", summary: { saved: 0, duplicates: 0, rejected: 0, errors: 2, labelFound: true } }));
  assert.equal((await gmailCard()).state, "warn");
});

test("every function the control center calls exists in the module it is imported from", () => {
  const { DEPENDENCIES } = require("../src/services/system-status-service");
  for (const [name, fn] of Object.entries(DEPENDENCIES)) assert.equal(typeof fn, "function", `${name} is not exported`);
});

function withBackup(status) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-status-"));
  env.BACKUP_STATUS_FILE = path.join(dir, "backup-status.json");
  if (status) fs.writeFileSync(env.BACKUP_STATUS_FILE, JSON.stringify(status));
}
const backupDone = (hoursAgo, extra = {}) => ({ finishedAt: new Date(Date.now() - hoursAgo * 3600000).toISOString(), ok: true, bytes: 3145728, copiesKept: 6, keepDays: 14, parts: ["fleebee.db", "bank-statements.db"], problems: [], ...extra });

test("a recent good backup is OK; an old one warns, then goes down; a failed one is down; unset is off", async () => {
  const { backupCard } = require("../src/services/system-status-service");
  withBackup(backupDone(5));
  const ok = await backupCard();
  assert.equal(ok.state, "ok");
  assert.equal(value(ok, "Copies kept"), "6 (14 days)");
  assert.equal(value(ok, "Size"), "3.0 MB");
  withBackup(backupDone(40));
  assert.equal((await backupCard()).state, "warn");
  withBackup(backupDone(80));
  assert.equal((await backupCard()).state, "down");
  withBackup(backupDone(2, { ok: false, problems: ["bank-statements.db: not found"] }));
  const failed = await backupCard();
  assert.equal(failed.state, "down");
  assert.match(value(failed, "Problem"), /not found/);
  withBackup(null);
  assert.equal((await backupCard()).state, "warn");
  env.BACKUP_STATUS_FILE = "";
  assert.equal((await backupCard()).state, "off");
});
