const fs = require("node:fs");
const path = require("node:path");
const { ensureDir, readJson, sha256, writeFileAtomic } = require("./files");

const LOCK_STALE_MS = 30 * 60 * 1000;

function loadState(config) {
  const state = readJson(config.stateFile, null);
  return state && typeof state === "object"
    ? { since: state.since, messages: state.messages || {}, hashes: state.hashes || {} }
    : { since: null, messages: {}, hashes: {} };
}

const saveState = (config, state) => writeFileAtomic(config.stateFile, `${JSON.stringify(state, null, 2)}\n`);

// Only emails that arrive after this moment are ever considered; set once, then never moved back.
function ensureStart(config, state, now = Date.now()) {
  if (!state.since) { state.since = new Date(now).toISOString(); saveState(config, state); }
  return Date.parse(state.since);
}

// Stores the PDF as <dir>/YYYY-MM/bk-statement_<received>_<hash12>.pdf (the name never comes from the email).
function savePdf(config, { buffer, receivedMs }) {
  const hash = sha256(buffer);
  const received = new Date(receivedMs).toISOString();
  const folder = path.join(config.downloadDir, received.slice(0, 7));
  ensureDir(config.downloadDir);
  ensureDir(folder);
  const file = path.join(folder, `bk-statement_${received.slice(0, 10)}_${hash.slice(0, 12)}.pdf`);
  writeFileAtomic(file, buffer);
  if (sha256(fs.readFileSync(file)) !== hash) throw new Error(`Verification of ${file} failed after writing.`);
  return { file, hash };
}

// One run at a time (the timer could fire while a slow run is still going).
function acquireLock(config, now = Date.now()) {
  const lock = `${config.stateFile}.lock`;
  ensureDir(path.dirname(lock));
  try {
    fs.closeSync(fs.openSync(lock, "wx", 0o600));
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (now - fs.statSync(lock).mtimeMs < LOCK_STALE_MS) return null;
    fs.rmSync(lock, { force: true });
    fs.closeSync(fs.openSync(lock, "wx", 0o600));
  }
  return () => fs.rmSync(lock, { force: true });
}

// Heartbeat for the control center. Holds no secrets: only times, counts, and the authorization state.
function writeStatus(config, status) {
  const token = readJson(config.tokenFile, null) || {};
  writeFileAtomic(config.statusFile, `${JSON.stringify({
    checkedAt: new Date().toISOString(),
    label: config.label,
    sender: config.sender,
    authorizedAt: token.authorized_at || null,
    scope: token.scope || null,
    ...status
  }, null, 2)}\n`);
}

module.exports = { writeStatus, acquireLock, ensureStart, loadState, savePdf, saveState };
