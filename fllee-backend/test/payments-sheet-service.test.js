const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { generateKeyPairSync } = require("node:crypto");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sheet-test-"));
const keyFile = path.join(dir, "key.json");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(keyFile, JSON.stringify({
  client_email: "test@example.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" })
}));
process.env.PAYMENTS_SHEET_SERVICE_ACCOUNT_FILE = keyFile;
process.env.PAYMENTS_SHEET_ID = "sheet-id";

const { appendCheckNote, deleteSyncedPayment, syncPayment } = require("../src/services/payments-sheet-service");

// 46326 = 2026-10-31
const baseRows = () => [
  [],
  ["Payment date", "Name", "Amount paid (RWF)", "Payment method", "Reference/Notes", "Entered by"],
  [46326, "Manual Rider", 36000, "BK agent"],
  [46326, "App Rider", 36000, "BK agent", "Synced from app"],
  [46327, "Another Rider", 10000, "BK agent", "Synced from app"]
];

function installFetch(rows) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, method: options.method || "GET", body: options.body });
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (href.includes("oauth2.googleapis.com")) return json({ access_token: "t", expires_in: 3600 });
    if (href.includes("fields=sheets.properties")) return json({ sheets: [{ properties: { sheetId: 99, title: "Payments" } }] });
    if (href.includes(":batchUpdate")) return json({});
    if (href.includes("/values/Payments!A1%3AF10000") || href.includes("Payments!A1:F10000")) return json({ values: rows });
    const single = /Payments!A(\d+)%3AF\1|Payments!A(\d+):F\2/.exec(decodeURIComponent(href));
    if (single) return json({ values: [rows[Number(single[1] || single[2]) - 1]] });
    return json({});
  };
  return calls;
}

test("deletes only the exact synced row", async () => {
  const calls = installFetch(baseRows());
  const result = await deleteSyncedPayment({ date: "2026-10-31", name: "App Rider", amount: 36000, rowHint: 4 });
  assert.equal(result.status, "deleted");
  assert.equal(result.row, 4);
  const batch = calls.find((call) => call.href.includes(":batchUpdate"));
  assert.deepEqual(JSON.parse(batch.body).requests[0].deleteDimension.range, { sheetId: 99, dimension: "ROWS", startIndex: 3, endIndex: 4 });
});

test("never deletes a manually entered row with the same date, name and amount", async () => {
  const calls = installFetch(baseRows());
  const result = await deleteSyncedPayment({ date: "2026-10-31", name: "Manual Rider", amount: 36000 });
  assert.equal(result.status, "not-found");
  assert.equal(calls.some((call) => call.href.includes(":batchUpdate")), false);
});

test("refuses to delete when the row changed since it was found", async () => {
  const rows = baseRows();
  const calls = installFetch(rows);
  const original = global.fetch;
  global.fetch = async (url, options) => {
    if (decodeURIComponent(String(url)).includes("Payments!A4:F4")) {
      return { ok: true, status: 200, json: async () => ({ values: [[46326, "Someone Else", 1, "BK agent", ""]] }) };
    }
    return original(url, options);
  };
  await assert.rejects(() => deleteSyncedPayment({ date: "2026-10-31", name: "App Rider", amount: 36000, rowHint: 4 }), /changed/);
  assert.equal(calls.some((call) => call.href.includes(":batchUpdate")), false);
});

test("syncPayment skips duplicates and appends below the last row", async () => {
  const calls = installFetch(baseRows());
  const dup = await syncPayment({ date: "2026-10-31", name: "App Rider", amount: 5000 });
  assert.equal(dup.status, "duplicate");
  const added = await syncPayment({ date: "2026-11-02", name: "New Rider", amount: 5000 });
  assert.equal(added.status, "synced");
  assert.equal(added.row, 6);
  assert.ok(calls.some((call) => call.method === "PUT" && decodeURIComponent(call.href).includes("Payments!A6:E6")));
});

test("a payment made after its month records which month it is for, and can still be deleted", async () => {
  const calls = installFetch(baseRows());
  const added = await syncPayment({ date: "2026-11-15", name: "Late Rider", amount: 5000, forMonth: "2026-10" });
  assert.equal(added.status, "synced");
  assert.equal(added.note, "Synced from app · for 2026-10");
  const put = calls.find((call) => call.method === "PUT");
  assert.deepEqual(JSON.parse(put.body).values[0], ["2026-11-15", "Late Rider", 5000, "BK agent", "Synced from app · for 2026-10"]);

  const rows = [...baseRows(), [46341, "Late Rider", 5000, "BK agent", "Synced from app · for 2026-10"]];
  const deleteCalls = installFetch(rows);
  const removed = await deleteSyncedPayment({ date: "2026-11-15", name: "Late Rider", amount: 5000, rowHint: 6 });
  assert.equal(removed.status, "deleted");
  assert.ok(deleteCalls.some((call) => call.href.includes(":batchUpdate")));
});

test("a back-dated payment is written on the last day of its month, with the real date and a reference in the note", async () => {
  const calls = installFetch(baseRows());
  const added = await syncPayment({ date: "2026-10-31", paidOn: "2026-11-02", name: "Late Rider", amount: 36000, ref: "5fa2e4f7" });
  assert.equal(added.status, "synced");
  assert.equal(added.note, "Synced from app \u00b7 paid 2026-11-02 \u00b7 ref 5fa2e4f7");
  const put = calls.find((call) => call.method === "PUT");
  assert.deepEqual(JSON.parse(put.body).values[0], ["2026-10-31", "Late Rider", 36000, "BK agent", "Synced from app \u00b7 paid 2026-11-02 \u00b7 ref 5fa2e4f7"]);
});

test("the same bank entry is never synced twice, even if someone edited the date of its row", async () => {
  const rows = [...baseRows(), [46330, "Late Rider", 36000, "BK agent", "Synced from app \u00b7 paid 2026-11-02 \u00b7 ref 5fa2e4f7"]];   // date edited by hand
  installFetch(rows);
  const again = await syncPayment({ date: "2026-11-02", name: "Late Rider", amount: 36000, ref: "5fa2e4f7" });
  assert.equal(again.status, "duplicate");
  assert.match(again.message, /already in the Google Sheet/);
});

test("delete finds the row by its reference code even after its date was edited", async () => {
  const rows = [...baseRows(), [46330, "Late Rider", 36000, "BK agent", "Synced from app \u00b7 paid 2026-11-02 \u00b7 ref 5fa2e4f7"]];
  const calls = installFetch(rows);
  const removed = await deleteSyncedPayment({ date: "2026-10-31", name: "Late Rider", amount: 36000, ref: "5fa2e4f7" });
  assert.equal(removed.status, "deleted");
  assert.equal(removed.row, 6);
  assert.ok(calls.some((call) => call.href.includes(":batchUpdate")));
});

test("a reference code never matches a manually entered row", async () => {
  const rows = [...baseRows(), [46330, "Late Rider", 36000, "BK agent", "ref 5fa2e4f7 typed by hand"]];
  const calls = installFetch(rows);
  const removed = await deleteSyncedPayment({ date: "2026-10-31", name: "Late Rider", amount: 36000, ref: "5fa2e4f7" });
  assert.equal(removed.status, "not-found");
  assert.equal(calls.some((call) => call.href.includes(":batchUpdate")), false);
});

test("when Google says slow down (429) the write is retried and succeeds", async () => {
  process.env.SHEETS_RETRY_BASE_MS = "1";
  const calls = installFetch(baseRows());
  const inner = global.fetch;
  let throttled = 0;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("sheets.googleapis.com") && options.method === "PUT" && throttled < 2) {
      throttled += 1;
      return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { message: "Quota exceeded" } }) };
    }
    return inner(url, options);
  };
  const added = await syncPayment({ date: "2026-11-03", name: "Busy Rider", amount: 1000 });
  assert.equal(added.status, "synced");
  assert.equal(throttled, 2, "it waited and retried twice before Google accepted the write");
  assert.ok(calls.some((call) => call.method === "PUT"));
});

test("a persistent 429 gives a clear message instead of a crash", async () => {
  process.env.SHEETS_RETRY_BASE_MS = "1";
  installFetch(baseRows());
  const inner = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("sheets.googleapis.com") && options.method === "PUT") {
      return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) };
    }
    return inner(url, options);
  };
  await assert.rejects(() => syncPayment({ date: "2026-11-03", name: "Busy Rider 2", amount: 1000 }), /too many requests/);
});

test("a check comment is appended after an existing note, never replacing it", async () => {
  const rows = baseRows();
  rows[2][4] = "April debt";                                          // a hand-written note
  const calls = installFetch(rows);
  const status = await appendCheckNote({ row: 3, expect: { date: "2026-10-31", name: "Manual Rider", amount: 36000 }, text: "CHECK [S1]: no deposit", marker: "CHECK [S1]" });
  assert.equal(status, "written");
  const put = calls.find((call) => call.method === "PUT");
  assert.ok(decodeURIComponent(put.href).includes("Payments!E3"));
  assert.ok(decodeURIComponent(put.href).includes("valueInputOption=RAW"));
  assert.deepEqual(JSON.parse(put.body).values, [["April debt | CHECK [S1]: no deposit"]]);
});

test("an empty note simply becomes the comment, and the same statement never comments twice", async () => {
  const rows = baseRows();
  const calls = installFetch(rows);
  assert.equal(await appendCheckNote({ row: 3, expect: { date: "2026-10-31", name: "Manual Rider", amount: 36000 }, text: "CHECK [S1]: x", marker: "CHECK [S1]" }), "written");
  assert.deepEqual(JSON.parse(calls.find((call) => call.method === "PUT").body).values, [["CHECK [S1]: x"]]);

  rows[2][4] = "CHECK [S1]: x";
  const again = installFetch(rows);
  assert.equal(await appendCheckNote({ row: 3, expect: { date: "2026-10-31", name: "Manual Rider", amount: 36000 }, text: "CHECK [S1]: x", marker: "CHECK [S1]" }), "already");
  assert.equal(again.some((call) => call.method === "PUT"), false);
});

test("a row that changed since it was checked is not touched", async () => {
  const calls = installFetch(baseRows());
  const status = await appendCheckNote({ row: 3, expect: { date: "2026-10-31", name: "Manual Rider", amount: 99999 }, text: "CHECK [S1]: x", marker: "CHECK [S1]" });
  assert.equal(status, "changed");
  assert.equal(calls.some((call) => call.method === "PUT"), false);
});
