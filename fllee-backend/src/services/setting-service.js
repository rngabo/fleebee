const { env } = require("../config/env");
const { prisma } = require("../lib/prisma");

const DISPATCH_PASSWORD_SETTING_ID = "dispatchPassword";
const MESSAGE_SIGNATURE_SETTING_ID = "messageSignature";
const GATEWAY_MODE_SETTING_ID = "smsGatewayMode";

function normalizeSettingValue(value) {
  return String(value || "").trim();
}

function normalizeGatewayMode(value, fallback = "registered-bikers") {
  const normalized = normalizeSettingValue(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (["registered-bikers", "real", "real-mode", "live"].includes(normalized)) {
    return "registered-bikers";
  }

  if (["test-routing", "testing", "testing-mode", "test"].includes(normalized)) {
    return "test-routing";
  }

  return null;
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
  const [dispatchPassword, signature, gatewayMode] = await Promise.all([
    getSettingValue(DISPATCH_PASSWORD_SETTING_ID),
    getSettingValue(MESSAGE_SIGNATURE_SETTING_ID),
    getSettingValue(GATEWAY_MODE_SETTING_ID)
  ]);

  if (!dispatchPassword) {
    await setSettingValue(DISPATCH_PASSWORD_SETTING_ID, normalizeSettingValue(env.SMS_SEND_PASSWORD));
  }

  if (!signature) {
    await setSettingValue(MESSAGE_SIGNATURE_SETTING_ID, "");
  }

  if (!gatewayMode) {
    await setSettingValue(
      GATEWAY_MODE_SETTING_ID,
      normalizeGatewayMode(env.SMS_GATEWAY_MODE, "registered-bikers") || "registered-bikers"
    );
  }
}

async function getDispatchPassword() {
  const stored = normalizeSettingValue(await getSettingValue(DISPATCH_PASSWORD_SETTING_ID));
  return stored || normalizeSettingValue(env.SMS_SEND_PASSWORD);
}

async function getMessageSignature() {
  return normalizeSettingValue(await getSettingValue(MESSAGE_SIGNATURE_SETTING_ID));
}

async function getSmsGatewayMode() {
  const stored = normalizeGatewayMode(await getSettingValue(GATEWAY_MODE_SETTING_ID), "");
  return stored
    || normalizeGatewayMode(env.SMS_GATEWAY_MODE, "registered-bikers")
    || "registered-bikers";
}

async function getSmsSettings() {
  const [dispatchPassword, signature, gatewayMode] = await Promise.all([
    getDispatchPassword(),
    getMessageSignature(),
    getSmsGatewayMode()
  ]);

  return {
    passwordConfigured: Boolean(dispatchPassword),
    signature,
    gatewayMode,
    gatewayTargetNumber: normalizeSettingValue(env.SMS_GATEWAY_TARGET_NUMBER)
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
  const gatewayMode = normalizeGatewayMode(payload.gatewayMode, await getSmsGatewayMode());
  if (!gatewayMode) {
    return {
      statusCode: 400,
      body: {
        error: "Choose either Real mode or Testing mode for SMS routing."
      }
    };
  }

  await Promise.all([
    setSettingValue(DISPATCH_PASSWORD_SETTING_ID, nextPassword),
    setSettingValue(MESSAGE_SIGNATURE_SETTING_ID, signature),
    setSettingValue(GATEWAY_MODE_SETTING_ID, gatewayMode)
  ]);

  return {
    statusCode: 200,
    body: {
      saved: true,
      passwordConfigured: true,
      signature,
      gatewayMode,
      gatewayTargetNumber: normalizeSettingValue(env.SMS_GATEWAY_TARGET_NUMBER)
    }
  };
}

module.exports = {
  ensureSmsSettings,
  getDispatchPassword,
  getSmsGatewayMode,
  getMessageSignature,
  getSmsSettings,
  isDispatchPasswordValid,
  normalizeGatewayMode,
  saveSmsSettings
};
