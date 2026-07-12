const { env } = require("./src/config/env");
const { ensureDatabaseReady } = require("./scripts/ensure-database");

let prisma;

async function main() {
  ensureDatabaseReady();

  ({ prisma } = require("./src/lib/prisma"));
  const { startServer } = require("./src/server");
  await startServer();
}

main().catch(async (error) => {
  console.error("Could not start fllee-backend:", error);

  if (error?.code === "P2021") {
    console.error(`Configured SQLite database: ${env.DATABASE_FILE}`);
    console.error("The expected Prisma tables are missing from that file.");
  }

  if (prisma) {
    await prisma.$disconnect();
  }

  process.exit(error.exitCode || 1);
});
