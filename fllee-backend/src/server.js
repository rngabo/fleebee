const { env } = require("./config/env");
const { prisma } = require("./lib/prisma");
const { createAppServer } = require("./app");
const { seedDefaultBikers } = require("./services/biker-service");
const { processDueScheduledMessages } = require("./services/scheduled-message-service");
const { getPhoneState } = require("./services/phone-service");
const { ensureSmsSettings } = require("./services/setting-service");
const { ensureDefaultSmsTemplates } = require("./services/template-service");

const server = createAppServer();
let isShuttingDown = false;
let schedulePollHandle = null;
let isProcessingSchedules = false;

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

  return server;
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
