const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({
  path: process.env.FINE_MONITOR_ENV_FILE || path.resolve(__dirname, "../.env"),
  quiet: true
});

function text(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function integer(name, fallback) {
  const parsed = Number(text(name));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function findBrowserExecutable() {
  const configured = text("CHROMIUM_EXECUTABLE_PATH");
  const candidates = [
    configured,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium"
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

const config = {
  fleebeeBaseUrl: text("FLEEBEE_BASE_URL", "http://127.0.0.1:4100").replace(/\/$/, ""),
  serviceToken: text("FINE_MONITOR_SERVICE_TOKEN"),
  taxpayerNumber: text("IREMBO_TIN"),
  plateNumber: text("FINE_MONITOR_PLATE").toUpperCase().replace(/\s+/g, ""),
  trigger: text("FINE_MONITOR_TRIGGER", "manual"),
  targetUrl: text(
    "IREMBO_FINE_URL",
    "https://irembo.gov.rw/user/citizen/service/rnp/traffic_fines"
  ),
  browserExecutable: findBrowserExecutable(),
  timeoutMs: integer("FINE_CHECK_PAGE_TIMEOUT_MS", 60000),
  retryLimit: Math.min(integer("FINE_CHECK_RETRY_LIMIT", 2), 3),
  delayMinMs: integer("FINE_CHECK_DELAY_MIN_MS", 3000),
  delayMaxMs: integer("FINE_CHECK_DELAY_MAX_MS", 7000),
  artifactDirectory: text("FINE_CHECK_ARTIFACT_DIR")
};

function validateConfig() {
  const missing = [];
  if (!config.serviceToken) missing.push("FINE_MONITOR_SERVICE_TOKEN");
  if (!config.taxpayerNumber) missing.push("IREMBO_TIN");
  if (missing.length) {
    throw new Error(`Missing fine-monitor configuration: ${missing.join(", ")}`);
  }
}

module.exports = {
  config,
  validateConfig
};
