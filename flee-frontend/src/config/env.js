const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "../..");

loadEnvFile(path.join(ROOT_DIR, ".env"));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function stringFromEnv(name, fallback) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }

  return value.trim();
}

function numberFromEnv(name, fallback) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const env = {
  ROOT_DIR,
  PUBLIC_DIR: path.join(ROOT_DIR, "public"),
  PORT: numberFromEnv("PORT", 4173),
  API_BASE_URL: stringFromEnv("API_BASE_URL", "http://localhost:4100"),
  APP_NAME: stringFromEnv("APP_NAME", "Fleebee Dispatch Desk"),
  BOARD_REFRESH_INTERVAL_MS: numberFromEnv("BOARD_REFRESH_INTERVAL_MS", 5000),
  MESSAGE_RESULT_TIMEOUT_MS: numberFromEnv("MESSAGE_RESULT_TIMEOUT_MS", 18000),
  MESSAGE_RESULT_POLL_MS: numberFromEnv("MESSAGE_RESULT_POLL_MS", 1500)
};

module.exports = { env };
