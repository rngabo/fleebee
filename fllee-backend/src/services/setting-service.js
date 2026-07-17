const { env } = require("../config/env");
const { prisma } = require("../lib/prisma");

const DISPATCH_PASSWORD_SETTING_ID = "dispatchPassword";
const MESSAGE_SIGNATURE_SETTING_ID = "messageSignature";

function normalizeSettingValue(value) {
  return String(value || "").trim();
}

async function getSettingValue(id) {
  const setting = await prisma.appSetting.findUnique({
    where: {
      id
    }
  });

  return setting ? setting.value : "";
}

async function setSettingValue(id, value) {
  await prisma.appSetting.upsert({
    where: {
      id
    },
    update: {
      value
    },
    create: {
      id,
      value
    }
  });
}

async function ensureSmsSettings() {
  const [dispatchPassword, signature] = await Promise.all([
    getSettingValue(DISPATCH_PASSWORD_SETTING_ID),
    getSettingValue(MESSAGE_SIGNATURE_SETTING_ID)
  ]);

  if (!dispatchPassword) {
    await setSettingValue(DISPATCH_PASSWORD_SETTING_ID, normalizeSettingValue(env.SMS_SEND_PASSWORD));
  }

  if (!signature) {
    await setSettingValue(MESSAGE_SIGNATURE_SETTING_ID, "");
  }
}

async function getDispatchPassword() {
  const stored = normalizeSettingValue(await getSettingValue(DISPATCH_PASSWORD_SETTING_ID));
  return stored || normalizeSettingValue(env.SMS_SEND_PASSWORD);
}

async function getMessageSignature() {
  return normalizeSettingValue(await getSettingValue(MESSAGE_SIGNATURE_SETTING_ID));
}

async function getSmsSettings() {
  const [dispatchPassword, signature] = await Promise.all([
    getDispatchPassword(),
    getMessageSignature()
  ]);

  return {
    passwordConfigured: Boolean(dispatchPassword),
    signature
  };
}

function isAdminPasswordValid(value) {
  return normalizeSettingValue(value) === normalizeSettingValue(env.SMS_ADMIN_PASSWORD);
}

async function isDispatchPasswordValid(value) {
  const stored = await getDispatchPassword();
  return Boolean(stored) && normalizeSettingValue(value) === stored;
}

async function saveSmsSettings(payload = {}) {
  const adminPassword = normalizeSettingValue(payload.adminPassword);
  if (!isAdminPasswordValid(adminPassword)) {
    return {
      statusCode: 401,
      body: {
        error: "Admin password is incorrect. SMS settings were not changed."
      }
    };
  }

  const currentPassword = await getDispatchPassword();
  const nextPassword = normalizeSettingValue(payload.dispatchPassword) || currentPassword;
  if (!nextPassword) {
    return {
      statusCode: 400,
      body: {
        error: "SMS send password is required."
      }
    };
  }

  const signature = String(payload.signature || "").trim();

  await Promise.all([
    setSettingValue(DISPATCH_PASSWORD_SETTING_ID, nextPassword),
    setSettingValue(MESSAGE_SIGNATURE_SETTING_ID, signature)
  ]);

  return {
    statusCode: 200,
    body: {
      saved: true,
      passwordConfigured: true,
      signature
    }
  };
}

module.exports = {
  ensureSmsSettings,
  getDispatchPassword,
  getMessageSignature,
  getSmsSettings,
  isDispatchPasswordValid,
  saveSmsSettings
};
