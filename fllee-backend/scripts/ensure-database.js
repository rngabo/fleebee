const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { ROOT_DIR, resolveDatabaseFile, stringFromEnv } = require("../src/config/runtime");

const DATABASE_URL = stringFromEnv("DATABASE_URL", "file:./fleebee.db");
const DATABASE_FILE = resolveDatabaseFile(DATABASE_URL);

function ensureDatabaseFile() {
  fs.mkdirSync(path.dirname(DATABASE_FILE), { recursive: true });

  if (!fs.existsSync(DATABASE_FILE)) {
    fs.closeSync(fs.openSync(DATABASE_FILE, "w"));
    console.log(`Created SQLite database file at ${DATABASE_FILE}`);
  } else {
    console.log(`Using SQLite database file at ${DATABASE_FILE}`);
  }
}

function runPrismaCommand(args) {
  const prismaBin = path.join(
    ROOT_DIR,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prisma.cmd" : "prisma"
  );

  const result = spawnSync(prismaBin, args, {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const error = new Error(`prisma ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

function syncDatabaseSchema() {
  runPrismaCommand(["db", "push"]);
  runPrismaCommand(["generate"]);
}

function ensureDatabaseReady() {
  ensureDatabaseFile();
  syncDatabaseSchema();
}

if (require.main === module) {
  try {
    ensureDatabaseReady();
  } catch (error) {
    console.error(`Could not prepare SQLite database at ${DATABASE_FILE}:`, error.message);
    process.exit(error.exitCode || 1);
  }
}

module.exports = {
  DATABASE_FILE,
  DATABASE_URL,
  ensureDatabaseFile,
  ensureDatabaseReady,
  syncDatabaseSchema
};
