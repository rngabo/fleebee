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
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const REVEAL_HIDE_MS = 5000;
const SESSION_TOUCH_COOLDOWN_MS = Math.min(
  60 * 1000,
  Math.max(15 * 1000, Math.floor(SESSION_IDLE_TIMEOUT_MS / 4))
);
const DEFAULT_WORKFLOW_STAGES = [
  "LEAD_CAPTURED",
  "PREPARATION",
  "BIKES_ORDERED",
  "WAITING_FOR_COMPANY",
  "BIKE_DETAILS_RECEIVED",
  "PLATE_ASSIGNED",
  "INSURANCE_IN_PROGRESS",
  "INSURANCE_COMPLETED",
  "AUTHORIZATION_IN_PROGRESS",
  "AUTHORIZATION_PENDING",
  "AUTHORIZATION_COMPLETED",
  "PICKUP_READY",
  "PICKUP_SCHEDULED",
  "AT_COMPANY",
  "AT_NOTARY",
  "DELIVERED",
  "WELCOME_SENT",
  "PAYMENT_REMINDER",
  "FINE_RECORDED"
];
const DEFAULT_WORKFLOW_CATEGORIES = [
  "onboarding",
  "preparation",
  "progress-update",
  "insurance",
  "authorization",
  "pickup",
  "notary",
  "welcome",
  "payment-reminder",
  "fine-notice",
  "safety",
  "service-information",
  "cleanliness",
  "batch-notice",
  "emergency"
];
const DEFAULT_WORKFLOW_URGENCIES = ["normal", "important", "urgent"];
const BATCH_SEND_GROUP_KIND = "batch";
const BASE_SCHEDULE_REPEAT_OPTIONS = [
  { value: "ONCE", label: "Occasionally" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "EVERY_2_MONTHS", label: "After 2 months" },
  { value: "EVERY_3_MONTHS", label: "After 3 months" },
  { value: "EVERY_4_MONTHS", label: "After 4 months" },
  { value: "EVERY_5_MONTHS", label: "After 5 months" }
];

const state = {
  bikers: [],
  batches: [],
  bikes: [],
  fines: [],
  messages: [],
  schedules: [],
  templates: [],
  workflowOptions: {
    stages: [...DEFAULT_WORKFLOW_STAGES],
    categories: [...DEFAULT_WORKFLOW_CATEGORIES],
    urgencies: [...DEFAULT_WORKFLOW_URGENCIES]
  },
  phone: null,
  adb: null,
  summary: null,
  serverHealth: null,
  testRoute: "",
  smsSettings: {
    passwordConfigured: false,
    signature: "",
    gatewayMode: "registered-bikers",
    gatewayTargetNumber: ""
  },
  smsSettingsDraft: {
    active: false,
    signature: "",
    gatewayMode: "registered-bikers"
  },
  lastUpdatedAt: null,
  recentPage: 0,
  recentPageSize: 5,
  revealTimers: new Map(),
  expandedRecentBatchIds: new Set(),
  retryingMessageIds: new Set(),
  composeMode: "new",
  composeTargetId: "",
  composeTargetMode: "current",
  composeBatchId: "",
  composeBodyMode: "template",
  composeTemplateId: "",
  composeCategory: "REMINDER",
  composeWhen: "now",
  composeRecipients: new Set(),
  lastSuggestion: "",
  bundleDetailsOpen: false,
  modifyMode: false,
  bikerStatusFilter: "all",
  selectedBikerIds: new Set(),
  editingBikerId: "",
  editingBatchId: "",
  editingBikeId: "",
  editingTemplateId: "",
  recipientBatchTargetId: String(PAGE_PARAMS.get("batchId") || "").trim(),
  recipientBatchTargetName: String(PAGE_PARAMS.get("batchName") || "").trim()
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
const phoneAdbValue = $("phoneAdbValue");
const phoneBatteryValue = $("phoneBatteryValue");
const phoneRouteValue = $("phoneRouteValue");
const bundleRefreshButton = $("bundleRefreshButton");
const bundleStatusValue = $("bundleStatusValue");
const bundleCheckedValue = $("bundleCheckedValue");
const bundlePlanRow = $("bundlePlanRow");
const bundlePlanValue = $("bundlePlanValue");
const bundleVoiceRow = $("bundleVoiceRow");
const bundleVoiceValue = $("bundleVoiceValue");
const bundleSmsValue = $("bundleSmsValue");
const bundleDataValue = $("bundleDataValue");
const bundleBuyAgainRow = $("bundleBuyAgainRow");
const bundleBuyAgainValue = $("bundleBuyAgainValue");
const bundleSmsUsageRow = $("bundleSmsUsageRow");
const bundleSmsUsageValue = $("bundleSmsUsageValue");
const bundleDetailsActionRow = $("bundleDetailsActionRow");
const bundleDetailsToggle = $("bundleDetailsToggle");
const bundleDetailsRow = $("bundleDetailsRow");
const bundleDetailsValue = $("bundleDetailsValue");
const recentTableBody = $("recentTableBody");
const recentPageSizeSelect = $("recentPageSizeSelect");
const recentPrevButton = $("recentPrevButton");
const recentNextButton = $("recentNextButton");
const recentPageLabel = $("recentPageLabel");
const overviewRecurringScheduleBody = $("overviewRecurringScheduleBody");

const smsTableBody = $("smsTableBody");
const scheduleTableBody = $("scheduleTableBody");
const newScheduleButton = $("newScheduleButton");
const adminPasswordInput = $("adminPasswordInput");
const gatewayModeInput = $("gatewayModeInput");
const gatewayModeToggle = $("gatewayModeToggle");
const gatewayModeLabel = $("gatewayModeLabel");
const gatewayModeHint = $("gatewayModeHint");
const gatewayTargetNumberDisplay = $("gatewayTargetNumberDisplay");
const dispatchPasswordSettingInput = $("dispatchPasswordSettingInput");
const signatureInput = $("signatureInput");
const saveSmsSettingsButton = $("saveSmsSettingsButton");
const smsSettingsNote = $("smsSettingsNote");

const bikerForm = $("bikerForm");
const nameInput = $("nameInput");
const firstNameInput = $("firstNameInput");
const phoneInput = $("phoneInput");
const plateInput = $("plateInput");
const modelInput = $("modelInput");
const statusInput = $("statusInput");
const bikerBatchInput = $("bikerBatchInput");
const notificationsEnabledInput = $("notificationsEnabledInput");
const teamLeaderInput = $("teamLeaderInput");
const notesInput = $("notesInput");
const reminderDueInput = $("reminderDueInput");
const urgentAlertInput = $("urgentAlertInput");
const bikerSubmitButton = $("bikerSubmitButton");
const bikerResetButton = $("bikerResetButton");
const bikerPanelTitle = $("bikerPanelTitle");
const bikerPanelNote = $("bikerPanelNote");
const bikerNotice = $("bikerNotice");
const recipientBatchFlowBar = $("recipientBatchFlowBar");
const recipientBatchFlowLabel = $("recipientBatchFlowLabel");
const recipientBatchFlowClearButton = $("recipientBatchFlowClearButton");
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

const batchForm = $("batchForm");
const batchNameInput = $("batchNameInput");
const batchCodeInput = $("batchCodeInput");
const batchExpectedDeliveryInput = $("batchExpectedDeliveryInput");
const batchLeaseEndInput = $("batchLeaseEndInput");
const batchNotesInput = $("batchNotesInput");
const batchSubmitButton = $("batchSubmitButton");
const batchResetButton = $("batchResetButton");
const batchPanelTitle = $("batchPanelTitle");
const batchNotice = $("batchNotice");
const batchTableBody = $("batchTableBody");

const bikeForm = $("bikeForm");
const bikeRecipientInput = $("bikeRecipientInput");
const bikeBatchInput = $("bikeBatchInput");
const bikePlateInput = $("bikePlateInput");
const bikeChassisInput = $("bikeChassisInput");
const bikeModelInput = $("bikeModelInput");
const bikeStageInput = $("bikeStageInput");
const bikeInsuranceStatusInput = $("bikeInsuranceStatusInput");
const bikeAuthorizationStatusInput = $("bikeAuthorizationStatusInput");
const bikePickupStatusInput = $("bikePickupStatusInput");
const bikeOfficialStartInput = $("bikeOfficialStartInput");
const bikeNextPaymentInput = $("bikeNextPaymentInput");
const bikeNotificationsEnabledInput = $("bikeNotificationsEnabledInput");
const bikeKnownIssuesInput = $("bikeKnownIssuesInput");
const bikeMaintenanceNotesInput = $("bikeMaintenanceNotesInput");
const bikeNotesInput = $("bikeNotesInput");
const bikeSubmitButton = $("bikeSubmitButton");
const bikeResetButton = $("bikeResetButton");
const bikePanelTitle = $("bikePanelTitle");
const bikeNotice = $("bikeNotice");
const bikeTableBody = $("bikeTableBody");

const progressForm = $("progressForm");
const progressBikeInput = $("progressBikeInput");
const progressStageInput = $("progressStageInput");
const progressCategoryInput = $("progressCategoryInput");
const progressUrgencyInput = $("progressUrgencyInput");
const progressNoteInput = $("progressNoteInput");
const progressNotifyInput = $("progressNotifyInput");
const progressNotice = $("progressNotice");
const progressTableBody = $("progressTableBody");

const fineForm = $("fineForm");
const fineBikeInput = $("fineBikeInput");
const fineAmountInput = $("fineAmountInput");
const fineReasonInput = $("fineReasonInput");
const fineDateInput = $("fineDateInput");
const fineDeadlineInput = $("fineDeadlineInput");
const fineSourceInput = $("fineSourceInput");
const fineUrgencyInput = $("fineUrgencyInput");
const fineNotifyInput = $("fineNotifyInput");
const fineNotice = $("fineNotice");
const fineTableBody = $("fineTableBody");

const templateForm = $("templateForm");
const templateStageInput = $("templateStageInput");
const templateCategoryInput = $("templateCategoryInput");
const templateUrgencyInput = $("templateUrgencyInput");
const templateTitleInput = $("templateTitleInput");
const templateBodyInput = $("templateBodyInput");
const templateActiveInput = $("templateActiveInput");
const templateIncludeSignatureInput = $("templateIncludeSignatureInput");
const templateSubmitButton = $("templateSubmitButton");
const templateResetButton = $("templateResetButton");
const templatePanelTitle = $("templatePanelTitle");
const templateNotice = $("templateNotice");
const templateTableBody = $("templateTableBody");

const composeModal = $("composeModal");
const composeForm = $("composeForm");
const composeTitle = $("composeTitle");
const composeNote = $("composeNote");
const composeTargetTabsField = $("composeTargetTabsField");
const composeTargetTabs = $("composeTargetTabs");
const composeBiker = $("composeBiker");
const composeBikerField = $("composeBikerField");
const composeRecipientsField = $("composeRecipientsField");
const composeRecipientList = $("composeRecipientList");
const composeAllBikers = $("composeAllBikers");
const composeRecipientCount = $("composeRecipientCount");
const composeBatchField = $("composeBatchField");
const composeBatchSelect = $("composeBatchSelect");
const composeBatchNotice = $("composeBatchNotice");
const composeBatchRecipientCount = $("composeBatchRecipientCount");
const composeBatchRecipientList = $("composeBatchRecipientList");
const composeBodyModeField = $("composeBodyModeField");
const composeBodyModeRow = $("composeBodyModeRow");
const composeCategoryField = $("composeCategoryField");
const composeCategorySelect = $("composeCategorySelect");
const composeTemplateField = $("composeTemplateField");
const composeTemplateSelect = $("composeTemplateSelect");
const composeTemplateMeta = $("composeTemplateMeta");
const composeTemplatePreviewField = $("composeTemplatePreviewField");
const composeTemplatePreviewLabel = $("composeTemplatePreviewLabel");
const composeTemplatePreview = $("composeTemplatePreview");
const composePreviewModeHint = $("composePreviewModeHint");
const composeMessageField = $("composeMessageField");
const composeMessage = $("composeMessage");
const composeWhenField = $("composeWhenField");
const composeWhenRow = $("composeWhenRow");
const composeScheduleRow = $("composeScheduleRow");
const composeScheduleQuickDay = $("composeScheduleQuickDay");
const composeScheduleQuickHint = $("composeScheduleQuickHint");
const composeSendAt = $("composeSendAt");
const composeRepeat = $("composeRepeat");
const composeNotice = $("composeNotice");
const composeSubmit = $("composeSubmit");
const composeRouteStatus = $("composeRouteStatus");
const sendPasswordModal = $("sendPasswordModal");
const sendPasswordForm = $("sendPasswordForm");
const sendPasswordCopy = $("sendPasswordCopy");
const sendPasswordInput = $("sendPasswordInput");
const sendPasswordNotice = $("sendPasswordNotice");
const sendPasswordSubmit = $("sendPasswordSubmit");

let sessionExpiryTimer = 0;
let lastSessionTouchAt = 0;
let sessionTouchInFlight = null;
let pendingSendPasswordResolver = null;

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

function formatDateOnly(value) {
  const date = parseDateValue(value);
  return date ? date.toLocaleDateString() : "-";
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

function formatDateInputValue(value) {
  const date = parseDateValue(value);
  if (!date) {
    return "";
  }

  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function nextRoundedHourDate(from = new Date()) {
  const nextHour = new Date(from.getTime() + 60 * 60 * 1000);
  nextHour.setMinutes(0, 0, 0);
  return nextHour;
}

function buildScheduleQuickDayOptions(count = 4, from = new Date()) {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);

  return Array.from({ length: count }, (_, index) => {
    const offset = index + 1;
    const optionDate = new Date(start);
    optionDate.setDate(start.getDate() + offset);
    const weekdayLabel = optionDate.toLocaleDateString([], { weekday: "long" });
    const dateLabel = optionDate.toLocaleDateString([], { month: "short", day: "numeric" });

    return {
      value: formatDateInputValue(optionDate),
      label: offset === 1
        ? `Tomorrow — ${weekdayLabel}, ${dateLabel}`
        : `${weekdayLabel}, ${dateLabel}`
    };
  });
}

function createClientId(prefix = "id") {
  const randomId = window.crypto?.randomUUID?.();
  if (randomId) {
    return `${prefix}-${randomId}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

function currentComposeScheduleDateValue() {
  return formatDateInputValue(composeSendAt?.value || "");
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
  if (normalized === "DAILY") return "Daily (legacy)";
  if (normalized === "WEEKLY") return "Weekly (legacy)";
  if (normalized === "MONTHLY") return "Monthly";
  if (normalized === "EVERY_2_MONTHS") return "After 2 months";
  if (normalized === "EVERY_3_MONTHS") return "After 3 months";
  if (normalized === "EVERY_4_MONTHS") return "After 4 months";
  if (normalized === "EVERY_5_MONTHS") return "After 5 months";
  return "Occasionally";
}

function legacyScheduleRepeatOption(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "DAILY") {
    return { value: normalized, label: "Daily (legacy)" };
  }
  if (normalized === "WEEKLY") {
    return { value: normalized, label: "Weekly (legacy)" };
  }
  return null;
}

function renderComposeRepeatOptions(selectedValue = "ONCE") {
  if (!composeRepeat) {
    return;
  }

  const normalized = String(selectedValue || "ONCE").trim().toUpperCase();
  const options = [...BASE_SCHEDULE_REPEAT_OPTIONS];
  if (!options.some((option) => option.value === normalized)) {
    const legacyOption = legacyScheduleRepeatOption(normalized);
    if (legacyOption) {
      options.push(legacyOption);
    }
  }

  composeRepeat.innerHTML = options.map((option) => `
    <option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>
  `).join("");
  composeRepeat.value = options.some((option) => option.value === normalized) ? normalized : "ONCE";
}

function visibleSchedules() {
  return state.schedules.filter((schedule) => String(schedule.status || "").trim().toLowerCase() !== "completed");
}

function openNewScheduleCompose() {
  openCompose("new");
  state.composeWhen = "later";
  renderComposeRepeatOptions(composeRepeat?.value || "ONCE");
  if (composeTitle) {
    composeTitle.textContent = "New Schedule";
  }
  if (composeNote) {
    composeNote.textContent = "Choose one biker or a batch, then set the timing and repeat pattern.";
    composeNote.classList.remove("hidden");
  }
  renderComposeWhen();
  composeSendAt?.focus();
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

function workflowStages() {
  return state.workflowOptions?.stages?.length
    ? state.workflowOptions.stages
    : DEFAULT_WORKFLOW_STAGES;
}

function workflowCategories() {
  return state.workflowOptions?.categories?.length
    ? state.workflowOptions.categories
    : DEFAULT_WORKFLOW_CATEGORIES;
}

function workflowUrgencies() {
  return state.workflowOptions?.urgencies?.length
    ? state.workflowOptions.urgencies
    : DEFAULT_WORKFLOW_URGENCIES;
}

function titleCaseFromSlug(value) {
  return String(value || "")
    .replaceAll(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function buildFirstName(value, fallback = "") {
  const source = String(value || "").trim();
  if (!source) {
    return String(fallback || "").trim();
  }

  return source.split(/\s+/).filter(Boolean)[0] || String(fallback || "").trim();
}

function formatDateLabel(value) {
  const date = parseDateValue(value);
  return date ? date.toISOString().slice(0, 10) : "";
}

function templateToMessageCategory(template) {
  const workflowCategory = String(template?.category || "").trim().toLowerCase();
  const urgency = String(template?.urgency || "").trim().toLowerCase();

  if (workflowCategory === "emergency" || urgency === "urgent") {
    return "EMERGENCY";
  }

  if (workflowCategory === "payment-reminder" || workflowCategory === "fine-notice") {
    return "REMINDER";
  }

  return "GENERAL";
}

function activeTemplates() {
  return state.templates.filter((template) => template.isActive);
}

function findTemplateById(templateId) {
  return state.templates.find((template) => template.id === templateId) || null;
}

function latestBikeForBiker(biker) {
  if (!biker) {
    return null;
  }

  if (biker.latestBikeId) {
    const directMatch = state.bikes.find((bike) => bike.id === biker.latestBikeId);
    if (directMatch) {
      return directMatch;
    }
  }

  return state.bikes
    .filter((bike) => bike.bikerId === biker.id)
    .sort(
      (left, right) => (parseDateValue(right.updatedAt)?.getTime() || 0) - (parseDateValue(left.updatedAt)?.getTime() || 0)
    )[0] || null;
}

function buildTemplateContextForBiker(biker) {
  const latestBike = latestBikeForBiker(biker);
  const batch = state.batches.find((item) => item.id === (latestBike?.batchId || biker?.batchId || ""));

  return {
    firstName: biker?.firstName || buildFirstName(biker?.name || ""),
    fullName: biker?.name || "",
    plate: latestBike?.plateNumber || biker?.bikePlate || "",
    chassisNumber: latestBike?.chassisNumber || "",
    bikeModel: latestBike?.bikeModel || biker?.bikeModel || "",
    batchName: latestBike?.batchName || biker?.batchName || batch?.name || "",
    officialStartDate: formatDateLabel(latestBike?.officialStartDate),
    nextPaymentDate: formatDateLabel(latestBike?.nextPaymentDate),
    fineAmount: "",
    fineReason: "",
    paymentDeadline: ""
  };
}

function renderTemplateBody(templateBody, context = {}) {
  return String(templateBody || "")
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => String(context[key] ?? "").trim())
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function renderSelectOptions(select, options, selectedValue, { placeholder = "" } = {}) {
  if (!select) {
    return;
  }

  const values = Array.isArray(options) ? options : [];
  const optionMarkup = values.map((item) => {
    const value = String(item.value ?? item.id ?? item);
    const label = String(item.label ?? item.name ?? titleCaseFromSlug(value));
    return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  }).join("");

  select.innerHTML = placeholder
    ? `<option value="">${escapeHtml(placeholder)}</option>${optionMarkup}`
    : optionMarkup;

  if (selectedValue && values.some((item) => String(item.value ?? item.id ?? item) === String(selectedValue))) {
    select.value = String(selectedValue);
  } else if (!selectedValue && placeholder) {
    select.value = "";
  }
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
  const anyOpen = [composeModal, bikerDetailModal, sendPasswordModal].some(
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

function resolveSendPasswordPrompt(result = null) {
  const resolver = pendingSendPasswordResolver;
  pendingSendPasswordResolver = null;

  if (sendPasswordInput) {
    sendPasswordInput.value = "";
  }
  setNotice(sendPasswordNotice, "");
  closeModal(sendPasswordModal);

  if (resolver) {
    resolver(result);
  }
}

function requestSendPassword({ messageCount = 1 } = {}) {
  if (!sendPasswordModal || !sendPasswordInput) {
    return Promise.resolve(null);
  }

  if (pendingSendPasswordResolver) {
    resolveSendPasswordPrompt(null);
  }

  if (sendPasswordCopy) {
    sendPasswordCopy.textContent = messageCount === 1
      ? "Enter SMS send password to queue this message."
      : `Enter SMS send password to queue ${messageCount} messages.`;
  }
  if (sendPasswordSubmit) {
    sendPasswordSubmit.textContent = messageCount === 1 ? "Send SMS" : `Send ${messageCount} SMS`;
  }

  setNotice(sendPasswordNotice, "");
  sendPasswordInput.value = "";
  openModal(sendPasswordModal);
  window.setTimeout(() => {
    sendPasswordInput.focus();
  }, 0);

  return new Promise((resolve) => {
    pendingSendPasswordResolver = resolve;
  });
}

/* ---------- Data loading ---------- */

async function loadAll({ announce = false } = {}) {
  if (announce) {
    setNotice(pageNotice, "Refreshing live data...");
  }

  const health = await fetchJson("/health").catch(() => null);
  const [smsSettings, dashboard, bikers, batches, bikes, fines, templates, workflowOptions, messages, schedules] = await Promise.all([
    fetchJson("/api/settings/sms").catch(() => null),
    fetchJson("/api/dashboard"),
    fetchJson("/api/bikers"),
    fetchJson("/api/batches"),
    fetchJson("/api/bikes"),
    fetchJson("/api/fines"),
    fetchJson("/api/templates"),
    fetchJson("/api/workflow/options").catch(() => null),
    fetchJson("/api/messages"),
    fetchJson("/api/schedules")
  ]);

  state.serverHealth = health;
  state.smsSettings = {
    passwordConfigured: Boolean(smsSettings?.passwordConfigured),
    signature: String(smsSettings?.signature || ""),
    gatewayMode: String(smsSettings?.gatewayMode || "registered-bikers"),
    gatewayTargetNumber: String(smsSettings?.gatewayTargetNumber || "")
  };
  state.summary = dashboard.summary;
  state.phone = dashboard.phone;
  state.adb = dashboard.adb || null;
  state.testRoute = dashboard.testRoute;
  state.bikers = bikers.items;
  state.batches = batches.items;
  state.bikes = bikes.items;
  state.fines = fines.items;
  state.templates = templates.items;
  state.workflowOptions = {
    stages: workflowOptions?.stages?.length ? workflowOptions.stages : [...DEFAULT_WORKFLOW_STAGES],
    categories: workflowOptions?.categories?.length ? workflowOptions.categories : [...DEFAULT_WORKFLOW_CATEGORIES],
    urgencies: workflowOptions?.urgencies?.length ? workflowOptions.urgencies : [...DEFAULT_WORKFLOW_URGENCIES]
  };
  state.messages = [...messages.items].sort(
    (a, b) => (parseDateValue(b.createdAt)?.getTime() || 0) - (parseDateValue(a.createdAt)?.getTime() || 0)
  );
  state.schedules = schedules.items;
  state.lastUpdatedAt = new Date();

  if (state.editingBikerId && !state.bikers.some((biker) => biker.id === state.editingBikerId)) {
    clearBikerForm();
  }
  if (state.editingBatchId && !state.batches.some((batch) => batch.id === state.editingBatchId)) {
    clearBatchForm();
  }
  if (state.editingBikeId && !state.bikes.some((bike) => bike.id === state.editingBikeId)) {
    clearBikeForm();
  }
  if (state.editingTemplateId && !state.templates.some((template) => template.id === state.editingTemplateId)) {
    clearTemplateForm();
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
    "send-sms": "Templates",
    "scheduled-sms": "Scheduled SMS",
    "message-history": "Message History",
    gateway: "Phone Gateway",
    bundles: "Bundle Check",
    recipients: "Recipients",
    bikes: "Bike Workflow",
    batches: "Batches",
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
  if (phoneAdbValue) {
    const adb = state.adb;
    phoneAdbValue.textContent = adb?.label || "Unavailable";
    phoneAdbValue.className = adb?.status === "connected"
      ? "value-good"
      : adb?.status === "disconnected" || adb?.status === "offline" || adb?.status === "unauthorized"
        ? "value-bad"
        : "value-warn";
    phoneAdbValue.title = adb?.detail || "";
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

function normalizeBundleSnippet(value) {
  return String(value || "")
    .replace(/\s*\+\s*/g, " + ")
    .replace(/\s*&\s*/g, " & ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatBundlePlanLabel(value) {
  return normalizeBundleSnippet(value).replace(/_/g, " ");
}

function buildBundleBuyAgainText(expiryDate, shortCode) {
  if (expiryDate && shortCode) {
    return `By ${expiryDate} with ${shortCode}`;
  }

  if (expiryDate) {
    return `By ${expiryDate}`;
  }

  if (shortCode) {
    return `With ${shortCode}`;
  }

  return "";
}

function extractBundleHighlights(bundle) {
  const rawText = getBundleRawText(bundle);
  const flatText = normalizeBundleSnippet(rawText);
  const sharedExpiryMatch = flatText.match(/\bEXP\s*:?\s*(\d{4}-\d{2}-\d{2})/i);
  const sharedExpiry = sharedExpiryMatch ? sharedExpiryMatch[1] : "";
  const legacySmsMatch = flatText.match(/(\d+)\s*SMS\.\s*EXP\s*(\d{4}-\d{2}-\d{2})/i);
  const genericSmsMatch = legacySmsMatch || flatText.match(/(?:^|[+&\s,])(\d+)\s*SMS\b/i);
  const legacyDataMatch = flatText.match(/Data\s*:?\s*([\d.]+)\s*MB\s*EXP\s*:?\s*(\d{4}-\d{2}-\d{2})/i);
  const dailyDataMatch = flatText.match(/(\d+(?:\.\d+)?)\s*MB\s*\/\s*day\b/i);
  const genericDataMatch = legacyDataMatch
    ? null
    : dailyDataMatch
      ? null
      : flatText.match(/Data\s*:?\s*([\d.]+)\s*MB\b/i);
  const voiceMatch = flatText.match(/(?:^|[\s.,])(?:[A-Za-z0-9]+_)?Bundle\s*:\s*(.+?)\s*&\s*\d+\s*SMS\b/i);
  const planMatch = flatText.match(/(?:^|[\s.,])([A-Za-z0-9]+_Bundle)\s*:/i);
  const packMatch = flatText.match(/,\s*([^,]*Packs)\s*,/i);
  const buyAgainMatch = flatText.match(/\bKanda\s+(\*[0-9*#]+#)/i);
  const hasPurchasedBundleFormat = Boolean(planMatch || voiceMatch || buyAgainMatch || dailyDataMatch);

  const smsCount = genericSmsMatch ? Number(genericSmsMatch[1]) : null;
  const smsExpiry = legacySmsMatch ? legacySmsMatch[2] : sharedExpiry;
  const dataAmount = legacyDataMatch
    ? legacyDataMatch[1]
    : dailyDataMatch
      ? dailyDataMatch[1]
      : genericDataMatch
        ? genericDataMatch[1]
        : "";
  const dataIsDaily = Boolean(dailyDataMatch);
  const dataExpiry = legacyDataMatch ? legacyDataMatch[2] : dataAmount ? sharedExpiry : "";
  const voice = voiceMatch
    ? `${normalizeBundleSnippet(voiceMatch[1])}${sharedExpiry ? `. EXP ${sharedExpiry}` : ""}`
    : "";
  const plan = [planMatch ? formatBundlePlanLabel(planMatch[1]) : "", packMatch ? normalizeBundleSnippet(packMatch[1]) : ""]
    .filter(Boolean)
    .join(" / ");

  let data = "";
  if (legacyDataMatch) {
    data = `Data:${legacyDataMatch[1]}MB EXP:${legacyDataMatch[2]}`;
  } else if (dataAmount) {
    data = `Data:${dataAmount}MB${dataIsDaily ? "/day" : ""}${dataExpiry ? ` EXP ${dataExpiry}` : ""}`;
  }

  return {
    rawText,
    plan,
    voice,
    sms: legacySmsMatch
      ? `${legacySmsMatch[1]} SMS. EXP ${legacySmsMatch[2]}`
      : genericSmsMatch
        ? `${genericSmsMatch[1]} SMS loaded${smsExpiry ? `. EXP ${smsExpiry}` : ""}`
        : "",
    smsExpiry,
    smsLimit: hasPurchasedBundleFormat && Number.isFinite(smsCount) ? smsCount : null,
    data,
    dataExpiry,
    buyAgain: hasPurchasedBundleFormat
      ? buildBundleBuyAgainText(sharedExpiry, buyAgainMatch ? buyAgainMatch[1] : "")
      : ""
  };
}

function isBundleUsageCountedMessage(message) {
  const normalized = String(message?.status || "").trim().toLowerCase();
  return normalized === "submitted" || normalized === "sent";
}

function buildBundleSmsUsageText(bundle, highlights) {
  const checkedAt = parseDateValue(bundle?.checkedAt);
  const smsLimit = Number(highlights?.smsLimit);
  if (!checkedAt || !Number.isFinite(smsLimit) || smsLimit <= 0) {
    return "";
  }

  const sentCount = state.messages.filter((message) => {
    if (!isBundleUsageCountedMessage(message)) {
      return false;
    }

    const sentAt = parseDateValue(message.resultAt || message.createdAt);
    return Boolean(sentAt && sentAt.getTime() >= checkedAt.getTime());
  }).length;
  const sinceLabel = formatDate(checkedAt);

  if (sentCount > smsLimit) {
    return `${sentCount} of ${smsLimit} sent since the ${sinceLabel} check. Over by ${sentCount - smsLimit}.`;
  }

  return `${sentCount} of ${smsLimit} sent since the ${sinceLabel} check. About ${smsLimit - sentCount} remaining.`;
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

function renderOptionalBundleRow(row, valueNode, text) {
  if (!row || !valueNode) {
    return;
  }

  const value = String(text || "").trim();
  row.classList.toggle("hidden", !value);
  valueNode.textContent = value || "-";
}

function renderBundleCard() {
  const bundle = state.phone?.bundle;
  if (!bundle) {
    return;
  }

  const highlights = extractBundleHighlights(bundle);
  const smsUsage = buildBundleSmsUsageText(bundle, highlights);
  state.bundleDetailsOpen = state.bundleDetailsOpen && Boolean(highlights.rawText);

  if (bundleStatusValue) {
    bundleStatusValue.textContent = bundleStatusLabel(bundle.status);
    bundleStatusValue.className = bundleStatusTone(bundle.status);
  }
  if (bundleCheckedValue) {
    bundleCheckedValue.textContent = formatDate(bundle.checkedAt);
  }
  renderOptionalBundleRow(bundlePlanRow, bundlePlanValue, highlights.plan);
  renderOptionalBundleRow(bundleVoiceRow, bundleVoiceValue, highlights.voice);
  if (bundleSmsValue) {
    bundleSmsValue.textContent = highlights.sms || bundleHighlightFallback(bundle);
  }
  if (bundleDataValue) {
    bundleDataValue.textContent = highlights.data || bundleHighlightFallback(bundle);
  }
  renderOptionalBundleRow(bundleBuyAgainRow, bundleBuyAgainValue, highlights.buyAgain);
  renderOptionalBundleRow(bundleSmsUsageRow, bundleSmsUsageValue, smsUsage);
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

function normalizeSendGroupKind(value) {
  return String(value || "").trim().toLowerCase();
}

function isBatchSendGroupMessage(message) {
  return normalizeSendGroupKind(message?.sendGroupKind) === BATCH_SEND_GROUP_KIND
    && Boolean(String(message?.sendGroupId || "").trim());
}

function isFailedMessage(message) {
  return String(message?.status || "").trim().toLowerCase() === "failed";
}

function batchSendRecipientKey(message) {
  const bikerId = String(message?.bikerId || "").trim();
  if (bikerId) {
    return `biker:${bikerId}`;
  }

  const targetNumber = String(message?.targetNumber || "").trim();
  if (targetNumber) {
    return `target:${targetNumber}`;
  }

  return `message:${String(message?.id || "").trim()}`;
}

function latestBatchSendMessages(messages) {
  const latestByRecipient = new Map();
  const orderedMessages = [...messages].sort(
    (left, right) => (parseDateValue(right.createdAt)?.getTime() || 0) - (parseDateValue(left.createdAt)?.getTime() || 0)
  );

  for (const message of orderedMessages) {
    const key = batchSendRecipientKey(message);
    if (!latestByRecipient.has(key)) {
      latestByRecipient.set(key, message);
    }
  }

  return [...latestByRecipient.values()].sort(
    (left, right) => (parseDateValue(right.createdAt)?.getTime() || 0) - (parseDateValue(left.createdAt)?.getTime() || 0)
  );
}

function batchSendStatusPriority(status) {
  const ordered = ["failed", "pending", "queued", "dispatched", "submitted", "sent"];
  const index = ordered.indexOf(String(status || "").trim().toLowerCase());
  return index >= 0 ? index : ordered.length;
}

function summarizeMessageList(items, formatter, maxItems = 3) {
  const labels = items.slice(0, maxItems).map(formatter).filter(Boolean);
  const remaining = items.length - labels.length;
  if (remaining > 0) {
    return `${labels.join(", ")} and ${remaining} more`;
  }

  return labels.join(", ");
}

function batchSendDisplayStatus(messages) {
  const statuses = [...new Set(messages.map((message) => String(message.status || "").trim().toLowerCase()))];
  statuses.sort((left, right) => batchSendStatusPriority(left) - batchSendStatusPriority(right));
  return statuses[0] || "pending";
}

function batchSendStatusCounts(messages) {
  const ordered = ["pending", "queued", "dispatched", "submitted", "sent", "failed"];
  return ordered
    .map((status) => ({
      status,
      count: messages.filter((message) => String(message.status || "").trim().toLowerCase() === status).length
    }))
    .filter((item) => item.count > 0);
}

function batchSendStatusSummary(messages) {
  const statusParts = batchSendStatusCounts(messages).map((item) => `${item.count} ${item.status}`);
  return [`${messages.length} recipient${messages.length === 1 ? "" : "s"}`, ...statusParts].join(" • ");
}

function batchSendFailureSummary(messages) {
  const failed = messages.filter((message) => isFailedMessage(message));
  if (!failed.length) {
    return "";
  }

  return `Failed: ${summarizeMessageList(failed, (message) => message.bikerName || message.targetNumber || "Unknown recipient")}.`;
}

function batchSendBodySummary(messages) {
  const uniqueBodies = [...new Set(messages.map((message) => String(message.body || "").trim()).filter(Boolean))];
  if (uniqueBodies.length === 1) {
    return {
      text: uniqueBodies[0],
      personalized: false
    };
  }

  return {
    text: `Personalized batch SMS for ${messages.length} recipient${messages.length === 1 ? "" : "s"}.`,
    personalized: true
  };
}

function buildBatchSendDisplayRow(messages) {
  if (!messages.length) {
    return null;
  }

  const currentMessages = latestBatchSendMessages(messages);
  const orderedMessages = [...currentMessages].sort(
    (left, right) => (parseDateValue(right.createdAt)?.getTime() || 0) - (parseDateValue(left.createdAt)?.getTime() || 0)
  );
  const latestMessage = orderedMessages[0];
  if (!latestMessage) {
    return null;
  }
  const availableAt = orderedMessages
    .map((message) => parseDateValue(message.availableAt))
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  const resultAt = orderedMessages
    .map((message) => parseDateValue(message.resultAt))
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  const categories = [...new Set(orderedMessages.map((message) => message.category).filter(Boolean))];
  const bodySummary = batchSendBodySummary(orderedMessages);
  const failedMessages = orderedMessages.filter((message) => isFailedMessage(message));

  return {
    kind: "batch-group",
    id: `batch-group:${latestMessage.sendGroupId}`,
    sendGroupId: latestMessage.sendGroupId,
    sendGroupLabel: latestMessage.sendGroupLabel || "Batch send",
    category: categories.length === 1 ? categories[0] : "MIXED",
    source: latestMessage.source,
    status: batchSendDisplayStatus(orderedMessages),
    availableAt: availableAt ? availableAt.toISOString() : null,
    createdAt: latestMessage.createdAt,
    resultAt: resultAt ? resultAt.toISOString() : null,
    body: bodySummary.text,
    personalized: bodySummary.personalized,
    statusSummary: batchSendStatusSummary(orderedMessages),
    failureSummary: batchSendFailureSummary(orderedMessages),
    failedMessages,
    messages: orderedMessages
  };
}

function buildMessageDisplayRows(messages = state.messages) {
  const rows = [];
  const groupedMessages = new Map();

  for (const message of messages) {
    if (isBatchSendGroupMessage(message)) {
      const groupId = String(message.sendGroupId || "").trim();
      if (!groupedMessages.has(groupId)) {
        groupedMessages.set(groupId, []);
        rows.push({
          kind: "batch-placeholder",
          sendGroupId: groupId
        });
      }
      groupedMessages.get(groupId).push(message);
      continue;
    }

    rows.push({
      kind: "single",
      message
    });
  }

  return rows.map((row) => {
    if (row.kind === "single") {
      return row;
    }

    const group = buildBatchSendDisplayRow(groupedMessages.get(row.sendGroupId) || []);
    return group ? group : null;
  }).filter(Boolean);
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

function toggleRecentBatchDetails(sendGroupId) {
  const groupId = String(sendGroupId || "").trim();
  if (!groupId) {
    return;
  }

  if (state.expandedRecentBatchIds.has(groupId)) {
    state.expandedRecentBatchIds.delete(groupId);
  } else {
    state.expandedRecentBatchIds.add(groupId);
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

  const displayRows = buildMessageDisplayRows();
  const total = displayRows.length;
  const pageSize = state.recentPageSize;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  state.recentPage = Math.min(state.recentPage, pageCount - 1);

  const start = state.recentPage * pageSize;
  const pageItems = displayRows.slice(start, start + pageSize);

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
    if (message.kind === "batch-group") {
      const failedMessages = message.failedMessages || [];
      const expanded = failedMessages.length > 0 && state.expandedRecentBatchIds.has(message.sendGroupId);
      const actionCell = failedMessages.length > 0
        ? `
          <div class="table-actions">
            <button
              type="button"
              class="table-action"
              data-action="toggle-batch-failures"
              data-send-group-id="${escapeHtml(message.sendGroupId)}"
            >${expanded ? "Hide failed" : `Review failed (${failedMessages.length})`}</button>
          </div>
        `
        : `<span class="table-cell-muted">Batch row</span>`;
      const detailRow = expanded
        ? `
          <tr class="recent-batch-detail-row">
            <td colspan="6">
              <div class="recent-batch-detail-card">
                <div class="recent-batch-detail-head">
                  <div class="table-cell-strong">Failed recipients in ${escapeHtml(message.sendGroupLabel)}</div>
                  <div class="table-cell-muted">Retry only the failed recipient. Successful recipients stay untouched.</div>
                </div>
                <div class="recent-batch-failure-list">
                  ${failedMessages.map((item) => {
                    const retrying = state.retryingMessageIds.has(item.id);
                    return `
                      <div class="recent-batch-failure-item">
                        <div>
                          <div class="table-cell-strong">${escapeHtml(item.bikerName || "Unknown recipient")}</div>
                          <div class="table-cell-muted">${escapeHtml(item.targetNumber || "")}</div>
                          <div class="table-cell-muted">${escapeHtml(messageStatusDetail(item))}</div>
                        </div>
                        <div class="table-actions">
                          <button
                            type="button"
                            class="table-action"
                            data-action="retry-message"
                            data-message-id="${escapeHtml(item.id)}"
                            ${retrying ? "disabled" : ""}
                          >${retrying ? "Retrying..." : "Retry"}</button>
                        </div>
                      </div>
                    `;
                  }).join("")}
                </div>
              </div>
            </td>
          </tr>
        `
        : "";

      return `
        <tr>
          <td>
            <div class="table-cell-strong">Batch: ${escapeHtml(message.sendGroupLabel)}</div>
            <div class="table-cell-muted">${escapeHtml(message.statusSummary)}</div>
          </td>
          <td>${escapeHtml(message.category)}</td>
          <td>
            <span class="status-chip ${escapeHtml(message.status)}">${escapeHtml(message.status.toUpperCase())}</span>
            <div class="table-cell-muted">${escapeHtml(message.statusSummary)}</div>
            ${message.failureSummary ? `<div class="table-cell-muted">${escapeHtml(message.failureSummary)}</div>` : ""}
          </td>
          <td class="message-cell">
            <span class="masked" aria-label="Hidden batch message">••••••••••</span>
            <div class="table-cell-muted">${escapeHtml(message.body)}</div>
          </td>
          <td>${escapeHtml(formatTimeShort(message.createdAt))}</td>
          <td>${actionCell}</td>
        </tr>
        ${detailRow}
      `;
    }

    const item = message.message;
    const revealed = isRevealed(item.id);
    const retrying = state.retryingMessageIds.has(item.id);
    const failed = isFailedMessage(item);
    const messageCell = revealed
      ? `<span class="revealed-text">${escapeHtml(item.body)}</span>`
      : `<span class="masked" aria-label="Hidden message">••••••••••</span>`;

    return `
      <tr>
        <td>
          <div class="table-cell-strong">${escapeHtml(item.bikerName)}</div>
          <div class="table-cell-muted">${escapeHtml(item.targetNumber || "")}</div>
        </td>
        <td>${escapeHtml(item.category)}</td>
        <td>
          <span class="status-chip ${escapeHtml(item.status)}">${escapeHtml(item.status.toUpperCase())}</span>
          <div class="table-cell-muted">${escapeHtml(messageStatusDetail(item))}</div>
        </td>
        <td class="message-cell">${messageCell}</td>
        <td>${escapeHtml(formatTimeShort(item.createdAt))}</td>
        <td>
          <div class="table-actions recent-row-actions">
            ${failed ? `
              <button
                type="button"
                class="table-action"
                data-action="retry-message"
                data-message-id="${escapeHtml(item.id)}"
                ${retrying ? "disabled" : ""}
              >${retrying ? "Retrying..." : "Retry"}</button>
            ` : ""}
            <button type="button" class="icon-button ${revealed ? "active" : ""}" data-action="toggle-reveal"
              data-message-id="${escapeHtml(item.id)}"
              aria-label="${revealed ? "Hide message" : "Show message for 5 seconds"}"
              title="${revealed ? "Hide message" : "Show message for 5 seconds"}">
              ${revealed ? EYE_OFF_ICON : EYE_ICON}
            </button>
          </div>
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

  const displayRows = buildMessageDisplayRows();

  if (displayRows.length === 0) {
    smsTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-table">No SMS have been queued yet.</td>
      </tr>
    `;
    return;
  }

  smsTableBody.innerHTML = displayRows.map((message) => {
    if (message.kind === "batch-group") {
      const allPending = message.messages.every((item) => item.status === "pending");
      const actions = allPending
        ? `
          <button type="button" class="table-action alert" data-action="delete-message-group" data-send-group-id="${escapeHtml(message.sendGroupId)}">Delete Batch</button>
        `
        : `<span class="table-cell-muted">Locked after release</span>`;

      return `
        <tr>
          <td>
            <div class="table-cell-strong">Batch: ${escapeHtml(message.sendGroupLabel)}</div>
            <div class="table-cell-muted">${escapeHtml(`${message.messages.length} recipient${message.messages.length === 1 ? "" : "s"}`)}</div>
          </td>
          <td>
            <div>${escapeHtml(message.category)}</div>
            <div class="table-cell-muted">${escapeHtml(message.source === "scheduled" ? "from batch planner" : "batch send")}</div>
          </td>
          <td class="message-cell">
            <span class="${message.personalized ? "table-cell-muted" : "revealed-text"}">${escapeHtml(message.body)}</span>
          </td>
          <td>
            <span class="status-chip ${escapeHtml(message.status)}">${escapeHtml(message.status.toUpperCase())}</span>
            <div class="table-cell-muted">${escapeHtml(message.statusSummary)}</div>
            ${message.failureSummary ? `<div class="table-cell-muted">${escapeHtml(message.failureSummary)}</div>` : ""}
          </td>
          <td>${escapeHtml(formatDate(message.createdAt))}</td>
          <td><div class="table-actions">${actions}</div></td>
        </tr>
      `;
    }

    const item = message.message;
    const editable = item.status === "pending";
    const actions = editable
      ? `
        <button type="button" class="table-action" data-action="edit-message" data-message-id="${escapeHtml(item.id)}">Edit</button>
        <button type="button" class="table-action alert" data-action="delete-message" data-message-id="${escapeHtml(item.id)}">Delete</button>
      `
      : `<span class="table-cell-muted">Locked after release</span>`;

    return `
      <tr>
        <td>
          <div class="table-cell-strong">${escapeHtml(item.bikerName)}</div>
          <div class="table-cell-muted">${escapeHtml(item.targetNumber || "")}</div>
        </td>
        <td>
          <div>${escapeHtml(item.category)}</div>
          <div class="table-cell-muted">${escapeHtml(item.source === "scheduled" ? "from planner" : "direct send")}</div>
        </td>
        <td class="message-cell"><span class="revealed-text">${escapeHtml(item.body)}</span></td>
        <td>
          <span class="status-chip ${escapeHtml(item.status)}">${escapeHtml(item.status.toUpperCase())}</span>
          <div class="table-cell-muted">${escapeHtml(messageStatusDetail(item))}</div>
        </td>
        <td>${escapeHtml(formatDate(item.createdAt))}</td>
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

function scheduleNextSendLabel(schedule) {
  return schedule.status === "completed"
    ? "Completed"
    : schedule.nextRunAt
      ? formatDate(schedule.nextRunAt)
      : "Paused";
}

function recurringSchedules() {
  return [...visibleSchedules()]
    .filter((schedule) => String(schedule.recurrence || "").trim().toUpperCase() !== "ONCE")
    .sort((left, right) => {
      const leftCompleted = String(left.status || "").trim().toLowerCase() === "completed";
      const rightCompleted = String(right.status || "").trim().toLowerCase() === "completed";
      if (leftCompleted !== rightCompleted) {
        return leftCompleted ? 1 : -1;
      }

      const leftPaused = String(left.status || "").trim().toLowerCase() === "paused";
      const rightPaused = String(right.status || "").trim().toLowerCase() === "paused";
      if (leftPaused !== rightPaused) {
        return leftPaused ? 1 : -1;
      }

      const leftNext = parseDateValue(left.nextRunAt || left.sendAt)?.getTime() || Number.MAX_SAFE_INTEGER;
      const rightNext = parseDateValue(right.nextRunAt || right.sendAt)?.getTime() || Number.MAX_SAFE_INTEGER;
      return leftNext - rightNext;
    });
}

function buildScheduleActionButtons(schedule) {
  const toggleLabel = schedule.status === "paused" ? "Resume" : "Pause";
  const toggleButton = schedule.status === "completed"
    ? ""
    : `<button type="button" class="table-action" data-action="toggle-schedule" data-schedule-id="${escapeHtml(schedule.id)}">${toggleLabel}</button>`;

  return `
    <div class="table-actions">
      <button type="button" class="table-action" data-action="edit-schedule" data-schedule-id="${escapeHtml(schedule.id)}">Edit</button>
      ${toggleButton}
      <button type="button" class="table-action alert" data-action="delete-schedule" data-schedule-id="${escapeHtml(schedule.id)}">Delete</button>
    </div>
  `;
}

function renderOverviewRecurringScheduleTable() {
  if (!overviewRecurringScheduleBody) {
    return;
  }

  const items = recurringSchedules();
  if (items.length === 0) {
    overviewRecurringScheduleBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-table">No recurring schedules yet. Open Scheduled SMS, then use New Schedule and choose monthly or after 2 to 5 months.</td>
      </tr>
    `;
    return;
  }

  overviewRecurringScheduleBody.innerHTML = items.map((schedule) => `
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
      <td>${escapeHtml(scheduleNextSendLabel(schedule))}</td>
      <td>${escapeHtml(scheduleDispatchSummary(schedule))}</td>
      <td>${buildScheduleActionButtons(schedule)}</td>
    </tr>
  `).join("");
}

function renderScheduleTable() {
  if (!scheduleTableBody) {
    return;
  }

  const items = visibleSchedules();

  if (items.length === 0) {
    scheduleTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-table">No pending schedules right now. Once a scheduled SMS runs, it stays only in Message History.</td>
      </tr>
    `;
    return;
  }

  scheduleTableBody.innerHTML = items.map((schedule) => {
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
          <div class="table-cell-strong">${escapeHtml(scheduleNextSendLabel(schedule))}</div>
          <div class="table-cell-muted">Last: ${escapeHtml(scheduleDispatchSummary(schedule))}</div>
        </td>
        <td>${buildScheduleActionButtons(schedule)}</td>
      </tr>
    `;
  }).join("");
}

function renderSmsSettingsStatus() {
  if (!smsSettingsNote) {
    return;
  }

  const signature = String(state.smsSettings.signature || "").trim();
  const routeMode = String(state.smsSettings.gatewayMode || "registered-bikers").trim().toLowerCase();
  const routeNote = routeMode === "test-routing"
    ? `Testing mode is active. Every SMS currently routes to ${state.smsSettings.gatewayTargetNumber || "the test number"} even if a saved biker is selected.`
    : "Real mode is active. SMS route to the selected active biker numbers.";
  const passwordNote = state.smsSettings.passwordConfigured
    ? "SMS send password is configured."
    : "SMS send password is not configured yet. An admin must save it on this page before direct sends can be queued.";
  const signatureNote = signature
    ? `Signature will be appended automatically: ${signature}`
    : "No signature is currently appended.";
  const draftNote = state.smsSettingsDraft.active && hasSmsSettingsDraftChanges()
    ? "You have unsaved SMS settings changes in this browser. Press Save SMS Settings to make them live. "
    : "";

  setNotice(
    smsSettingsNote,
    `${draftNote}${passwordNote} ${signatureNote} ${routeNote}`,
    state.smsSettings.passwordConfigured ? "success" : "muted"
  );
}

function normalizeGatewayMode(value) {
  return String(value || "").trim().toLowerCase() === "test-routing"
    ? "test-routing"
    : "registered-bikers";
}

function currentGatewayModeDraftValue() {
  if (gatewayModeToggle) {
    return gatewayModeToggle.checked ? "test-routing" : "registered-bikers";
  }

  return gatewayModeInput?.value || state.smsSettings.gatewayMode || "registered-bikers";
}

function hasSmsSettingsDraftChanges(draft = state.smsSettingsDraft) {
  const savedSignature = String(state.smsSettings.signature || "");
  const savedMode = normalizeGatewayMode(state.smsSettings.gatewayMode || "registered-bikers");
  const draftSignature = String(draft?.signature ?? savedSignature);
  const draftMode = normalizeGatewayMode(draft?.gatewayMode || savedMode);
  return draftSignature !== savedSignature || draftMode !== savedMode;
}

function clearSmsSettingsDraft() {
  state.smsSettingsDraft = {
    active: false,
    signature: String(state.smsSettings.signature || ""),
    gatewayMode: normalizeGatewayMode(state.smsSettings.gatewayMode || "registered-bikers")
  };
}

function updateSmsSettingsDraftFromInputs() {
  state.smsSettingsDraft = {
    active: false,
    signature: String(signatureInput?.value ?? state.smsSettings.signature ?? ""),
    gatewayMode: normalizeGatewayMode(currentGatewayModeDraftValue())
  };
  state.smsSettingsDraft.active = hasSmsSettingsDraftChanges(state.smsSettingsDraft);
}

function renderSmsSettingsForm({ preserveDraft = false } = {}) {
  const draftActive = preserveDraft || (state.smsSettingsDraft.active && hasSmsSettingsDraftChanges());
  if (!draftActive && state.smsSettingsDraft.active) {
    clearSmsSettingsDraft();
  }

  const signatureValue = draftActive
    ? String(state.smsSettingsDraft.signature ?? signatureInput?.value ?? state.smsSettings.signature ?? "")
    : String(state.smsSettings.signature || "");
  if (signatureInput && (draftActive || document.activeElement !== signatureInput)) {
    signatureInput.value = signatureValue;
  }

  const activeMode = draftActive
    ? normalizeGatewayMode(state.smsSettingsDraft.gatewayMode || currentGatewayModeDraftValue())
    : normalizeGatewayMode(state.smsSettings.gatewayMode || "registered-bikers");
  if (gatewayModeInput) {
    gatewayModeInput.value = activeMode;
  }
  if (gatewayModeToggle) {
    gatewayModeToggle.checked = activeMode === "test-routing";
  }
  if (gatewayModeLabel) {
    gatewayModeLabel.textContent = activeMode === "test-routing" ? "Testing mode" : "Real mode";
  }
  if (gatewayModeHint) {
    gatewayModeHint.textContent = activeMode === "test-routing"
      ? `Every SMS is forced to ${state.smsSettings.gatewayTargetNumber || "the testing number"} even if you select a real biker.`
      : "SMS go to the selected active biker numbers.";
  }
  if (gatewayTargetNumberDisplay) {
    gatewayTargetNumberDisplay.value = state.smsSettings.gatewayTargetNumber || "";
  }
}

/* ---------- Settings page ---------- */

function isActiveBiker(biker) {
  return String(biker?.status || "").trim().toLowerCase() === "active";
}

function activeBikers() {
  return state.bikers.filter(isActiveBiker);
}

function normalizePhoneNumber(value) {
  return String(value || "").replace(/\D+/g, "");
}

function hasValidSmsPhoneNumber(value) {
  const digits = normalizePhoneNumber(value);
  return digits.length >= 10 && digits.length <= 15;
}

function hasValidBikerPhoneNumber(biker) {
  if (typeof biker?.hasValidPhoneNumber === "boolean") {
    return biker.hasValidPhoneNumber;
  }

  return hasValidSmsPhoneNumber(biker?.phoneNumber || "");
}

function smsReadyBikers() {
  return state.bikers.filter((biker) => isActiveBiker(biker) && hasValidBikerPhoneNumber(biker));
}

function describeBikerPhoneNumber(biker) {
  return String(biker?.phoneNumber || "").trim() || "missing number";
}

function summarizeRecipients(recipients, formatter, maxItems = 3) {
  const items = recipients.slice(0, maxItems).map(formatter).filter(Boolean);
  const remaining = recipients.length - items.length;
  if (remaining > 0) {
    return `${items.join(", ")} and ${remaining} more`;
  }

  return items.join(", ");
}

function formatInvalidPhoneRecipientSummary(recipients, maxItems = 3) {
  return summarizeRecipients(
    recipients,
    (biker) => `${biker.name} (${describeBikerPhoneNumber(biker)})`,
    maxItems
  );
}

function bikerStatusSummary(biker) {
  const labels = [biker.status];
  if (!biker.notificationsEnabled) {
    labels.push("Notifications off");
  }
  if (biker.isTeamLeader) {
    labels.push("Team leader");
  }
  if (biker.reminderDue) {
    labels.push("Reminder due");
  }
  if (biker.urgentAlert) {
    labels.push("Emergency open");
  }
  return labels.join(" | ");
}

function renderBikerBatchOptions(selectedValue = bikerBatchInput?.value || "") {
  renderSelectOptions(
    bikerBatchInput,
    state.batches.map((batch) => ({
      value: batch.id,
      label: batch.name
    })),
    selectedValue,
    { placeholder: "No batch assigned" }
  );
}

function buildBatchRecipientUrl(batch) {
  const params = new URLSearchParams();
  params.set("batchId", batch.id);
  if (batch.name) {
    params.set("batchName", batch.name);
  }

  return `/settings/index.html?${params.toString()}#recipients`;
}

function currentRecipientBatchTarget() {
  const targetId = String(state.recipientBatchTargetId || "").trim();
  if (!targetId) {
    return null;
  }

  const liveBatch = state.batches.find((item) => item.id === targetId);
  if (liveBatch) {
    state.recipientBatchTargetName = liveBatch.name || state.recipientBatchTargetName;
    return liveBatch;
  }

  if (!state.recipientBatchTargetName) {
    return null;
  }

  return {
    id: targetId,
    name: state.recipientBatchTargetName
  };
}

function clearRecipientBatchTarget({ clearSelection = true } = {}) {
  state.recipientBatchTargetId = "";
  state.recipientBatchTargetName = "";

  if (PAGE_VIEW === "recipients") {
    window.history.replaceState({}, "", "/settings/index.html#recipients");
  }

  if (clearSelection && bikerBatchInput && !state.editingBikerId) {
    renderBikerBatchOptions("");
  }

  renderRecipientBatchFlow();
}

function renderRecipientBatchFlow() {
  if (!recipientBatchFlowBar || PAGE_VIEW !== "recipients") {
    return;
  }

  const target = currentRecipientBatchTarget();
  const linkedCount = target
    ? state.bikers.filter((biker) => biker.batchId === target.id).length
    : 0;

  recipientBatchFlowBar.classList.toggle("hidden", !target);
  if (recipientBatchFlowLabel) {
    recipientBatchFlowLabel.textContent = target
      ? `Adding recipients for batch ${target.name}. ${linkedCount} recipient${linkedCount === 1 ? "" : "s"} already linked.`
      : "";
  }
}

function renderBikerStatusFilters() {
  const container = $("bikerStatusFilters");
  if (!container) {
    return;
  }
  const count = (status) => state.bikers.filter((biker) => String(biker.status).toLowerCase() === status).length;
  const options = [
    ["all", "All", state.bikers.length],
    ["active", "Active", count("active")],
    ["inactive", "Inactive", count("inactive")]
  ];
  container.innerHTML = options.map(([key, label, total]) => `
    <button type="button" class="filter-chip${state.bikerStatusFilter === key ? " active" : ""}" data-status-filter="${key}">${label} <span>${total}</span></button>
  `).join("");
}

// The status chip is a button: one click switches Active <-> Inactive. Other flags stay as small text.
function bikerStatusCell(biker) {
  const active = String(biker.status).toLowerCase() !== "inactive";
  const extras = bikerStatusSummary(biker).split(" | ").slice(1).join(" | ");
  return `
    <button type="button" class="status-chip ${active ? "sent" : "pending"} status-toggle" data-action="toggle-biker-status"
      data-biker-id="${escapeHtml(biker.id)}" title="Click to make ${active ? "Inactive" : "Active"}">${active ? "Active" : "Inactive"}</button>
    ${extras ? `<div class="table-cell-muted">${escapeHtml(extras)}</div>` : ""}
  `;
}

async function toggleBikerStatus(bikerId) {
  const biker = state.bikers.find((item) => item.id === bikerId);
  if (!biker) {
    return;
  }
  const next = String(biker.status).toLowerCase() === "inactive" ? "Active" : "Inactive";
  if (next === "Inactive" && !window.confirm(`Make ${biker.name} inactive?\n\nInactive recipients are left out of manual and workflow SMS. You can switch them back at any time.`)) {
    return;
  }
  try {
    await fetchJson(`/api/bikers/${encodeURIComponent(biker.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next })
    });
    await loadAll();
    setNotice(bikerNotice, `${biker.name} is now ${next}.`, "success");
  } catch (error) {
    setNotice(bikerNotice, error.message, "error");
  }
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

  renderBikerStatusFilters();

  if (state.bikers.length === 0) {
    bikerTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-table">No recipients yet. Add the first one above.</td>
      </tr>
    `;
    return;
  }

  const visibleBikers = state.bikers.filter((biker) => state.bikerStatusFilter === "all"
    || String(biker.status).toLowerCase() === state.bikerStatusFilter);
  if (visibleBikers.length === 0) {
    bikerTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-table">No ${escapeHtml(state.bikerStatusFilter)} recipients.</td>
      </tr>
    `;
    return;
  }

  bikerTableBody.innerHTML = visibleBikers.map((biker, rowIndex) => {
    const selected = state.selectedBikerIds.has(biker.id);
    const rowEdit = state.modifyMode && selected
      ? `<button type="button" class="table-action" data-action="edit-biker" data-biker-id="${escapeHtml(biker.id)}">Edit</button>`
      : "";
    const bikeSummary = biker.bikePlate || biker.bikeModel
      ? `
        <div class="table-cell-strong">${escapeHtml(biker.bikePlate || "No plate yet")}</div>
        <div class="table-cell-muted">${escapeHtml(biker.bikeModel || "Bike record pending")}</div>
      `
      : `
        <div class="table-cell-strong">${escapeHtml(String(biker.activeBikeCount || 0))} bike record(s)</div>
        <div class="table-cell-muted">${escapeHtml(biker.latestBikeStage || "No workflow started yet")}</div>
      `;

    return `
      <tr class="${selected ? "row-selected" : ""}">
        <td class="check-cell">
          <input type="checkbox" data-action="select-biker" data-biker-id="${escapeHtml(biker.id)}" ${selected ? "checked" : ""}
            aria-label="Select ${escapeHtml(biker.name)}">
        </td>
        <td class="row-number">${rowIndex + 1}</td>
        <td>
          <div class="table-cell-strong">${escapeHtml(biker.name)}</div>
          <div class="table-cell-muted">${escapeHtml(biker.firstName || "")}</div>
        </td>
        <td>${escapeHtml(biker.phoneNumber)}</td>
        <td>${bikeSummary}</td>
        <td>${bikerStatusCell(biker)}</td>
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
      bikerPanelNote.textContent = "Save the rider first, then assign bikes and progress updates from the workflow page.";
    }
    bikerSubmitButton.textContent = "Add Recipient";
    if (bikerResetButton) {
      bikerResetButton.textContent = "Clear Form";
    }
    return;
  }

  bikerPanelTitle.textContent = `Edit ${biker.name}`;
  if (bikerPanelNote) {
    bikerPanelNote.textContent = "Change the rider details, batch, or notification preference, then save.";
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
  if (notificationsEnabledInput) {
    notificationsEnabledInput.checked = true;
  }
  renderBikerBatchOptions(currentRecipientBatchTarget()?.id || "");
  renderBikerFormState();
  renderRecipientBatchFlow();
}

function populateBikerForm(biker) {
  if (!biker || !nameInput) {
    clearBikerForm();
    return;
  }

  state.editingBikerId = biker.id;
  nameInput.value = biker.name;
  if (firstNameInput) {
    firstNameInput.value = biker.firstName || "";
  }
  phoneInput.value = biker.phoneNumber;
  if (plateInput) {
    plateInput.value = biker.bikePlate || "";
  }
  if (modelInput) {
    modelInput.value = biker.bikeModel || "";
  }
  statusInput.value = biker.status === "Inactive" ? "Inactive" : "Active";
  renderBikerBatchOptions(biker.batchId || "");
  if (notificationsEnabledInput) {
    notificationsEnabledInput.checked = Boolean(biker.notificationsEnabled);
  }
  if (teamLeaderInput) {
    teamLeaderInput.checked = Boolean(biker.isTeamLeader);
  }
  if (notesInput) {
    notesInput.value = biker.notes || "";
  }
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
    ["First name", biker.firstName || "-"],
    ["Batch", biker.batchName || "-"],
    ["Notifications enabled", biker.notificationsEnabled ? "Yes" : "No"],
    ["Team leader", biker.isTeamLeader ? "Yes" : "No"],
    ["Latest bike plate", biker.bikePlate || "-"],
    ["Latest bike model", biker.bikeModel || "-"],
    ["Status", biker.status],
    ["Reminder due", biker.reminderDue ? "Yes" : "No"],
    ["Emergency open", biker.urgentAlert ? "Yes" : "No"],
    ["Notes", biker.notes || "-"],
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

/* ---------- Batch page ---------- */

function renderBatchFormState() {
  if (!batchPanelTitle || !batchSubmitButton) {
    return;
  }

  const batch = state.batches.find((item) => item.id === state.editingBatchId);
  if (!batch) {
    batchPanelTitle.textContent = "Add Batch";
    batchSubmitButton.textContent = "Save Batch";
    if (batchResetButton) {
      batchResetButton.textContent = "Clear Form";
    }
    return;
  }

  batchPanelTitle.textContent = `Edit ${batch.name}`;
  batchSubmitButton.textContent = "Save Changes";
  if (batchResetButton) {
    batchResetButton.textContent = "Cancel Edit";
  }
}

function clearBatchForm() {
  state.editingBatchId = "";
  batchForm?.reset();
  renderBatchFormState();
}

function populateBatchForm(batch) {
  if (!batch) {
    clearBatchForm();
    return;
  }

  state.editingBatchId = batch.id;
  if (batchNameInput) batchNameInput.value = batch.name || "";
  if (batchCodeInput) batchCodeInput.value = batch.code || "";
  if (batchExpectedDeliveryInput) batchExpectedDeliveryInput.value = formatDateInputValue(batch.expectedDeliveryDate);
  if (batchLeaseEndInput) batchLeaseEndInput.value = formatDateInputValue(batch.leaseEndDate);
  if (batchNotesInput) batchNotesInput.value = batch.notes || "";
  renderBatchFormState();
  batchNameInput?.focus();
}

function renderBatchTable() {
  if (!batchTableBody) {
    return;
  }

  if (state.batches.length === 0) {
    batchTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-table">No batches yet. Add the first batch above.</td>
      </tr>
    `;
    return;
  }

  batchTableBody.innerHTML = state.batches.map((batch) => `
    <tr>
      <td>
        <div class="table-cell-strong">${escapeHtml(batch.name)}</div>
        <div class="table-cell-muted">${escapeHtml(batch.code || "")}</div>
      </td>
      <td>${escapeHtml(formatDateOnly(batch.expectedDeliveryDate))}</td>
      <td>${escapeHtml(formatDateOnly(batch.leaseEndDate))}</td>
      <td>
        <div class="table-cell-strong">${escapeHtml(String(batch.bikerCount || 0))} riders</div>
        <div class="table-cell-muted">${escapeHtml(String(batch.bikeCount || 0))} bikes</div>
      </td>
      <td>
        <div class="table-actions">
          <button type="button" class="table-action" data-action="add-batch-bikers" data-batch-id="${escapeHtml(batch.id)}">Add Recipients</button>
          <button type="button" class="table-action" data-action="edit-batch" data-batch-id="${escapeHtml(batch.id)}">Edit</button>
          <button type="button" class="table-action alert" data-action="delete-batch" data-batch-id="${escapeHtml(batch.id)}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderSharedBatchOptions() {
  const currentBikerBatchValue = state.editingBikerId
    ? state.bikers.find((item) => item.id === state.editingBikerId)?.batchId || ""
    : (bikerBatchInput?.value || currentRecipientBatchTarget()?.id || "");
  const currentBikeBatchValue = bikeBatchInput?.value
    || (state.editingBikeId ? state.bikes.find((item) => item.id === state.editingBikeId)?.batchId || "" : "");
  renderBikerBatchOptions(currentBikerBatchValue);
  renderSelectOptions(
    bikeBatchInput,
    state.batches.map((batch) => ({
      value: batch.id,
      label: batch.name
    })),
    currentBikeBatchValue,
    { placeholder: "No batch assigned" }
  );
}

/* ---------- Bike workflow page ---------- */

function bikeOptionLabel(bike) {
  const plate = bike?.plateNumber || "No plate yet";
  const model = bike?.bikeModel || "Model pending";
  const owner = bike?.bikerName || "Unassigned";
  return `${plate} — ${model} — ${owner}`;
}

function sortedBikes() {
  return [...state.bikes].sort(
    (left, right) => (parseDateValue(right.updatedAt)?.getTime() || 0) - (parseDateValue(left.updatedAt)?.getTime() || 0)
  );
}

function flattenedProgressUpdates() {
  return sortedBikes().flatMap((bike) => (bike.progressUpdates || []).map((update) => ({
    ...update,
    bikeLabel: bikeOptionLabel(bike),
    bikerName: bike.bikerName || ""
  }))).sort(
    (left, right) => (parseDateValue(right.createdAt)?.getTime() || 0) - (parseDateValue(left.createdAt)?.getTime() || 0)
  );
}

function renderBikeRecipientOptions(selectedValue = bikeRecipientInput?.value || "") {
  renderSelectOptions(
    bikeRecipientInput,
    state.bikers.map((biker) => ({
      value: biker.id,
      label: `${biker.name} — ${biker.phoneNumber}`
    })),
    selectedValue,
    { placeholder: "Choose recipient" }
  );
}

function renderBikeWorkflowOptions() {
  renderSelectOptions(
    bikeStageInput,
    workflowStages(),
    bikeStageInput?.value || "LEAD_CAPTURED"
  );
  renderSelectOptions(
    progressStageInput,
    workflowStages(),
    progressStageInput?.value || "LEAD_CAPTURED"
  );
  renderSelectOptions(
    progressCategoryInput,
    workflowCategories(),
    progressCategoryInput?.value || "progress-update"
  );
  renderSelectOptions(
    progressUrgencyInput,
    workflowUrgencies(),
    progressUrgencyInput?.value || "normal"
  );
  renderSelectOptions(
    fineUrgencyInput,
    workflowUrgencies(),
    fineUrgencyInput?.value || "urgent"
  );
  renderSelectOptions(
    templateStageInput,
    workflowStages(),
    templateStageInput?.value || "LEAD_CAPTURED"
  );
  renderSelectOptions(
    templateCategoryInput,
    workflowCategories(),
    templateCategoryInput?.value || "progress-update"
  );
  renderSelectOptions(
    templateUrgencyInput,
    workflowUrgencies(),
    templateUrgencyInput?.value || "normal"
  );
}

function renderBikeOptionsForWorkflow() {
  const currentProgressBike = progressBikeInput?.value || "";
  const currentFineBike = fineBikeInput?.value || "";
  const bikeOptions = sortedBikes().map((bike) => ({
    value: bike.id,
    label: bikeOptionLabel(bike)
  }));

  renderSelectOptions(
    progressBikeInput,
    bikeOptions,
    currentProgressBike,
    { placeholder: "Choose bike" }
  );
  renderSelectOptions(
    fineBikeInput,
    bikeOptions,
    currentFineBike,
    { placeholder: "Choose bike" }
  );
}

function renderBikeFormState() {
  if (!bikePanelTitle || !bikeSubmitButton) {
    return;
  }

  const bike = state.bikes.find((item) => item.id === state.editingBikeId);
  if (!bike) {
    bikePanelTitle.textContent = "Add Bike / Application";
    bikeSubmitButton.textContent = "Save Bike";
    if (bikeResetButton) {
      bikeResetButton.textContent = "Clear Form";
    }
    return;
  }

  bikePanelTitle.textContent = `Edit ${bikeOptionLabel(bike)}`;
  bikeSubmitButton.textContent = "Save Changes";
  if (bikeResetButton) {
    bikeResetButton.textContent = "Cancel Edit";
  }
}

function clearBikeForm() {
  state.editingBikeId = "";
  bikeForm?.reset();
  renderBikeRecipientOptions();
  renderSharedBatchOptions();
  renderBikeWorkflowOptions();
  if (bikeNotificationsEnabledInput) {
    bikeNotificationsEnabledInput.checked = true;
  }
  if (bikeStageInput) {
    bikeStageInput.value = "LEAD_CAPTURED";
  }
  renderBikeFormState();
}

function populateBikeForm(bike) {
  if (!bike) {
    clearBikeForm();
    return;
  }

  state.editingBikeId = bike.id;
  renderBikeRecipientOptions(bike.bikerId || "");
  renderSharedBatchOptions();
  renderBikeWorkflowOptions();
  if (bikeBatchInput) bikeBatchInput.value = bike.batchId || "";
  if (bikePlateInput) bikePlateInput.value = bike.plateNumber || "";
  if (bikeChassisInput) bikeChassisInput.value = bike.chassisNumber || "";
  if (bikeModelInput) bikeModelInput.value = bike.bikeModel || "";
  if (bikeStageInput) bikeStageInput.value = bike.lifecycleStage || "LEAD_CAPTURED";
  if (bikeInsuranceStatusInput) bikeInsuranceStatusInput.value = bike.insuranceStatus || "";
  if (bikeAuthorizationStatusInput) bikeAuthorizationStatusInput.value = bike.authorizationStatus || "";
  if (bikePickupStatusInput) bikePickupStatusInput.value = bike.pickupStatus || "";
  if (bikeOfficialStartInput) bikeOfficialStartInput.value = formatDateInputValue(bike.officialStartDate);
  if (bikeNextPaymentInput) bikeNextPaymentInput.value = formatDateInputValue(bike.nextPaymentDate);
  if (bikeNotificationsEnabledInput) bikeNotificationsEnabledInput.checked = Boolean(bike.notificationsEnabled);
  if (bikeKnownIssuesInput) bikeKnownIssuesInput.value = bike.knownModelIssues || "";
  if (bikeMaintenanceNotesInput) bikeMaintenanceNotesInput.value = bike.maintenanceNotes || "";
  if (bikeNotesInput) bikeNotesInput.value = bike.notes || "";
  renderBikeFormState();
  bikeRecipientInput?.focus();
}

function renderBikeTable() {
  if (!bikeTableBody) {
    return;
  }

  const bikes = sortedBikes();
  if (bikes.length === 0) {
    bikeTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-table">No bike workflow records yet. Add the first bike above.</td>
      </tr>
    `;
    return;
  }

  bikeTableBody.innerHTML = bikes.map((bike) => `
    <tr>
      <td>
        <div class="table-cell-strong">${escapeHtml(bike.bikerName || "")}</div>
        <div class="table-cell-muted">${escapeHtml(bike.batchName || "No batch")}</div>
      </td>
      <td>
        <div class="table-cell-strong">${escapeHtml(bike.plateNumber || "No plate yet")}</div>
        <div class="table-cell-muted">${escapeHtml(bike.bikeModel || "Model pending")}</div>
      </td>
      <td>
        <div class="table-cell-strong">${escapeHtml(bike.lifecycleStage || "")}</div>
        <div class="table-cell-muted">${escapeHtml(bike.authorizationStatus || bike.insuranceStatus || "-")}</div>
      </td>
      <td>
        <div class="table-cell-strong">${escapeHtml(formatDateOnly(bike.nextPaymentDate))}</div>
        <div class="table-cell-muted">${escapeHtml(bike.notificationsEnabled ? "Auto notify on" : "Auto notify off")}</div>
      </td>
      <td>
        <div class="table-cell-strong">${escapeHtml(String((bike.progressUpdates || []).length))} updates</div>
        <div class="table-cell-muted">${escapeHtml(String(bike.fineCount || 0))} fines</div>
      </td>
      <td>
        <div class="table-actions">
          <button type="button" class="table-action" data-action="edit-bike" data-bike-id="${escapeHtml(bike.id)}">Edit</button>
          <button type="button" class="table-action alert" data-action="delete-bike" data-bike-id="${escapeHtml(bike.id)}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderProgressTable() {
  if (!progressTableBody) {
    return;
  }

  const items = flattenedProgressUpdates();
  if (items.length === 0) {
    progressTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-table">No progress updates yet. Save one from the form above.</td>
      </tr>
    `;
    return;
  }

  progressTableBody.innerHTML = items.map((update) => `
    <tr>
      <td>
        <div class="table-cell-strong">${escapeHtml(update.bikeLabel)}</div>
        <div class="table-cell-muted">${escapeHtml(update.bikerName)}</div>
      </td>
      <td>${escapeHtml(update.stage)}</td>
      <td>${escapeHtml(titleCaseFromSlug(update.category))}</td>
      <td>${escapeHtml(titleCaseFromSlug(update.urgency))}</td>
      <td>${escapeHtml(update.note || "-")}</td>
      <td>
        <div class="table-cell-strong">${escapeHtml(formatDate(update.createdAt))}</div>
        <div class="table-cell-muted">${escapeHtml(update.sentMessageId ? "SMS queued" : update.notifyRecipient ? "SMS skipped" : "No SMS requested")}</div>
      </td>
    </tr>
  `).join("");
}

function renderFineTable() {
  if (!fineTableBody) {
    return;
  }

  if (state.fines.length === 0) {
    fineTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-table">No fines recorded yet.</td>
      </tr>
    `;
    return;
  }

  fineTableBody.innerHTML = state.fines.map((fine) => `
    <tr>
      <td>
        <div class="table-cell-strong">${escapeHtml(fine.plateNumber || "No plate")}</div>
        <div class="table-cell-muted">${escapeHtml(fine.bikerName || "")}</div>
      </td>
      <td>${escapeHtml(fine.amount)}</td>
      <td>${escapeHtml(fine.reason)}</td>
      <td>${escapeHtml(formatDateOnly(fine.fineDate))}</td>
      <td>${escapeHtml(formatDateOnly(fine.paymentDeadline))}</td>
      <td>
        <div class="table-cell-strong">${escapeHtml(fine.sentMessageId ? "SMS queued" : fine.notifyRecipient ? "SMS skipped" : "No SMS requested")}</div>
        <div class="table-cell-muted">${escapeHtml(fine.sourceSummary || "")}</div>
      </td>
    </tr>
  `).join("");
}

/* ---------- Template page section ---------- */

function renderTemplateFormState() {
  if (!templatePanelTitle || !templateSubmitButton) {
    return;
  }

  const template = state.templates.find((item) => item.id === state.editingTemplateId);
  if (!template) {
    templatePanelTitle.textContent = "Add Workflow Template";
    templateSubmitButton.textContent = "Save Template";
    if (templateResetButton) {
      templateResetButton.textContent = "Clear Form";
    }
    return;
  }

  templatePanelTitle.textContent = `Edit ${template.title}`;
  templateSubmitButton.textContent = "Save Changes";
  if (templateResetButton) {
    templateResetButton.textContent = "Cancel Edit";
  }
}

function clearTemplateForm() {
  state.editingTemplateId = "";
  templateForm?.reset();
  renderBikeWorkflowOptions();
  if (templateActiveInput) {
    templateActiveInput.checked = true;
  }
  if (templateIncludeSignatureInput) {
    templateIncludeSignatureInput.checked = true;
  }
  renderTemplateFormState();
}

function populateTemplateForm(template) {
  if (!template) {
    clearTemplateForm();
    return;
  }

  state.editingTemplateId = template.id;
  renderBikeWorkflowOptions();
  if (templateStageInput) templateStageInput.value = template.stage || "LEAD_CAPTURED";
  if (templateCategoryInput) templateCategoryInput.value = template.category || "progress-update";
  if (templateUrgencyInput) templateUrgencyInput.value = template.urgency || "normal";
  if (templateTitleInput) templateTitleInput.value = template.title || "";
  if (templateBodyInput) templateBodyInput.value = template.body || "";
  if (templateActiveInput) templateActiveInput.checked = Boolean(template.isActive);
  if (templateIncludeSignatureInput) templateIncludeSignatureInput.checked = Boolean(template.includeSignature);
  renderTemplateFormState();
  templateTitleInput?.focus();
}

function renderTemplateTable() {
  if (!templateTableBody) {
    return;
  }

  if (state.templates.length === 0) {
    templateTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-table">No workflow templates yet.</td>
      </tr>
    `;
    return;
  }

  templateTableBody.innerHTML = state.templates.map((template) => `
    <tr>
      <td>
        <div class="table-cell-strong">${escapeHtml(template.title)}</div>
        <div class="table-cell-muted">${escapeHtml(template.stage)}</div>
      </td>
      <td>${escapeHtml(titleCaseFromSlug(template.category))}</td>
      <td>${escapeHtml(titleCaseFromSlug(template.urgency))}</td>
      <td class="message-cell"><span class="revealed-text">${escapeHtml(template.body)}</span></td>
      <td>${escapeHtml(template.isActive ? "Active" : "Inactive")}</td>
      <td>
        <div class="table-actions">
          <button type="button" class="table-action" data-action="edit-template" data-template-id="${escapeHtml(template.id)}">Edit</button>
          <button type="button" class="table-action alert" data-action="delete-template" data-template-id="${escapeHtml(template.id)}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}

/* ---------- Compose modal ---------- */

function composeBatchRecipients(batchId = state.composeBatchId) {
  const targetBatchId = String(batchId || "").trim();
  if (!targetBatchId) {
    return [];
  }

  return smsReadyBikers().filter((biker) => biker.batchId === targetBatchId);
}

function composeBatchInvalidRecipients(batchId = state.composeBatchId) {
  const targetBatchId = String(batchId || "").trim();
  if (!targetBatchId) {
    return [];
  }

  return activeBikers().filter((biker) => biker.batchId === targetBatchId && !hasValidBikerPhoneNumber(biker));
}

function composeSelectedRecipients() {
  if (state.composeMode !== "new") {
    const biker = state.bikers.find((item) => item.id === (composeBiker?.value || ""));
    return biker ? [biker] : [];
  }

  if (state.composeTargetMode === "batch") {
    return composeBatchRecipients();
  }

  return smsReadyBikers().filter((biker) => state.composeRecipients.has(biker.id));
}

function composeSelectedInvalidRecipients() {
  if (state.composeMode !== "new") {
    return [];
  }

  if (state.composeTargetMode === "batch") {
    return composeBatchInvalidRecipients();
  }

  return [];
}

function composeDispatchRecipients() {
  const recipients = composeSelectedRecipients();
  return state.composeMode === "new" && isTestingGatewayMode()
    ? recipients.slice(0, 1)
    : recipients;
}

function composeSelectedTemplate() {
  return findTemplateById(state.composeTemplateId);
}

function isTestingGatewayMode(mode = state.smsSettings.gatewayMode) {
  return String(mode || "").trim().toLowerCase() === "test-routing";
}

function buildDeliveryBody(body, signature) {
  const messageBody = String(body || "").trim();
  if (!messageBody) {
    return "";
  }

  const messageSignature = String(signature || "").trim();
  return messageSignature ? `${messageBody}\n\n${messageSignature}` : messageBody;
}

function renderComposeRouteStatus() {
  if (!composeRouteStatus) {
    return;
  }

  const testingMode = isTestingGatewayMode();
  const targetNumber = String(state.smsSettings.gatewayTargetNumber || "").trim();

  composeRouteStatus.classList.remove("mode-live", "mode-testing");
  composeRouteStatus.classList.add(testingMode ? "mode-testing" : "mode-live");
  composeRouteStatus.textContent = testingMode
    ? "Testing mode"
    : "Real mode";
  composeRouteStatus.title = testingMode
    ? `Only 1 SMS is queued in testing mode and it is forced to ${targetNumber || "the testing number"}.`
    : "SMS will be sent to the selected active bikers.";
}

function renderComposePreviewModeState(sampleRecipient, { templateMode = false } = {}) {
  if (!composeTemplatePreviewField || !composePreviewModeHint) {
    return;
  }

  const testingMode = isTestingGatewayMode();

  composeTemplatePreviewField.classList.remove("preview-frame-active", "preview-frame-testing");
  composePreviewModeHint.classList.remove("preview-mode-active", "preview-mode-testing");
  composeTemplatePreviewField.classList.add(testingMode ? "preview-frame-testing" : "preview-frame-active");
  composePreviewModeHint.classList.add(testingMode ? "preview-mode-testing" : "preview-mode-active");
  composePreviewModeHint.textContent = "";
  composePreviewModeHint.classList.add("hidden");
}

function renderComposeTargetTabs() {
  if (!composeTargetTabs) {
    return;
  }

  [...composeTargetTabs.querySelectorAll(".category-pill")].forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.targetMode === state.composeTargetMode);
  });
}

function renderComposeBodyModes() {
  if (!composeBodyModeRow) {
    return;
  }

  [...composeBodyModeRow.querySelectorAll(".category-pill")].forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.bodyMode === state.composeBodyMode);
  });
}

function renderComposeCategories() {
  if (!composeCategorySelect) {
    return;
  }

  composeCategorySelect.value = state.composeCategory;
}

function ensureComposeBatchSelection() {
  const current = String(state.composeBatchId || "").trim();
  if (current && state.batches.some((batch) => batch.id === current)) {
    return;
  }

  state.composeBatchId = state.batches.find((batch) => composeBatchRecipients(batch.id).length > 0)?.id
    || state.batches[0]?.id
    || "";
}

function renderComposeBatchOptions() {
  if (!composeBatchSelect) {
    return;
  }

  ensureComposeBatchSelection();
  const options = state.batches.map((batch) => ({
    value: batch.id,
    label: (() => {
      const readyCount = composeBatchRecipients(batch.id).length;
      const invalidCount = composeBatchInvalidRecipients(batch.id).length;
      return invalidCount > 0
        ? `${batch.name} (${readyCount} ready, ${invalidCount} invalid)`
        : `${batch.name} (${readyCount} ready)`;
    })()
  }));

  renderSelectOptions(
    composeBatchSelect,
    options,
    state.composeBatchId,
    { placeholder: "Choose batch" }
  );
}

function renderComposeBatchRecipients() {
  if (!composeBatchRecipientList) {
    return;
  }

  const batch = state.batches.find((item) => item.id === state.composeBatchId) || null;
  const recipients = composeBatchRecipients();
  const invalidRecipients = composeBatchInvalidRecipients();

  if (!batch) {
    composeBatchRecipientList.innerHTML = `
      <div class="empty-table">Choose a batch to send the SMS to its registered active bikers.</div>
    `;
    if (composeBatchRecipientCount) {
      composeBatchRecipientCount.textContent = "0 ready";
    }
    if (composeBatchNotice) {
      composeBatchNotice.textContent = "Only active registered bikers with valid phone numbers will be included.";
    }
    return;
  }

  if (recipients.length === 0) {
    const invalidMarkup = invalidRecipients.length > 0
      ? `
        <div class="recipient-warning-label">Fix these phone numbers first</div>
        ${invalidRecipients.map((biker) => `
          <div class="recipient-item recipient-preview recipient-item-warning">
            <span class="recipient-name">${escapeHtml(biker.name)}</span>
            <span class="recipient-meta">${escapeHtml(describeBikerPhoneNumber(biker))}</span>
          </div>
        `).join("")}
      `
      : "";
    composeBatchRecipientList.innerHTML = invalidRecipients.length > 0
      ? `
        <div class="empty-table">No active bikers in ${escapeHtml(batch.name)} currently have a valid phone number.</div>
        ${invalidMarkup}
      `
      : `
        <div class="empty-table">No active registered bikers are linked to ${escapeHtml(batch.name)} yet.</div>
      `;
    if (composeBatchRecipientCount) {
      composeBatchRecipientCount.textContent = invalidRecipients.length > 0
        ? `0 ready • ${invalidRecipients.length} invalid`
        : "0 ready";
    }
    if (composeBatchNotice) {
      composeBatchNotice.textContent = invalidRecipients.length > 0
        ? `Fix these recipients first: ${formatInvalidPhoneRecipientSummary(invalidRecipients)}.`
        : "Add or activate recipients in this batch first.";
    }
    return;
  }

  const validMarkup = recipients.map((biker) => `
    <div class="recipient-item recipient-preview">
      <span class="recipient-name">${escapeHtml(biker.name)}</span>
      <span class="recipient-meta">${escapeHtml(biker.bikePlate || biker.phoneNumber)}</span>
    </div>
  `).join("");
  const invalidMarkup = invalidRecipients.length > 0
    ? `
      <div class="recipient-warning-label">Skipped until phone number is fixed</div>
      ${invalidRecipients.map((biker) => `
        <div class="recipient-item recipient-preview recipient-item-warning">
          <span class="recipient-name">${escapeHtml(biker.name)}</span>
          <span class="recipient-meta">${escapeHtml(describeBikerPhoneNumber(biker))}</span>
        </div>
      `).join("")}
    `
    : "";

  composeBatchRecipientList.innerHTML = `${validMarkup}${invalidMarkup}`;

  if (composeBatchRecipientCount) {
    composeBatchRecipientCount.textContent = invalidRecipients.length > 0
      ? `${recipients.length} ready • ${invalidRecipients.length} invalid`
      : `${recipients.length} ready`;
  }
  if (composeBatchNotice) {
    const invalidNote = invalidRecipients.length > 0
      ? ` ${invalidRecipients.length} recipient${invalidRecipients.length === 1 ? " is" : "s are"} skipped until the phone number${invalidRecipients.length === 1 ? " is" : "s are"} fixed.`
      : "";
    if (isTestingGatewayMode()) {
      const previewRecipient = recipients[0] || null;
      composeBatchNotice.textContent = previewRecipient
        ? `${recipients.length} active registered bikers are ready, but testing mode will queue only 1 SMS to ${state.smsSettings.gatewayTargetNumber || "the test number"} using ${previewRecipient.name}'s values.${invalidNote}`
        : `Testing mode will queue only 1 SMS to ${state.smsSettings.gatewayTargetNumber || "the test number"}.${invalidNote}`;
    } else {
      composeBatchNotice.textContent = `${recipients.length} active registered biker${recipients.length === 1 ? "" : "s"} from ${batch.name} will receive this message.${invalidNote}`;
    }
  }
}

function renderComposeTemplateOptions() {
  if (!composeTemplateSelect) {
    return;
  }

  const templates = activeTemplates();
  if (!templates.length) {
    composeTemplateSelect.innerHTML = '<option value="">No active templates available</option>';
    state.composeTemplateId = "";
    return;
  }

  if (!state.composeTemplateId || !templates.some((template) => template.id === state.composeTemplateId)) {
    state.composeTemplateId = templates[0].id;
  }

  renderSelectOptions(
    composeTemplateSelect,
    templates.map((template) => ({
      value: template.id,
      label: `${template.title} — ${titleCaseFromSlug(template.stage)}`
    })),
    state.composeTemplateId
  );
}

function renderComposeTemplatePreview() {
  if (!composeTemplatePreview || !composeTemplateMeta) {
    return;
  }

  const sampleRecipient = composeSelectedRecipients()[0] || smsReadyBikers()[0] || activeBikers()[0] || null;
  const templateMode = state.composeMode === "new" && state.composeBodyMode === "template";
  const body = composeMessage?.value.trim() || "";
  const showPreview = templateMode || Boolean(body) || state.composeMode !== "new";

  if (composeTemplatePreviewField) {
    composeTemplatePreviewField.classList.toggle("hidden", !showPreview);
  }

  if (composeTemplatePreviewLabel) {
    composeTemplatePreviewLabel.textContent = templateMode && sampleRecipient
      ? `Preview for ${sampleRecipient.name}`
      : "Preview";
  }

  if (templateMode) {
    const template = composeSelectedTemplate();
    if (!template) {
      composeTemplatePreview.value = "";
      composeTemplateMeta.textContent = "Choose a saved template.";
      renderComposePreviewModeState(sampleRecipient, { templateMode: true });
      return;
    }

    const previewBody = sampleRecipient
      ? renderTemplateBody(template.body, buildTemplateContextForBiker(sampleRecipient))
      : template.body;
    const finalBody = buildDeliveryBody(previewBody, state.smsSettings.signature);
    composeTemplatePreview.value = finalBody;
    renderComposePreviewModeState(sampleRecipient, { templateMode: true });
    composeTemplateMeta.textContent = sampleRecipient
      ? `Preview only. ${sampleRecipient.name}'s details are shown here.`
      : "Preview only. Saved template stays unchanged.";
    return;
  }

  const signature = String(state.smsSettings.signature || "").trim();
  composeTemplatePreview.value = buildDeliveryBody(body, signature);
  renderComposePreviewModeState(sampleRecipient, { templateMode: false });

  if (!body) {
    composeTemplateMeta.textContent = "";
    return;
  }

  if (state.composeMode === "new") {
    if (isTestingGatewayMode()) {
      composeTemplateMeta.textContent = `1 SMS will be queued to ${state.smsSettings.gatewayTargetNumber || "the test number"}.`;
      return;
    }

    composeTemplateMeta.textContent = composeSelectedRecipients().length
      ? "Selected bikers receive this preview text."
      : "Select at least one biker.";
    return;
  }

  composeTemplateMeta.textContent = "This preview includes the signature.";
}

function renderComposeBodyState() {
  const isNew = state.composeMode === "new";
  if (isNew && state.composeBodyMode === "template" && activeTemplates().length === 0) {
    state.composeBodyMode = "custom";
  }
  const templateMode = isNew && state.composeBodyMode === "template";

  if (composeTargetTabsField) {
    composeTargetTabsField.classList.toggle("hidden", !isNew);
  }
  if (composeRecipientsField) {
    composeRecipientsField.classList.toggle("hidden", !isNew || state.composeTargetMode !== "current");
  }
  if (composeBatchField) {
    composeBatchField.classList.toggle("hidden", !isNew || state.composeTargetMode !== "batch");
  }
  if (composeBikerField) {
    composeBikerField.classList.toggle("hidden", isNew);
  }
  if (composeBodyModeField) {
    composeBodyModeField.classList.toggle("hidden", !isNew);
  }
  if (composeCategoryField) {
    composeCategoryField.classList.toggle("hidden", templateMode);
  }
  if (composeMessageField) {
    composeMessageField.classList.toggle("hidden", templateMode);
  }
  if (composeTemplateField) {
    composeTemplateField.classList.toggle("hidden", !templateMode);
  }

  renderComposeTargetTabs();
  renderComposeBodyModes();
  renderComposeCategories();
  renderComposeTemplateOptions();
  renderComposeTemplatePreview();
  renderComposeRouteStatus();

  if (composeNote) {
    composeNote.classList.toggle("hidden", isNew || !composeNote.textContent.trim());
  }
}

function renderComposeScheduleQuickDayOptions() {
  if (!composeScheduleQuickDay) {
    return;
  }

  const options = buildScheduleQuickDayOptions();
  const selectedDateValue = currentComposeScheduleDateValue();
  renderSelectOptions(
    composeScheduleQuickDay,
    options,
    selectedDateValue,
    { placeholder: "Choose tomorrow or another nearby day" }
  );

  if (composeScheduleQuickHint) {
    const selectedOption = options.find((item) => item.value === selectedDateValue);
    composeScheduleQuickHint.textContent = selectedOption
      ? `${selectedOption.label}. You can still adjust the time below.`
      : "Pick a nearby day, then fine-tune the time below if needed.";
  }
}

function applyComposeScheduleQuickDay(dateValue) {
  const selectedDateValue = String(dateValue || "").trim();
  if (!composeSendAt || !selectedDateValue) {
    renderComposeScheduleQuickDayOptions();
    return;
  }

  const selectedDate = parseDateValue(`${selectedDateValue}T00:00`);
  if (!selectedDate) {
    renderComposeScheduleQuickDayOptions();
    return;
  }

  const existingDate = parseDateValue(composeSendAt.value) || nextRoundedHourDate();
  selectedDate.setHours(existingDate.getHours(), existingDate.getMinutes(), 0, 0);
  composeSendAt.value = formatDateTimeInputValue(selectedDate);
  renderComposeScheduleQuickDayOptions();
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
  if (scheduling) {
    renderComposeScheduleQuickDayOptions();
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

  const recipients = smsReadyBikers();
  const selectedBiker = state.bikers.find((biker) => biker.id === selectedId);
  const options = [...recipients];
  if (selectedBiker && !isActiveBiker(selectedBiker) && !options.some((biker) => biker.id === selectedBiker.id)) {
    options.unshift(selectedBiker);
  } else if (selectedBiker && isActiveBiker(selectedBiker) && !hasValidBikerPhoneNumber(selectedBiker) && !options.some((biker) => biker.id === selectedBiker.id)) {
    options.unshift(selectedBiker);
  }

  if (options.length === 0) {
    composeBiker.innerHTML = '<option value="">No active bikers with valid phone numbers available</option>';
    composeBiker.value = "";
    return;
  }

  composeBiker.innerHTML = options.map((biker) => `
    <option value="${escapeHtml(biker.id)}">${escapeHtml(biker.name)} — ${escapeHtml(biker.bikePlate || biker.phoneNumber)}${isActiveBiker(biker) ? (hasValidBikerPhoneNumber(biker) ? "" : " (Invalid phone)") : " (Inactive)"}</option>
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

  const recipients = smsReadyBikers();
  const invalidRecipients = activeBikers().filter((biker) => !hasValidBikerPhoneNumber(biker));
  for (const id of [...state.composeRecipients]) {
    if (!recipients.some((biker) => biker.id === id)) {
      state.composeRecipients.delete(id);
    }
  }

  if (recipients.length === 0) {
    const invalidMarkup = invalidRecipients.length > 0
      ? `
        <div class="recipient-warning-label">Fix these phone numbers first</div>
        ${invalidRecipients.map((biker) => `
          <div class="recipient-item recipient-preview recipient-item-warning">
            <span class="recipient-name">${escapeHtml(biker.name)}</span>
            <span class="recipient-meta">${escapeHtml(describeBikerPhoneNumber(biker))}</span>
          </div>
        `).join("")}
      `
      : "";
    composeRecipientList.innerHTML = invalidRecipients.length > 0
      ? `
        <div class="empty-table">No active recipients currently have a valid phone number.</div>
        ${invalidMarkup}
      `
      : `
        <div class="empty-table">No active recipients available. Mark a rider Active in Recipients first.</div>
      `;
    if (composeRecipientCount) {
      composeRecipientCount.textContent = invalidRecipients.length > 0
        ? `0 of 0 ready • ${invalidRecipients.length} invalid`
        : "0 of 0 selected";
    }
    if (composeAllBikers) {
      composeAllBikers.checked = false;
      composeAllBikers.indeterminate = false;
      composeAllBikers.disabled = true;
    }
    return;
  }

  const validMarkup = recipients.map((biker) => `
    <label class="recipient-item">
      <input type="checkbox" data-recipient-id="${escapeHtml(biker.id)}" ${state.composeRecipients.has(biker.id) ? "checked" : ""}>
      <span class="recipient-name">${escapeHtml(biker.name)}</span>
      <span class="recipient-meta">${escapeHtml(biker.bikePlate || biker.phoneNumber)}</span>
    </label>
  `).join("");
  const invalidMarkup = invalidRecipients.length > 0
    ? `
      <div class="recipient-warning-label">Skipped until phone number is fixed</div>
      ${invalidRecipients.map((biker) => `
        <div class="recipient-item recipient-preview recipient-item-warning">
          <span class="recipient-name">${escapeHtml(biker.name)}</span>
          <span class="recipient-meta">${escapeHtml(describeBikerPhoneNumber(biker))}</span>
        </div>
      `).join("")}
    `
    : "";

  composeRecipientList.innerHTML = `${validMarkup}${invalidMarkup}`;

  const total = recipients.length;
  const count = state.composeRecipients.size;

  if (composeRecipientCount) {
    composeRecipientCount.textContent = invalidRecipients.length > 0
      ? `${count} of ${total} ready • ${invalidRecipients.length} invalid`
      : `${count} of ${total} selected`;
  }
  if (composeAllBikers) {
    composeAllBikers.disabled = false;
    composeAllBikers.checked = total > 0 && count === total;
    composeAllBikers.indeterminate = count > 0 && count < total;
  }
}

function applyComposeSuggestion(force = false) {
  if (!composeMessage || state.composeMode !== "new" || state.composeBodyMode !== "custom") {
    return;
  }

  let bikerName = "";
  const selectedRecipients = composeSelectedRecipients();
  if (selectedRecipients.length === 1) {
    bikerName = selectedRecipients[0]?.name || "";
  }

  const suggested = suggestionFor(state.composeCategory, bikerName);
  const current = composeMessage.value.trim();

  if ((force && current && current === state.lastSuggestion) || (current && current === state.lastSuggestion)) {
    composeMessage.value = suggested;
    state.lastSuggestion = suggested;
  } else if (!current) {
    state.lastSuggestion = suggested;
  }

  renderComposeTemplatePreview();
}

function openCompose(mode = "new", target = null) {
  if (!composeModal || !composeForm) {
    return;
  }

  state.composeMode = mode;
  state.composeTargetId = target?.id || "";
  composeForm.reset();
  setNotice(composeNotice, "");
  renderComposeRepeatOptions(target?.recurrence || "ONCE");

  if (composeWhenField) {
    composeWhenField.classList.toggle("hidden", mode !== "new");
  }

  if (mode === "edit-message") {
    state.composeCategory = target.category;
    state.composeWhen = "now";
    if (composeTitle) composeTitle.textContent = "Edit Pending SMS";
    if (composeNote) {
      composeNote.textContent = "Saving restarts the 2-minute wait before the phone sends it.";
      composeNote.classList.remove("hidden");
    }
    syncComposeBikerOptions(target.bikerId);
    if (composeMessage) composeMessage.value = messageEditorBody(target);
  } else if (mode === "edit-schedule") {
    state.composeCategory = target.category;
    state.composeWhen = "later";
    if (composeTitle) composeTitle.textContent = "Edit Scheduled Send";
    if (composeNote) {
      composeNote.textContent = "Change the timing or message, then save.";
      composeNote.classList.remove("hidden");
    }
    syncComposeBikerOptions(target.bikerId);
    if (composeMessage) composeMessage.value = target.body;
    if (composeSendAt) composeSendAt.value = formatDateTimeInputValue(target.sendAt);
    renderComposeRepeatOptions(String(target.recurrence || "ONCE").toUpperCase());
  } else {
    const defaultTemplateId = activeTemplates()[0]?.id || "";
    state.composeTargetMode = "current";
    state.composeBodyMode = defaultTemplateId ? "template" : "custom";
    state.composeTemplateId = defaultTemplateId;
    state.composeCategory = "GENERAL";
    state.composeWhen = "now";
    state.composeRecipients.clear();
    ensureComposeBatchSelection();
    if (smsReadyBikers().length === 1) {
      state.composeRecipients.add(smsReadyBikers()[0].id);
    }
    state.lastSuggestion = "";
    if (composeTitle) composeTitle.textContent = "New SMS";
    if (composeNote) {
      composeNote.textContent = "";
      composeNote.classList.add("hidden");
    }
    renderComposeRecipients();
    renderComposeBatchOptions();
    renderComposeBatchRecipients();
    if (composeSendAt) {
      composeSendAt.value = formatDateTimeInputValue(nextRoundedHourDate());
    }
    renderComposeRepeatOptions("ONCE");
    if (composeMessage) {
      composeMessage.value = "";
    }
  }

  renderComposeBodyState();
  renderComposeWhen();
  openModal(composeModal);
  if (state.composeMode === "new" && state.composeBodyMode === "template") {
    composeTemplateSelect?.focus();
  } else {
    composeMessage?.focus();
  }
}

function bikerNameById(bikerId) {
  return state.bikers.find((biker) => biker.id === bikerId)?.name || "Unknown biker";
}

function buildComposePayloadForBiker(biker) {
  if (state.composeMode === "new" && state.composeBodyMode === "template") {
    const template = composeSelectedTemplate();
    if (!template) {
      return {
        error: "Choose a saved template first."
      };
    }

    const body = renderTemplateBody(template.body, buildTemplateContextForBiker(biker));
    if (!body) {
      return {
        error: `Template ${template.title} rendered an empty message for ${biker.name}.`
      };
    }

    return {
      bikerId: biker.id,
      category: templateToMessageCategory(template),
      body,
      templateId: template.id,
      workflowStage: template.stage,
      workflowCategory: template.category,
      workflowUrgency: template.urgency
    };
  }

  const body = composeMessage?.value.trim() || "";
  if (!body) {
    return {
      error: "Write a message first."
    };
  }

  return {
    bikerId: biker.id,
    category: state.composeCategory,
    body
  };
}

async function submitCompose() {
  const bikerId = composeBiker?.value || "";
  const recipients = composeSelectedRecipients();
  const invalidRecipients = composeSelectedInvalidRecipients();
  const dispatchRecipients = state.composeMode === "new"
    ? composeDispatchRecipients()
    : recipients;
  const invalidRecipientNote = invalidRecipients.length > 0
    ? `Skipped invalid phone numbers — ${formatInvalidPhoneRecipientSummary(invalidRecipients)}.`
    : "";

  if (recipients.length === 0) {
    setNotice(
      composeNotice,
      state.composeMode === "new" && state.composeTargetMode === "batch"
        ? invalidRecipients.length > 0
          ? `This batch has no valid SMS phone numbers yet. Fix these recipients first — ${formatInvalidPhoneRecipientSummary(invalidRecipients)}.`
          : "Choose a batch with at least one active registered biker first."
        : "Select at least one biker first.",
      "error"
    );
    return;
  }

  if (state.composeMode === "new" && state.composeBodyMode === "template" && !composeSelectedTemplate()) {
    setNotice(composeNotice, "Choose a saved template first.", "error");
    composeTemplateSelect?.focus();
    return;
  }

  if (state.composeMode !== "new" && !(composeMessage?.value.trim())) {
    setNotice(composeNotice, "Write a message first.", "error");
    return;
  }

  if (state.composeMode === "edit-message") {
    setNotice(composeNotice, "Saving changes...");
    const response = await fetchJson(`/api/messages/${encodeURIComponent(state.composeTargetId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bikerId,
        category: state.composeCategory,
        body: composeMessage?.value.trim() || ""
      })
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

    if (state.composeMode === "edit-schedule") {
      setNotice(composeNotice, "Saving schedule...");
      await fetchJson(`/api/schedules/${encodeURIComponent(state.composeTargetId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bikerId,
          category: state.composeCategory,
          recurrence: composeRepeat?.value || "ONCE",
          sendAt: new Date(rawSendAt).toISOString(),
          body: composeMessage?.value.trim() || ""
        })
      });

      closeModal(composeModal);
      await loadAll();
      setNotice(pageNotice, "Schedule updated.", "success");
      return;
    }

    setNotice(composeNotice, `Creating ${dispatchRecipients.length} schedule${dispatchRecipients.length > 1 ? "s" : ""}...`);
    let created = 0;
    const failures = [];

    for (const recipient of dispatchRecipients) {
      const payload = buildComposePayloadForBiker(recipient);
      if (payload.error) {
        failures.push(`${recipient.name}: ${payload.error}`);
        continue;
      }

      try {
        await fetchJson("/api/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bikerId: recipient.id,
            category: payload.category,
            recurrence: composeRepeat?.value || "ONCE",
            sendAt: new Date(rawSendAt).toISOString(),
            body: payload.body
          })
        });
        created += 1;
      } catch (error) {
        failures.push(`${recipient.name}: ${error.message}`);
      }
    }

    if (created === 0) {
      setNotice(
        composeNotice,
        ["Nothing was scheduled.", invalidRecipientNote, failures.join(" — ")].filter(Boolean).join(" "),
        "error"
      );
      return;
    }

    closeModal(composeModal);
    await loadAll();
    setNotice(
      pageNotice,
      failures.length > 0 || invalidRecipients.length > 0
        ? [
            `Scheduled ${created} send${created > 1 ? "s" : ""}.`,
            `Planned for ${formatDate(new Date(rawSendAt).toISOString())}.`,
            invalidRecipientNote,
            failures.length > 0 ? `Failed — ${failures.join(" — ")}` : ""
          ].filter(Boolean).join(" ")
        : `Scheduled ${created} send${created > 1 ? "s" : ""} for ${formatDate(new Date(rawSendAt).toISOString())}.`,
      failures.length > 0 || invalidRecipients.length > 0 ? "error" : "success"
    );
    return;
  }

  const password = await requestSendPassword({ messageCount: dispatchRecipients.length });
  if (!password) {
    return;
  }

  const batchGroup = state.composeMode === "new" && state.composeTargetMode === "batch"
    ? (() => {
        const batch = state.batches.find((item) => item.id === state.composeBatchId);
        return batch
          ? {
              sendGroupId: createClientId("batch-send"),
              sendGroupKind: BATCH_SEND_GROUP_KIND,
              sendGroupLabel: batch.name
            }
          : null;
      })()
    : null;

  setNotice(composeNotice, `Queueing ${dispatchRecipients.length} SMS...`);
  let queued = 0;
  let lastAvailableAt = null;
  let authFailed = false;
  const failures = [];

  for (const recipient of dispatchRecipients) {
    const payload = buildComposePayloadForBiker(recipient);
    if (payload.error) {
      failures.push(`${recipient.name}: ${payload.error}`);
      continue;
    }

    try {
      const response = await fetchJson("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          ...(batchGroup || {}),
          password
        })
      });
      queued += 1;
      lastAvailableAt = response.item?.availableAt || lastAvailableAt;
    } catch (error) {
      if (error.status === 401) {
        authFailed = true;
        break;
      }
      failures.push(`${recipient.name}: ${error.message}`);
    }
  }

  if (queued > 0) {
    await loadAll();
  }

  if (authFailed) {
    setNotice(
      composeNotice,
      queued > 0
        ? `Wrong SMS send password — stopped after queueing ${queued} of ${dispatchRecipients.length}.`
        : "Wrong SMS send password.",
      "error"
    );
    return;
  }

  if (queued === 0) {
    setNotice(
      composeNotice,
      ["Nothing was queued.", invalidRecipientNote, failures.join(" — ")].filter(Boolean).join(" "),
      "error"
    );
    return;
  }

  closeModal(composeModal);
  setNotice(
    pageNotice,
    failures.length > 0 || invalidRecipients.length > 0
      ? [
          `Queued ${queued} SMS.`,
          lastAvailableAt ? `They release at ${formatDate(lastAvailableAt)} — until then you can edit or delete them on the SMS page.` : "",
          invalidRecipientNote,
          failures.length > 0 ? `Failed — ${failures.join(" — ")}` : ""
        ].filter(Boolean).join(" ")
      : `Queued ${queued} SMS. ${lastAvailableAt ? `They release at ${formatDate(lastAvailableAt)} — until then you can edit or delete them on the SMS page.` : ""}`,
    failures.length > 0 || invalidRecipients.length > 0 ? "error" : "success"
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

async function handleDeleteMessageGroup(sendGroupId) {
  const messages = state.messages.filter((item) => String(item.sendGroupId || "").trim() === String(sendGroupId || "").trim());
  if (messages.length === 0) {
    return;
  }

  const groupLabel = messages[0]?.sendGroupLabel || "this batch";
  if (!window.confirm(`Delete the pending batch SMS for ${groupLabel}?`)) {
    return;
  }

  setNotice(pageNotice, `Deleting pending batch SMS for ${groupLabel}...`);
  const failures = [];

  for (const message of messages) {
    try {
      await fetchJson(`/api/messages/${encodeURIComponent(message.id)}`, { method: "DELETE" });
    } catch (error) {
      failures.push(`${message.bikerName}: ${error.message}`);
    }
  }

  await loadAll();

  if (failures.length > 0) {
    setNotice(pageNotice, `Some batch messages could not be deleted. ${failures.join(" — ")}`, "error");
    return;
  }

  setNotice(pageNotice, `Pending batch SMS deleted for ${groupLabel}.`, "success");
}

function buildRetryMessagePayload(message, password) {
  const payload = {
    bikerId: message.bikerId,
    category: message.category,
    body: String(message.editorBody || message.body || "").trim(),
    password
  };

  if (message.source) {
    payload.source = message.source;
  }
  if (message.templateId) {
    payload.templateId = message.templateId;
  }
  if (message.workflowStage) {
    payload.workflowStage = message.workflowStage;
  }
  if (message.workflowCategory) {
    payload.workflowCategory = message.workflowCategory;
  }
  if (message.workflowUrgency) {
    payload.workflowUrgency = message.workflowUrgency;
  }
  if (message.sendGroupId) {
    payload.sendGroupId = message.sendGroupId;
  }
  if (message.sendGroupKind) {
    payload.sendGroupKind = message.sendGroupKind;
  }
  if (message.sendGroupLabel) {
    payload.sendGroupLabel = message.sendGroupLabel;
  }

  return payload;
}

async function handleRetryMessage(messageId) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message || !isFailedMessage(message)) {
    setNotice(pageNotice, "Only failed SMS can be retried.", "error");
    return;
  }

  const password = await requestSendPassword({ messageCount: 1 });
  if (!password) {
    return;
  }

  state.retryingMessageIds.add(messageId);
  renderRecentTable();

  try {
    const response = await fetchJson("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRetryMessagePayload(message, password))
    });
    await loadAll();
    if (isBatchSendGroupMessage(message)) {
      state.expandedRecentBatchIds.add(String(message.sendGroupId || "").trim());
    }
    setNotice(
      pageNotice,
      `Retry queued for ${message.bikerName}.${response.item?.availableAt ? ` It releases at ${formatDate(response.item.availableAt)}.` : ""}`,
      "success"
    );
  } catch (error) {
    setNotice(pageNotice, error.message, "error");
  } finally {
    state.retryingMessageIds.delete(messageId);
    renderRecentTable();
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
  renderOverviewRecurringScheduleTable();
  renderRecentTable();
  renderSmsTable();
  renderScheduleTable();
  renderSharedBatchOptions();
  renderRecipientBatchFlow();
  renderBikeRecipientOptions(bikeRecipientInput?.value || "");
  renderBikeOptionsForWorkflow();
  renderBikeWorkflowOptions();
  renderSmsSettingsForm();
  renderSmsSettingsStatus();
  renderBikerTable();
  renderBikerFormState();
  renderBatchFormState();
  renderBatchTable();
  renderBikeFormState();
  renderBikeTable();
  renderProgressTable();
  renderFineTable();
  renderTemplateFormState();
  renderTemplateTable();
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
    openNewScheduleCompose();
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
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }

    if (button.dataset.action === "toggle-reveal") {
      toggleReveal(button.dataset.messageId);
    } else if (button.dataset.action === "toggle-batch-failures") {
      toggleRecentBatchDetails(button.dataset.sendGroupId);
    } else if (button.dataset.action === "retry-message") {
      handleRetryMessage(button.dataset.messageId).catch((error) => {
        setNotice(pageNotice, error.message, "error");
      });
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
    } else if (button.dataset.action === "delete-message-group") {
      handleDeleteMessageGroup(button.dataset.sendGroupId);
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

if (overviewRecurringScheduleBody) {
  overviewRecurringScheduleBody.addEventListener("click", (event) => {
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
    const gatewayMode = gatewayModeToggle
      ? (gatewayModeToggle.checked ? "test-routing" : "registered-bikers")
      : normalizeGatewayMode(gatewayModeInput?.value || state.smsSettings.gatewayMode || "registered-bikers");
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
          gatewayMode,
          dispatchPassword,
          signature
        })
      });

      state.smsSettings = {
        passwordConfigured: Boolean(response.passwordConfigured),
        signature: String(response.signature || ""),
        gatewayMode: String(response.gatewayMode || gatewayMode),
        gatewayTargetNumber: String(response.gatewayTargetNumber || state.smsSettings.gatewayTargetNumber || "")
      };
      clearSmsSettingsDraft();

      if (adminPasswordInput) {
        adminPasswordInput.value = "";
      }
      if (dispatchPasswordSettingInput) {
        dispatchPasswordSettingInput.value = "";
      }

      await loadAll();
      renderSmsSettingsForm();
      renderSmsSettingsStatus();
      setNotice(
        pageNotice,
        `SMS settings updated. ${state.smsSettings.gatewayMode === "test-routing" ? "Testing mode" : "Real mode"} is now saved.`,
        "success"
      );
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
      firstName: firstNameInput?.value || "",
      phoneNumber: phoneInput?.value || "",
      bikePlate: plateInput?.value || "",
      bikeModel: modelInput?.value || "",
      status: statusInput?.value || "Active",
      batchId: bikerBatchInput?.value || "",
      notificationsEnabled: notificationsEnabledInput?.checked ?? true,
      isTeamLeader: teamLeaderInput?.checked || false,
      notes: notesInput?.value || "",
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

if (recipientBatchFlowClearButton) {
  recipientBatchFlowClearButton.addEventListener("click", () => {
    clearRecipientBatchTarget();
    setNotice(bikerNotice, "Batch target cleared. You can now choose any batch.", "success");
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
    if (button.dataset.action === "toggle-biker-status") {
      toggleBikerStatus(bikerId);
    } else if (button.dataset.action === "biker-details") {
      openBikerDetails(bikerId);
    } else if (button.dataset.action === "edit-biker") {
      const biker = state.bikers.find((item) => item.id === bikerId);
      populateBikerForm(biker);
      setNotice(bikerNotice, `Editing ${biker?.name || "biker"}.`, "success");
    }
  });
}

if ($("bikerStatusFilters")) {
  $("bikerStatusFilters").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-status-filter]");
    if (!chip) {
      return;
    }
    state.bikerStatusFilter = chip.dataset.statusFilter;
    renderBikerTable();
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

if (batchForm) {
  batchForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      name: batchNameInput?.value || "",
      code: batchCodeInput?.value || "",
      expectedDeliveryDate: batchExpectedDeliveryInput?.value || "",
      leaseEndDate: batchLeaseEndInput?.value || "",
      notes: batchNotesInput?.value || ""
    };
    const editingId = state.editingBatchId;

    setNotice(batchNotice, editingId ? "Saving batch..." : "Adding batch...");

    try {
      const response = await fetchJson(editingId ? `/api/batches/${encodeURIComponent(editingId)}` : "/api/batches", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!editingId && response.item) {
        window.location.href = buildBatchRecipientUrl(response.item);
        return;
      }

      clearBatchForm();
      await loadAll();
      setNotice(batchNotice, "Batch updated.", "success");
    } catch (error) {
      setNotice(batchNotice, error.message, "error");
    }
  });
}

if (batchResetButton) {
  batchResetButton.addEventListener("click", () => {
    clearBatchForm();
    setNotice(batchNotice, "Form cleared.", "success");
  });
}

if (batchTableBody) {
  batchTableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }

    const batchId = button.dataset.batchId;
    if (button.dataset.action === "add-batch-bikers") {
      const batch = state.batches.find((item) => item.id === batchId);
      if (batch) {
        window.location.href = buildBatchRecipientUrl(batch);
      }
      return;
    }

    if (button.dataset.action === "edit-batch") {
      populateBatchForm(state.batches.find((item) => item.id === batchId));
      return;
    }

    if (button.dataset.action === "delete-batch") {
      const batch = state.batches.find((item) => item.id === batchId);
      if (!batch) {
        return;
      }
      if (!window.confirm(`Delete batch ${batch.name}?`)) {
        return;
      }

      try {
        await fetchJson(`/api/batches/${encodeURIComponent(batchId)}`, { method: "DELETE" });
        if (state.editingBatchId === batchId) {
          clearBatchForm();
        }
        await loadAll();
        setNotice(batchNotice, "Batch deleted.", "success");
      } catch (error) {
        setNotice(batchNotice, error.message, "error");
      }
    }
  });
}

if (bikeForm) {
  bikeForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      bikerId: bikeRecipientInput?.value || "",
      batchId: bikeBatchInput?.value || "",
      plateNumber: bikePlateInput?.value || "",
      chassisNumber: bikeChassisInput?.value || "",
      bikeModel: bikeModelInput?.value || "",
      lifecycleStage: bikeStageInput?.value || "LEAD_CAPTURED",
      insuranceStatus: bikeInsuranceStatusInput?.value || "",
      authorizationStatus: bikeAuthorizationStatusInput?.value || "",
      pickupStatus: bikePickupStatusInput?.value || "",
      officialStartDate: bikeOfficialStartInput?.value || "",
      nextPaymentDate: bikeNextPaymentInput?.value || "",
      notificationsEnabled: bikeNotificationsEnabledInput?.checked ?? true,
      knownModelIssues: bikeKnownIssuesInput?.value || "",
      maintenanceNotes: bikeMaintenanceNotesInput?.value || "",
      notes: bikeNotesInput?.value || ""
    };
    const editingId = state.editingBikeId;

    setNotice(bikeNotice, editingId ? "Saving bike..." : "Adding bike...");

    try {
      await fetchJson(editingId ? `/api/bikes/${encodeURIComponent(editingId)}` : "/api/bikes", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      clearBikeForm();
      await loadAll();
      setNotice(bikeNotice, editingId ? "Bike updated." : "Bike added.", "success");
    } catch (error) {
      setNotice(bikeNotice, error.message, "error");
    }
  });
}

if (bikeResetButton) {
  bikeResetButton.addEventListener("click", () => {
    clearBikeForm();
    setNotice(bikeNotice, "Form cleared.", "success");
  });
}

if (bikeTableBody) {
  bikeTableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }

    const bikeId = button.dataset.bikeId;
    if (button.dataset.action === "edit-bike") {
      populateBikeForm(state.bikes.find((item) => item.id === bikeId));
      return;
    }

    if (button.dataset.action === "delete-bike") {
      const bike = state.bikes.find((item) => item.id === bikeId);
      if (!bike) {
        return;
      }
      if (!window.confirm(`Delete bike record ${bikeOptionLabel(bike)}?`)) {
        return;
      }

      try {
        await fetchJson(`/api/bikes/${encodeURIComponent(bikeId)}`, { method: "DELETE" });
        if (state.editingBikeId === bikeId) {
          clearBikeForm();
        }
        await loadAll();
        setNotice(bikeNotice, "Bike deleted.", "success");
      } catch (error) {
        setNotice(bikeNotice, error.message, "error");
      }
    }
  });
}

if (progressForm) {
  progressForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const bikeId = progressBikeInput?.value || "";
    if (!bikeId) {
      setNotice(progressNotice, "Choose the bike to update first.", "error");
      progressBikeInput?.focus();
      return;
    }

    setNotice(progressNotice, "Saving progress update...");

    try {
      const response = await fetchJson(`/api/bikes/${encodeURIComponent(bikeId)}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: progressStageInput?.value || "LEAD_CAPTURED",
          category: progressCategoryInput?.value || "progress-update",
          urgency: progressUrgencyInput?.value || "normal",
          note: progressNoteInput?.value || "",
          notifyRecipient: progressNotifyInput?.checked ?? true
        })
      });
      progressForm.reset();
      if (progressNotifyInput) {
        progressNotifyInput.checked = true;
      }
      renderBikeWorkflowOptions();
      await loadAll();
      setNotice(
        progressNotice,
        response.notification?.sent
          ? "Progress update saved and SMS queued."
          : `Progress update saved. ${response.notification?.reason || "SMS was not sent."}`,
        response.notification?.sent ? "success" : "muted"
      );
    } catch (error) {
      setNotice(progressNotice, error.message, "error");
    }
  });
}

if (fineForm) {
  fineForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    setNotice(fineNotice, "Recording fine...");

    try {
      const response = await fetchJson("/api/fines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bikeId: fineBikeInput?.value || "",
          amount: fineAmountInput?.value || "",
          reason: fineReasonInput?.value || "",
          fineDate: fineDateInput?.value || "",
          paymentDeadline: fineDeadlineInput?.value || "",
          sourceSummary: fineSourceInput?.value || "",
          urgency: fineUrgencyInput?.value || "urgent",
          notifyRecipient: fineNotifyInput?.checked ?? true
        })
      });
      fineForm.reset();
      if (fineNotifyInput) {
        fineNotifyInput.checked = true;
      }
      if (fineUrgencyInput) {
        fineUrgencyInput.value = "urgent";
      }
      await loadAll();
      setNotice(
        fineNotice,
        response.notification?.sent
          ? "Fine recorded and SMS queued."
          : `Fine recorded. ${response.notification?.reason || "SMS was not sent."}`,
        response.notification?.sent ? "success" : "muted"
      );
    } catch (error) {
      setNotice(fineNotice, error.message, "error");
    }
  });
}

if (templateForm) {
  templateForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      stage: templateStageInput?.value || "LEAD_CAPTURED",
      category: templateCategoryInput?.value || "progress-update",
      urgency: templateUrgencyInput?.value || "normal",
      title: templateTitleInput?.value || "",
      body: templateBodyInput?.value || "",
      isActive: templateActiveInput?.checked ?? true,
      includeSignature: templateIncludeSignatureInput?.checked ?? true
    };
    const editingId = state.editingTemplateId;

    setNotice(templateNotice, editingId ? "Saving template..." : "Adding template...");

    try {
      await fetchJson(editingId ? `/api/templates/${encodeURIComponent(editingId)}` : "/api/templates", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      clearTemplateForm();
      await loadAll();
      setNotice(templateNotice, editingId ? "Template updated." : "Template added.", "success");
    } catch (error) {
      setNotice(templateNotice, error.message, "error");
    }
  });
}

if (templateResetButton) {
  templateResetButton.addEventListener("click", () => {
    clearTemplateForm();
    setNotice(templateNotice, "Form cleared.", "success");
  });
}

if (templateTableBody) {
  templateTableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }

    const templateId = button.dataset.templateId;
    if (button.dataset.action === "edit-template") {
      populateTemplateForm(state.templates.find((item) => item.id === templateId));
      return;
    }

    if (button.dataset.action === "delete-template") {
      const template = state.templates.find((item) => item.id === templateId);
      if (!template) {
        return;
      }
      if (!window.confirm(`Delete template ${template.title}?`)) {
        return;
      }

      try {
        await fetchJson(`/api/templates/${encodeURIComponent(templateId)}`, { method: "DELETE" });
        if (state.editingTemplateId === templateId) {
          clearTemplateForm();
        }
        await loadAll();
        setNotice(templateNotice, "Template deleted.", "success");
      } catch (error) {
        setNotice(templateNotice, error.message, "error");
      }
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

if (sendPasswordForm) {
  sendPasswordForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const password = sendPasswordInput?.value || "";
    if (!password) {
      setNotice(sendPasswordNotice, "Enter the SMS send password to continue.", "error");
      sendPasswordInput?.focus();
      return;
    }

    resolveSendPasswordPrompt(password);
  });
}

if (composeCategorySelect) {
  composeCategorySelect.addEventListener("change", () => {
    state.composeCategory = composeCategorySelect.value || "GENERAL";
    renderComposeCategories();
    applyComposeSuggestion();
  });
}

if (composeTargetTabs) {
  composeTargetTabs.addEventListener("click", (event) => {
    const pill = event.target.closest(".category-pill");
    if (!pill) {
      return;
    }

    state.composeTargetMode = pill.dataset.targetMode === "batch" ? "batch" : "current";
    renderComposeBodyState();
    renderComposeRecipients();
    renderComposeBatchOptions();
    renderComposeBatchRecipients();
    renderComposeTemplatePreview();
    applyComposeSuggestion();
  });
}

if (composeBodyModeRow) {
  composeBodyModeRow.addEventListener("click", (event) => {
    const pill = event.target.closest(".category-pill");
    if (!pill) {
      return;
    }

    state.composeBodyMode = pill.dataset.bodyMode === "template" ? "template" : "custom";
    if (state.composeBodyMode === "template" && !state.composeTemplateId) {
      state.composeTemplateId = activeTemplates()[0]?.id || "";
    }
    renderComposeBodyState();
    applyComposeSuggestion(true);
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
    renderComposeTemplatePreview();
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
    renderComposeTemplatePreview();
  });
}

if (composeBatchSelect) {
  composeBatchSelect.addEventListener("change", () => {
    state.composeBatchId = composeBatchSelect.value || "";
    renderComposeBatchRecipients();
    renderComposeTemplatePreview();
    applyComposeSuggestion();
  });
}

if (composeTemplateSelect) {
  composeTemplateSelect.addEventListener("change", () => {
    state.composeTemplateId = composeTemplateSelect.value || "";
    renderComposeTemplatePreview();
  });
}

if (composeBiker) {
  composeBiker.addEventListener("change", () => {
    renderComposeTemplatePreview();
  });
}

if (composeMessage) {
  composeMessage.addEventListener("input", () => {
    renderComposeTemplatePreview();
  });
}

if (composeScheduleQuickDay) {
  composeScheduleQuickDay.addEventListener("change", () => {
    applyComposeScheduleQuickDay(composeScheduleQuickDay.value || "");
  });
}

if (composeSendAt) {
  composeSendAt.addEventListener("input", () => {
    renderComposeScheduleQuickDayOptions();
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

if (gatewayModeToggle) {
  gatewayModeToggle.addEventListener("change", () => {
    if (gatewayModeInput) {
      gatewayModeInput.value = gatewayModeToggle.checked ? "test-routing" : "registered-bikers";
    }
    updateSmsSettingsDraftFromInputs();
    renderSmsSettingsForm({ preserveDraft: true });
    renderSmsSettingsStatus();
  });
}

if (signatureInput) {
  signatureInput.addEventListener("input", () => {
    updateSmsSettingsDraftFromInputs();
    renderSmsSettingsStatus();
  });
}


document.addEventListener("click", (event) => {
  const closer = event.target.closest("[data-close-modal]");
  if (!closer) {
    return;
  }

  if (closer.dataset.closeModal === "compose") {
    closeModal(composeModal);
  } else if (closer.dataset.closeModal === "send-password") {
    resolveSendPasswordPrompt(null);
  } else if (closer.dataset.closeModal === "biker-detail") {
    closeModal(bikerDetailModal);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (sendPasswordModal && !sendPasswordModal.classList.contains("hidden")) {
    resolveSendPasswordPrompt(null);
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

window.addEventListener("beforeunload", (event) => {
  if (!state.smsSettingsDraft.active || !hasSmsSettingsDraftChanges()) {
    return;
  }

  event.preventDefault();
  event.returnValue = "";
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
