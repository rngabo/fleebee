const { env } = require("../config/env");
const { prisma } = require("../lib/prisma");
const { SheetError, isConfigured: sheetConfigured, syncPayment } = require("./payments-sheet-service");

const PDF_CONTENT_TYPES = new Set(["application/pdf", "application/octet-stream"]);

function integrationConfigured() {
  return Boolean(env.BANK_STATEMENT_SERVICE_URL && env.BANK_STATEMENT_SERVICE_API_KEY);
}

function validateUploadHeaders(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const contentLength = Number(req.headers["content-length"] || 0);

  if (!contentType.startsWith("multipart/form-data;")) {
    return { statusCode: 415, error: "Choose a PDF bank statement to upload." };
  }
  if (contentLength > env.BANK_STATEMENT_MAX_UPLOAD_BYTES) {
    return {
      statusCode: 413,
      error: `The PDF is larger than the ${Math.round(env.BANK_STATEMENT_MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`
    };
  }
  return null;
}

async function readUpload(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > env.BANK_STATEMENT_MAX_UPLOAD_BYTES + 64 * 1024) {
      const error = new Error("The uploaded statement exceeds the configured size limit.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function upstreamMessage(statusCode, payload) {
  const detail = payload?.detail;
  const message = typeof detail === "string" ? detail : detail?.message || payload?.error;
  if (statusCode === 415) return "Only PDF bank statements can be uploaded.";
  if (statusCode === 422 && /unsupported bank statement/i.test(message || "")) {
    return "This PDF is not a supported Bank of Kigali account statement.";
  }
  if (statusCode === 422) return message || "The PDF is invalid, encrypted, corrupted, or unsupported.";
  if (statusCode === 409) return "This bank statement has already been processed.";
  return message || "The bank statement service could not process this request.";
}

async function requestService(pathname, options = {}) {
  if (!integrationConfigured()) {
    return { statusCode: 503, body: { error: "Bank statement processing is not configured." } };
  }

  let response;
  try {
    response = await fetch(`${env.BANK_STATEMENT_SERVICE_URL}${pathname}`, {
      ...options,
      signal: AbortSignal.timeout(env.BANK_STATEMENT_SERVICE_TIMEOUT_MS),
      headers: {
        "X-API-Key": env.BANK_STATEMENT_SERVICE_API_KEY,
        ...(options.headers || {})
      }
    });
  } catch (error) {
    return {
      statusCode: 503,
      body: { error: "Bank statement processing is temporarily unavailable." }
    };
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { statusCode: response.status, body: { error: upstreamMessage(response.status, payload) } };
  }
  return { statusCode: response.status, body: payload };
}

function nameTokens(value) {
  return new Set(String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean));
}

// Order-insensitive match: identical token sets, or one name fully contained in
// the other with at least two shared tokens (e.g. a missing middle name).
function namesMatch(depositorTokens, bikerTokens) {
  if (!depositorTokens.size || !bikerTokens.size) return false;
  const shared = [...depositorTokens].filter((token) => bikerTokens.has(token)).length;
  if (shared === depositorTokens.size && shared === bikerTokens.size) return true;
  const smaller = Math.min(depositorTokens.size, bikerTokens.size);
  return shared >= 2 && shared === smaller;
}

function bikerDisplayName(biker) {
  return [biker.name, biker.firstName].map((part) => String(part ?? "").trim()).filter(Boolean).join(" ");
}

async function markUnregisteredDepositors(body) {
  if (!Array.isArray(body?.transactions)) return body;
  const bikers = await prisma.biker.findMany({ select: { id: true, name: true, firstName: true } });
  const registered = bikers.map((biker) => ({ id: biker.id, tokens: nameTokens(bikerDisplayName(biker)) }));
  return {
    ...body,
    transactions: body.transactions.map((item) => {
      if (!item.depositor_name) return item;
      const tokens = nameTokens(item.depositor_name);
      const matches = registered.filter((candidate) => namesMatch(tokens, candidate.tokens));
      if (!matches.length) {
        if (item.review_status === "REVIEW_REQUIRED") return item;
        return { ...item, review_status: "REVIEW_REQUIRED", review_reason: "not-registered-biker" };
      }
      // Pre-select the biker only when the match is unambiguous.
      return matches.length === 1 ? { ...item, suggested_biker_id: matches[0].id } : item;
    })
  };
}

async function listRegisteredBikers() {
  const bikers = await prisma.biker.findMany({ select: { id: true, name: true, firstName: true } });
  const items = bikers.map((biker) => ({ id: biker.id, name: bikerDisplayName(biker) }))
    .filter((biker) => biker.name)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return { statusCode: 200, body: { items } };
}

async function syncBankPayment(payload) {
  const date = String(payload?.date || "").slice(0, 10);
  const amount = Number(payload?.amount);
  const bikerId = String(payload?.bikerId || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { statusCode: 400, body: { error: "The payment date is missing or invalid." } };
  if (!Number.isFinite(amount) || amount <= 0) return { statusCode: 400, body: { error: "The payment amount is missing or invalid." } };
  if (!bikerId) return { statusCode: 400, body: { error: "Select a registered biker before syncing." } };
  if (!sheetConfigured()) return { statusCode: 503, body: { error: "Google Sheet syncing is not configured." } };

  const biker = await prisma.biker.findUnique({ where: { id: bikerId }, select: { name: true, firstName: true } });
  if (!biker) return { statusCode: 404, body: { error: "The selected biker is no longer registered." } };

  try {
    const result = await syncPayment({ date, name: bikerDisplayName(biker), amount });
    return { statusCode: 200, body: { ...result, name: bikerDisplayName(biker) } };
  } catch (error) {
    if (error instanceof SheetError) return { statusCode: error.statusCode === 403 ? 403 : 502, body: { error: error.message } };
    throw error;
  }
}

async function withRegistrationCheck(response) {
  if (response.statusCode >= 400) return response;
  try {
    return { ...response, body: await markUnregisteredDepositors(response.body) };
  } catch (error) {
    return response;
  }
}

async function uploadBankStatement(req) {
  const headerError = validateUploadHeaders(req);
  if (headerError) return { statusCode: headerError.statusCode, body: { error: headerError.error } };

  try {
    const body = await readUpload(req);
    if (!body.length) return { statusCode: 400, body: { error: "The uploaded file is empty." } };
    const uploaded = await requestService("/api/v1/statements/upload", {
      method: "POST",
      headers: { "Content-Type": req.headers["content-type"] },
      body
    });
    if (uploaded.statusCode >= 400 || !uploaded.body?.statement_id) return uploaded;
    // The upload response only carries the new statement id; return the full statement.
    return getBankStatement(uploaded.body.statement_id);
  } catch (error) {
    return {
      statusCode: error.statusCode || 400,
      body: { error: error.message || "The upload could not be read." }
    };
  }
}

function listBankStatements() {
  return requestService("/api/v1/statements?page=1&page_size=25");
}

async function getBankStatement(statementId) {
  return withRegistrationCheck(await requestService(`/api/v1/statements/${encodeURIComponent(statementId)}`));
}

module.exports = {
  getBankStatement,
  integrationConfigured,
  listBankStatements,
  listRegisteredBikers,
  markUnregisteredDepositors,
  syncBankPayment,
  uploadBankStatement
};
