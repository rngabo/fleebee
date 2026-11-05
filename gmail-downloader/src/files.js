const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

// Writes through a private temp file and renames it, so readers never see half a file. Always owner-only (0600).
function writeFileAtomic(file, data) {
  ensureDir(path.dirname(file));
  const temp = path.join(path.dirname(file), `.tmp-${crypto.randomBytes(6).toString("hex")}`);
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error(`Cannot read ${file}: ${error.message}`);
  }
}

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

module.exports = { ensureDir, writeFileAtomic, readJson, sha256 };
