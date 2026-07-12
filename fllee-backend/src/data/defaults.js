const { env } = require("../config/env");

const DEFAULT_BIKERS = [
  {
    id: "bkr-001",
    name: "Mugisha Eric",
    phoneNumber: "0788001111",
    bikePlate: "RAE 241M",
    bikeModel: "TVS HLX 125",
    status: "Active",
    reminderDue: true,
    urgentAlert: false
  },
  {
    id: "bkr-002",
    name: "Uwase Linda",
    phoneNumber: "0788002222",
    bikePlate: "RAD 558K",
    bikeModel: "Boxer BM 150",
    status: "Active",
    reminderDue: false,
    urgentAlert: true
  },
  {
    id: "bkr-003",
    name: "Habimana Claude",
    phoneNumber: "0788003333",
    bikePlate: "RAH 904P",
    bikeModel: "Bajaj Pulsar",
    status: "Active",
    reminderDue: true,
    urgentAlert: false
  }
];

function buildDefaultPhoneState() {
  return {
    id: env.PHONE_STATE_ID,
    mode: env.SMS_GATEWAY_MODE,
    targetNumber: env.SMS_GATEWAY_TARGET_NUMBER,
    fixedLocation: env.SMS_GATEWAY_FIXED_LOCATION,
    batteryPolicy: env.SMS_GATEWAY_BATTERY_POLICY,
    network: env.SMS_GATEWAY_NETWORK_LABEL,
    deviceId: env.SMS_GATEWAY_DEVICE_ID,
    bundleUssdCode: env.SMS_BUNDLE_USSD_CODE,
    bundleStatus: "unknown",
    bundleSummary: null,
    bundleDetails: null,
    bundleLastError: null,
    bundleCheckedAt: null,
    bundleRequestedAt: null,
    lastHeartbeatAt: new Date()
  };
}

module.exports = {
  DEFAULT_BIKERS,
  buildDefaultPhoneState
};
