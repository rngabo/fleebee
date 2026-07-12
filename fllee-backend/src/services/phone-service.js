const { env } = require("../config/env");
const { buildDefaultPhoneState } = require("../data/defaults");
const { prisma } = require("../lib/prisma");

function isPhoneOnline(phone) {
  return Date.now() - phone.lastHeartbeatAt.getTime() <= env.PHONE_HEARTBEAT_STALE_MS;
}

function routeLabel(phone) {
  return `${phone.fixedLocation} -> ${phone.targetNumber}`;
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

async function getPhoneState() {
  return prisma.phoneState.upsert({
    where: {
      id: env.PHONE_STATE_ID
    },
    update: {},
    create: buildDefaultPhoneState()
  });
}

async function updatePhoneHeartbeat(payload = {}) {
  const data = {
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
      ...data
    }
  });
}

async function requestBundleCheck() {
  const requestedAt = new Date();

  return prisma.phoneState.upsert({
    where: {
      id: env.PHONE_STATE_ID
    },
    update: {
      bundleRequestedAt: requestedAt,
      bundleStatus: "requested",
      bundleSummary: buildBundleSummary("requested", "", "", "", env.SMS_BUNDLE_USSD_CODE),
      bundleLastError: null,
      bundleUssdCode: env.SMS_BUNDLE_USSD_CODE
    },
    create: {
      ...buildDefaultPhoneState(),
      bundleRequestedAt: requestedAt,
      bundleStatus: "requested",
      bundleSummary: buildBundleSummary("requested", "", "", "", env.SMS_BUNDLE_USSD_CODE)
    }
  });
}

async function updateBundleCheck(payload = {}) {
  const status = normalizeBundleStatus(payload.status);
  const ussdCode = String(payload.ussdCode || env.SMS_BUNDLE_USSD_CODE).trim() || env.SMS_BUNDLE_USSD_CODE;
  const details = String(payload.details || "").trim();
  const error = String(payload.error || "").trim();
  const summary = buildBundleSummary(status, payload.summary, details, error, ussdCode);
  const now = new Date();

  const data = {
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
