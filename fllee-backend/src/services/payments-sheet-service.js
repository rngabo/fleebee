const fs = require("node:fs");
const { createSign } = require("node:crypto");

const { env } = require("../config/env");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEET_NAME = "Payments";
const PAYMENT_METHOD = "BK agent";
const SYNC_NOTE = "Synced from app";
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

async function sheetsRequest(path, options = {}) {
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
  const payload = await response.json().catch(() => ({}));
  if (response.status === 403) {
    throw new SheetError("The Payments sheet is not shared with edit access for the Fleebee service account.", 403);
  }
  if (!response.ok) throw new SheetError(payload.error?.message || `Google Sheets returned HTTP ${response.status}.`);
  return payload;
}

async function readPaymentRows() {
  const range = encodeURIComponent(`${SHEET_NAME}!A1:F10000`);
  const payload = await sheetsRequest(`/values/${range}?valueRenderOption=UNFORMATTED_VALUE`);
  return payload.values || [];
}

async function sheetIdFor(title) {
  const payload = await sheetsRequest("?fields=sheets.properties(sheetId,title)");
  const sheet = (payload.sheets || []).find((item) => item.properties?.title === title);
  if (!sheet) throw new SheetError(`The "${title}" tab was not found in the Google Sheet.`);
  return sheet.properties.sheetId;
}

async function appendPayment({ date, name, amount }) {
  const rows = await readPaymentRows();
  const key = nameKey(name);
  const existing = rows.find((row) => cellDateIso(row[0]) === date && nameKey(row[1]) === key);
  if (existing) {
    return { status: "duplicate", message: "Already in the Google Sheet for this date and name." };
  }

  // The API trims trailing empty rows, so rows.length is the last used row; write strictly below it.
  const lastRow = rows.length;
  const targetRow = lastRow + 1;
  await sheetsRequest(
    `/values/${encodeURIComponent(`${SHEET_NAME}!A${targetRow}:E${targetRow}`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: [[date, name, amount, PAYMENT_METHOD, SYNC_NOTE]] }) }
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
  return { status: "synced", row: targetRow, message: `Added to the Google Sheet at row ${targetRow}.` };
}

function syncPayment(payment) {
  const run = writeQueue.then(() => appendPayment(payment));
  writeQueue = run.catch(() => {});
  return run;
}

module.exports = { SheetError, isConfigured, nameKey, syncPayment };
