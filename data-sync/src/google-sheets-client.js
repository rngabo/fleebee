const fs = require("node:fs");
const { createSign } = require("node:crypto");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function createServiceAccountAssertion(credentials, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600
  }));
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(credentials.private_key, "base64url")}`;
}

async function requestAccessToken({ serviceAccountFile, timeoutMs }) {
  const credentials = JSON.parse(fs.readFileSync(serviceAccountFile, "utf8"));
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google service-account JSON must contain client_email and private_key.");
  }

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: createServiceAccountAssertion(credentials)
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `Google OAuth returned HTTP ${response.status}.`);
  }
  return payload.access_token;
}

async function readAccountingWorkbook({
  spreadsheetId,
  serviceAccountFile,
  accessToken,
  timeoutMs = 60000
}) {
  const token = accessToken || await requestAccessToken({ serviceAccountFile, timeoutMs });
  const ranges = [
    "Setup!A8:W200",
    "Payments!A1:F5000",
    "Dashboard!A3:M500"
  ];
  const params = new URLSearchParams({
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });
  for (const range of ranges) params.append("ranges", range);

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `Google Sheets returned HTTP ${response.status}.`);
  }
  const valueRanges = payload.valueRanges || [];
  if (valueRanges.length !== ranges.length) {
    throw new Error("Google Sheets did not return Setup, Payments, and Dashboard ranges.");
  }

  return {
    setup: valueRanges[0].values || [],
    payments: valueRanges[1].values || [],
    dashboard: valueRanges[2].values || []
  };
}

module.exports = {
  createServiceAccountAssertion,
  readAccountingWorkbook,
  requestAccessToken
};
