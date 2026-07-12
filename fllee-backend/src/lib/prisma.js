const { PrismaClient } = require("@prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

const { env } = require("../config/env");

const adapter = new PrismaBetterSqlite3({
  url: env.DATABASE_FILE
});

const prisma = new PrismaClient({ adapter });

module.exports = { prisma };
