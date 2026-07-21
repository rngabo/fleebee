const {
  WORKFLOW_CATEGORIES,
  WORKFLOW_STAGES,
  WORKFLOW_URGENCY_LEVELS
} = require("../data/workflow-defaults");

const WORKFLOW_STAGE_SET = new Set(WORKFLOW_STAGES);
const WORKFLOW_CATEGORY_SET = new Set(WORKFLOW_CATEGORIES);
const WORKFLOW_URGENCY_SET = new Set(WORKFLOW_URGENCY_LEVELS);

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function normalizeOptionalText(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeRequiredText(value) {
  return String(value ?? "").trim();
}

function normalizeStage(value, fallback = "LEAD_CAPTURED") {
  const normalized = normalizeRequiredText(value).toUpperCase();
  if (!normalized) {
    return fallback;
  }

  return WORKFLOW_STAGE_SET.has(normalized) ? normalized : null;
}

function normalizeCategory(value, fallback = "progress-update") {
  const normalized = normalizeRequiredText(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return WORKFLOW_CATEGORY_SET.has(normalized) ? normalized : null;
}

function normalizeUrgency(value, fallback = "normal") {
  const normalized = normalizeRequiredText(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return WORKFLOW_URGENCY_SET.has(normalized) ? normalized : null;
}

function normalizeDateTime(value) {
  if (value == null || value === "") {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildFirstName(fullName, fallback = "") {
  const source = normalizeRequiredText(fullName);
  if (!source) {
    return normalizeRequiredText(fallback);
  }

  return source.split(/\s+/)[0] || normalizeRequiredText(fallback);
}

function formatDateLabel(value) {
  const date = normalizeDateTime(value);
  if (!date) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function renderTemplateBody(templateBody, context = {}) {
  const template = String(templateBody || "");
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    return String(context[key] ?? "").trim();
  }).replace(/[ \t]+\n/g, "\n").trim();
}

function toMessageCategory(workflowCategory, urgency) {
  const normalizedCategory = normalizeCategory(workflowCategory, "progress-update");
  const normalizedUrgency = normalizeUrgency(urgency, "normal");

  if (normalizedCategory === "emergency" || normalizedUrgency === "urgent") {
    return "EMERGENCY";
  }

  if (normalizedCategory === "payment-reminder" || normalizedCategory === "fine-notice") {
    return "REMINDER";
  }

  return "GENERAL";
}

module.exports = {
  WORKFLOW_CATEGORIES,
  WORKFLOW_STAGES,
  WORKFLOW_URGENCY_LEVELS,
  buildFirstName,
  formatDateLabel,
  normalizeBoolean,
  normalizeCategory,
  normalizeDateTime,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeStage,
  normalizeUrgency,
  renderTemplateBody,
  toMessageCategory
};
