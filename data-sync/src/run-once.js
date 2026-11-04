const { config, validateConfig } = require("./config");
const { FleebeeClient } = require("./fleebee-client");
const { readAccountingWorkbook } = require("./google-sheets-client");
const { parseAccountingWorkbook } = require("./parse-workbook");

async function main() {
  validateConfig();
  const client = new FleebeeClient({
    baseUrl: config.fleebeeBaseUrl,
    serviceToken: config.serviceToken,
    timeoutMs: config.timeoutMs
  });
  let runId = "";

  try {
    const started = await client.startRun(config.spreadsheetId, config.trigger);
    runId = started.run.id;
    const workbook = await readAccountingWorkbook(config);
    const data = parseAccountingWorkbook(workbook);
    const completed = await client.applyData(runId, data);
    process.stdout.write(`${JSON.stringify({
      runId,
      status: completed.run.status,
      memberCount: completed.run.memberCount,
      paymentCount: completed.run.paymentCount,
      dashboardRowCount: completed.run.dashboardRowCount,
      conflictCount: completed.run.conflictCount
    })}\n`);
  } catch (error) {
    if (runId) {
      await client.failRun(runId, String(error?.message || error).slice(0, 500)).catch(() => {});
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`Data sync could not complete: ${error.message}`);
  process.exit(1);
});
