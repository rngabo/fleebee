const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { env } = require("../config/env");
const { buildDefaultPhoneState } = require("../data/defaults");
const { prisma } = require("../lib/prisma");
const { getSmsGatewayMode } = require("./setting-service");

const execFileAsync = promisify(execFile);
const ADB_CACHE_MS = 10000;
let cachedAdbStatus = null;
let cachedAdbStatusAt = 0;
let adbProbePromise = null;

function isPhoneOnline(phone) {
  return Date.now() - phone.lastHeartbeatAt.getTime() <= env.PHONE_HEARTBEAT_STALE_MS;
}

function routeLabel(phone, targetLabel = phone.targetNumber) {
  return `${phone.fixedLocation} -> ${targetLabel}`;
}

async function buildPhoneConfigData() {
  return {
    mode: await getSmsGatewayMode(),
    targetNumber: env.SMS_GATEWAY_TARGET_NUMBER,
    fixedLocation: env.SMS_GATEWAY_FIXED_LOCATION,
    batteryPolicy: env.SMS_GATEWAY_BATTERY_POLICY,
    network: env.SMS_GATEWAY_NETWORK_LABEL,
    deviceId: env.SMS_GATEWAY_DEVICE_ID,
    bundleUssdCode: env.SMS_BUNDLE_USSD_CODE
  };
}

function buildBundleSummary(status, summary, details, error, ussdCode) {
  const trimmedSummary = String(summary || "").trim();
  if (trimmedSummary) {
    return trimmedSummary;
  }

  const trimmedDetails = String(details || "").trim();
  if (status === "ok" && trimmedDetails) {
    const firstLine = trimmedDetails
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (firstLine) {
      return firstLine.slice(0, 180);
    }
  }

  if (status === "checking") {
    return `Running ${ussdCode} on the phone.`;
  }

  if (status === "requested") {
    return `Waiting for the phone to run ${ussdCode}.`;
  }

  const trimmedError = String(error || "").trim();
  if (trimmedError) {
    return trimmedError;
  }

  if (status === "permission-missing") {
    return "CALL_PHONE permission is missing on the Android gateway.";
  }

  if (status === "unsupported") {
    return "This Android version does not support automated USSD checks.";
  }

  return "";
}

function normalizeBundleStatus(value) {
  const allowed = new Set([
    "unknown",
    "requested",
    "checking",
    "ok",
    "error",
    "permission-missing",
    "unsupported"
  ]);
  const normalized = String(value || "unknown").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : "error";
}

function serializeBundle(phone) {
  const checkedAt = phone.bundleCheckedAt;
  return {
    ussdCode: phone.bundleUssdCode,
    status: phone.bundleStatus || "unknown",
    summary: phone.bundleSummary || "",
    details: phone.bundleDetails || "",
    lastError: phone.bundleLastError || "",
    checkedAt: checkedAt ? checkedAt.toISOString() : null,
    requestedAt: phone.bundleRequestedAt ? phone.bundleRequestedAt.toISOString() : null,
    nextAutoCheckAt: checkedAt
      ? new Date(checkedAt.getTime() + env.SMS_BUNDLE_REFRESH_INTERVAL_MS).toISOString()
      : null
  };
}

function buildBundleCheckDirective(phone) {
  const status = phone.bundleStatus || "unknown";
  const manuallyRequested = Boolean(phone.bundleRequestedAt);
  const autoDue = !phone.bundleCheckedAt
    || Date.now() - phone.bundleCheckedAt.getTime() >= env.SMS_BUNDLE_REFRESH_INTERVAL_MS;

  if (status === "checking") {
    return {
      shouldRun: false,
      reason: "checking",
      ussdCode: phone.bundleUssdCode,
      refreshIntervalMs: env.SMS_BUNDLE_REFRESH_INTERVAL_MS
    };
  }

  return {
    shouldRun: manuallyRequested || autoDue,
    reason: manuallyRequested
      ? "manual"
      : !phone.bundleCheckedAt
        ? "first-run"
        : autoDue
          ? "stale"
          : "fresh",
    ussdCode: phone.bundleUssdCode,
    refreshIntervalMs: env.SMS_BUNDLE_REFRESH_INTERVAL_MS
  };
}

function serializePhone(phone) {
  return {
    mode: phone.mode,
    targetNumber: phone.targetNumber,
    online: isPhoneOnline(phone),
    fixedLocation: phone.fixedLocation,
    lastHeartbeatAt: phone.lastHeartbeatAt.toISOString(),
    batteryPolicy: phone.batteryPolicy,
    network: phone.network,
    deviceId: phone.deviceId,
    bundle: serializeBundle(phone)
  };
}

function adbStatusLabel(status, serial, totalDevices) {
  if (status === "connected") {
    if (serial) {
      return `Connected (${serial})`;
    }
    if (totalDevices > 1) {
      return `Connected (${totalDevices} devices)`;
    }
    return "Connected";
  }

  if (status === "unauthorized") {
    return serial ? `Unauthorized (${serial})` : "Unauthorized";
  }

  if (status === "offline") {
    return serial ? `Offline (${serial})` : "Offline";
  }

  if (status === "disconnected") {
    return "Disconnected";
  }

  return "Unavailable";
}

function parseAdbDevices(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices attached"))
    .map((line) => {
      const [serial = "", state = ""] = line.split(/\s+/, 3);
      return {
        serial,
        state
      };
    })
    .filter((item) => item.serial);
}

function serializeAdbStatus(status, serial, totalDevices, detail = "") {
  return {
    status,
    connected: status === "connected",
    serial,
    totalDevices,
    label: adbStatusLabel(status, serial, totalDevices),
    detail
  };
}

function chooseAdbDevice(devices) {
  if (!devices.length) {
    return null;
  }

  const preferredSerial = String(env.SMS_GATEWAY_ADB_SERIAL || "").trim();
  if (preferredSerial) {
    const exactMatch = devices.find((device) => device.serial === preferredSerial);
    if (exactMatch) {
      return exactMatch;
    }
  }

  return devices.find((device) => device.state === "device") || devices[0];
}

function summarizeAdbProbe(stdout) {
  const devices = parseAdbDevices(stdout);
  if (!devices.length) {
    return serializeAdbStatus("disconnected", "", 0, "No Android device is visible through ADB.");
  }

  const selected = chooseAdbDevice(devices);
  if (!selected) {
    return serializeAdbStatus("disconnected", "", 0, "No Android device is visible through ADB.");
  }

  const normalizedState = String(selected.state || "").trim().toLowerCase();
  if (normalizedState === "device") {
    return serializeAdbStatus(
      "connected",
      selected.serial,
      devices.length,
      "USB debugging is ready on the home computer."
    );
  }

  if (normalizedState === "unauthorized") {
    return serializeAdbStatus(
      "unauthorized",
      selected.serial,
      devices.length,
      "Allow the USB debugging prompt on the phone to restore ADB access."
    );
  }

  if (normalizedState === "offline") {
    return serializeAdbStatus(
      "offline",
      selected.serial,
      devices.length,
      "ADB can see the phone, but the transport is offline."
    );
  }

  return serializeAdbStatus(
    "unavailable",
    selected.serial,
    devices.length,
    `ADB reported "${normalizedState || "unknown"}" for the phone.`
  );
}

async function runAdbCommand(command) {
  return execFileAsync(command, ["devices", "-l"], {
    timeout: env.SMS_GATEWAY_ADB_TIMEOUT_MS,
    windowsHide: true
  });
}

async function probeAdbStatus() {
  const candidates = [...new Set([env.SMS_GATEWAY_ADB_COMMAND, "adb"].filter(Boolean))];

  for (const command of candidates) {
    try {
      const { stdout } = await runAdbCommand(command);
      return summarizeAdbProbe(stdout);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        continue;
      }

      if (error && error.killed) {
        return serializeAdbStatus(
          "unavailable",
          "",
          0,
          `ADB status timed out after ${env.SMS_GATEWAY_ADB_TIMEOUT_MS}ms.`
        );
      }

      const message = String(error?.stderr || error?.message || "").trim();
      return serializeAdbStatus(
        "unavailable",
        "",
        0,
        message || "The backend could not read ADB status from the home computer."
      );
    }
  }

  return serializeAdbStatus(
    "unavailable",
    "",
    0,
    "ADB is not installed or its helper command is missing on the home computer."
  );
}

async function getAdbStatus() {
  if (cachedAdbStatus && Date.now() - cachedAdbStatusAt < ADB_CACHE_MS) {
    return cachedAdbStatus;
  }

  if (!adbProbePromise) {
    adbProbePromise = probeAdbStatus()
      .then((status) => {
        cachedAdbStatus = status;
        cachedAdbStatusAt = Date.now();
        return status;
      })
      .finally(() => {
        adbProbePromise = null;
      });
  }

  return adbProbePromise;
}

async function getPhoneState() {
  const config = await buildPhoneConfigData();
  return prisma.phoneState.upsert({
    where: {
      id: env.PHONE_STATE_ID
    },
    update: config,
    create: {
      ...buildDefaultPhoneState(),
      ...config
    }
  });
}

async function updatePhoneHeartbeat(payload = {}) {
  const config = await buildPhoneConfigData();
  const data = {
    ...config,
    lastHeartbeatAt: new Date()
  };

  if (payload.deviceId) {
    data.deviceId = String(payload.deviceId).trim();
  }
  if (payload.network) {
    data.network = String(payload.network);
  }
  if (payload.fixedLocation) {
    data.fixedLocation = String(payload.fixedLocation);
  }
  if (payload.bundleUssdCode) {
    data.bundleUssdCode = String(payload.bundleUssdCode).trim();
  }

  return prisma.phoneState.upsert({
    where: {
      id: env.PHONE_STATE_ID
    },
    update: data,
    create: {
      ...buildDefaultPhoneState(),
      ...config,
      ...data
    }
  });
}

async function requestBundleCheck() {
  const requestedAt = new Date();
  const config = await buildPhoneConfigData();

  return prisma.phoneState.upsert({
    where: {
      id: env.PHONE_STATE_ID
    },
    update: {
      ...config,
      bundleRequestedAt: requestedAt,
      bundleStatus: "requested",
      bundleSummary: buildBundleSummary("requested", "", "", "", env.SMS_BUNDLE_USSD_CODE),
      bundleLastError: null,
      bundleUssdCode: env.SMS_BUNDLE_USSD_CODE
    },
    create: {
      ...buildDefaultPhoneState(),
      ...config,
      bundleRequestedAt: requestedAt,
      bundleStatus: "requested",
      bundleSummary: buildBundleSummary("requested", "", "", "", env.SMS_BUNDLE_USSD_CODE)
    }
  });
}

async function updateBundleCheck(payload = {}) {
  const config = await buildPhoneConfigData();
  const status = normalizeBundleStatus(payload.status);
  const ussdCode = String(payload.ussdCode || env.SMS_BUNDLE_USSD_CODE).trim() || env.SMS_BUNDLE_USSD_CODE;
  const details = String(payload.details || "").trim();
  const error = String(payload.error || "").trim();
  const summary = buildBundleSummary(status, payload.summary, details, error, ussdCode);
  const now = new Date();

  const data = {
    ...config,
    bundleUssdCode: ussdCode,
    bundleStatus: status,
    bundleSummary: summary || null,
    bundleDetails: details || null,
    bundleLastError: error || null,
    bundleRequestedAt: null
  };

  if (status !== "checking" && status !== "requested") {
    data.bundleCheckedAt = now;
  }

  return prisma.phoneState.upsert({
    where: {
      id: env.PHONE_STATE_ID
    },
    update: data,
    create: {
      ...buildDefaultPhoneState(),
      ...config,
      ...data,
      ...(status !== "checking" && status !== "requested"
        ? {
            bundleCheckedAt: now
          }
        : {})
    }
  });
}

module.exports = {
  getAdbStatus,
  buildBundleCheckDirective,
  getPhoneState,
  isPhoneOnline,
  normalizeBundleStatus,
  routeLabel,
  requestBundleCheck,
  serializePhone,
  updateBundleCheck,
  updatePhoneHeartbeat
};
