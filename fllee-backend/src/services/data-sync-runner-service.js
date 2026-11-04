const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { env } = require("../config/env");
const { prisma } = require("../lib/prisma");
const {
  failDataSyncRun,
  getDataSyncSchedule
} = require("./data-sync-service");

let activeProcess = null;
let lastProcessResult = null;

function serializeRunnerState() {
  return {
    isRunning: Boolean(activeProcess),
    trigger: activeProcess?.trigger || "",
    startedAt: activeProcess?.startedAt?.toISOString() || null,
    lastExitCode: lastProcessResult?.exitCode ?? null,
    lastFinishedAt: lastProcessResult?.finishedAt?.toISOString() || null,
    configurationError: validateWorkerConfiguration()
  };
}

async function closeOrphanedRun(startedAt, errorMessage) {
  const run = await prisma.dataSyncRun.findFirst({
    where: {
      status: "RUNNING",
      startedAt: { gte: new Date(startedAt.getTime() - 5000) }
    },
    orderBy: { startedAt: "desc" }
  });
  if (run) await failDataSyncRun(run.id, { errorMessage });
}

function validateWorkerConfiguration() {
  if (!env.DATA_SYNC_SERVICE_TOKEN) return "Data sync service token is not configured.";
  if (!fs.existsSync(env.DATA_SYNC_NODE_BINARY)) return "Data sync Node binary was not found.";
  if (!fs.existsSync(env.DATA_SYNC_SCRIPT_PATH)) return "Data sync worker script was not found.";
  if (!fs.existsSync(env.DATA_SYNC_ENV_FILE)) return "Data sync environment file was not found.";
  return "";
}

function startDataSyncProcess(trigger = "manual") {
  if (activeProcess) {
    return {
      statusCode: 409,
      body: { error: "A data sync is already running.", runner: serializeRunnerState() }
    };
  }
  const configurationError = validateWorkerConfiguration();
  if (configurationError) {
    return {
      statusCode: 503,
      body: { error: configurationError, runner: serializeRunnerState() }
    };
  }

  const startedAt = new Date();
  const child = spawn(env.DATA_SYNC_NODE_BINARY, [env.DATA_SYNC_SCRIPT_PATH], {
    cwd: path.dirname(env.DATA_SYNC_SCRIPT_PATH),
    env: {
      ...process.env,
      DATA_SYNC_ENV_FILE: env.DATA_SYNC_ENV_FILE,
      DATA_SYNC_TRIGGER: trigger
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  activeProcess = { child, trigger, startedAt };

  child.stdout.on("data", (chunk) => {
    const message = String(chunk).trim();
    if (message) console.log(`Data sync: ${message}`);
  });
  child.stderr.on("data", (chunk) => {
    const message = String(chunk).trim();
    if (message) console.error(`Data sync: ${message}`);
  });
  child.on("error", (error) => console.error("Data sync process error:", error.message));
  child.on("close", (exitCode) => {
    const errorMessage = exitCode === 0
      ? ""
      : `Data sync worker exited with code ${exitCode ?? "unknown"}.`;
    lastProcessResult = { exitCode, finishedAt: new Date() };
    activeProcess = null;
    if (errorMessage) {
      closeOrphanedRun(startedAt, errorMessage).catch((error) => {
        console.error("Could not close an interrupted data sync run:", error);
      });
    } else {
      // Payments deleted from the sheet by hand send their bank statement entries back to Pending.
      require("./bank-statement-service").reconcileSyncedEntries().catch((error) => {
        console.error("Could not reconcile bank statement entries:", error.message);
      });
    }
  });

  return {
    statusCode: 202,
    body: { accepted: true, runner: serializeRunnerState() }
  };
}

async function runDataSyncSchedulePoll() {
  if (activeProcess || validateWorkerConfiguration()) return;
  const schedule = await getDataSyncSchedule();
  if (!schedule.due) return;
  const response = startDataSyncProcess(`scheduled-${schedule.intervalDays}-days`);
  if (response.statusCode >= 400 && response.statusCode !== 409) {
    console.error(`Data sync scheduler: ${response.body.error}`);
  }
}

function stopDataSyncProcess() {
  if (activeProcess && !activeProcess.child.killed) activeProcess.child.kill("SIGTERM");
}

module.exports = {
  getDataSyncRunnerState: serializeRunnerState,
  runDataSyncSchedulePoll,
  startDataSyncProcess,
  stopDataSyncProcess,
  validateDataSyncWorkerConfiguration: validateWorkerConfiguration
};
