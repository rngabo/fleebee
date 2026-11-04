const fs = require("node:fs");
const { createSign } = require("node:crypto");

const { env } = require("../config/env");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEET_NAME = "Payments";
const PAYMENT_METHOD = "BK agent";
const SYNC_NOTE = "Synced from app";

// The note says where the row came from, and carries what is needed to keep the link when someone edits the
// date by hand: "Synced from app \u00b7 paid 2026-11-02 \u00b7 ref 5fa2e4f7". "paid" is the real bank date when the
// row was back-dated; "ref" identifies the bank statement entry; "for YYYY-MM" is the optional month tag.
function appNote(options = {}) {
  const { forMonth, paidOn, ref } = typeof options === "string" ? { forMonth: options } : options;
  return [SYNC_NOTE, paidOn ? `paid ${paidOn}` : "", forMonth ? `for ${forMonth}` : "", ref ? `ref ${ref}` : ""]
    .filter(Boolean)
    .join(" \u00b7 ");
}

function refOf(note) {
  const match = /\bref\s+([0-9a-f]{6,36})\b/i.exec(String(note ?? ""));
  return match ? match[1].toLowerCase() : "";
}

function isAppNote(note) {
  return /^Synced from app\b/.test(String(note ?? "").trim());
}
const TIMEOUT_MS = 30000;

let cachedToken = null;
let writeQueue = Promise.resolve();

class SheetError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.statusCode = statusCode;
  }
}

function nameKey(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).sort().join(" ");
}

function serialToIso(serial) {
  return new Date(Math.round((Number(serial) - 25569) * 86400000)).toISOString().slice(0, 10);
}

function cellDateIso(cell) {
  if (typeof cell === "number") return serialToIso(cell);
  const text = String(cell ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

function isConfigured() {
  return Boolean(env.PAYMENTS_SHEET_ID && env.PAYMENTS_SHEET_SERVICE_ACCOUNT_FILE
    && fs.existsSync(env.PAYMENTS_SHEET_SERVICE_ACCOUNT_FILE));
}

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;
  const credentials = JSON.parse(fs.readFileSync(env.PAYMENTS_SHEET_SERVICE_ACCOUNT_FILE, "utf8"));
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: credentials.client_email, scope: SCOPE, aud: TOKEN_URL, iat: issuedAt, exp: issuedAt + 3600
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(credentials.private_key, "base64url");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new SheetError("Google sign-in for the Payments sheet failed.");
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Google limits writes per minute (a bulk sync can hit it). On "slow down" (429) or a brief outage (503) wait
// and try again a few times, honouring Retry-After when Google sends it.
async function sheetsRequest(path, options = {}) {
  const baseDelay = Number(process.env.SHEETS_RETRY_BASE_MS ?? 2000);
  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetch(`${API}/${encodeURIComponent(env.PAYMENTS_SHEET_ID)}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          "Content-Type": "application/json",
          ...(options.headers || {})
        },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (error) {
      if (error instanceof SheetError) throw error;
      throw new SheetError("Google Sheets is temporarily unreachable.", 503);
    }
    if ((response.status === 429 || response.status === 503) && attempt < 4) {
      const retryAfter = Number(response.headers?.get?.("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : baseDelay * 2 ** attempt);
      continue;
    }
    return parseSheetsResponse(response);
  }
}

async function parseSheetsResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (response.status === 403) {
    throw new SheetError("The Payments sheet is not shared with edit access for the Fleebee service account.", 403);
  }
  if (response.status === 429) throw new SheetError("Google Sheets is busy (too many requests). Wait a minute and try again.", 429);
  if (!response.ok) throw new SheetError(payload.error?.message || `Google Sheets returned HTTP ${response.status}.`);
  return payload;
}

async function readPaymentRows() {
  const range = encodeURIComponent(`${SHEET_NAME}!A1:F10000`);
  const payload = await sheetsRequest(`/values/${range}?valueRenderOption=UNFORMATTED_VALUE`);
  return payload.values || [];
}

const sheetIds = new Map();

// The tab id never changes, so look it up once (a bulk sync would otherwise ask for it on every row).
async function sheetIdFor(title) {
  if (sheetIds.has(title)) return sheetIds.get(title);
  const payload = await sheetsRequest("?fields=sheets.properties(sheetId,title)");
  const sheet = (payload.sheets || []).find((item) => item.properties?.title === title);
  if (!sheet) throw new SheetError(`The "${title}" tab was not found in the Google Sheet.`);
  sheetIds.set(title, sheet.properties.sheetId);
  return sheet.properties.sheetId;
}

async function appendPayment({ date, name, amount, forMonth, paidOn, ref, findExisting }) {
  const rows = await readPaymentRows();
  const key = nameKey(name);
  // The same bank entry was already synced (found by its reference code, whatever date the row now carries).
  if (ref && rows.some((row) => refOf(row[4]) === ref)) {
    return { status: "duplicate", sameEntry: true, message: "This bank entry is already in the Google Sheet." };
  }
  // Is this deposit already recorded? Looks at every row of the rider (back-dated ones included), one row per deposit.
  if (typeof findExisting === "function") {
    const list = rows
      .map((row, index) => ({
        row: index + 1,
        date: cellDateIso(row?.[0]),
        name: String(row?.[1] ?? "").trim(),
        amount: Number(row?.[2]),
        note: String(row?.[4] ?? "")
      }))
      .filter((item) => item.row >= 3 && item.date && item.name && Number.isFinite(item.amount));
    const found = findExisting(list);
    if (found) {
      return {
        status: "duplicate",
        existingRow: found.row.row,
        existingDate: found.row.date,
        sameEntry: found.kind === "app",
        message: found.kind === "app"
          ? "This bank entry is already in the Google Sheet."
          : `Already in the Google Sheet as row ${found.row.row} (${found.row.date}, ${Number(found.row.amount).toLocaleString("en-US")}). Nothing was added.`
      };
    }
  }
  const existing = rows.find((row) => cellDateIso(row[0]) === date && nameKey(row[1]) === key);
  if (existing) {
    return { status: "duplicate", message: "Already in the Google Sheet for this date and name." };
  }

  // The API trims trailing empty rows, so rows.length is the last used row; write strictly below it.
  const lastRow = rows.length;
  const targetRow = lastRow + 1;
  await sheetsRequest(
    `/values/${encodeURIComponent(`${SHEET_NAME}!A${targetRow}:E${targetRow}`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: [[date, name, amount, PAYMENT_METHOD, appNote({ forMonth, paidOn, ref })]] }) }
  );

  // Cosmetic: give the new row the same cell formats (date / #,##0) as the row above it.
  try {
    const sheetId = await sheetIdFor(SHEET_NAME);
    await sheetsRequest(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests: [{ copyPaste: {
        source: { sheetId, startRowIndex: lastRow - 1, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: 6 },
        destination: { sheetId, startRowIndex: lastRow, endRowIndex: lastRow + 1, startColumnIndex: 0, endColumnIndex: 6 },
        pasteType: "PASTE_FORMAT"
      } }] })
    });
  } catch (error) {
    // Formatting is best-effort; the payment itself is already recorded.
  }
  return { status: "synced", row: targetRow, paymentMethod: PAYMENT_METHOD, note: appNote({ forMonth, paidOn, ref }), message: `Added to the Google Sheet at row ${targetRow}.` };
}

// Deletes ONE row from the Payments tab, and only a row this app added (note "Synced from app"): found by its
// reference code when it has one (so a hand-edited date does not matter), otherwise by exact date, name and
// amount. Anything else is never touched.
async function removeSyncedPayment({ date, name, amount, rowHint, ref }) {
  const matches = (row) => isAppNote(row?.[4]) && (ref
    ? refOf(row?.[4]) === ref
    : cellDateIso(row?.[0]) === date && nameKey(row?.[1]) === nameKey(name) && Number(row?.[2]) === Number(amount));

  const rows = await readPaymentRows();
  const candidates = rows.map((row, index) => (matches(row) ? index + 1 : 0)).filter((row) => row >= 3);
  if (!candidates.length) {
    return { status: "not-found", message: "It was already gone from the Google Sheet, so only the app record was removed. Its bank statement entry is pending again." };
  }
  const sheetRow = candidates.includes(rowHint) ? rowHint : candidates[0];

  // Re-read just this row right before deleting, in case the sheet changed in between.
  const range = encodeURIComponent(`${SHEET_NAME}!A${sheetRow}:F${sheetRow}`);
  const fresh = (await sheetsRequest(`/values/${range}?valueRenderOption=UNFORMATTED_VALUE`)).values?.[0];
  if (!matches(fresh)) {
    throw new SheetError("The Google Sheet changed while deleting; nothing was removed. Please try again.", 409);
  }

  const sheetId = await sheetIdFor(SHEET_NAME);
  await sheetsRequest(":batchUpdate", {
    method: "POST",
    body: JSON.stringify({ requests: [{ deleteDimension: {
      range: { sheetId, dimension: "ROWS", startIndex: sheetRow - 1, endIndex: sheetRow }
    } }] })
  });
  return { status: "deleted", row: sheetRow, message: `Deleted row ${sheetRow} from the Google Sheet. Its bank statement entry is pending again.` };
}

// Link to the Payments tab, so a flagged row can be opened and fixed in the sheet itself.
async function paymentsSheetUrl() {
  try {
    return `https://docs.google.com/spreadsheets/d/${env.PAYMENTS_SHEET_ID}/edit#gid=${await sheetIdFor(SHEET_NAME)}`;
  } catch (error) {
    return `https://docs.google.com/spreadsheets/d/${env.PAYMENTS_SHEET_ID}/edit`;
  }
}

// Every payment row with its sheet row number, for comparing against a bank statement.
async function readPaymentsForAudit() {
  const rows = await readPaymentRows();
  return rows
    .map((row, index) => ({
      row: index + 1,
      date: cellDateIso(row?.[0]),
      name: String(row?.[1] ?? "").trim(),
      amount: Number(row?.[2]),
      method: String(row?.[3] ?? ""),
      note: String(row?.[4] ?? "")
    }))
    .filter((item) => item.row >= 3 && item.date && item.name && Number.isFinite(item.amount));
}

// Appends a review comment to the Reference/Notes cell of ONE payment row. The existing note is never replaced:
// the comment is added after it (" | "), and only if the row still is the one that was checked and does not
// already carry a comment from the same statement. Nothing else in the row is touched.
async function appendCheckNote({ row, expect, text, marker }) {
  const range = encodeURIComponent(`${SHEET_NAME}!A${row}:F${row}`);
  const current = (await sheetsRequest(`/values/${range}?valueRenderOption=UNFORMATTED_VALUE`)).values?.[0] || [];
  const same = cellDateIso(current[0]) === expect.date
    && nameKey(current[1]) === nameKey(expect.name)
    && Number(current[2]) === Number(expect.amount);
  if (!same) return "changed";
  const existing = String(current[4] ?? "");
  if (existing.includes(marker)) return "already";
  const next = existing ? `${existing} | ${text}` : text;
  await sheetsRequest(
    `/values/${encodeURIComponent(`${SHEET_NAME}!E${row}`)}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [[next]] }) }
  );
  return "written";
}

function exclusive(task) {
  const run = writeQueue.then(task);
  writeQueue = run.catch(() => {});
  return run;
}

function deleteSyncedPayment(payment) {
  const run = writeQueue.then(() => removeSyncedPayment(payment));
  writeQueue = run.catch(() => {});
  return run;
}

function syncPayment(payment) {
  const run = writeQueue.then(() => appendPayment(payment));
  writeQueue = run.catch(() => {});
  return run;
}

module.exports = { SYNC_NOTE, SheetError, appNote, appendCheckNote, deleteSyncedPayment, exclusive, isAppNote, isConfigured, nameKey, paymentsSheetUrl, readPaymentsForAudit, refOf, syncPayment };
