const { env } = require("../config/env");
const { prisma } = require("../lib/prisma");

const DISPATCH_PASSWORD_SETTING_ID = "dispatchPassword";

async function getStoredDispatchPassword() {
  const setting = await prisma.appSetting.findUnique({
    where: {
      id: DISPATCH_PASSWORD_SETTING_ID
    }
  });

  return setting ? setting.value : "";
}

async function hasValidStoredDispatchPassword() {
  const stored = await getStoredDispatchPassword();
  return Boolean(stored) && stored === env.SMS_SEND_PASSWORD;
}

async function saveDispatchPassword(password) {
  const value = String(password || "").trim();

  if (!value) {
    return {
      statusCode: 400,
      body: {
        error: "Dispatch password is required."
      }
    };
  }

  if (value !== env.SMS_SEND_PASSWORD) {
    return {
      statusCode: 401,
      body: {
        error: "Dispatch password is incorrect. Nothing was saved."
      }
    };
  }

  await prisma.appSetting.upsert({
    where: {
      id: DISPATCH_PASSWORD_SETTING_ID
    },
    update: {
      value
    },
    create: {
      id: DISPATCH_PASSWORD_SETTING_ID,
      value
    }
  });

  return {
    statusCode: 200,
    body: {
      saved: true
    }
  };
}

async function clearDispatchPassword() {
  await prisma.appSetting.deleteMany({
    where: {
      id: DISPATCH_PASSWORD_SETTING_ID
    }
  });
}

module.exports = {
  clearDispatchPassword,
  getStoredDispatchPassword,
  hasValidStoredDispatchPassword,
  saveDispatchPassword
};
