const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { env } = require("../src/config/env");
const { listEmailStatements, openEmailStatement, periodFromSubject } = require("../src/services/email-statements-service");

const HASH_NEW = "a".repeat(64);
const HASH_OPENED = "b".repeat(64);
const HASH_EVIL = "c".repeat(64);

function setup({ bankStatements = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "email-inbox-"));
  fs.mkdirSync(path.join(dir, "2026-11"));
  const files = { new: "bk-statement_2026-11-05_aaaaaaaaaaaa.pdf", opened: "bk-statement_2026-11-04_bbbbbbbbbbbb.pdf" };
  for (const name of Object.values(files)) fs.writeFileSync(path.join(dir, "2026-11", name), "%PDF-1.4 test");
  const stateFile = path.join(dir, "state.json");
  fs.writeFileSync(stateFile, JSON.stringify({ hashes: {
    [HASH_NEW]: { file: `/home/richard/fleebee/shared/bank-statements/inbox/2026-11/${files.new}`, bytes: 34460, subject: "BK INTERNET BANKING STATEMENT FROM 2026-11-05 TO 2026-11-05", receivedAt: "2026-11-05T14:10:26.000Z", originalName: "Statement_24025.pdf" },
    [HASH_OPENED]: { file: `/x/2026-11/${files.opened}`, bytes: 100, subject: "BK INTERNET BANKING STATEMENT FROM 04/11/2026 TO 04/11/2026", receivedAt: "2026-11-04T10:00:00.000Z", originalName: "Statement_old.pdf" },
    ["e".repeat(64)]: { file: `/x/2026-10/bk-statement_2026-10-01_eeeeeeeeeeee.pdf`, subject: "expired", receivedAt: "2026-10-01T00:00:00.000Z", removedAt: "2026-11-05T00:00:00.000Z" },
    [HASH_EVIL]: { file: "/x/../../etc/passwd", subject: "x", receivedAt: "2026-11-06T00:00:00.000Z" }
  } }));
  Object.assign(env, { BANK_EMAIL_STATE_FILE: stateFile, BANK_EMAIL_INBOX_DIR: dir, BANK_STATEMENT_SERVICE_URL: "http://bank.test", BANK_STATEMENT_SERVICE_API_KEY: "k".repeat(20) });
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (String(url).includes("/api/v1/statements?page=1")) return json(200, { items: bankStatements });
    if (String(url).endsWith("/api/v1/statements/upload")) return json(201, { statement_id: "s-new" });
    if (String(url).endsWith("/api/v1/statements/s-new")) return json(200, { id: "s-new", display_name: "BK-3215_nov-nov", source: "email", transactions: [] });
    return json(404, {});
  };
  return { calls, dir };
}

test("periods are read from either subject date style", () => {
  assert.deepEqual(periodFromSubject("BK INTERNET BANKING STATEMENT FROM 2026-11-02 TO 2026-11-05"), { period_start: "2026-11-02", period_end: "2026-11-05" });
  assert.deepEqual(periodFromSubject("BK INTERNET BANKING STATEMENT FROM 02/11/2026 TO 05/11/2026"), { period_start: "2026-11-02", period_end: "2026-11-05" });
  assert.deepEqual(periodFromSubject("nothing here"), { period_start: null, period_end: null });
});

test("arrived statements are listed newest first, with their name, subject, time and whether they were opened", async () => {
  setup({ bankStatements: [{ id: "s-1", display_name: "BK-3215_nov-nov", file_hash: HASH_OPENED }] });
  const { body } = await listEmailStatements();
  assert.equal(body.enabled, true);
  assert.equal(body.new_count, 1);
  assert.deepEqual(body.items.map((item) => [item.name, item.status, item.received_at]), [
    ["Statement_24025.pdf", "new", "2026-11-05T14:10:26.000Z"],
    ["Statement_old.pdf", "opened", "2026-11-04T10:00:00.000Z"]
  ]);
  assert.equal(body.items[1].statement_id, "s-1");
  assert.equal(body.items[0].period_start, "2026-11-05");
  assert.equal(body.items.some((item) => item.id === HASH_EVIL), false);       // a path outside the inbox is never listed
});

test("opening sends the saved PDF to the bank service tagged as email and returns the statement", async () => {
  const { calls } = setup();
  const { statusCode, body } = await openEmailStatement(HASH_NEW);
  assert.equal(statusCode, 200);
  assert.equal(body.from_email, true);
  const upload = calls.find((call) => call.url.endsWith("/upload"));
  assert.equal(upload.options.method, "POST");
  assert.equal(upload.options.body.get("source"), "email");
  assert.equal(upload.options.body.get("received_at"), "2026-11-05T14:10:26.000Z");
  assert.equal(upload.options.body.get("file").name, "Statement_24025.pdf");
  assert.equal(await upload.options.body.get("file").text(), "%PDF-1.4 test");
});

test("opening refuses unknown ids and paths outside the inbox", async () => {
  setup();
  assert.equal((await openEmailStatement("not-a-hash")).statusCode, 400);
  assert.equal((await openEmailStatement("d".repeat(64))).statusCode, 404);
  assert.equal((await openEmailStatement(HASH_EVIL)).statusCode, 404);
});

test("opening a statement the bank service already has shows the saved one", async () => {
  setup();
  const fetchBefore = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).endsWith("/upload")) return { ok: false, status: 409, json: async () => ({ detail: { message: "dup", statement_id: "s-old" } }) };
    if (String(url).endsWith("/api/v1/statements/s-old")) return { ok: true, status: 200, json: async () => ({ id: "s-old", transactions: [] }) };
    return fetchBefore(url, options);
  };
  const { statusCode, body } = await openEmailStatement(HASH_NEW);
  assert.equal(statusCode, 200);
  assert.equal(body.already_processed, true);
});

test("without the email settings the feature reports itself off", async () => {
  Object.assign(env, { BANK_EMAIL_STATE_FILE: "", BANK_EMAIL_INBOX_DIR: "" });
  assert.deepEqual((await listEmailStatements()).body, { enabled: false, items: [] });
  assert.equal((await openEmailStatement(HASH_NEW)).statusCode, 503);
});
