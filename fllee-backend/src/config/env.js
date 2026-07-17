const fs = require("node:fs");
const path = require("node:path");
const { ROOT_DIR, stringFromEnv, resolveDatabaseFile } = require("./runtime");

function numberFromEnv(name, fallback) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanFromEnv(name, fallback) {
  const value = process.env[name];
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off", ""].includes(normalized)) {
    return false;
  }

  return fallback;
}

function resolveDirectoryCandidates(name, candidates) {
  const checked = [];

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.trim() === "") {
      continue;
    }

    const resolved = path.isAbsolute(candidate)
      ? path.normalize(candidate)
      : path.resolve(ROOT_DIR, candidate);

    checked.push(resolved);

    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  throw new Error(`${name} must point to an existing directory. Checked: ${checked.join(", ")}`);
}

const PORT = numberFromEnv("PORT", 4100);
const DATABASE_URL = stringFromEnv("DATABASE_URL", "file:./fleebee.db");

const env = {
  ROOT_DIR,
  PORT,
  PUBLIC_APP_URL: stringFromEnv("PUBLIC_APP_URL", `http://localhost:${PORT}`),
  DASHBOARD_PUBLIC_DIR: resolveDirectoryCandidates("DASHBOARD_PUBLIC_DIR", [
    stringFromEnv("DASHBOARD_PUBLIC_DIR", ""),
    "public",
    "../flee-frontend/public"
  ]),
  DASHBOARD_API_BASE_URL: stringFromEnv("DASHBOARD_API_BASE_URL", ""),
  APP_NAME: stringFromEnv("APP_NAME", "Fleebee Dispatch Desk"),
  BOARD_REFRESH_INTERVAL_MS: numberFromEnv("BOARD_REFRESH_INTERVAL_MS", 5000),
  MESSAGE_RESULT_TIMEOUT_MS: numberFromEnv("MESSAGE_RESULT_TIMEOUT_MS", 18000),
  MESSAGE_RESULT_POLL_MS: numberFromEnv("MESSAGE_RESULT_POLL_MS", 1500),
  MESSAGE_PENDING_WINDOW_MS: numberFromEnv("MESSAGE_PENDING_WINDOW_MS", 2 * 60 * 1000),
  DATABASE_URL,
  DATABASE_FILE: resolveDatabaseFile(DATABASE_URL),
  CORS_ALLOW_ORIGIN: stringFromEnv("CORS_ALLOW_ORIGIN", "*"),
  JOB_STALE_MS: numberFromEnv("JOB_STALE_MS", 60 * 1000),
  SCHEDULE_POLL_MS: numberFromEnv("SCHEDULE_POLL_MS", 30 * 1000),
  PHONE_HEARTBEAT_STALE_MS: numberFromEnv("PHONE_HEARTBEAT_STALE_MS", 20 * 1000),
  DUPLICATE_WINDOW_MS: numberFromEnv("DUPLICATE_WINDOW_MS", 10 * 60 * 1000),
  SMS_SEND_PASSWORD: stringFromEnv("SMS_SEND_PASSWORD", "1234"),
  SMS_ADMIN_PASSWORD: stringFromEnv(
    "SMS_ADMIN_PASSWORD",
    stringFromEnv("SMS_SEND_PASSWORD", "1234")
  ),
  APP_LOGIN_PASSWORD: stringFromEnv(
    "APP_LOGIN_PASSWORD",
    stringFromEnv(
      "SMS_ADMIN_PASSWORD",
      stringFromEnv("SMS_SEND_PASSWORD", "1234")
    )
  ),
  APP_SESSION_SECRET: stringFromEnv(
    "APP_SESSION_SECRET",
    stringFromEnv(
      "APP_LOGIN_PASSWORD",
      stringFromEnv(
        "SMS_ADMIN_PASSWORD",
        stringFromEnv("SMS_SEND_PASSWORD", "1234")
      )
    )
  ),
  APP_SESSION_IDLE_TIMEOUT_MS: numberFromEnv(
    "APP_SESSION_IDLE_TIMEOUT_MS",
    15 * 60 * 1000
  ),
  APP_SESSION_COOKIE_NAME: stringFromEnv("APP_SESSION_COOKIE_NAME", "fleebee_session"),
  APP_SESSION_COOKIE_SECURE: booleanFromEnv("APP_SESSION_COOKIE_SECURE", false),
  PHONE_STATE_ID: stringFromEnv("PHONE_STATE_ID", "android-home-gateway"),
  SMS_GATEWAY_MODE: stringFromEnv("SMS_GATEWAY_MODE", "registered-bikers"),
  SMS_GATEWAY_TARGET_NUMBER: stringFromEnv("SMS_GATEWAY_TARGET_NUMBER", "0788690545"),
  SMS_GATEWAY_FIXED_LOCATION: stringFromEnv("SMS_GATEWAY_FIXED_LOCATION", "Home gateway"),
  SMS_GATEWAY_BATTERY_POLICY: stringFromEnv(
    "SMS_GATEWAY_BATTERY_POLICY",
    "Needs manual unrestricted setting on Samsung"
  ),
  SMS_GATEWAY_NETWORK_LABEL: stringFromEnv(
    "SMS_GATEWAY_NETWORK_LABEL",
    "Wi-Fi / mobile fallback"
  ),
  SMS_GATEWAY_DEVICE_ID: stringFromEnv("SMS_GATEWAY_DEVICE_ID", "android-home-gateway"),
  SEED_DEFAULT_BIKERS: booleanFromEnv("SEED_DEFAULT_BIKERS", false),
  SMS_BUNDLE_USSD_CODE: stringFromEnv("SMS_BUNDLE_USSD_CODE", "*131#"),
  SMS_BUNDLE_REFRESH_INTERVAL_MS: numberFromEnv(
    "SMS_BUNDLE_REFRESH_INTERVAL_MS",
    6 * 60 * 60 * 1000
  )
};

module.exports = { env };
