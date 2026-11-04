const { env } = require("./config/env");
const { prisma } = require("./lib/prisma");
const { createAppServer } = require("./app");
const { seedDefaultBikers } = require("./services/biker-service");
const {
  runFineMonitorSchedulePoll,
  stopFineMonitorProcess
} = require("./services/fine-monitor-runner-service");
const {
  runDataSyncSchedulePoll,
  stopDataSyncProcess
} = require("./services/data-sync-runner-service");
const { processDueScheduledMessages } = require("./services/scheduled-message-service");
const { getPhoneState } = require("./services/phone-service");
const { ensureSmsSettings } = require("./services/setting-service");
const { ensureDefaultSmsTemplates } = require("./services/template-service");

const server = createAppServer();
let isShuttingDown = false;
let schedulePollHandle = null;
let fineMonitorPollHandle = null;
let dataSyncPollHandle = null;
let isProcessingSchedules = false;
let isPollingFineMonitor = false;
let isPollingDataSync = false;

async function seedDefaults() {
  await seedDefaultBikers();
  await ensureSmsSettings();
  await ensureDefaultSmsTemplates();
  await getPhoneState();
}

async function startServer() {
  await seedDefaults();
  await runScheduledMessagePoll();
  schedulePollHandle = setInterval(() => {
    runScheduledMessagePoll().catch((error) => {
      console.error("Scheduled message worker failed:", error);
    });
  }, env.SCHEDULE_POLL_MS);

  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off("listening", handleListening);
      reject(error);
    };

    const handleListening = () => {
      server.off("error", handleError);
      console.log(`fleebee app running on http://localhost:${env.PORT}`);
      resolve();
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(env.PORT);
  });

  await runFineMonitorPoll();
  fineMonitorPollHandle = setInterval(() => {
    runFineMonitorPoll().catch((error) => {
      console.error("Fine Monitor scheduler failed:", error);
    });
  }, env.FINE_MONITOR_SCHEDULER_POLL_MS);

  await runDataSyncPoll();
  dataSyncPollHandle = setInterval(() => {
    runDataSyncPoll().catch((error) => {
      console.error("Data sync scheduler failed:", error);
    });
  }, env.DATA_SYNC_SCHEDULER_POLL_MS);

  return server;
}

async function runFineMonitorPoll() {
  if (isPollingFineMonitor || isShuttingDown) {
    return;
  }

  isPollingFineMonitor = true;
  try {
    await runFineMonitorSchedulePoll();
  } finally {
    isPollingFineMonitor = false;
  }
}

async function runDataSyncPoll() {
  if (isPollingDataSync || isShuttingDown) return;
  isPollingDataSync = true;
  try {
    await runDataSyncSchedulePoll();
  } finally {
    isPollingDataSync = false;
  }
}

async function runScheduledMessagePoll() {
  if (isProcessingSchedules || isShuttingDown) {
    return;
  }

  isProcessingSchedules = true;

  try {
    await processDueScheduledMessages();
  } finally {
    isProcessingSchedules = false;
  }
}

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}, shutting down fllee-backend...`);

  if (schedulePollHandle) {
    clearInterval(schedulePollHandle);
    schedulePollHandle = null;
  }
  if (fineMonitorPollHandle) {
    clearInterval(fineMonitorPollHandle);
    fineMonitorPollHandle = null;
  }
  if (dataSyncPollHandle) {
    clearInterval(dataSyncPollHandle);
    dataSyncPollHandle = null;
  }
  stopFineMonitorProcess();
  stopDataSyncProcess();

  await new Promise((resolve) => {
    server.close(() => resolve());
  });

  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((error) => {
    console.error(error);
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((error) => {
    console.error(error);
    process.exit(1);
  });
});

module.exports = {
  startServer
};
