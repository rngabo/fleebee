const runtimeConfig = window.FLEEBEE_CONFIG || {};

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function resolveApiBaseUrl(configuredUrl) {
  const fallbackUrl = window.location.origin;
  const rawUrl = typeof configuredUrl === "string" ? configuredUrl.trim() : "";

  if (!rawUrl) {
    return fallbackUrl.replace(/\/$/, "");
  }

  try {
    const apiUrl = new URL(rawUrl, fallbackUrl);
    const pageUrl = new URL(window.location.href);

    if (isLoopbackHost(apiUrl.hostname) && !isLoopbackHost(pageUrl.hostname)) {
      apiUrl.hostname = pageUrl.hostname;
    }

    return apiUrl.toString().replace(/\/$/, "");
  } catch {
    return rawUrl;
  }
}

const API_BASE = resolveApiBaseUrl(runtimeConfig.apiBaseUrl);
const APP_NAME = runtimeConfig.appName || "Fleebee Dispatch Desk";
const REFRESH_INTERVAL_MS = Number(runtimeConfig.refreshIntervalMs || 5000);
const BUNDLE_REFRESH_INTERVAL_MS = Number(runtimeConfig.bundleRefreshIntervalMs || 0);
const SESSION_IDLE_TIMEOUT_MS = Number(runtimeConfig.sessionIdleTimeoutMs || 15 * 60 * 1000);
const PAGE_VIEW = document.body.dataset.view || "overview";
const REVEAL_HIDE_MS = 5000;
const SESSION_TOUCH_COOLDOWN_MS = Math.min(
  60 * 1000,
  Math.max(15 * 1000, Math.floor(SESSION_IDLE_TIMEOUT_MS / 4))
);

const state = {
  bikers: [],
  messages: [],
  schedules: [],
  phone: null,
  summary: null,
  serverHealth: null,
  testRoute: "",
  smsSettings: {
    passwordConfigured: false,
    signature: ""
  },
  lastUpdatedAt: null,
  recentPage: 0,
  recentPageSize: 5,
  revealTimers: new Map(),
  composeMode: "new",
  composeTargetId: "",
  composeCategory: "REMINDER",
  composeWhen: "now",
  composeRecipients: new Set(),
  lastSuggestion: "",
  bundleDetailsOpen: false,
  modifyMode: false,
  selectedBikerIds: new Set(),
  editingBikerId: ""
};

const $ = (id) => document.getElementById(id);

const appNameLabel = $("appNameLabel");
const apiBaseLabel = $("apiBaseLabel");
const testRouteLabel = $("testRouteLabel");
const phoneBadge = $("phoneBadge");
const bundleAlertButton = $("bundleAlertButton");
const refreshButton = $("refreshButton");
const logoutButton = $("logoutButton");
const pageNotice = $("pageNotice");
const newSmsButton = $("newSmsButton");
const sendSmsSectionButton = $("sendSmsSectionButton");
const navLinks = [...document.querySelectorAll("[data-nav-view]")];

const serverStatusValue = $("serverStatusValue");
const serverServiceValue = $("serverServiceValue");
const serverStorageValue = $("serverStorageValue");
const serverUpdatedValue = $("serverUpdatedValue");
const serverBundlePolicyValue = $("serverBundlePolicyValue");
const phoneOnlineValue = $("phoneOnlineValue");
const phoneLocationValue = $("phoneLocationValue");
const phoneNetworkValue = $("phoneNetworkValue");
const phoneHeartbeatValue = $("phoneHeartbeatValue");
const phoneBatteryValue = $("phoneBatteryValue");
const phoneRouteValue = $("phoneRouteValue");
const bundleRefreshButton = $("bundleRefreshButton");
const bundleStatusValue = $("bundleStatusValue");
const bundleCheckedValue = $("bundleCheckedValue");
const bundleSmsValue = $("bundleSmsValue");
const bundleDataValue = $("bundleDataValue");
const bundleDetailsActionRow = $("bundleDetailsActionRow");
const bundleDetailsToggle = $("bundleDetailsToggle");
const bundleDetailsRow = $("bundleDetailsRow");
const bundleDetailsValue = $("bundleDetailsValue");
const recentTableBody = $("recentTableBody");
const recentPageSizeSelect = $("recentPageSizeSelect");
const recentPrevButton = $("recentPrevButton");
const recentNextButton = $("recentNextButton");
const recentPageLabel = $("recentPageLabel");

const smsTableBody = $("smsTableBody");
const scheduleTableBody = $("scheduleTableBody");
const newScheduleButton = $("newScheduleButton");
const adminPasswordInput = $("adminPasswordInput");
const dispatchPasswordSettingInput = $("dispatchPasswordSettingInput");
const signatureInput = $("signatureInput");
const saveSmsSettingsButton = $("saveSmsSettingsButton");
const smsSettingsNote = $("smsSettingsNote");

const bikerForm = $("bikerForm");
const nameInput = $("nameInput");
const phoneInput = $("phoneInput");
const plateInput = $("plateInput");
const modelInput = $("modelInput");
const statusInput = $("statusInput");
const reminderDueInput = $("reminderDueInput");
const urgentAlertInput = $("urgentAlertInput");
const bikerSubmitButton = $("bikerSubmitButton");
const bikerResetButton = $("bikerResetButton");
const bikerPanelTitle = $("bikerPanelTitle");
const bikerPanelNote = $("bikerPanelNote");
const bikerNotice = $("bikerNotice");
const bikerTable = $("bikerTable");
const bikerTableBody = $("bikerTableBody");
const bikerModifyButton = $("bikerModifyButton");
const bikerBulkBar = $("bikerBulkBar");
const bulkCountLabel = $("bulkCountLabel");
const bulkEditButton = $("bulkEditButton");
const bulkDeleteButton = $("bulkDeleteButton");
const bikerDetailModal = $("bikerDetailModal");
const bikerDetailTitle = $("bikerDetailTitle");
const bikerDetailBody = $("bikerDetailBody");
const bikerDetailEditButton = $("bikerDetailEditButton");

const composeModal = $("composeModal");
const composeForm = $("composeForm");
const composeTitle = $("composeTitle");
const composeNote = $("composeNote");
const composeBiker = $("composeBiker");
const composeBikerField = $("composeBikerField");
const composeRecipientsField = $("composeRecipientsField");
const composeRecipientList = $("composeRecipientList");
const composeAllBikers = $("composeAllBikers");
const composeRecipientCount = $("composeRecipientCount");
const composeCategoryRow = $("composeCategoryRow");
const composeMessage = $("composeMessage");
const composeWhenField = $("composeWhenField");
const composeWhenRow = $("composeWhenRow");
const composeScheduleRow = $("composeScheduleRow");
const composeSendAt = $("composeSendAt");
const composeRepeat = $("composeRepeat");
const composePasswordRow = $("composePasswordRow");
const composePassword = $("composePassword");
const composeNotice = $("composeNotice");
const composeSubmit = $("composeSubmit");

let sessionExpiryTimer = 0;
let lastSessionTouchAt = 0;
let sessionTouchInFlight = null;

/* ---------- Utilities ---------- */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function parseDateValue(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDateValue(value);
  return date ? date.toLocaleString() : "-";
}

function formatTimeShort(value) {
  const date = parseDateValue(value);
  if (!date) {
    return "-";
  }

  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDateTimeInputValue(value) {
  const date = parseDateValue(value);
  if (!date) {
    return "";
  }

  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatCountdownDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours || parts.length) parts.push(`${hours}h`);
  if (minutes || parts.length) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.slice(0, 3).join(" ");
}

function formatIntervalShort(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "";
  }

  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);

  return parts.join(" ");
}

function parseDateOnlyValue(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function calendarDaysUntil(value) {
  const target = parseDateOnlyValue(value);
  if (!target) {
    return null;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function pendingCountdownLabel(availableAt) {
  const date = parseDateValue(availableAt);
  if (!date) {
    return "";
  }

  const diffMs = date.getTime() - Date.now();
  return diffMs <= 0 ? "ready now" : formatCountdownDuration(diffMs);
}

function recurrenceLabel(value) {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "DAILY") return "Daily";
  if (normalized === "WEEKLY") return "Weekly";
  if (normalized === "MONTHLY") return "Monthly";
  return "One time";
}

function suggestionFor(category, bikerName) {
  const greeting = bikerName ? `Hello ${bikerName},` : "Hello,";
  if (category === "GENERAL") {
    return `${greeting} please drive safely, follow the latest rules, and keep good conduct while on duty today.`;
  }

  if (category === "EMERGENCY") {
    return `${greeting} please contact me immediately regarding an urgent traffic issue linked to your bike.`;
  }

  return `${greeting} this is a reminder to complete your scheduled payment as soon as possible. Thank you.`;
}

function setNotice(element, message, tone = "muted") {
  if (!element) {
    return;
  }

  element.textContent = message;
  element.style.color = tone === "error" ? "#b3261e" : tone === "success" ? "#17804a" : "#5b6779";
}

function normalizeSessionReason(reason) {
  if (reason === "expired") {
    return "expired";
  }

  if (reason === "logged-out") {
    return "logged-out";
  }

  return "auth-required";
}

function buildLoginUrl(reason = "auth-required") {
  const params = new URLSearchParams();
  const target = `${window.location.pathname}${window.location.search || ""}`;

  if (target !== "/") {
    params.set("redirect", target);
  }
  params.set("reason", normalizeSessionReason(reason));

  return `/login/?${params.toString()}`;
}

function redirectToLogin(reason = "auth-required") {
  window.location.replace(buildLoginUrl(reason));
}

function scheduleSessionExpiry(deadlineMs = Date.now() + SESSION_IDLE_TIMEOUT_MS) {
  if (sessionExpiryTimer) {
    window.clearTimeout(sessionExpiryTimer);
  }

  const delay = Math.max(1000, deadlineMs - Date.now());
  sessionExpiryTimer = window.setTimeout(() => {
    redirectToLogin("expired");
  }, delay);
}

async function logoutAndRedirect(reason = "logged-out") {
  try {
    await fetch(`${API_BASE}/api/session/logout`, {
      method: "POST",
      credentials: "same-origin"
    });
  } catch {
    // Ignore network failures here and still move the operator back to login.
  }

  redirectToLogin(reason);
}

async function fetchJson(path, options) {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: "same-origin",
      ...options
    });
  } catch (error) {
    const networkError = new Error(
      `Cannot reach the backend at ${API_BASE}. Make sure the Fleebee backend is running and reachable from this browser.`
    );
    networkError.cause = error;
    throw networkError;
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    if (response.status === 401) {
      redirectToLogin(typeof payload === "object" ? payload?.reason : "expired");
    }

    const error = new Error(
      typeof payload === "string"
        ? payload || `Request failed with ${response.status}`
        : payload.error || payload.note || `Request failed with ${response.status}`
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function noteUserActivity({ force = false } = {}) {
  scheduleSessionExpiry();

  const now = Date.now();
  if (!force && now - lastSessionTouchAt < SESSION_TOUCH_COOLDOWN_MS) {
    return;
  }

  if (sessionTouchInFlight) {
    return;
  }

  lastSessionTouchAt = now;
  sessionTouchInFlight = fetchJson("/api/session/touch", { method: "POST" })
    .then((payload) => {
      const expiresAtMs = Date.parse(payload.expiresAt || "");
      if (Number.isFinite(expiresAtMs)) {
        scheduleSessionExpiry(expiresAtMs);
      }
    })
    .catch((error) => {
      if (error.status !== 401) {
        console.warn("Session touch failed:", error);
      }
    })
    .finally(() => {
      sessionTouchInFlight = null;
    });
}

/* ---------- Modals ---------- */

function syncBodyModalState() {
  const anyOpen = [composeModal, bikerDetailModal].some(
    (modal) => modal && !modal.classList.contains("hidden")
  );
  document.body.classList.toggle("modal-open", anyOpen);
}

function openModal(element) {
  if (!element) {
    return;
  }

  element.classList.remove("hidden");
  element.setAttribute("aria-hidden", "false");
  syncBodyModalState();
}

function closeModal(element) {
  if (!element) {
    return;
  }

  element.classList.add("hidden");
  element.setAttribute("aria-hidden", "true");
  syncBodyModalState();
}

/* ---------- Data loading ---------- */

async function loadAll({ announce = false } = {}) {
  if (announce) {
    setNotice(pageNotice, "Refreshing live data...");
  }

  const health = await fetchJson("/health").catch(() => null);
  const [smsSettings, dashboard, bikers, messages, schedules] = await Promise.all([
    fetchJson("/api/settings/sms").catch(() => null),
    fetchJson("/api/dashboard"),
    fetchJson("/api/bikers"),
    fetchJson("/api/messages"),
    fetchJson("/api/schedules")
  ]);

  state.serverHealth = health;
  state.smsSettings = {
    passwordConfigured: Boolean(smsSettings?.passwordConfigured),
    signature: String(smsSettings?.signature || "")
  };
  state.summary = dashboard.summary;
  state.phone = dashboard.phone;
  state.testRoute = dashboard.testRoute;
  state.bikers = bikers.items;
  state.messages = [...messages.items].sort(
    (a, b) => (parseDateValue(b.createdAt)?.getTime() || 0) - (parseDateValue(a.createdAt)?.getTime() || 0)
  );
  state.schedules = schedules.items;
  state.lastUpdatedAt = new Date();

  if (state.editingBikerId && !state.bikers.some((biker) => biker.id === state.editingBikerId)) {
    clearBikerForm();
  }

  for (const id of state.selectedBikerIds) {
    if (!state.bikers.some((biker) => biker.id === id)) {
      state.selectedBikerIds.delete(id);
    }
  }

  for (const id of state.composeRecipients) {
    if (!state.bikers.some((biker) => biker.id === id && isActiveBiker(biker))) {
      state.composeRecipients.delete(id);
    }
  }

  renderAll();

  if (announce) {
    setNotice(pageNotice, "Everything is up to date.", "success");
  }
}

/* ---------- Shared rendering ---------- */

function renderShared() {
  const pageTitles = {
    overview: "Overview",
    "send-sms": "Send SMS",
    "scheduled-sms": "Scheduled SMS",
    "message-history": "Message History",
    gateway: "Gateway",
    bundles: "Bundles",
    recipients: "Recipients",
    "admin-settings": "Admin Settings"
  };

  document.title = `${APP_NAME} — ${pageTitles[PAGE_VIEW] || "Dashboard"}`;

  if (appNameLabel) {
    appNameLabel.textContent = APP_NAME;
  }
  if (apiBaseLabel) {
    apiBaseLabel.textContent = API_BASE;
  }
  if (testRouteLabel) {
    testRouteLabel.textContent = state.testRoute || "-";
  }

  if (phoneBadge && state.phone) {
    phoneBadge.textContent = state.phone.online ? "Phone online" : "Phone offline";
    phoneBadge.className = `badge ${state.phone.online ? "badge-online" : "badge-offline"}`;
  }

  if (bundleAlertButton) {
    const alertSignal = getBundleExpiryAlert(state.phone?.bundle);
    bundleAlertButton.classList.toggle("hidden", !alertSignal);
    bundleAlertButton.title = alertSignal?.note || "";
  }

  renderSidebarNav();
}

function messageEditorBody(message) {
  return String(message?.editorBody || message?.body || "").trim();
}

function renderSidebarNav() {
  if (!navLinks.length) {
    return;
  }

  for (const link of navLinks) {
    const active = link.dataset.navView === PAGE_VIEW;
    link.classList.toggle("active", active);
  }
}

/* ---------- Home page ---------- */

function renderServerHealth() {
  if (!serverStatusValue) {
    return;
  }

  const health = state.serverHealth;
  serverStatusValue.textContent = health && health.status === "ok" ? "Online" : "Unreachable";
  serverStatusValue.className = health && health.status === "ok" ? "value-good" : "value-bad";

  if (serverServiceValue) {
    serverServiceValue.textContent = health?.service || "fleebee-app";
  }
  if (serverStorageValue) {
    serverStorageValue.textContent = health?.storage ? health.storage.toUpperCase() : "-";
  }
  if (serverUpdatedValue) {
    serverUpdatedValue.textContent = state.lastUpdatedAt ? state.lastUpdatedAt.toLocaleTimeString() : "-";
  }
  if (serverBundlePolicyValue) {
    const intervalLabel = formatIntervalShort(BUNDLE_REFRESH_INTERVAL_MS);
    const nextCheck = state.phone?.bundle?.nextAutoCheckAt;
    serverBundlePolicyValue.textContent = intervalLabel
      ? nextCheck
        ? `Every ${intervalLabel}. Next ${formatDate(nextCheck)}`
        : `Every ${intervalLabel}`
      : "Manual only";
  }
}

function renderGatewayCard() {
  const phone = state.phone;
  if (!phone) {
    return;
  }

  if (phoneOnlineValue) {
    phoneOnlineValue.textContent = phone.online ? "Online" : "Offline";
    phoneOnlineValue.className = phone.online ? "value-good" : "value-bad";
  }
  if (phoneLocationValue) {
    phoneLocationValue.textContent = phone.fixedLocation || "-";
  }
  if (phoneNetworkValue) {
    phoneNetworkValue.textContent = phone.network || "-";
  }
  if (phoneHeartbeatValue) {
    phoneHeartbeatValue.textContent = formatDate(phone.lastHeartbeatAt);
  }
  if (phoneBatteryValue) {
    phoneBatteryValue.textContent = phone.batteryPolicy || "-";
  }
  if (phoneRouteValue) {
    phoneRouteValue.textContent = state.testRoute || phone.targetNumber || "-";
  }
}

function bundleStatusLabel(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "ok") return "Fresh";
  if (normalized === "requested") return "Requested";
  if (normalized === "checking") return "Checking";
  if (normalized === "permission-missing") return "Permission missing";
  if (normalized === "unsupported") return "Unsupported";
  if (normalized === "error") return "Error";
  return "Not checked yet";
}

function bundleStatusTone(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "ok") {
    return "value-good";
  }
  if (normalized === "error" || normalized === "permission-missing" || normalized === "unsupported") {
    return "value-bad";
  }
  return "value-warn";
}

function getBundleRawText(bundle) {
  return [bundle?.details, bundle?.summary, bundle?.lastError]
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
}

function extractBundleHighlights(bundle) {
  const rawText = getBundleRawText(bundle);
  const flatText = rawText.replace(/\s+/g, " ").trim();
  const smsMatch = flatText.match(/(\d+)\s*SMS\.\s*EXP\s*(\d{4}-\d{2}-\d{2})/i);
  const dataMatch = flatText.match(/Data\s*:?\s*([\d.]+)\s*MB\s*EXP\s*:?\s*(\d{4}-\d{2}-\d{2})/i);

  return {
    rawText,
    sms: smsMatch ? `${smsMatch[1]} SMS. EXP ${smsMatch[2]}` : "",
    smsExpiry: smsMatch ? smsMatch[2] : "",
    data: dataMatch ? `Data:${dataMatch[1]}MB EXP:${dataMatch[2]}` : "",
    dataExpiry: dataMatch ? dataMatch[2] : ""
  };
}

function buildExpiryAlertNote(label, daysLeft, expiryDate) {
  if (daysLeft == null) {
    return `${label} bundle expires on ${expiryDate}.`;
  }

  if (daysLeft < 0) {
    const daysAgo = Math.abs(daysLeft);
    return `${label} bundle expired ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago (${expiryDate}).`;
  }

  if (daysLeft === 0) {
    return `${label} bundle expires today (${expiryDate}).`;
  }

  if (daysLeft === 1) {
    return `${label} bundle expires tomorrow (${expiryDate}).`;
  }

  return `${label} bundle expires in ${daysLeft} days (${expiryDate}).`;
}

function getBundleExpiryAlert(bundle) {
  const highlights = extractBundleHighlights(bundle);
  const expiringItems = [
    {
      label: "SMS",
      expiryDate: highlights.smsExpiry,
      daysLeft: calendarDaysUntil(highlights.smsExpiry)
    },
    {
      label: "Data",
      expiryDate: highlights.dataExpiry,
      daysLeft: calendarDaysUntil(highlights.dataExpiry)
    }
  ]
    .filter((item) => item.expiryDate)
    .filter((item) => item.daysLeft != null && item.daysLeft <= 2)
    .sort((left, right) => left.daysLeft - right.daysLeft);

  if (!expiringItems.length) {
    return null;
  }

  const soonest = expiringItems[0];
  return {
    note: buildExpiryAlertNote(soonest.label, soonest.daysLeft, soonest.expiryDate)
  };
}

function bundleHighlightFallback(bundle) {
  const normalized = String(bundle?.status || "").trim().toLowerCase();

  if (normalized === "requested") return "Requested";
  if (normalized === "checking") return "Checking now";
  if (normalized === "error" || normalized === "permission-missing" || normalized === "unsupported") {
    return "Unavailable";
  }
  if (normalized === "unknown") return "Not checked yet";
  return "Not found";
}

function renderBundleCard() {
  const bundle = state.phone?.bundle;
  if (!bundle) {
    return;
  }

  const highlights = extractBundleHighlights(bundle);
  state.bundleDetailsOpen = state.bundleDetailsOpen && Boolean(highlights.rawText);

  if (bundleStatusValue) {
    bundleStatusValue.textContent = bundleStatusLabel(bundle.status);
    bundleStatusValue.className = bundleStatusTone(bundle.status);
  }
  if (bundleCheckedValue) {
    bundleCheckedValue.textContent = formatDate(bundle.checkedAt);
  }
  if (bundleSmsValue) {
    bundleSmsValue.textContent = highlights.sms || bundleHighlightFallback(bundle);
  }
  if (bundleDataValue) {
    bundleDataValue.textContent = highlights.data || bundleHighlightFallback(bundle);
  }
  if (bundleDetailsToggle) {
    bundleDetailsToggle.textContent = state.bundleDetailsOpen ? "Hide details" : "View full message";
  }
  if (bundleDetailsActionRow) {
    bundleDetailsActionRow.classList.toggle("hidden", !highlights.rawText);
  }
  if (bundleDetailsRow) {
    bundleDetailsRow.classList.toggle("hidden", !state.bundleDetailsOpen || !highlights.rawText);
  }
  if (bundleDetailsValue) {
    bundleDetailsValue.textContent = highlights.rawText || "No raw USSD response has been stored yet.";
  }
}

async function requestBundleCheckNow() {
  const actionButtons = [bundleRefreshButton, bundleAlertButton].filter(Boolean);
  if (!actionButtons.length) {
    return;
  }

  for (const button of actionButtons) {
    button.dataset.defaultLabel = button.dataset.defaultLabel || button.textContent;
    button.disabled = true;
    button.textContent = "Requesting...";
  }

  try {
    const response = await fetchJson("/api/phone/bundle/request", {
      method: "POST"
    });
    await loadAll();
    setNotice(
      pageNotice,
      response.note || "Bundle check requested. The phone should report back shortly.",
      "success"
    );
  } catch (error) {
    setNotice(pageNotice, error.message, "error");
  } finally {
    for (const button of actionButtons) {
      button.disabled = false;
      button.textContent = button.dataset.defaultLabel || "Check now";
    }
  }
}

function messageStatusDetail(message) {
  if (message.status === "pending") {
    const countdown = pendingCountdownLabel(message.availableAt);
    if (countdown === "ready now") {
      return "Ready for phone pickup";
    }

    return countdown ? `Releases in ${countdown}` : "In review window";
  }

  if (message.status === "queued") {
    return "Released to phone queue";
  }

  if (message.status === "submitted") {
    return "Handed to carrier";
  }

  if (message.status === "dispatched") {
    return "Claimed by phone";
  }

  if (message.status === "sent") {
    return message.resultAt ? `Delivered ${formatTimeShort(message.resultAt)}` : "Delivered";
  }

  if (message.status === "failed") {
    return message.failureReason || message.resultNote || "Send failed";
  }

  return "";
}

function isRevealed(messageId) {
  return state.revealTimers.has(messageId);
}

function toggleReveal(messageId) {
  const existingTimer = state.revealTimers.get(messageId);

  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer);
    state.revealTimers.delete(messageId);
  } else {
    const timer = window.setTimeout(() => {
      state.revealTimers.delete(messageId);
      renderRecentTable();
    }, REVEAL_HIDE_MS);
    state.revealTimers.set(messageId, timer);
  }

  renderRecentTable();
}

const EYE_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>`;

const EYE_OFF_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M2.5 12S6 5.5 12 5.5c1.9 0 3.6.65 5 1.55M21.5 12S18 18.5 12 18.5c-1.9 0-3.6-.65-5-1.55"/>
    <path d="M4 20L20 4"/>
  </svg>`;

function renderRecentTable() {
  if (!recentTableBody) {
    return;
  }

  const total = state.messages.length;
  const pageSize = state.recentPageSize;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  state.recentPage = Math.min(state.recentPage, pageCount - 1);

  const start = state.recentPage * pageSize;
  const pageItems = state.messages.slice(start, start + pageSize);

  if (recentPageLabel) {
    recentPageLabel.textContent = total === 0 ? "No messages" : `Page ${state.recentPage + 1} of ${pageCount}`;
  }
  if (recentPrevButton) {
    recentPrevButton.disabled = state.recentPage === 0;
  }
  if (recentNextButton) {
    recentNextButton.disabled = state.recentPage >= pageCount - 1;
  }

  if (pageItems.length === 0) {
    recentTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-table">No SMS have been sent yet. Use the New SMS button to send the first one.</td>
      </tr>
    `;
    return;
  }

  recentTableBody.innerHTML = pageItems.map((message) => {
    const revealed = isRevealed(message.id);
    const messageCell = revealed
      ? `<span class="revealed-text">${escapeHtml(message.body)}</span>`
      : `<span class="masked" aria-label="Hidden message">••••••••••</span>`;

    return `
      <tr>
        <td>
          <div class="table-cell-strong">${escapeHtml(message.bikerName)}</div>
          <div class="table-cell-muted">${escapeHtml(message.targetNumber || "")}</div>
        </td>
        <td>${escapeHtml(message.category)}</td>
        <td>
          <span class="status-chip ${escapeHtml(message.status)}">${escapeHtml(message.status.toUpperCase())}</span>
          <div class="table-cell-muted">${escapeHtml(messageStatusDetail(message))}</div>
        </td>
        <td class="message-cell">${messageCell}</td>
        <td>${escapeHtml(formatTimeShort(message.createdAt))}</td>
        <td>
          <button type="button" class="icon-button ${revealed ? "active" : ""}" data-action="toggle-reveal"
            data-message-id="${escapeHtml(message.id)}"
            aria-label="${revealed ? "Hide message" : "Show message for 5 seconds"}"
            title="${revealed ? "Hide message" : "Show message for 5 seconds"}">
            ${revealed ? EYE_OFF_ICON : EYE_ICON}
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

/* ---------- SMS page ---------- */

function renderSmsTable() {
  if (!smsTableBody) {
    return;
  }

  if (state.messages.length === 0) {
    smsTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-table">No SMS have been queued yet.</td>
      </tr>
    `;
    return;
  }

  smsTableBody.innerHTML = state.messages.map((message) => {
    const editable = message.status === "pending";
    const actions = editable
      ? `
        <button type="button" class="table-action" data-action="edit-message" data-message-id="${escapeHtml(message.id)}">Edit</button>
        <button type="button" class="table-action alert" data-action="delete-message" data-message-id="${escapeHtml(message.id)}">Delete</button>
      `
      : `<span class="table-cell-muted">Locked after release</span>`;

    return `
      <tr>
        <td>
          <div class="table-cell-strong">${escapeHtml(message.bikerName)}</div>
          <div class="table-cell-muted">${escapeHtml(message.targetNumber || "")}</div>
        </td>
        <td>
          <div>${escapeHtml(message.category)}</div>
          <div class="table-cell-muted">${escapeHtml(message.source === "scheduled" ? "from planner" : "direct send")}</div>
        </td>
        <td class="message-cell"><span class="revealed-text">${escapeHtml(message.body)}</span></td>
        <td>
          <span class="status-chip ${escapeHtml(message.status)}">${escapeHtml(message.status.toUpperCase())}</span>
          <div class="table-cell-muted">${escapeHtml(messageStatusDetail(message))}</div>
        </td>
        <td>${escapeHtml(formatDate(message.createdAt))}</td>
        <td><div class="table-actions">${actions}</div></td>
      </tr>
    `;
  }).join("");
}

function scheduleDispatchSummary(schedule) {
  if (!schedule.lastRunAt) {
    return "Not sent yet";
  }

  const status = String(schedule.lastDispatchStatus || "").trim().toLowerCase();
  const label = status === "pending"
    ? "pending review"
    : status === "queued"
      ? "waiting for phone"
    : status === "submitted"
      ? "sent to carrier"
      : status === "sent"
        ? "delivered"
        : status || "processed";

  return `${formatTimeShort(schedule.lastRunAt)} • ${label}`;
}

function renderScheduleTable() {
  if (!scheduleTableBody) {
    return;
  }

  if (state.schedules.length === 0) {
    scheduleTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-table">No scheduled sends yet. Use New SMS and pick "Schedule".</td>
      </tr>
    `;
    return;
  }

  scheduleTableBody.innerHTML = state.schedules.map((schedule) => {
    const nextSend = schedule.status === "completed"
      ? "Completed"
      : schedule.nextRunAt
        ? formatDate(schedule.nextRunAt)
        : "Paused";
    const toggleLabel = schedule.status === "paused" ? "Resume" : "Pause";
    const toggleButton = schedule.status === "completed"
      ? ""
      : `<button type="button" class="table-action" data-action="toggle-schedule" data-schedule-id="${escapeHtml(schedule.id)}">${toggleLabel}</button>`;

    return `
      <tr>
        <td>
          <div class="table-cell-strong">${escapeHtml(schedule.bikerName)}</div>
          <div class="table-cell-muted">${escapeHtml(schedule.category)}</div>
        </td>
        <td class="message-cell"><span class="revealed-text">${escapeHtml(schedule.body)}</span></td>
        <td>
          <div class="table-cell-strong">${escapeHtml(recurrenceLabel(schedule.recurrence))}</div>
          <div class="table-cell-muted">${escapeHtml(schedule.status)}</div>
        </td>
        <td>
          <div class="table-cell-strong">${escapeHtml(nextSend)}</div>
          <div class="table-cell-muted">Last: ${escapeHtml(scheduleDispatchSummary(schedule))}</div>
        </td>
        <td>
          <div class="table-actions">
            <button type="button" class="table-action" data-action="edit-schedule" data-schedule-id="${escapeHtml(schedule.id)}">Edit</button>
            ${toggleButton}
            <button type="button" class="table-action alert" data-action="delete-schedule" data-schedule-id="${escapeHtml(schedule.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderSmsSettingsStatus() {
  if (!smsSettingsNote) {
    return;
  }

  const signature = String(state.smsSettings.signature || "").trim();
  if (state.smsSettings.passwordConfigured && signature) {
    setNotice(
      smsSettingsNote,
      `SMS send password is configured. Signature will be appended automatically: ${signature}`,
      "success"
    );
    return;
  }

  if (state.smsSettings.passwordConfigured) {
    setNotice(
      smsSettingsNote,
      "SMS send password is configured. No signature is currently appended.",
      "success"
    );
    return;
  }

  setNotice(
    smsSettingsNote,
    "SMS send password is not configured yet. An admin must save it on this page before direct sends can be queued.",
    "muted"
  );
}

function renderSmsSettingsForm() {
  if (signatureInput && document.activeElement !== signatureInput) {
    signatureInput.value = state.smsSettings.signature || "";
  }
}

/* ---------- Settings page ---------- */

function isActiveBiker(biker) {
  return String(biker?.status || "").trim().toLowerCase() === "active";
}

function activeBikers() {
  return state.bikers.filter(isActiveBiker);
}

function bikerStatusSummary(biker) {
  const labels = [biker.status];
  if (biker.reminderDue) {
    labels.push("Reminder due");
  }
  if (biker.urgentAlert) {
    labels.push("Emergency open");
  }
  return labels.join(" | ");
}

function renderBikerTable() {
  if (!bikerTableBody) {
    return;
  }

  if (bikerTable) {
    bikerTable.classList.toggle("modify-mode", state.modifyMode);
  }

  if (bikerModifyButton) {
    bikerModifyButton.textContent = state.modifyMode ? "Done" : "Modify";
  }

  if (bikerBulkBar) {
    bikerBulkBar.classList.toggle("hidden", !state.modifyMode);
  }

  const selectedCount = state.selectedBikerIds.size;
  if (bulkCountLabel) {
    bulkCountLabel.textContent = selectedCount === 0
      ? "Select rows to edit or delete"
      : `${selectedCount} selected`;
  }
  if (bulkEditButton) {
    bulkEditButton.disabled = selectedCount !== 1;
  }
  if (bulkDeleteButton) {
    bulkDeleteButton.disabled = selectedCount === 0;
  }

  if (state.bikers.length === 0) {
    bikerTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-table">No recipients yet. Add the first one above.</td>
      </tr>
    `;
    return;
  }

  bikerTableBody.innerHTML = state.bikers.map((biker) => {
    const selected = state.selectedBikerIds.has(biker.id);
    const rowEdit = state.modifyMode && selected
      ? `<button type="button" class="table-action" data-action="edit-biker" data-biker-id="${escapeHtml(biker.id)}">Edit</button>`
      : "";

    return `
      <tr class="${selected ? "row-selected" : ""}">
        <td class="check-cell">
          <input type="checkbox" data-action="select-biker" data-biker-id="${escapeHtml(biker.id)}" ${selected ? "checked" : ""}
            aria-label="Select ${escapeHtml(biker.name)}">
        </td>
        <td><div class="table-cell-strong">${escapeHtml(biker.name)}</div></td>
        <td>${escapeHtml(biker.phoneNumber)}</td>
        <td>
          <div class="table-cell-strong">${escapeHtml(biker.bikePlate)}</div>
          <div class="table-cell-muted">${escapeHtml(biker.bikeModel)}</div>
        </td>
        <td>${escapeHtml(bikerStatusSummary(biker))}</td>
        <td>
          <div class="table-actions">
            <button type="button" class="table-action" data-action="biker-details" data-biker-id="${escapeHtml(biker.id)}">Details</button>
            ${rowEdit}
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderBikerFormState() {
  if (!bikerPanelTitle || !bikerSubmitButton) {
    return;
  }

  const biker = state.bikers.find((item) => item.id === state.editingBikerId) || null;

  if (!biker) {
    bikerPanelTitle.textContent = "Add Recipient";
    if (bikerPanelNote) {
      bikerPanelNote.textContent = "Fill in the rider's details, then save.";
    }
    bikerSubmitButton.textContent = "Add Recipient";
    if (bikerResetButton) {
      bikerResetButton.textContent = "Clear Form";
    }
    return;
  }

  bikerPanelTitle.textContent = `Edit ${biker.name}`;
  if (bikerPanelNote) {
    bikerPanelNote.textContent = "Change the details, then save.";
  }
  bikerSubmitButton.textContent = "Save Changes";
  if (bikerResetButton) {
    bikerResetButton.textContent = "Cancel Edit";
  }
}

function clearBikerForm() {
  state.editingBikerId = "";

  if (bikerForm) {
    bikerForm.reset();
  }
  if (statusInput) {
    statusInput.value = "Active";
  }
  renderBikerFormState();
}

function populateBikerForm(biker) {
  if (!biker || !nameInput) {
    clearBikerForm();
    return;
  }

  state.editingBikerId = biker.id;
  nameInput.value = biker.name;
  phoneInput.value = biker.phoneNumber;
  plateInput.value = biker.bikePlate;
  modelInput.value = biker.bikeModel;
  statusInput.value = biker.status === "Inactive" ? "Inactive" : "Active";
  reminderDueInput.checked = Boolean(biker.reminderDue);
  urgentAlertInput.checked = Boolean(biker.urgentAlert);
  renderBikerFormState();
  nameInput.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openBikerDetails(bikerId) {
  const biker = state.bikers.find((item) => item.id === bikerId);
  if (!biker || !bikerDetailModal || !bikerDetailBody) {
    return;
  }

  if (bikerDetailTitle) {
    bikerDetailTitle.textContent = biker.name;
  }

  const rows = [
    ["Phone number", biker.phoneNumber],
    ["Bike plate", biker.bikePlate],
    ["Bike model", biker.bikeModel],
    ["Status", biker.status],
    ["Reminder due", biker.reminderDue ? "Yes" : "No"],
    ["Emergency open", biker.urgentAlert ? "Yes" : "No"],
    ["Record ID", biker.id]
  ];

  bikerDetailBody.innerHTML = rows.map(([label, value]) => `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `).join("");

  if (bikerDetailEditButton) {
    bikerDetailEditButton.dataset.bikerId = biker.id;
  }

  openModal(bikerDetailModal);
}

async function deleteSelectedBikers() {
  const targets = state.bikers.filter((biker) => state.selectedBikerIds.has(biker.id));
  if (targets.length === 0) {
    return;
  }

  const names = targets.map((biker) => biker.name).join(", ");
  const confirmed = window.confirm(
    `Delete ${targets.length} biker${targets.length > 1 ? "s" : ""} (${names})? ` +
    "Bikers with SMS history cannot be deleted."
  );
  if (!confirmed) {
    return;
  }

  setNotice(pageNotice, "Deleting selected bikers...");
  const failures = [];

  for (const biker of targets) {
    try {
      await fetchJson(`/api/bikers/${encodeURIComponent(biker.id)}`, { method: "DELETE" });
      state.selectedBikerIds.delete(biker.id);
      if (state.editingBikerId === biker.id) {
        clearBikerForm();
      }
    } catch (error) {
      failures.push(`${biker.name}: ${error.message}`);
    }
  }

  await loadAll();

  if (failures.length > 0) {
    setNotice(pageNotice, `Some bikers were not deleted. ${failures.join(" — ")}`, "error");
  } else {
    setNotice(pageNotice, "Selected bikers deleted.", "success");
  }
}

/* ---------- Compose modal ---------- */

function renderComposeCategories() {
  if (!composeCategoryRow) {
    return;
  }

  [...composeCategoryRow.querySelectorAll(".category-pill")].forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.category === state.composeCategory);
  });
}

function renderComposeWhen() {
  if (composeWhenRow) {
    [...composeWhenRow.querySelectorAll(".category-pill")].forEach((pill) => {
      pill.classList.toggle("active", pill.dataset.when === state.composeWhen);
    });
  }

  const scheduling = state.composeWhen === "later" || state.composeMode === "edit-schedule";
  if (composeScheduleRow) {
    composeScheduleRow.classList.toggle("hidden", !scheduling);
  }

  const needsPassword = state.composeMode === "new" && state.composeWhen === "now";
  if (composePasswordRow) {
    composePasswordRow.classList.toggle("hidden", !needsPassword);
  }

  if (composeSubmit) {
    composeSubmit.textContent = state.composeMode === "edit-message"
      ? "Save Changes"
      : state.composeMode === "edit-schedule"
        ? "Save Schedule"
        : scheduling ? "Create Schedule" : "Send SMS";
  }
}

function syncComposeBikerOptions(selectedId) {
  if (!composeBiker) {
    return;
  }

  const recipients = activeBikers();
  const selectedBiker = state.bikers.find((biker) => biker.id === selectedId);
  const options = [...recipients];
  if (selectedBiker && !isActiveBiker(selectedBiker) && !options.some((biker) => biker.id === selectedBiker.id)) {
    options.unshift(selectedBiker);
  }

  if (options.length === 0) {
    composeBiker.innerHTML = '<option value="">No active bikers available</option>';
    composeBiker.value = "";
    return;
  }

  composeBiker.innerHTML = options.map((biker) => `
    <option value="${escapeHtml(biker.id)}">${escapeHtml(biker.name)} — ${escapeHtml(biker.bikePlate)}${isActiveBiker(biker) ? "" : " (Inactive)"}</option>
  `).join("");

  if (selectedId && options.some((biker) => biker.id === selectedId)) {
    composeBiker.value = selectedId;
  } else if (recipients[0]) {
    composeBiker.value = recipients[0].id;
  } else if (options[0]) {
    composeBiker.value = options[0].id;
  }
}

function renderComposeRecipients() {
  if (!composeRecipientList) {
    return;
  }

  const recipients = activeBikers();
  for (const id of [...state.composeRecipients]) {
    if (!recipients.some((biker) => biker.id === id)) {
      state.composeRecipients.delete(id);
    }
  }

  if (recipients.length === 0) {
    composeRecipientList.innerHTML = `
      <div class="empty-table">No active recipients available. Mark a rider Active in Recipients first.</div>
    `;
    if (composeRecipientCount) {
      composeRecipientCount.textContent = "0 of 0 selected";
    }
    if (composeAllBikers) {
      composeAllBikers.checked = false;
      composeAllBikers.indeterminate = false;
      composeAllBikers.disabled = true;
    }
    return;
  }

  composeRecipientList.innerHTML = recipients.map((biker) => `
    <label class="recipient-item">
      <input type="checkbox" data-recipient-id="${escapeHtml(biker.id)}" ${state.composeRecipients.has(biker.id) ? "checked" : ""}>
      <span class="recipient-name">${escapeHtml(biker.name)}</span>
      <span class="recipient-meta">${escapeHtml(biker.bikePlate)}</span>
    </label>
  `).join("");

  const total = recipients.length;
  const count = state.composeRecipients.size;

  if (composeRecipientCount) {
    composeRecipientCount.textContent = `${count} of ${total} selected`;
  }
  if (composeAllBikers) {
    composeAllBikers.disabled = false;
    composeAllBikers.checked = total > 0 && count === total;
    composeAllBikers.indeterminate = count > 0 && count < total;
  }
}

function applyComposeSuggestion(force = false) {
  if (!composeMessage || state.composeMode !== "new") {
    return;
  }

  let bikerName = "";
  if (state.composeRecipients.size === 1) {
    const only = state.bikers.find((biker) => state.composeRecipients.has(biker.id));
    bikerName = only?.name || "";
  }

  const suggested = suggestionFor(state.composeCategory, bikerName);
  const current = composeMessage.value.trim();

  if (force || !current || current === state.lastSuggestion) {
    composeMessage.value = suggested;
    state.lastSuggestion = suggested;
  }
}

function openCompose(mode = "new", target = null) {
  if (!composeModal || !composeForm) {
    return;
  }

  state.composeMode = mode;
  state.composeTargetId = target?.id || "";
  composeForm.reset();
  setNotice(composeNotice, "");

  if (composeWhenField) {
    composeWhenField.classList.toggle("hidden", mode !== "new");
  }
  if (composeRecipientsField) {
    composeRecipientsField.classList.toggle("hidden", mode !== "new");
  }
  if (composeBikerField) {
    composeBikerField.classList.toggle("hidden", mode === "new");
  }

  if (mode === "edit-message") {
    state.composeCategory = target.category;
    state.composeWhen = "now";
    if (composeTitle) composeTitle.textContent = "Edit Pending SMS";
    if (composeNote) composeNote.textContent = "Saving restarts the 2-minute wait before the phone sends it.";
    syncComposeBikerOptions(target.bikerId);
    if (composeMessage) composeMessage.value = messageEditorBody(target);
  } else if (mode === "edit-schedule") {
    state.composeCategory = target.category;
    state.composeWhen = "later";
    if (composeTitle) composeTitle.textContent = "Edit Scheduled Send";
    if (composeNote) composeNote.textContent = "Change the timing or message, then save.";
    syncComposeBikerOptions(target.bikerId);
    if (composeMessage) composeMessage.value = target.body;
    if (composeSendAt) composeSendAt.value = formatDateTimeInputValue(target.sendAt);
    if (composeRepeat) composeRepeat.value = String(target.recurrence || "ONCE").toUpperCase();
  } else {
    state.composeCategory = "REMINDER";
    state.composeWhen = "now";
    state.composeRecipients.clear();
    if (activeBikers().length === 1) {
      state.composeRecipients.add(activeBikers()[0].id);
    }
    state.lastSuggestion = "";
    if (composeTitle) composeTitle.textContent = "New SMS";
    if (composeNote) {
      const signature = String(state.smsSettings.signature || "").trim();
      composeNote.textContent = signature
        ? `Pick one or more bikers, then send now or schedule it. Current signature: ${signature}`
        : "Pick one or more bikers, then send now or schedule it.";
    }
    renderComposeRecipients();
    if (composeSendAt) {
      const nextHour = new Date(Date.now() + 60 * 60 * 1000);
      nextHour.setMinutes(0, 0, 0);
      composeSendAt.value = formatDateTimeInputValue(nextHour);
    }
    if (composeRepeat) composeRepeat.value = "ONCE";
    applyComposeSuggestion(true);
  }

  if (composePassword) {
    composePassword.value = "";
  }
  renderComposeCategories();
  renderComposeWhen();
  openModal(composeModal);
  composeMessage?.focus();
}

function bikerNameById(bikerId) {
  return state.bikers.find((biker) => biker.id === bikerId)?.name || "Unknown biker";
}

async function submitCompose() {
  const bikerId = composeBiker?.value || "";
  const body = composeMessage?.value.trim() || "";
  const recipientIds = state.composeMode === "new" ? [...state.composeRecipients] : [bikerId];

  if (recipientIds.length === 0 || !recipientIds[0]) {
    setNotice(composeNotice, "Select at least one biker first.", "error");
    return;
  }
  if (!body) {
    setNotice(composeNotice, "Write a message first.", "error");
    return;
  }

  if (state.composeMode === "edit-message") {
    setNotice(composeNotice, "Saving changes...");
    const response = await fetchJson(`/api/messages/${encodeURIComponent(state.composeTargetId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bikerId, category: state.composeCategory, body })
    });

    closeModal(composeModal);
    await loadAll();
    setNotice(pageNotice, response.note || "Pending SMS updated. The 2-minute wait restarted.", "success");
    return;
  }

  if (state.composeMode === "edit-schedule" || state.composeWhen === "later") {
    const rawSendAt = composeSendAt?.value || "";
    if (!rawSendAt) {
      setNotice(composeNotice, "Choose the date and time to send.", "error");
      return;
    }

    const basePayload = {
      category: state.composeCategory,
      recurrence: composeRepeat?.value || "ONCE",
      sendAt: new Date(rawSendAt).toISOString(),
      body
    };

    if (state.composeMode === "edit-schedule") {
      setNotice(composeNotice, "Saving schedule...");
      await fetchJson(`/api/schedules/${encodeURIComponent(state.composeTargetId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...basePayload, bikerId })
      });

      closeModal(composeModal);
      await loadAll();
      setNotice(pageNotice, "Schedule updated.", "success");
      return;
    }

    setNotice(composeNotice, `Creating ${recipientIds.length} schedule${recipientIds.length > 1 ? "s" : ""}...`);
    let created = 0;
    const failures = [];

    for (const recipientId of recipientIds) {
      try {
        await fetchJson("/api/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...basePayload, bikerId: recipientId })
        });
        created += 1;
      } catch (error) {
        failures.push(`${bikerNameById(recipientId)}: ${error.message}`);
      }
    }

    if (created === 0) {
      setNotice(composeNotice, `Nothing was scheduled. ${failures.join(" — ")}`, "error");
      return;
    }

    closeModal(composeModal);
    await loadAll();
    setNotice(
      pageNotice,
      failures.length > 0
        ? `Scheduled ${created} of ${recipientIds.length}. Failed — ${failures.join(" — ")}`
        : `Scheduled ${created} send${created > 1 ? "s" : ""} for ${formatDate(basePayload.sendAt)}.`,
      failures.length > 0 ? "error" : "success"
    );
    return;
  }

  const password = composePassword?.value || "";
  if (!password) {
    setNotice(composeNotice, "Enter the SMS send password to continue.", "error");
    if (composePasswordRow) {
      composePasswordRow.classList.remove("hidden");
    }
    composePassword?.focus();
    return;
  }

  setNotice(composeNotice, `Queueing ${recipientIds.length} SMS...`);
  let queued = 0;
  let lastAvailableAt = null;
  let authFailed = false;
  const failures = [];

  for (const recipientId of recipientIds) {
    try {
      const response = await fetchJson("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bikerId: recipientId, category: state.composeCategory, body, password })
      });
      queued += 1;
      lastAvailableAt = response.item?.availableAt || lastAvailableAt;
    } catch (error) {
      if (error.status === 401) {
        authFailed = true;
        break;
      }
      failures.push(`${bikerNameById(recipientId)}: ${error.message}`);
    }
  }

  if (queued > 0) {
    await loadAll();
  }

  if (authFailed) {
    setNotice(
      composeNotice,
      queued > 0
        ? `Wrong SMS send password — stopped after queueing ${queued} of ${recipientIds.length}.`
        : "Wrong SMS send password.",
      "error"
    );
    if (composePasswordRow) {
      composePasswordRow.classList.remove("hidden");
    }
    composePassword?.focus();
    composePassword?.select();
    return;
  }

  if (queued === 0) {
    setNotice(composeNotice, `Nothing was queued. ${failures.join(" — ")}`, "error");
    return;
  }

  closeModal(composeModal);
  setNotice(
    pageNotice,
    failures.length > 0
      ? `Queued ${queued} of ${recipientIds.length} SMS. Failed — ${failures.join(" — ")}`
      : `Queued ${queued} SMS. ${lastAvailableAt ? `They release at ${formatDate(lastAvailableAt)} — until then you can edit or delete them on the SMS page.` : ""}`,
    failures.length > 0 ? "error" : "success"
  );
}

/* ---------- Message and schedule actions ---------- */

async function handleDeleteMessage(messageId) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message) {
    return;
  }

  if (!window.confirm(`Delete the pending SMS for ${message.bikerName}?`)) {
    return;
  }

  try {
    const response = await fetchJson(`/api/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" });
    await loadAll();
    setNotice(pageNotice, response.note || "Pending SMS deleted.", "success");
  } catch (error) {
    setNotice(pageNotice, error.message, "error");
  }
}

async function handleDeleteSchedule(scheduleId) {
  const schedule = state.schedules.find((item) => item.id === scheduleId);
  if (!schedule) {
    return;
  }

  if (!window.confirm(`Delete the schedule for ${schedule.bikerName}?`)) {
    return;
  }

  try {
    await fetchJson(`/api/schedules/${encodeURIComponent(scheduleId)}`, { method: "DELETE" });
    await loadAll();
    setNotice(pageNotice, "Schedule deleted.", "success");
  } catch (error) {
    setNotice(pageNotice, error.message, "error");
  }
}

async function handleToggleSchedule(scheduleId) {
  const schedule = state.schedules.find((item) => item.id === scheduleId);
  if (!schedule) {
    return;
  }

  const nextStatus = schedule.status === "paused" ? "active" : "paused";

  try {
    await fetchJson(`/api/schedules/${encodeURIComponent(scheduleId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bikerId: schedule.bikerId,
        category: schedule.category,
        recurrence: schedule.recurrence,
        sendAt: schedule.sendAt,
        body: schedule.body,
        status: nextStatus
      })
    });

    await loadAll();
    setNotice(pageNotice, nextStatus === "active" ? "Schedule resumed." : "Schedule paused.", "success");
  } catch (error) {
    setNotice(pageNotice, error.message, "error");
  }
}

/* ---------- Render root ---------- */

function renderAll() {
  renderShared();
  renderServerHealth();
  renderGatewayCard();
  renderBundleCard();
  renderRecentTable();
  renderSmsTable();
  renderScheduleTable();
  renderSmsSettingsForm();
  renderSmsSettingsStatus();
  renderBikerTable();
  renderBikerFormState();
}

/* ---------- Event wiring ---------- */

if (refreshButton) {
  refreshButton.addEventListener("click", () => {
    loadAll({ announce: true }).catch((error) => {
      setNotice(pageNotice, error.message, "error");
    });
  });
}

if (logoutButton) {
  logoutButton.addEventListener("click", () => {
    logoutAndRedirect();
  });
}

if (newSmsButton) {
  newSmsButton.addEventListener("click", () => {
    openCompose("new");
  });
}

if (sendSmsSectionButton) {
  sendSmsSectionButton.addEventListener("click", () => {
    openCompose("new");
  });
}

if (bundleRefreshButton) {
  bundleRefreshButton.addEventListener("click", () => {
    requestBundleCheckNow();
  });
}

if (bundleAlertButton) {
  bundleAlertButton.addEventListener("click", () => {
    requestBundleCheckNow();
  });
}

if (bundleDetailsToggle) {
  bundleDetailsToggle.addEventListener("click", () => {
    state.bundleDetailsOpen = !state.bundleDetailsOpen;
    renderBundleCard();
  });
}

if (newScheduleButton) {
  newScheduleButton.addEventListener("click", () => {
    openCompose("new");
    state.composeWhen = "later";
    renderComposeWhen();
  });
}

if (recentPageSizeSelect) {
  recentPageSizeSelect.addEventListener("change", () => {
    state.recentPageSize = Number(recentPageSizeSelect.value) || 5;
    state.recentPage = 0;
    renderRecentTable();
  });
}

if (recentPrevButton) {
  recentPrevButton.addEventListener("click", () => {
    state.recentPage = Math.max(0, state.recentPage - 1);
    renderRecentTable();
  });
}

if (recentNextButton) {
  recentNextButton.addEventListener("click", () => {
    state.recentPage += 1;
    renderRecentTable();
  });
}

if (recentTableBody) {
  recentTableBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='toggle-reveal']");
    if (button) {
      toggleReveal(button.dataset.messageId);
    }
  });
}

if (smsTableBody) {
  smsTableBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }

    const messageId = button.dataset.messageId;
    if (button.dataset.action === "edit-message") {
      const message = state.messages.find((item) => item.id === messageId);
      if (message && message.status === "pending") {
        openCompose("edit-message", message);
      } else {
        setNotice(pageNotice, "Only pending SMS can be edited.", "error");
      }
    } else if (button.dataset.action === "delete-message") {
      handleDeleteMessage(messageId);
    }
  });
}

if (scheduleTableBody) {
  scheduleTableBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }

    const scheduleId = button.dataset.scheduleId;
    if (button.dataset.action === "edit-schedule") {
      const schedule = state.schedules.find((item) => item.id === scheduleId);
      if (schedule) {
        openCompose("edit-schedule", schedule);
      }
    } else if (button.dataset.action === "toggle-schedule") {
      handleToggleSchedule(scheduleId);
    } else if (button.dataset.action === "delete-schedule") {
      handleDeleteSchedule(scheduleId);
    }
  });
}

if (saveSmsSettingsButton) {
  saveSmsSettingsButton.addEventListener("click", async () => {
    const adminPassword = adminPasswordInput?.value.trim() || "";
    const dispatchPassword = dispatchPasswordSettingInput?.value || "";
    const signature = signatureInput?.value || "";

    if (!adminPassword) {
      setNotice(smsSettingsNote, "Enter the admin password before changing SMS settings.", "error");
      adminPasswordInput?.focus();
      return;
    }

    setNotice(smsSettingsNote, "Saving SMS settings...");

    try {
      const response = await fetchJson("/api/settings/sms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminPassword,
          dispatchPassword,
          signature
        })
      });

      state.smsSettings = {
        passwordConfigured: Boolean(response.passwordConfigured),
        signature: String(response.signature || "")
      };

      if (adminPasswordInput) {
        adminPasswordInput.value = "";
      }
      if (dispatchPasswordSettingInput) {
        dispatchPasswordSettingInput.value = "";
      }

      renderSmsSettingsForm();
      renderSmsSettingsStatus();
    } catch (error) {
      setNotice(smsSettingsNote, error.message, "error");
    }
  });
}

if (bikerForm) {
  bikerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      name: nameInput?.value || "",
      phoneNumber: phoneInput?.value || "",
      bikePlate: plateInput?.value || "",
      bikeModel: modelInput?.value || "",
      status: statusInput?.value || "Active",
      reminderDue: reminderDueInput?.checked || false,
      urgentAlert: urgentAlertInput?.checked || false
    };
    const editingId = state.editingBikerId;

    setNotice(bikerNotice, editingId ? "Saving changes..." : "Adding biker...");

    try {
      await fetchJson(editingId ? `/api/bikers/${encodeURIComponent(editingId)}` : "/api/bikers", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      clearBikerForm();
      await loadAll();
      setNotice(bikerNotice, editingId ? "Biker updated." : "Biker added.", "success");
    } catch (error) {
      setNotice(bikerNotice, error.message, "error");
    }
  });
}

if (bikerResetButton) {
  bikerResetButton.addEventListener("click", () => {
    clearBikerForm();
    setNotice(bikerNotice, "Form cleared.", "success");
  });
}

if (bikerModifyButton) {
  bikerModifyButton.addEventListener("click", () => {
    state.modifyMode = !state.modifyMode;
    if (!state.modifyMode) {
      state.selectedBikerIds.clear();
    }
    renderBikerTable();
  });
}

if (bikerTableBody) {
  bikerTableBody.addEventListener("click", (event) => {
    const checkbox = event.target.closest("[data-action='select-biker']");
    if (checkbox) {
      if (checkbox.checked) {
        state.selectedBikerIds.add(checkbox.dataset.bikerId);
      } else {
        state.selectedBikerIds.delete(checkbox.dataset.bikerId);
      }
      renderBikerTable();
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }

    const bikerId = button.dataset.bikerId;
    if (button.dataset.action === "biker-details") {
      openBikerDetails(bikerId);
    } else if (button.dataset.action === "edit-biker") {
      const biker = state.bikers.find((item) => item.id === bikerId);
      populateBikerForm(biker);
      setNotice(bikerNotice, `Editing ${biker?.name || "biker"}.`, "success");
    }
  });
}

if (bulkEditButton) {
  bulkEditButton.addEventListener("click", () => {
    const [selectedId] = [...state.selectedBikerIds];
    const biker = state.bikers.find((item) => item.id === selectedId);
    if (biker) {
      populateBikerForm(biker);
      setNotice(bikerNotice, `Editing ${biker.name}.`, "success");
    }
  });
}

if (bulkDeleteButton) {
  bulkDeleteButton.addEventListener("click", () => {
    deleteSelectedBikers();
  });
}

if (bikerDetailEditButton) {
  bikerDetailEditButton.addEventListener("click", () => {
    const biker = state.bikers.find((item) => item.id === bikerDetailEditButton.dataset.bikerId);
    closeModal(bikerDetailModal);
    if (biker) {
      populateBikerForm(biker);
      setNotice(bikerNotice, `Editing ${biker.name}.`, "success");
    }
  });
}

if (composeForm) {
  composeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitCompose().catch((error) => {
      setNotice(composeNotice, error.message, "error");
    });
  });
}

if (composeCategoryRow) {
  composeCategoryRow.addEventListener("click", (event) => {
    const pill = event.target.closest(".category-pill");
    if (!pill) {
      return;
    }

    state.composeCategory = pill.dataset.category;
    renderComposeCategories();
    applyComposeSuggestion();
  });
}

if (composeRecipientList) {
  composeRecipientList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-recipient-id]");
    if (!checkbox) {
      return;
    }

    if (checkbox.checked) {
      state.composeRecipients.add(checkbox.dataset.recipientId);
    } else {
      state.composeRecipients.delete(checkbox.dataset.recipientId);
    }
    renderComposeRecipients();
    applyComposeSuggestion();
  });
}

if (composeAllBikers) {
  composeAllBikers.addEventListener("change", () => {
    if (composeAllBikers.checked) {
      activeBikers().forEach((biker) => state.composeRecipients.add(biker.id));
    } else {
      state.composeRecipients.clear();
    }
    renderComposeRecipients();
    applyComposeSuggestion();
  });
}

if (composeWhenRow) {
  composeWhenRow.addEventListener("click", (event) => {
    const pill = event.target.closest(".category-pill");
    if (!pill) {
      return;
    }

    state.composeWhen = pill.dataset.when;
    renderComposeWhen();
  });
}


document.addEventListener("click", (event) => {
  const closer = event.target.closest("[data-close-modal]");
  if (!closer) {
    return;
  }

  if (closer.dataset.closeModal === "compose") {
    closeModal(composeModal);
  } else if (closer.dataset.closeModal === "biker-detail") {
    closeModal(bikerDetailModal);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (composeModal && !composeModal.classList.contains("hidden")) {
    closeModal(composeModal);
  }
  if (bikerDetailModal && !bikerDetailModal.classList.contains("hidden")) {
    closeModal(bikerDetailModal);
  }
});

["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
  document.addEventListener(eventName, () => {
    noteUserActivity();
  }, { passive: true });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    noteUserActivity({ force: true });
  }
});

/* ---------- Boot ---------- */

renderShared();
scheduleSessionExpiry();
noteUserActivity({ force: true });

loadAll().catch((error) => {
  setNotice(pageNotice, `Could not load backend data: ${error.message}`, "error");
});

window.setInterval(() => {
  loadAll().catch((error) => {
    setNotice(pageNotice, `Could not refresh live data: ${error.message}`, "error");
  });
}, REFRESH_INTERVAL_MS);

window.setInterval(() => {
  const hasPending = state.messages.some(
    (message) => message.status === "pending" && parseDateValue(message.availableAt)
  );
  if (!hasPending) {
    return;
  }

  renderRecentTable();
  renderSmsTable();
}, 1000);
