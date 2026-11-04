const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(process.env.DATA_SYNC_ENV_FILE || path.resolve(__dirname, "../.env"));

function text(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function integer(name, fallback) {
  const parsed = Number(text(name));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const config = {
  fleebeeBaseUrl: text("FLEEBEE_BASE_URL", "http://127.0.0.1:4100").replace(/\/$/, ""),
  serviceToken: text("DATA_SYNC_SERVICE_TOKEN"),
  spreadsheetId: text(
    "GOOGLE_SPREADSHEET_ID",
    "1yK5CDKJL6xIXmnKTYmM8YP-XfKt2SGbq0an3LlAX1xE"
  ),
  serviceAccountFile: text("GOOGLE_SERVICE_ACCOUNT_FILE"),
  accessToken: text("GOOGLE_ACCESS_TOKEN"),
  trigger: text("DATA_SYNC_TRIGGER", "manual"),
  timeoutMs: integer("DATA_SYNC_HTTP_TIMEOUT_MS", 60000)
};

function validateConfig() {
  const missing = [];
  if (!config.serviceToken) missing.push("DATA_SYNC_SERVICE_TOKEN");
  if (!config.spreadsheetId) missing.push("GOOGLE_SPREADSHEET_ID");
  if (!config.accessToken && !config.serviceAccountFile) {
    missing.push("GOOGLE_SERVICE_ACCOUNT_FILE");
  }
  if (config.serviceAccountFile && !fs.existsSync(config.serviceAccountFile)) {
    throw new Error(`Google service-account file was not found: ${config.serviceAccountFile}`);
  }
  if (missing.length) {
    throw new Error(`Missing data-sync configuration: ${missing.join(", ")}`);
  }
}

module.exports = {
  config,
  loadEnvFile,
  validateConfig
};
