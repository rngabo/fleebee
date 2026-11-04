const { env } = require("../config/env");
const { prisma } = require("../lib/prisma");
const { recordSyncedPayment } = require("./data-sync-service");
const { calculateDashboard } = require("./dashboard-calculator");
const {
  SheetError,
  appendCheckNote,
  exclusive,
  isConfigured: sheetConfigured,
  paymentsSheetUrl,
  readPaymentsForAudit,
  refOf,
  syncPayment
} = require("./payments-sheet-service");
const { assignDeposits, auditSheetAgainstBank, findRecordedDeposit, nameKey: auditNameKey } = require("./sheet-audit-service");

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
  if (statusCode === 409) return typeof detail === "string" && detail ? detail : "This bank statement has already been processed.";
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
    const body = { error: upstreamMessage(response.status, payload) };
    const detail = payload?.detail;
    if (response.status === 409 && detail && typeof detail === "object") {
      if (detail.statement_id) body.statement_id = detail.statement_id;
      if (detail.code === "completed") {
        body.code = "completed";
        body.display_name = detail.display_name;
        const when = detail.completed_at ? new Date(detail.completed_at).toISOString().slice(0, 10) : "";
        body.error = `This statement (${detail.display_name}) was already fully synced${when ? ` on ${when}` : ""}. Nothing is left to do, so it was not uploaded again.`;
      }
    }
    return { statusCode: response.status, body };
  }
  return { statusCode: response.status, body: payload };
}

function nameTokens(value) {
  return new Set(String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean));
}

function nameWords(value) {
  return [...nameTokens(value)];
}

// Same normalisation the sheet import uses for rider names.
function nameTokensKey(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function bikerDisplayName(biker) {
  return [biker.name, biker.firstName].map((part) => String(part ?? "").trim()).filter(Boolean).join(" ");
}

// Riders you can sync payments for: the active riders of the sheet's Setup tab (linked to a Fleebee biker).
// Before any Setup data has been imported, every biker is offered.
async function eligibleBikers() {
  const members = await prisma.dataMember.findMany({
    where: { isPresent: true, sourceStatus: "active", bikerId: { not: null } },
    select: { bikerId: true }
  });
  const hasSetup = (await prisma.dataMember.count({ where: { isPresent: true } })) > 0;
  return prisma.biker.findMany({
    where: hasSetup ? { id: { in: members.map((member) => member.bikerId) } } : {},
    select: { id: true, name: true, firstName: true, phoneNumber: true }
  });
}

// Compare a name from the narration with the registered riders: a word equal to a rider's last name (the
// first word of their name) is a match; failing that, a word of 4+ letters equal to their first name.
// Several riders fitting means no match is made (never guess).
function findRidersByName(candidate, riders) {
  const words = nameWords(candidate).filter((word) => word.length >= 3);
  if (!words.length) return [];
  const byLastName = riders.filter((rider) => rider.lastWords.some((word) => words.includes(word)));
  if (byLastName.length) return byLastName;
  return riders.filter((rider) => rider.firstWords.some((word) => word.length >= 4 && words.includes(word)));
}

// Two payer names that are surely the same person: the same words in any order, or the same number of words where
// one word is just a cut-off of the other ("Uwurukundo Co" / "Uwurukundo Cos"). At least one full word of 5+ letters
// must be identical, and only one word may be a cut-off.
function similarNames(a, b) {
  const x = [...nameTokens(a)];
  const y = [...nameTokens(b)];
  if (!x.length || x.length !== y.length) return false;
  if ([...x].sort().join(" ") === [...y].sort().join(" ")) return true;
  const rest = [...y];
  let cutOffs = 0;
  let strong = 0;
  for (const word of x) {
    const exact = rest.indexOf(word);
    if (exact >= 0) {
      rest.splice(exact, 1);
      if (word.length >= 5) strong += 1;
      continue;
    }
    cutOffs += 1;
    const partial = rest.findIndex((other) => other.length >= 2 && word.length >= 2 && (other.startsWith(word) || word.startsWith(other)));
    if (partial < 0) return false;
    rest.splice(partial, 1);
  }
  return cutOffs <= 1 && strong >= 1;
}

// Remembered payers: a name the operator tied to a rider before. Matching ignores case, accents and word order.
const aliasKey = (name) => [...nameTokens(name)].sort().join(" ");

async function loadAliases() {
  const response = await requestService("/api/v1/aliases");
  if (response.statusCode >= 400) return new Map();
  return new Map((response.body?.items || []).map((alias) => [alias.name_key, alias]));
}

async function listAliases() {
  const response = await requestService("/api/v1/aliases");
  if (response.statusCode >= 400) return response;
  const riders = new Set((await eligibleBikers()).map((biker) => biker.id));
  return { statusCode: 200, body: { items: (response.body?.items || []).map((alias) => ({ ...alias, rider_available: riders.has(alias.biker_id) })) } };
}

async function saveAlias(payload) {
  const name = String(payload?.name || "").trim();
  const biker = payload?.bikerId ? await prisma.biker.findUnique({ where: { id: String(payload.bikerId) }, select: { id: true, name: true, firstName: true } }) : null;
  if (!name || !aliasKey(name)) return { statusCode: 400, body: { error: "There is no payer name to remember." } };
  if (!biker) return { statusCode: 404, body: { error: "The selected rider was not found." } };
  return requestService("/api/v1/aliases", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, biker_id: biker.id, biker_name: bikerDisplayName(biker) })
  });
}

async function removeAlias(aliasId) {
  const response = await requestService(`/api/v1/aliases/${encodeURIComponent(aliasId)}`, { method: "DELETE" });
  return response.statusCode >= 400 ? response : { statusCode: 200, body: { removed: true } };
}

// A narration can hold two names: the last text (usually the rider paid for, often cut short) and the sender.
// The one that fits a registered rider decides; if none fits, the last text is simply shown as the name.
async function markUnregisteredDepositors(body) {
  if (!Array.isArray(body?.transactions)) return body;
  const bikers = await eligibleBikers();
  const riders = bikers.map((biker) => ({
    id: biker.id,
    name: bikerDisplayName(biker),
    lastWords: nameWords(biker.name),
    firstWords: nameWords(biker.firstName)
  }));
  const riderIds = new Set(riders.map((rider) => rider.id));
  const aliases = await loadAliases().catch(() => new Map());
  const quote = (value) => `\u201c${value}\u201d`;

  return {
    ...body,
    transactions: body.transactions.map((item) => {
      if (item.sync_status && item.sync_status !== "PENDING") return item;
      const hints = item.name_hints || {};
      const tail = hints.trailing_name || "";
      const sender = hints.sender_name || "";
      const otherHint = (shown) => {
        if (shown === tail && sender && sender !== tail) return `Sender: ${sender}`;
        if (shown === sender && tail && tail !== sender) return `Narration ends with ${quote(tail)}`;
        return "";
      };

      // A rider picked earlier (saved with the entry) is kept when the statement is reopened.
      if (item.selected_biker_id && riderIds.has(item.selected_biker_id)) {
        return { ...item, suggested_biker_id: item.selected_biker_id, suggestion_source: "saved", name_hint: otherHint(item.depositor_name) };
      }

      // A payer name remembered from an earlier statement points straight at its rider.
      const remembered = item.depositor_name
        ? aliases.get(aliasKey(item.depositor_name)) || [...aliases.values()].find((alias) => riderIds.has(alias.biker_id) && similarNames(alias.display_name, item.depositor_name))
        : null;
      if (remembered && riderIds.has(remembered.biker_id)) {
        return { ...item, suggested_biker_id: remembered.biker_id, suggestion_source: "alias", name_hint: `Remembered: ${remembered.display_name} pays for ${remembered.biker_name}` };
      }

      const candidates = [...new Set([item.depositor_name, tail, sender].filter(Boolean))];
      if (!candidates.length) return item;

      const unique = new Map();       // rider id -> { rider, candidate } for names that fit exactly one rider
      const doubtful = [];            // names that fit several riders
      for (const candidate of candidates) {
        const fits = findRidersByName(candidate, riders);
        if (fits.length === 1 && !unique.has(fits[0].id)) unique.set(fits[0].id, { rider: fits[0], candidate });
        else if (fits.length > 1 && candidate === item.depositor_name) doubtful.push(...fits);
      }

      if (unique.size === 1) {
        const [{ rider, candidate }] = [...unique.values()];
        return { ...item, depositor_name: candidate, suggested_biker_id: rider.id, suggestion_source: "name", name_hint: otherHint(candidate) };
      }
      if (unique.size > 1 || doubtful.length) {
        const options = [...new Map([...unique.values()].map(({ rider }) => [rider.id, rider]).concat(doubtful.map((rider) => [rider.id, rider]))).values()];
        return {
          ...item,
          review_status: "REVIEW_REQUIRED",
          review_reason: "ambiguous-rider",
          name_hint: `Could be ${options.map((rider) => rider.name).join(" or ")}: pick the right rider`
        };
      }
      // Nothing resembles a rider: the last text stays as the name, with the other name as a hint.
      return { ...item, review_status: "REVIEW_REQUIRED", review_reason: "not-registered-biker", name_hint: otherHint(item.depositor_name) };
    })
  };
}

// How much each rider still owes for the current month and the 4 before it, so the sync dialog can offer
// "back-date to 31 Oct (owes 62,500)". Keyed by Fleebee biker id, then "YYYY-MM".
async function ridersOwed() {
  const [members, payments] = await Promise.all([
    prisma.dataMember.findMany({ where: { isPresent: true } }),
    prisma.dataPayment.findMany({ where: { isPresent: true }, select: { dataMemberId: true, paymentDate: true, amountRwf: true, referenceNote: true } })
  ]);
  const bikerOfMember = new Map(members.filter((member) => member.bikerId).map((member) => [member.id, member.bikerId]));
  const now = new Date(Date.now() + 2 * 3600 * 1000);
  const owed = new Map();
  for (let back = 0; back < 5; back += 1) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7);
    for (const row of calculateDashboard({ members, payments, month }).rows) {
      const bikerId = bikerOfMember.get(row.memberId);
      if (bikerId && row.forMonth.shortfall > 0) owed.set(bikerId, { ...(owed.get(bikerId) || {}), [month]: row.forMonth.shortfall });
    }
  }
  return owed;
}

async function listRegisteredBikers() {
  const bikers = await eligibleBikers();
  const owed = await ridersOwed().catch(() => new Map());
  const items = bikers.map((biker) => ({
    id: biker.id,
    name: bikerDisplayName(biker),
    phone: String(biker.phoneNumber ?? "").trim(),
    owed: owed.get(biker.id) || {}
  }))
    .filter((biker) => biker.name)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return { statusCode: 200, body: { items } };
}

// Once an entry is in the sheet (or skipped) its outcome is recorded on the saved statement entry.
async function settleEntry(transactionId, outcome, details = {}) {
  if (!transactionId) return {};
  const response = await requestService(`/api/v1/transactions/${encodeURIComponent(transactionId)}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outcome, biker_name: details.bikerName, sheet_row: details.sheetRow, sheet_date: details.sheetDate })
  });
  if (response.statusCode >= 400) return { settleWarning: "The payment was synced, but the saved statement could not be updated yet." };
  const statement = response.body?.statements?.[0];
  return statement ? {
    statementName: statement.display_name,
    remaining: statement.remaining,
    statementCompleted: statement.completed
  } : {};
}

async function skipBankEntry(payload) {
  if (!payload?.transactionId) return { statusCode: 400, body: { error: "The entry to skip is missing." } };
  const response = await requestService(`/api/v1/transactions/${encodeURIComponent(payload.transactionId)}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outcome: "SKIPPED" })
  });
  if (response.statusCode >= 400) return response;
  const statement = response.body?.statements?.[0] || {};
  return { statusCode: 200, body: {
    status: "skipped",
    message: "Entry skipped. It stays in the statement history and can be un-skipped.",
    statementName: statement.display_name,
    remaining: statement.remaining,
    statementCompleted: Boolean(statement.completed)
  } };
}

async function undoSkipEntry(payload) {
  if (!payload?.transactionId) return { statusCode: 400, body: { error: "The entry is missing." } };
  const response = await requestService(`/api/v1/transactions/${encodeURIComponent(payload.transactionId)}/reopen`, { method: "POST" });
  if (response.statusCode >= 400) return response;
  const statement = response.body?.statements?.[0] || {};
  return { statusCode: 200, body: { status: "pending", remaining: statement.remaining, statementName: statement.display_name } };
}

// A synced payment was deleted from the sheet: its bank entry becomes pending again.
async function reopenSyncedEntry({ date, amount, name, ref }) {
  return requestService("/api/v1/transactions/reopen-synced", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book_date: date || null, amount: amount === undefined ? null : String(amount), biker_name: name || null, ref: ref || null })
  });
}

const nameSortKey = (name) => [...nameTokens(name)].sort().join(" ");
const paymentKey = (day, amount, name) => `${String(day).slice(0, 10)}|${Number(amount)}|${nameSortKey(name)}`;

// Synced entries whose payment is no longer in the sheet (deleted there by hand). The reference code in the
// sheet note finds the row whatever date it now carries; entries without one fall back to the recorded date,
// amount and name. Only entries synced before the last sheet import started are judged, because newer ones may
// simply not be imported yet.
function findOrphanedSyncedEntries(entries, importedPayments, importStartedAt) {
  const present = new Set(importedPayments.map((payment) => paymentKey(payment.date, payment.amount, payment.name)));
  const refs = new Set(importedPayments.map((payment) => payment.ref).filter(Boolean));
  return entries.filter((entry) => {
    if (!entry.synced_at || new Date(entry.synced_at) >= importStartedAt) return false;
    if (entry.ref && refs.has(entry.ref)) return false;
    return !present.has(paymentKey(entry.sheet_date || entry.book_date, entry.amount, entry.biker_name));
  });
}

// After a sheet import: entries synced earlier but no longer in the sheet go back to Pending.
async function reconcileSyncedEntries() {
  const run = await prisma.dataSyncRun.findFirst({
    where: { status: { in: ["COMPLETED", "PARTIAL"] } },
    orderBy: { startedAt: "desc" }
  });
  if (!run) return 0;
  const listed = await requestService("/api/v1/transactions/synced");
  if (listed.statusCode >= 400) return 0;
  const payments = await prisma.dataPayment.findMany({
    where: { isPresent: true },
    select: { paymentDate: true, amountRwf: true, referenceNote: true, dataMember: { select: { sourceName: true } } }
  });
  const orphaned = findOrphanedSyncedEntries(
    listed.body?.items || [],
    payments.map((payment) => ({
      date: payment.paymentDate.toISOString().slice(0, 10),
      amount: payment.amountRwf,
      name: payment.dataMember.sourceName,
      ref: refOf(payment.referenceNote)
    })),
    run.startedAt
  );
  for (const entry of orphaned) {
    await reopenSyncedEntry({ date: entry.sheet_date || entry.book_date, amount: entry.amount, name: entry.biker_name, ref: entry.ref });
  }
  return orphaned.length;
}

// Which saved statement each app-synced payment came from (for the link on the Payments page): matched by the
// reference code in the note, else by recorded date, amount and name.
async function attachSourceStatements(items) {
  if (!items.some((item) => item.deletable)) return items;
  const response = await requestService("/api/v1/transactions/synced");
  if (response.statusCode >= 400) return items;
  const entries = response.body?.items || [];
  const byRef = new Map(entries.map((entry) => [entry.ref, entry]));
  const byKey = new Map(entries.map((entry) => [paymentKey(entry.sheet_date || entry.book_date, entry.amount, entry.biker_name), entry]));
  return items.map((item) => {
    if (!item.deletable) return item;
    const entry = byRef.get(refOf(item.referenceNote)) || byKey.get(paymentKey(item.paymentDate, item.amountRwf, item.sourceName));
    return entry ? { ...item, sourceStatement: { id: entry.statement_id, name: entry.statement_name } } : item;
  });
}

// The deposits of a statement as the matching engine wants them: which rider each is tied to (synced ones keep the
// rider they were synced for; pending ones use the chosen or suggested rider), and the short reference code.
function depositsOf(statement, riderNames, override = {}) {
  return (statement.transactions || [])
    .filter((item) => Number(item.credit) > 0)
    .map((item) => {
      const settled = item.sync_status === "SYNCED" || item.sync_status === "IN_SHEET";
      const riderId = item.selected_biker_id || item.suggested_biker_id;
      const ref = String(item.id).replace(/-/g, "").slice(0, 8).toLowerCase();
      return {
        id: item.id,
        ref,
        date: item.book_date,
        amount: Math.round(Number(item.credit)),
        rider: override[ref] || (settled ? (item.synced_biker_name || "") : (riderNames.get(riderId) || "")),
        depositor: item.depositor_name || "",
        status: item.sync_status
      };
    });
}

// Compares the sheet's payments with this statement (period start to end) rider by rider. With write=true each
// mistake found is also noted in that row's Reference/Notes in the sheet (appended, never replacing). Nothing is
// deleted or changed otherwise: the operator decides what to do from the sheet.
async function auditStatementAgainstSheet(statementId, { write = false } = {}) {
  if (!sheetConfigured()) return { statusCode: 503, body: { error: "Google Sheet checking is not configured." } };
  const detail = await getBankStatement(statementId);
  if (detail.statusCode >= 400) return detail;
  const statement = detail.body;
  if (!statement.period_start || !statement.period_end) {
    return { statusCode: 422, body: { error: "This statement has no period, so there is nothing to compare the sheet with." } };
  }

  const riders = await eligibleBikers();
  const riderNames = new Map(riders.map((biker) => [biker.id, bikerDisplayName(biker)]));
  const entries = depositsOf(statement, riderNames);

  const known = new Set([...riderNames.values()].map(auditNameKey));
  const sheetRows = (await readPaymentsForAudit()).filter((row) => known.has(auditNameKey(row.name)));
  const name = statement.display_name || "statement";
  const { assignments } = assignDeposits({ sheetRows: sheetRows.map((row) => ({ ...row })), entries: entries.map((entry) => ({ ...entry })) });
  // Deposits an earlier, looser check marked "already in the sheet" although no row matches them.
  const recordedWithoutRow = entries
    .filter((entry) => entry.status === "IN_SHEET" && entry.rider && !assignments.has(entry.ref))
    .map((entry) => ({ id: entry.id, date: entry.date, amount: entry.amount, rider: entry.rider }));
  const result = auditSheetAgainstBank({
    sheetRows,
    entries,
    period: { start: String(statement.period_start).slice(0, 10), end: String(statement.period_end).slice(0, 10) },
    statementName: name
  });

  let written = 0;
  const findings = [];
  for (const finding of result.findings) {
    let noteStatus = "not-written";
    if (write) {
      noteStatus = await exclusive(() => appendCheckNote({
        row: finding.row,
        expect: { date: finding.date, name: finding.rider, amount: finding.amount },
        text: finding.note,
        marker: `CHECK [${name}]`
      }));
      if (noteStatus === "written") written += 1;
    }
    findings.push({ ...finding, noteStatus });
  }
  return {
    statusCode: 200,
    body: {
      statementName: name,
      sheetUrl: await paymentsSheetUrl(),
      period: { start: statement.period_start, end: statement.period_end },
      sheetRowsChecked: sheetRows.length,
      matched: result.matched,
      tooRecent: result.tooRecent,
      undecided: result.undecided,
      recordedWithoutRow,
      appDuplicates: result.appDuplicates,
      missingInSheet: result.missingInSheet.length,
      findings,
      notesWritten: written,
      wrote: write
    }
  };
}

// Skipped entries back to pending: those closed in bulk by "Mark as verified" (default) or all of them.
async function reopenSkippedEntries(statementId, { onlyBulk = true } = {}) {
  return requestService(`/api/v1/statements/${encodeURIComponent(statementId)}/reopen-skipped?only_bulk=${onlyBulk ? "true" : "false"}`, { method: "POST" });
}

// Reopens the deposits that were marked "already in the sheet" without any matching row, tying each back to its rider,
// so Sync can add them (or find their real row).
async function reopenUnmatchedRecorded(statementId) {
  const audit = await auditStatementAgainstSheet(statementId, { write: false });
  if (audit.statusCode >= 400) return audit;
  const riders = await eligibleBikers();
  const idByName = new Map(riders.map((rider) => [auditNameKey(bikerDisplayName(rider)), rider.id]));
  let reopened = 0;
  for (const entry of audit.body.recordedWithoutRow) {
    const result = await undoSkipEntry({ transactionId: entry.id });
    if (result.statusCode >= 400) continue;
    const riderId = idByName.get(auditNameKey(entry.rider));
    if (riderId) await saveBikerSelection({ transactionId: entry.id, bikerId: riderId });
    reopened += 1;
  }
  return { statusCode: 200, body: { reopened } };
}

function saveBikerSelection(payload) {
  if (!payload?.transactionId) return { statusCode: 400, body: { error: "The entry is missing." } };
  return requestService(`/api/v1/transactions/${encodeURIComponent(payload.transactionId)}/biker`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ biker_id: payload.bikerId || null })
  });
}

function listCompletedStatements() {
  return requestService("/api/v1/statements/completed");
}

async function verifyBankStatement(statementId) {
  return requestService(`/api/v1/statements/${encodeURIComponent(statementId)}/verify`, { method: "POST" });
}

async function discardBankStatement(statementId) {
  const response = await requestService(`/api/v1/statements/${encodeURIComponent(statementId)}`, { method: "DELETE" });
  if (response.statusCode >= 400) return response;
  const archived = response.body?.mode === "archived";
  return { statusCode: 200, body: {
    mode: response.body?.mode || "deleted",
    message: archived
      ? "Removed from the list. Whatever is already synced stays on record, so overlapping uploads skip those rows. If the file was not finished, uploading it again reopens it."
      : "Saved statement discarded."
  } };
}

// Back-dating: a late payment can be recorded under the LAST DAY of an earlier month ("YYYY-MM", from the
// payment's own month back up to 12 months). Null when it stays on its bank date; false when invalid.
function validRecordAs(value, bankDate) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}$/.test(String(value))) return false;
  const own = String(bankDate).slice(0, 7);
  if (value === own) return null;
  const monthIndex = (key) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7));
  const gap = monthIndex(own) - monthIndex(value);
  return gap >= 1 && gap <= 12 ? value : false;
}

function lastDayOf(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
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

  // Payments only count on the dashboard for riders listed in the sheet's Setup tab; refuse others
  // before anything is written (skipped when no Setup data has been imported yet).
  const setupRiders = await prisma.dataMember.count({ where: { isPresent: true } });
  if (setupRiders > 0) {
    const listed = await prisma.dataMember.findFirst({
      where: { isPresent: true, normalizedName: nameTokensKey(bikerDisplayName(biker)) },
      select: { id: true }
    });
    if (!listed) {
      return { statusCode: 422, body: { error: `${bikerDisplayName(biker)} is not listed as a rider in the Setup tab of the Google Sheet, so this payment would not count on the dashboard. Nothing was written.` } };
    }
  }

  // The deposits of the same statement give the matcher the full picture (identical payments are paired one to one).
  let statementEntries = [];
  if (payload?.statementId) {
    const detail = await getBankStatement(payload.statementId);
    if (detail.statusCode < 400) {
      const riderNames = new Map((await eligibleBikers()).map((item) => [item.id, bikerDisplayName(item)]));
      statementEntries = depositsOf(detail.body, riderNames);
    }
  }
  const ownRef = payload?.transactionId ? String(payload.transactionId).replace(/-/g, "").slice(0, 8).toLowerCase() : "";
  const riderName = bikerDisplayName(biker);
  const depositsForMatch = ownRef
    ? [...statementEntries.filter((entry) => entry.ref !== ownRef), ...[{ ref: ownRef, date, amount: Math.round(amount), rider: riderName, depositor: "", status: "PENDING" }]]
    : [];
  const findExisting = ownRef ? (sheetRows) => findRecordedDeposit({ sheetRows, entries: depositsForMatch, ref: ownRef }) : undefined;

  const recordAs = validRecordAs(payload?.recordAs, date);
  if (recordAs === false) {
    return { statusCode: 400, body: { error: "A payment can be recorded under the last day of its own month or of one of the 12 months before." } };
  }
  // Back-dated: the sheet gets the last day of that month; the real bank date stays in the note.
  const recordedDate = recordAs ? lastDayOf(recordAs) : date;
  const ref = payload?.transactionId ? String(payload.transactionId).replace(/-/g, "").slice(0, 8).toLowerCase() : "";

  try {
    const result = await syncPayment({ date: recordedDate, name: bikerDisplayName(biker), amount, paidOn: recordedDate !== date ? date : "", ref, findExisting });
    if (result.status === "synced") {
      await recordSyncedPayment({
        name: bikerDisplayName(biker),
        paymentDate: recordedDate,
        amountRwf: Math.round(amount),
        paymentMethod: result.paymentMethod,
        sheetRow: result.row,
        note: result.note
      }).catch(() => {});
    }
    // The very same bank entry (found by its reference code) is already synced: nothing to record again.
    if (result.sameEntry) return { statusCode: 200, body: { ...result, name: bikerDisplayName(biker) } };
    const settled = await settleEntry(payload?.transactionId, result.status === "synced" ? "SYNCED" : "IN_SHEET", {
      bikerName: bikerDisplayName(biker),
      sheetRow: result.row || result.existingRow,
      sheetDate: result.status === "synced" ? recordedDate : result.existingDate
    });
    return { statusCode: 200, body: { ...result, name: bikerDisplayName(biker), recordedDate, ...settled } };
  } catch (error) {
    if (error instanceof SheetError) return { statusCode: [403, 429].includes(error.statusCode) ? error.statusCode : 502, body: { error: error.message } };
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
    if (uploaded.statusCode === 409 && uploaded.body?.statement_id) {
      // Same file uploaded before: show the saved results instead of failing.
      const existing = await getBankStatement(uploaded.body.statement_id);
      if (existing.statusCode >= 400) return uploaded;
      return { statusCode: 200, body: { ...existing.body, already_processed: true } };
    }
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
  return requestService("/api/v1/statements?page=1&page_size=100");
}

async function getBankStatement(statementId) {
  return withRegistrationCheck(await requestService(`/api/v1/statements/${encodeURIComponent(statementId)}`));
}

module.exports = {
  attachSourceStatements,
  reopenUnmatchedRecorded,
  similarNames,
  auditStatementAgainstSheet,
  reopenSkippedEntries,
  listAliases,
  removeAlias,
  saveAlias,
  findRidersByName,
  findOrphanedSyncedEntries,
  reconcileSyncedEntries,
  discardBankStatement,
  getBankStatement,
  listCompletedStatements,
  saveBikerSelection,
  reopenSyncedEntry,
  skipBankEntry,
  undoSkipEntry,
  verifyBankStatement,
  integrationConfigured,
  listBankStatements,
  listRegisteredBikers,
  markUnregisteredDepositors,
  syncBankPayment,
  uploadBankStatement
};
