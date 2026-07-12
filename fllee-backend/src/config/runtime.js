const path = require("node:path");
const dotenv = require("dotenv");

const ROOT_DIR = path.resolve(__dirname, "../..");

dotenv.config({
  path: path.join(ROOT_DIR, ".env"),
  quiet: true
});

function stringFromEnv(name, fallback) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }

  return value.trim();
}

function resolveDatabaseFile(databaseUrl) {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("DATABASE_URL must use the SQLite file: format.");
  }

  return path.resolve(ROOT_DIR, databaseUrl.slice("file:".length));
}

module.exports = {
  ROOT_DIR,
  stringFromEnv,
  resolveDatabaseFile
};
