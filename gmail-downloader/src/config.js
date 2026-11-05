const os = require("node:os");
const path = require("node:path");

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function intFrom(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Everything is configured through environment variables; defaults match the home-computer layout (~/fleebee/shared).
function loadConfig(env = process.env) {
  const shared = path.join(env.FLEEBEE_SHARED_DIR || path.join(os.homedir(), "fleebee", "shared"));
  const gmailDir = path.join(shared, "gmail");
  return {
    scope: SCOPE,
    credentialsFile: env.GMAIL_CREDENTIALS_FILE || path.join(gmailDir, "credentials.json"),
    tokenFile: env.GMAIL_TOKEN_FILE || path.join(gmailDir, "token.json"),
    stateFile: env.GMAIL_STATE_FILE || path.join(gmailDir, "state.json"),
    // Heartbeat read by the Fleebee control center: when the last check ran and how authorization stands.
    statusFile: env.GMAIL_STATUS_FILE || path.join(path.dirname(env.GMAIL_STATE_FILE || path.join(gmailDir, "state.json")), "status.json"),
    downloadDir: env.GMAIL_DOWNLOAD_DIR || path.join(shared, "bank-statements", "inbox"),
    label: env.GMAIL_LABEL || "Fleebee/BankStatements",
    sender: (env.GMAIL_SENDER || "bkebanking@bk.rw").trim().toLowerCase(),
    subjectPrefix: env.GMAIL_SUBJECT_PREFIX || "BK INTERNET BANKING STATEMENT FROM",
    maxPdfBytes: intFrom(env.GMAIL_MAX_PDF_BYTES, 15 * 1024 * 1024),
    maxMessagesPerRun: intFrom(env.GMAIL_MAX_MESSAGES_PER_RUN, 50),
    // Requires the mail to be authenticated (DKIM/SPF pass) for the sender's domain, so a forged From is not enough.
    requireSenderAuth: String(env.GMAIL_REQUIRE_SENDER_AUTH ?? "true").toLowerCase() !== "false",
    apiBase: (env.GMAIL_API_BASE || "https://gmail.googleapis.com").replace(/\/$/, ""),
    tokenUrlOverride: env.GMAIL_TOKEN_URL || ""
  };
}

module.exports = { loadConfig, SCOPE };
