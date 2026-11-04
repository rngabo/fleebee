const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { env } = require("../config/env");
const { prisma } = require("../lib/prisma");
const {
  completeFineCheckRun,
  getFineMonitorSchedule
} = require("./fine-monitor-service");

let activeProcess = null;
let lastProcessResult = null;

function serializeRunnerState() {
  return {
    isRunning: Boolean(activeProcess),
    trigger: activeProcess?.trigger || "",
    startedAt: activeProcess?.startedAt?.toISOString() || null,
    lastExitCode: lastProcessResult?.exitCode ?? null,
    lastFinishedAt: lastProcessResult?.finishedAt?.toISOString() || null
  };
}

async function closeOrphanedRun(startedAt, errorMessage) {
  const run = await prisma.fineCheckRun.findFirst({
    where: {
      status: "RUNNING",
      startedAt: {
        gte: new Date(startedAt.getTime() - 5000)
      }
    },
    orderBy: {
      startedAt: "desc"
    }
  });

  if (run) {
    await completeFineCheckRun(run.id, { errorMessage });
  }
}

function validateWorkerConfiguration() {
  if (!env.FINE_MONITOR_SERVICE_TOKEN) {
    return "Fine Monitor service token is not configured.";
  }
  if (!fs.existsSync(env.FINE_MONITOR_NODE_BINARY)) {
    return "Fine Monitor Node binary was not found.";
  }
  if (!fs.existsSync(env.FINE_MONITOR_SCRIPT_PATH)) {
    return "Fine Monitor worker script was not found.";
  }
  if (!fs.existsSync(env.FINE_MONITOR_ENV_FILE)) {
    return "Fine Monitor environment file was not found.";
  }
  return "";
}

function startFineMonitorProcess(trigger = "manual") {
  if (activeProcess) {
    return {
      statusCode: 409,
      body: {
        error: "A fine check is already running.",
        runner: serializeRunnerState()
      }
    };
  }

  const configurationError = validateWorkerConfiguration();
  if (configurationError) {
    return {
      statusCode: 503,
      body: {
        error: configurationError,
        runner: serializeRunnerState()
      }
    };
  }

  const startedAt = new Date();
  const child = spawn(env.FINE_MONITOR_NODE_BINARY, [env.FINE_MONITOR_SCRIPT_PATH], {
    cwd: path.dirname(env.FINE_MONITOR_SCRIPT_PATH),
    env: {
      ...process.env,
      FINE_MONITOR_ENV_FILE: env.FINE_MONITOR_ENV_FILE,
      FINE_MONITOR_TRIGGER: trigger
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  activeProcess = {
    child,
    trigger,
    startedAt
  };

  child.stdout.on("data", (chunk) => {
    const message = String(chunk).trim();
    if (message) {
      console.log(`Fine Monitor: ${message}`);
    }
  });
  child.stderr.on("data", (chunk) => {
    const message = String(chunk).trim();
    if (message) {
      console.error(`Fine Monitor: ${message}`);
    }
  });
  child.on("error", (error) => {
    console.error("Fine Monitor process error:", error.message);
  });
  child.on("close", (exitCode) => {
    const errorMessage = exitCode === 0
      ? ""
      : `Fine Monitor worker exited with code ${exitCode ?? "unknown"}.`;
    lastProcessResult = {
      exitCode,
      finishedAt: new Date()
    };
    activeProcess = null;

    if (errorMessage) {
      closeOrphanedRun(startedAt, errorMessage).catch((error) => {
        console.error("Could not close an interrupted Fine Monitor run:", error);
      });
    }
  });

  return {
    statusCode: 202,
    body: {
      accepted: true,
      runner: serializeRunnerState()
    }
  };
}

async function runFineMonitorSchedulePoll() {
  if (activeProcess) {
    return;
  }

  const schedule = await getFineMonitorSchedule();
  if (schedule.due) {
    const response = startFineMonitorProcess(`scheduled-${schedule.frequency}`);
    if (response.statusCode >= 400 && response.statusCode !== 409) {
      console.error(`Fine Monitor scheduler: ${response.body.error}`);
    }
  }
}

function stopFineMonitorProcess() {
  if (activeProcess && !activeProcess.child.killed) {
    activeProcess.child.kill("SIGTERM");
  }
}

module.exports = {
  getFineMonitorRunnerState: serializeRunnerState,
  runFineMonitorSchedulePoll,
  startFineMonitorProcess,
  stopFineMonitorProcess
};
