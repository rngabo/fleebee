const runtimeConfig = window.FLEEBEE_CONFIG || {};
const API_BASE = String(runtimeConfig.apiBaseUrl || window.location.origin).replace(/\/$/, "");
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const $ = (id) => document.getElementById(id);
const fileInput = $("statementFile");
const uploadForm = $("statementUploadForm");
const processButton = $("processStatementButton");
const dropZone = $("statementDropZone");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setNotice(message = "", kind = "") {
  $("pageNotice").textContent = message;
  $("pageNotice").className = `notice page-notice${kind ? ` ${kind}` : ""}`;
}

function formatRwf(value) {
  return `RWF ${(Number(value) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return "—";
  const parts = String(value).slice(0, 10).split("-");
  if (parts.length !== 3) return value;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${API_BASE}${pathname}`, { credentials: "same-origin", ...options });
  if (response.status === 401) {
    window.location.assign(`/login/?redirect=${encodeURIComponent(window.location.pathname)}`);
    throw new Error("Login required.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed with HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function validateFile(file) {
  if (!file) return "Choose a PDF statement first.";
  if (!file.name.toLowerCase().endsWith(".pdf")) return "Only PDF files are accepted.";
  if (file.type && file.type !== "application/pdf") return "The selected file is not a PDF.";
  if (file.size === 0) return "The selected PDF is empty.";
  if (file.size > MAX_FILE_BYTES) return "The selected PDF is larger than the 10 MB limit.";
  return "";
}

function clearResults() {
  hideSheetCheck();
  $("statementTransactionsBody").innerHTML = "";
  $("statementTableTotal").textContent = formatRwf(0);
  $("statementSummary").classList.add("hidden");
  $("statementResults").classList.add("hidden");
  $("statementBadge").textContent = "No statement loaded";
  $("statementBadge").className = "badge status-chip pending";
}

function resetUpload() {
  clearResults();
  fileInput.value = "";
  $("statementFileLabel").textContent = "Choose a Bank of Kigali PDF";
  $("statementFileMeta").textContent = "No file selected";
  processButton.disabled = true;
  setNotice("");
}

function selectFile(file) {
  clearResults();
  const error = validateFile(file);
  if (error) {
    fileInput.value = "";
    $("statementFileLabel").textContent = "Choose a Bank of Kigali PDF";
    $("statementFileMeta").textContent = "No valid file selected";
    processButton.disabled = true;
    setNotice(error, "error");
    return false;
  }
  $("statementFileLabel").textContent = file.name;
  $("statementFileMeta").textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB PDF`;
  processButton.disabled = false;
  setNotice("Ready to process this statement.");
  return true;
}

let registeredBikers = [];
let rows = [];
let currentStatement = { id: "", name: "", completed: false };
let statusFilter = "ALL";

const SETTLED = new Set(["synced", "duplicate"]);

function initialSync(item) {
  if (item.sync_status === "SYNCED") {
    const when = item.synced_at ? formatDate(item.synced_at) : "";
    return { state: "synced", message: `Synced${when ? ` on ${when}` : ""}${item.sheet_row ? ` · sheet row ${item.sheet_row}` : ""}` };
  }
  if (item.sync_status === "IN_SHEET") return { state: "duplicate", message: "This payment was already in the Google Sheet." };
  if (item.sync_status === "SKIPPED") return { state: "skipped", message: "Skipped: not synced to the sheet." };
  return { state: "idle", message: "" };
}

function normalizeTransactions(payload) {
  return (payload.transactions || [])
    .filter((item) => Number(item.credit ?? item.amount) > 0)
    .map((item) => {
      const sync = initialSync(item);
      return {
        id: item.id,
        date: item.book_date || item.date,
        depositorName: item.depositor_name,
        amount: item.credit ?? item.amount,
        reviewReason: item.review_reason || "",
        nameHint: item.name_hint || "",
        bikerId: SETTLED.has(sync.state) ? "" : (item.suggested_biker_id || ""),
        // Where the suggested rider came from: a saved earlier pick, a remembered payer, or the name itself.
        skipReason: item.skip_reason || "",
        suggestionSource: item.suggestion_source || "",
        autoBikerId: ["alias", "name"].includes(item.suggestion_source) ? (item.suggested_biker_id || "") : "",
        syncedBiker: item.synced_biker_name || "",
        sync,
        reviewStatus: item.review_status || (item.depositor_name ? "VALIDATED" : "REVIEW_REQUIRED")
      };
    });
}

function group(item) {
  if (SETTLED.has(item.sync.state)) return "SYNCED";
  if (item.sync.state === "skipped") return "SKIPPED";
  return "PENDING";
}

// A deposit is resolved once it is tied to a registered biker, so selecting one clears "Review required".
function isReview(item) {
  if (group(item) !== "PENDING") return false;
  return !item.bikerId && (item.reviewStatus === "REVIEW_REQUIRED" || !item.depositorName);
}

function bikerOptions(selectedId) {
  return `<option value="">— Select biker —</option>${registeredBikers.map((biker) =>
    `<option value="${escapeHtml(biker.id)}"${biker.id === selectedId ? " selected" : ""}>${escapeHtml(biker.name)}</option>`).join("")}`;
}

function paymentsLink(name) {
  return `/data-payments.html?show=1&filter=${encodeURIComponent(name || "")}`;
}

function bikerCell(item) {
  if (group(item) === "SYNCED") return `<span class="table-cell-strong">${escapeHtml(item.syncedBiker || "—")}</span>`;
  const busy = item.sync.state === "syncing";
  return `<select class="biker-select" data-biker aria-label="Registered biker for ${escapeHtml(item.depositorName || "this deposit")}"${busy ? " disabled" : ""}${group(item) === "SKIPPED" ? ' title="Pick a rider to reopen this skipped row"' : ""}>${bikerOptions(item.bikerId)}</select>`;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthKeyOffset(date, back) {
  const [year, month] = String(date).slice(0, 7).split("-").map(Number);
  const index = year * 12 + (month - 1) - back;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function lastDayLabel(key, bankDate) {
  const [year, month] = key.split("-").map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const sameYear = String(bankDate).slice(0, 4) === String(year);
  return `${day} ${MONTH_NAMES[month - 1]}${sameYear ? "" : ` ${year}`}`;
}

// "Record as": keep the bank date, or back-date a late payment to the LAST DAY of the month it settles.
// The sheet note keeps the real bank date. The rider's unpaid amount for that month is shown to help choose.
function recordAsSelect(item) {
  const owed = registeredBikers.find((biker) => biker.id === item.bikerId)?.owed || {};
  const options = [0, 1, 2, 3].map((back) => {
    const key = monthKeyOffset(item.date, back);
    if (back === 0) return `<option value=""${!item.recordAs ? " selected" : ""}>Bank date</option>`;
    const note = owed[key] ? ` · owes ${Number(owed[key]).toLocaleString("en-US")}` : "";
    return `<option value="${key}"${item.recordAs === key ? " selected" : ""}>${lastDayLabel(key, item.date)} (back-date)${note}</option>`;
  }).join("");
  return `<select class="for-month-select" data-record-as aria-label="Date to record in the sheet" title="Record the payment under its bank date, or back-date it to the last day of the month it settles. The real bank date is kept in the sheet note.">${options}</select>`;
}

// Back-dating is rare, so the dropdown only shows on a row when the chosen rider still owes for an earlier month
// (the amount owed is in the labels), when a back-date is already chosen, or when the operator opens it.
function offersBackDating(item) {
  if (item.showRecordAs || item.recordAs) return true;
  const owed = registeredBikers.find((biker) => biker.id === item.bikerId)?.owed || {};
  return [1, 2, 3].some((back) => owed[monthKeyOffset(item.date, back)] > 0);
}

function syncCell(item) {
  const { state, message } = item.sync;
  if (state === "synced" || state === "duplicate") {
    const chip = state === "synced"
      ? `<span class="status-chip sent" title="${escapeHtml(message)}">Synced</span>`
      : `<span class="status-chip pending" title="${escapeHtml(message)}">Already in sheet</span>`;
    return `${chip} <a class="row-link" href="${paymentsLink(item.syncedBiker)}">View in Payments</a>`;
  }
  if (state === "skipped") {
    return `<span class="status-chip pending" title="${escapeHtml(message)}">Skipped</span> <button class="link-button neutral" type="button" data-undo>Undo skip</button>`;
  }
  const busy = state === "syncing";
  const error = state === "error" ? `<div class="mini-note sync-error">${escapeHtml(message)}</div>` : "";
  const backDate = offersBackDating(item)
    ? recordAsSelect(item)
    : `<button class="link-button neutral" type="button" data-show-record-as title="Record this payment under the last day of an earlier month">Back-date</button>`;
  return `<span class="sync-actions"><button class="ghost-button" type="button" data-sync${item.bikerId && !busy ? "" : " disabled"}>${busy ? "Syncing…" : state === "error" ? "Retry" : "Sync"}</button> <button class="link-button" type="button" data-skip${busy ? " disabled" : ""} title="Not a bike payment: skip this entry">Skip</button> ${backDate}</span>${error}`;
}

function statusCell(item) {
  if (group(item) === "SKIPPED") return '<span class="status-chip pending">Skipped</span>';
  const review = isReview(item);
  const note = review && item.reviewReason === "ambiguous-rider" ? '<div class="mini-note">Several riders fit</div>' : "";
  const why = review && item.reviewReason === "not-registered-biker" ? "Not a registered biker" : "";
  const phone = !review && item.bikerId ? registeredBikers.find((biker) => biker.id === item.bikerId)?.phone : "";
  const call = phone ? `<div class="mini-note">📞 <a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ""))}">${escapeHtml(phone)}</a></div>` : "";
  return `<span class="status-chip ${review ? "failed" : "sent"}"${why ? ` title="${why}"` : ""}>${review ? "Review required" : "Validated"}</span>${note}${call}`;
}

function counts() {
  const result = { ALL: rows.length, PENDING: 0, SYNCED: 0, SKIPPED: 0 };
  for (const item of rows) result[group(item)] += 1;
  return result;
}

function renderFilters() {
  const c = counts();
  const labels = [["ALL", "All"], ["PENDING", "Pending"], ["SYNCED", "Synced"], ["SKIPPED", "Skipped"]];
  $("statementFilters").innerHTML = labels.map(([key, label]) =>
    `<button type="button" class="filter-chip${statusFilter === key ? " active" : ""}" data-filter="${key}">${label} <span>${c[key]}</span></button>`).join("");
}

function renderSummary(description) {
  const total = rows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const reviews = rows.filter(isReview).length;
  const c = counts();
  $("incomingCount").textContent = rows.length.toLocaleString("en-US");
  $("incomingTotal").textContent = formatRwf(total);
  $("reviewCount").textContent = reviews.toLocaleString("en-US");
  $("statementTableTotal").textContent = formatRwf(total);
  if (description) $("statementDescription").dataset.base = description;
  $("statementDescription").textContent = `${$("statementDescription").dataset.base || ""} ${c.PENDING} pending · ${c.SYNCED} synced · ${c.SKIPPED} skipped.`.trim();
  const finished = rows.length > 0 && c.PENDING === 0;
  $("statementBadge").textContent = finished ? "Verified" : reviews ? `${reviews} need review` : `${c.PENDING} pending`;
  $("statementBadge").className = `badge status-chip ${finished ? "sent" : "pending"}`;
  renderFilters();
  // Verifying by hand is only offered inside an opened statement that still has pending rows.
  $("verifyStatementButton").classList.toggle("hidden", !currentStatement.id || currentStatement.completed || finished);
  renderBulkButton();
}

function renderRow(item, index) {
  const hidden = statusFilter !== "ALL" && group(item) !== statusFilter ? " hidden" : "";
  return `
      <tr data-index="${index}" data-group="${group(item)}" class="${hidden.trim()}">
        <td class="row-number"></td>
        <td>${escapeHtml(formatDate(item.date))}</td>
        <td><div class="table-cell-strong">${escapeHtml(item.depositorName || "Name not identified")}</div>${item.nameHint ? `<div class="table-cell-muted name-hint">${escapeHtml(item.nameHint)}</div>` : ""}</td>
        <td data-cell="biker">${bikerCell(item)}</td>
        <td><div class="table-cell-strong">${escapeHtml(formatRwf(item.amount))}</div></td>
        <td data-cell="status">${statusCell(item)}</td>
        <td data-cell="sync">${syncCell(item)}</td>
      </tr>`;
}

function renderStatement(payload, description = "Statement processed successfully.") {
  rows = normalizeTransactions(payload);
  currentStatement = { id: payload.id || payload.statement_id || "", name: payload.display_name || "", completed: Boolean(payload.completed_at) };
  // Open on what still needs work; finished statements open on everything.
  statusFilter = rows.some((item) => group(item) === "PENDING") ? "PENDING" : "ALL";
  $("statementPeriod").textContent = payload.period_start || payload.period_end
    ? `${formatDate(payload.period_start)} – ${formatDate(payload.period_end)}`
    : "Not found in PDF";
  $("statementTransactionsBody").innerHTML = rows.length
    ? rows.map(renderRow).join("")
    : '<tr><td colspan="7" class="empty-table">No incoming transactions were found in this statement.</td></tr>';
  $("statementSummary").classList.remove("hidden");
  $("statementResults").classList.remove("hidden");
  renderSummary(description);
}

function applyFilter() {
  document.querySelectorAll("#statementTransactionsBody tr[data-index]").forEach((tr) => {
    tr.classList.toggle("hidden", statusFilter !== "ALL" && tr.dataset.group !== statusFilter);
  });
  renderFilters();
}

function refreshRow(tr) {
  const item = rows[Number(tr.dataset.index)];
  tr.dataset.group = group(item);
  tr.querySelector('[data-cell="biker"]').innerHTML = bikerCell(item);
  tr.querySelector('[data-cell="status"]').innerHTML = statusCell(item);
  tr.querySelector('[data-cell="sync"]').innerHTML = syncCell(item);
  renderSummary();
}

function reportProgress(result) {
  if (result.settleWarning) setNotice(result.settleWarning, "error");
  else if (result.statementCompleted) {
    setNotice(`All entries of ${result.statementName || "this statement"} are done. It is now marked Verified and its PDF file was removed; every row and its outcome stays here for reference.`, "success");
  } else if (typeof result.remaining === "number") {
    setNotice(`Saved. ${result.remaining} entr${result.remaining === 1 ? "y" : "ies"} still pending in ${result.statementName || "this statement"}.`, "success");
  }
  loadHistory();
}

async function syncRow(tr, { quiet = false } = {}) {
  const item = rows[Number(tr.dataset.index)];
  if (!item?.bikerId || item.sync.state === "syncing") return null;
  item.sync = { state: "syncing", message: "" };
  refreshRow(tr);
  try {
    const result = await fetchJson("/api/bank-statements/sync-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: String(item.date).slice(0, 10), amount: item.amount, bikerId: item.bikerId, transactionId: item.id, statementId: currentStatement.id, recordAs: item.recordAs || "" })
    });
    item.syncedBiker = result.name || registeredBikers.find((biker) => biker.id === item.bikerId)?.name || "";
    item.sync = {
      state: result.status === "duplicate" ? "duplicate" : "synced",
      message: result.recordedDate && result.recordedDate !== String(item.date).slice(0, 10)
        ? `${result.message || ""} Recorded as ${formatDate(result.recordedDate)}; real date ${formatDate(item.date)} is in the note.`.trim()
        : result.message || ""
    };
    if (!quiet) {
      reportProgress(result);
      runSheetCheck({ quiet: true });
    }
    refreshRow(tr);
    return {
      ok: true,
      duplicate: result.status === "duplicate",
      backDated: Boolean(result.recordedDate && result.recordedDate !== String(item.date).slice(0, 10)),
      warning: result.settleWarning || ""
    };
  } catch (error) {
    item.sync = { state: "error", message: error.message };
    refreshRow(tr);
    return { ok: false, error, status: error.status };
  }
}

// ---- Reopen rows that were only skipped because a statement was verified in bulk ----
async function reopenBulkSkipped() {
  const count = rows.filter((item) => group(item) === "SKIPPED" && item.skipReason === "VERIFY").length;
  if (!count || !currentStatement.id) return;
  if (!window.confirm(`Reopen ${count} row${count === 1 ? "" : "s"} that ${count === 1 ? "was" : "were"} skipped only because an earlier statement was marked as verified?\n\nThey become pending again so you can pick a rider and sync them. Rows you skipped yourself stay skipped.`)) return;
  try {
    const result = await fetchJson(`/api/bank-statements/${encodeURIComponent(currentStatement.id)}/reopen-skipped`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onlyBulk: true })
    });
    await openStatement(currentStatement.id);
    setNotice(`${result.reopened} row${result.reopened === 1 ? "" : "s"} reopened. Pick a rider on each (the same payer name fills its other rows) and use Sync all ready.`, "success");
  } catch (error) {
    setNotice(error.message, "error");
  }
}

// ---- Sheet check: does the Google Sheet agree with this statement? ----
let lastCheck = null;

const KIND_LABELS = {
  APP_DUPLICATE: ["Extra copy added by the app", "failed"],
  NOT_IN_BANK: ["Not in bank statement", "failed"],
  AMOUNT_DIFFERS: ["Amount differs", "pending"],
  DUPLICATE: ["Possible duplicate", "pending"]
};

function hideSheetCheck() {
  lastCheck = null;
  $("sheetCheckPanel").classList.add("hidden");
}

function renderSheetCheck(result) {
  lastCheck = result;
  const { findings } = result;
  const pending = findings.filter((finding) => finding.noteStatus === "not-written").length;
  $("sheetCheckTitle").textContent = findings.length
    ? `Sheet check: ${findings.length} row${findings.length === 1 ? "" : "s"} to look at`
    : "Sheet check: nothing wrong found";
  const parts = [
    `${result.sheetRowsChecked} sheet rows checked against ${result.statementName} (${formatDate(result.period.start)} to ${formatDate(result.period.end)})`,
    `${result.matched} matched to a deposit`,
    result.undecided.length ? `${result.undecided.length} explained by deposits not tied to a rider yet or skipped` : "",
    result.tooRecent ? `${result.tooRecent} too recent to judge` : "",
    result.missingInSheet ? `${result.missingInSheet} deposit${result.missingInSheet === 1 ? "" : "s"} with a rider not in the sheet yet (Sync adds them)` : "",
    result.recordedWithoutRow?.length ? `${result.recordedWithoutRow.length} marked “already in the sheet” but no matching row exists` : ""
  ].filter(Boolean);
  $("sheetCheckSummary").textContent = `${parts.join(" · ")}.`;
  $("sheetCheckBody").innerHTML = findings.length
    ? findings.map((finding) => {
      const [label, tone] = KIND_LABELS[finding.kind] || [finding.kind, "pending"];
      const note = { written: "Added", already: "Already there", changed: "Row changed: skipped", "not-written": "—" }[finding.noteStatus] || "—";
      const rowLink = result.sheetUrl ? `<a class="row-link" href="${escapeHtml(result.sheetUrl)}&range=A${finding.row}" target="_blank" rel="noreferrer">row ${finding.row}</a>` : `row ${finding.row}`;
      return `
        <tr>
          <td class="row-number"></td>
          <td>${rowLink} <span class="table-cell-muted">${escapeHtml(formatDate(finding.date))}</span></td>
          <td class="table-cell-strong">${escapeHtml(finding.rider)}</td>
          <td>${escapeHtml(formatRwf(finding.amount))}</td>
          <td><span class="status-chip ${tone}">${escapeHtml(label)}</span> <span class="table-cell-muted">${escapeHtml(finding.message)}</span></td>
          <td>${escapeHtml(note)}</td>
        </tr>`;
    }).join("")
    : '<tr><td colspan="6" class="empty-table">Every sheet row in this period is backed by a deposit, or is too recent to judge.</td></tr>';
  const reopenButton = $("reopenUnmatchedButton");
  const unmatched = result.recordedWithoutRow?.length || 0;
  reopenButton.classList.toggle("hidden", unmatched === 0);
  reopenButton.textContent = `Reopen ${unmatched} with no matching row`;
  const writeButton = $("writeCommentsButton");
  writeButton.classList.toggle("hidden", pending === 0);
  writeButton.textContent = `Add comments to the sheet (${pending})`;
  $("sheetCheckPanel").classList.remove("hidden");
}

async function runSheetCheck({ write = false, quiet = false } = {}) {
  if (!currentStatement.id) return null;
  const button = $("checkSheetButton");
  button.disabled = true;
  if (!quiet) setNotice(write ? "Adding comments to the Google Sheet…" : "Comparing the Google Sheet with this statement…");
  try {
    const result = await fetchJson(`/api/bank-statements/${encodeURIComponent(currentStatement.id)}/audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ write })
    });
    renderSheetCheck(result);
    if (!quiet) {
      setNotice(
        write
          ? `${result.notesWritten} comment${result.notesWritten === 1 ? "" : "s"} added to the sheet's Reference/Notes. Open the rows from the list to act on them in the sheet.`
          : result.findings.length ? `${result.findings.length} sheet row${result.findings.length === 1 ? "" : "s"} look wrong. Review them below.` : "The sheet agrees with this statement.",
        write || !result.findings.length ? "success" : "error"
      );
    }
    return result;
  } catch (error) {
    if (!quiet) setNotice(error.message, "error");
    return null;
  } finally {
    button.disabled = false;
  }
}

async function writeSheetComments() {
  if (!lastCheck) return;
  const pending = lastCheck.findings.filter((finding) => finding.noteStatus === "not-written").length;
  if (!pending) return;
  const message = `Add a comment to the Reference/Notes of ${pending} row${pending === 1 ? "" : "s"} in the Google Sheet?\n\nEach comment starts with CHECK [${lastCheck.statementName}] and is added AFTER any existing note. Nothing is changed or deleted, and you decide what to do with each row in the sheet.`;
  if (!window.confirm(message)) return;
  await runSheetCheck({ write: true });
}

async function reopenUnmatched() {
  const count = lastCheck?.recordedWithoutRow?.length || 0;
  if (!count) return;
  if (!window.confirm(`${count} deposit${count === 1 ? " was" : "s were"} marked "already in the sheet", but no row in the sheet matches ${count === 1 ? "it" : "them"}.\n\nReopen ${count === 1 ? "it" : "them"} so Sync can add the payment (or find its row)? Nothing is written to the sheet by this step.`)) return;
  try {
    const result = await fetchJson(`/api/bank-statements/${encodeURIComponent(currentStatement.id)}/reopen-unmatched`, { method: "POST" });
    await openStatement(currentStatement.id);
    setNotice(`${result.reopened} deposit${result.reopened === 1 ? "" : "s"} reopened with ${result.reopened === 1 ? "its" : "their"} rider. Use Sync all ready: payments that already have a row are skipped, only the missing ones are added.`, "success");
  } catch (error) {
    setNotice(error.message, "error");
  }
}

// ---- Sync all ready rows in one go ----
let bulkRunning = false;
let bulkStop = false;

const isReadyToSync = (item) => group(item) === "PENDING" && item.bikerId && item.sync.state !== "syncing";

function renderBulkButton() {
  const button = $("syncAllButton");
  const c = counts();
  const ready = rows.filter(isReadyToSync).length;
  button.classList.toggle("hidden", !currentStatement.id || currentStatement.completed || c.PENDING === 0);
  $("checkSheetButton").classList.toggle("hidden", !currentStatement.id);
  const bulkSkipped = rows.filter((item) => group(item) === "SKIPPED" && item.skipReason === "VERIFY").length;
  $("reopenSkippedButton").classList.toggle("hidden", !currentStatement.id || currentStatement.completed || bulkSkipped === 0);
  $("reopenSkippedButton").textContent = `Reopen skipped (${bulkSkipped})`;
  if (bulkRunning) return;
  const waiting = c.PENDING - ready;
  button.textContent = `Sync all ready (${ready})`;
  button.disabled = ready === 0;
  button.title = ready === 0
    ? "Pick a rider on a row first. Rows without a rider are never synced."
    : `Syncs ${ready} row${ready === 1 ? "" : "s"} to the Google Sheet${waiting ? `; ${waiting} still need a rider or a Skip` : ""}. Each row uses its own "Record as" choice.`;
}

async function syncAll() {
  if (bulkRunning) {
    bulkStop = true;
    $("syncAllButton").textContent = "Stopping…";
    return;
  }
  const queue = rows.map((item, index) => ({ item, index })).filter(({ item }) => isReadyToSync(item));
  if (!queue.length) return;
  const backDated = queue.filter(({ item }) => item.recordAs).length;
  const waiting = counts().PENDING - queue.length;
  const total = queue.reduce((sum, { item }) => sum + Number(item.amount || 0), 0);
  const lines = [
    `Sync ${queue.length} payment${queue.length === 1 ? "" : "s"} (${formatRwf(total)}) to the Google Sheet?`,
    backDated ? `${backDated} will be back-dated to the last day of their month; the real bank date goes in the note.` : "",
    waiting ? `${waiting} row${waiting === 1 ? "" : "s"} without a rider will be left alone.` : "",
    "Payments already in the sheet are skipped, not added twice."
  ].filter(Boolean);
  if (!window.confirm(lines.join("\n\n"))) return;

  bulkRunning = true;
  bulkStop = false;
  const button = $("syncAllButton");
  const outcome = { synced: 0, duplicate: 0, failed: 0, backDated: 0, aborted: "" };
  let done = 0;
  for (const { index } of queue) {
    if (bulkStop) break;
    const tr = document.querySelector(`#statementTransactionsBody tr[data-index="${index}"]`);
    if (!tr) continue;
    button.textContent = `Stop (${done + 1} of ${queue.length})`;
    button.disabled = false;
    setNotice(`Syncing ${done + 1} of ${queue.length}…`);
    const result = await syncRow(tr, { quiet: true });
    done += 1;
    if (!result) continue;
    if (result.ok) {
      outcome[result.duplicate ? "duplicate" : "synced"] += 1;
      if (result.backDated) outcome.backDated += 1;
    } else {
      outcome.failed += 1;
      // A problem with the sheet itself (no access, quota, outage) would hit every remaining row: stop there.
      if ([403, 429, 502, 503].includes(result.status)) {
        outcome.aborted = result.error.message;
        break;
      }
    }
  }
  const stopped = bulkStop;
  bulkRunning = false;
  bulkStop = false;
  renderSummary();
  const left = queue.length - done;
  const parts = [
    outcome.synced ? `${outcome.synced} synced${outcome.backDated ? ` (${outcome.backDated} back-dated)` : ""}` : "",
    outcome.duplicate ? `${outcome.duplicate} already in the sheet` : "",
    outcome.failed ? `${outcome.failed} failed (see the rows)` : ""
  ].filter(Boolean);
  const tail = outcome.aborted ? ` Stopped: ${outcome.aborted}` : stopped ? ` Stopped by you; ${left} not synced.` : "";
  setNotice(`${parts.join(", ") || "Nothing was synced"}.${tail}`, outcome.failed || outcome.aborted ? "error" : "success");
  loadHistory();
  // Syncing both adds the new records and validates the existing ones: now compare the whole sheet with the statement.
  if (outcome.synced || outcome.duplicate) {
    const check = await runSheetCheck({ quiet: true });
    if (check) {
      setNotice(
        `${parts.join(", ") || "Nothing was synced"}.${tail} Sheet check: ${check.findings.length ? `${check.findings.length} row${check.findings.length === 1 ? "" : "s"} to look at (see below)` : "nothing wrong found"}.`,
        outcome.failed || outcome.aborted || check.findings.length ? "error" : "success"
      );
    }
  }
}

async function skipRow(tr) {
  const item = rows[Number(tr.dataset.index)];
  if (!item || item.sync.state === "syncing") return;
  const label = `${item.depositorName || "Unknown sender"} — ${formatRwf(item.amount)} on ${formatDate(item.date)}`;
  if (!window.confirm(`Skip this entry?\n\n${label}\n\nNothing is added to the Google Sheet. It stays in this statement as Skipped and you can undo it.`)) return;
  try {
    const result = await fetchJson("/api/bank-statements/skip-entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId: item.id })
    });
    item.sync = { state: "skipped", message: result.message || "" };
    reportProgress(result);
  } catch (error) {
    item.sync = { state: "error", message: error.message };
  }
  refreshRow(tr);
}

async function undoSkip(tr) {
  const item = rows[Number(tr.dataset.index)];
  if (!item) return;
  try {
    const result = await fetchJson("/api/bank-statements/undo-skip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId: item.id })
    });
    item.sync = { state: "idle", message: "" };
    setNotice(`Entry is pending again (${result.remaining ?? "?"} pending in ${result.statementName || "this statement"}).`, "success");
    loadHistory();
  } catch (error) {
    setNotice(error.message, "error");
  }
  refreshRow(tr);
}

async function loadBikers() {
  try {
    registeredBikers = (await fetchJson("/api/bank-statements/bikers")).items || [];
  } catch (error) {
    setNotice(`Registered bikers could not be loaded: ${error.message}`, "error");
  }
}

async function reopenRow(item) {
  try {
    await fetchJson("/api/bank-statements/undo-skip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId: item.id })
    });
    item.sync = { state: "idle", message: "" };
    item.skipReason = "";
    return true;
  } catch (error) {
    setNotice(error.message, "error");
    return false;
  }
}

// Same rule as the server: same words in any order, or one cut-off word ("Uwurukundo Co" / "Uwurukundo Cos").
function similarNames(a, b) {
  const words = (name) => [...new Set(nameKeyOf(name).split(" ").filter(Boolean))];
  const x = words(a);
  const y = words(b);
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

const nameKeyOf = (name) => String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).sort().join(" ");

async function persistSelection(item) {
  return fetchJson("/api/bank-statements/select-biker", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactionId: item.id, bikerId: item.bikerId })
  }).catch(() => {});
}

// When a rider is chosen for a name that is not itself that rider (a payer paying for someone), remember it:
// the next statement that carries the same name selects this rider by itself.
async function rememberPayer(item) {
  const name = item.depositorName;
  if (!name || !item.bikerId || item.autoBikerId === item.bikerId) return;
  try {
    await fetchJson("/api/bank-statements/aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, bikerId: item.bikerId })
    });
  } catch (error) {
    return;
  }
  item.autoBikerId = item.bikerId;
  // The same payer (or a cut-off spelling of it) on other rows of this table: pick the same rider there too.
  // Rows already handled, or that already have a rider, are left alone.
  const riderName = registeredBikers.find((biker) => biker.id === item.bikerId)?.name || "the rider";
  let applied = 0;
  for (const tr of document.querySelectorAll("#statementTransactionsBody tr[data-index]")) {
    const other = rows[Number(tr.dataset.index)];
    if (other === item || !similarNames(other.depositorName, name)) continue;
    const skipped = group(other) === "SKIPPED";
    if ((group(other) !== "PENDING" && !skipped) || other.bikerId) continue;
    if (skipped && !(await reopenRow(other))) continue;
    other.bikerId = item.bikerId;
    other.autoBikerId = item.bikerId;
    refreshRow(tr);
    persistSelection(other);
    applied += 1;
  }
  setNotice(`Remembered: ${name} pays for ${riderName}${applied ? `; selected the same rider on ${applied} other row${applied === 1 ? "" : "s"}` : ""}. Next statements will recognise this name.`, "success");
  loadAliases();
}

async function loadAliases() {
  try {
    const { items } = await fetchJson("/api/bank-statements/aliases");
    $("aliasCount").textContent = String(items.length);
    $("aliasBody").innerHTML = items.length
      ? items.map((alias) => `
        <tr>
          <td class="row-number"></td>
          <td class="table-cell-strong">${escapeHtml(alias.display_name)}</td>
          <td>${escapeHtml(alias.biker_name)}${alias.rider_available ? "" : ' <span class="table-cell-muted">(not an active rider now: ignored)</span>'}</td>
          <td><button class="link-button" type="button" data-remove-alias="${escapeHtml(alias.id)}" data-name="${escapeHtml(alias.display_name)}">Forget</button></td>
        </tr>`).join("")
      : '<tr><td colspan="4" class="empty-table">Nothing remembered yet. Choose a rider for a payer name and it is saved here.</td></tr>';
  } catch (error) {
    if (error.status !== 503) $("aliasBody").innerHTML = `<tr><td colspan="4" class="empty-table">${escapeHtml(error.message)}</td></tr>`;
  }
}

$("aliasBody").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-alias]");
  if (!button) return;
  if (!window.confirm(`Forget that ${button.dataset.name} pays for a rider?\n\nFuture statements will no longer select the rider automatically for this name.`)) return;
  try {
    await fetchJson(`/api/bank-statements/aliases/${encodeURIComponent(button.dataset.removeAlias)}`, { method: "DELETE" });
    loadAliases();
  } catch (error) {
    setNotice(error.message, "error");
  }
});

$("statementTransactionsBody").addEventListener("change", (event) => {
  const recordSelect = event.target.closest("[data-record-as]");
  if (recordSelect) {
    rows[Number(recordSelect.closest("tr").dataset.index)].recordAs = recordSelect.value;
    return;
  }
  const select = event.target.closest("[data-biker]");
  if (!select) return;
  const tr = select.closest("tr");
  const item = rows[Number(tr.dataset.index)];
  (async () => {
    if (group(item) === "SKIPPED" && select.value) {
      // A skipped row that gets a rider is a pending row again.
      if (!(await reopenRow(item))) {
        select.value = "";
        return;
      }
    }
    item.bikerId = select.value;
    if (item.sync.state === "error") item.sync = { state: "idle", message: "" };
    refreshRow(tr);
    // Remember the choice with the saved entry so it is still there when the statement is reopened later.
    persistSelection(item).then(() => rememberPayer(item));
  })();
});

$("statementTransactionsBody").addEventListener("click", (event) => {
  const tr = event.target.closest("tr[data-index]");
  if (!tr) return;
  if (event.target.closest("[data-show-record-as]")) {
    rows[Number(tr.dataset.index)].showRecordAs = true;
    refreshRow(tr);
  } else if (event.target.closest("[data-sync]")) syncRow(tr);
  else if (event.target.closest("[data-skip]")) skipRow(tr);
  else if (event.target.closest("[data-undo]")) undoSkip(tr);
});

$("statementFilters").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-filter]");
  if (!chip) return;
  statusFilter = chip.dataset.filter;
  applyFilter();
});

function setUploading(active) {
  fileInput.disabled = active;
  processButton.disabled = active;
  $("clearStatementButton").disabled = active;
  $("uploadLoader").classList.toggle("hidden", !active);
  $("processButtonLabel").textContent = active ? "Processing PDF…" : "Process statement";
}

async function uploadStatement(event) {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!selectFile(file)) return;
  clearResults();
  setUploading(true);
  setNotice("Uploading and reading the Bank of Kigali statement…");
  try {
    const formData = new FormData();
    formData.append("file", file, file.name);
    const payload = await fetchJson("/api/bank-statements/upload", { method: "POST", body: formData });
    if (payload.already_processed) {
      renderStatement(payload, `${payload.display_name || "Saved statement"}.`);
      setNotice(`This file was uploaded before and is not finished yet. Reopened ${payload.display_name || "the saved statement"} where you left off.`, "success");
    } else {
      renderStatement(payload, `${payload.display_name || "Statement"}.`);
      const c = counts();
      const handled = c.SYNCED + c.SKIPPED;
      setNotice(
        handled
          ? `Statement saved as ${payload.display_name || "a new statement"}: ${rows.length} entries. ${handled} were already handled in earlier statements and are skipped (see the Synced / Skipped filters); ${c.PENDING} still need${c.PENDING === 1 ? "s" : ""} your attention.`
          : `Statement saved as ${payload.display_name || "a new statement"}: ${rows.length} incoming transactions loaded.`,
        "success"
      );
    }
    loadHistory();
  } catch (error) {
    setNotice(error.message, "error");
    $("statementBadge").textContent = "Upload rejected";
    $("statementBadge").className = "badge status-chip failed";
  } finally {
    setUploading(false);
    processButton.disabled = !fileInput.files[0];
  }
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function periodText(start, end) {
  return start || end ? `${formatDate(start)} – ${formatDate(end)}` : "—";
}

async function loadHistory() {
  try {
    const saved = await fetchJson("/api/bank-statements");
    const items = saved.items || [];
    $("historyBody").innerHTML = items.length
      ? items.map((item) => {
        const complete = Boolean(item.completed_at);
        const canDiscard = true;
        return `
        <tr${item.id === currentStatement.id ? ' class="is-open"' : ""}>
          <td class="row-number"></td>
          <td><span class="table-cell-strong">${escapeHtml(item.display_name || "Statement")}</span></td>
          <td>${escapeHtml(periodText(item.period_start, item.period_end))}</td>
          <td>${item.synced_count ?? 0} synced · ${item.skipped_count ?? 0} skipped · ${item.remaining_count ?? 0} pending</td>
          <td><span class="status-chip ${complete ? "sent" : "pending"}" title="${complete ? "Verified: nothing is left to do." : "Open this statement to finish it or to mark it as verified."}">${complete ? "Verified ✓" : "In progress"}</span></td>
          <td>${escapeHtml(formatDateTime(item.created_at))}</td>
          <td class="history-actions"><button class="ghost-button small-button" type="button" data-open-statement="${escapeHtml(item.id)}">Open</button>${canDiscard ? ` <button class="link-button" type="button" data-discard-statement="${escapeHtml(item.id)}" data-name="${escapeHtml(item.display_name || "")}" data-complete="${complete ? "1" : ""}" data-synced="${item.synced_count ?? 0}" data-pending="${item.remaining_count ?? 0}" title="${complete ? "Remove from this list. Its rows and outcomes stay on record." : item.synced_count ? "Remove from this list. What is already in the sheet stays on record." : "Nothing is in the sheet yet, so this statement is deleted completely."}">Discard</button>` : ""}</td>
        </tr>`;
      }).join("")
      : '<tr><td colspan="7" class="empty-table">No saved statements. Upload one above to start.</td></tr>';
  } catch (error) {
    if (error.status !== 503) $("historyBody").innerHTML = `<tr><td colspan="7" class="empty-table">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function openStatement(id) {
  setNotice("Opening saved statement…");
  try {
    const detail = await fetchJson(`/api/bank-statements/${encodeURIComponent(id)}`);
    clearResults();
    fileInput.value = "";
    $("statementFileLabel").textContent = "Choose a Bank of Kigali PDF";
    $("statementFileMeta").textContent = "No file selected";
    processButton.disabled = true;
    renderStatement(detail, `${detail.display_name || "Statement"}${detail.completed_at ? " (verified)" : ""}.`);
    setNotice(`Opened ${detail.display_name || "statement"}.`, "success");
    loadHistory();
    $("statementResults").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setNotice(error.message, "error");
  }
}

async function discardStatement(button) {
  const name = button.dataset.name || "this statement";
  const verified = Boolean(button.dataset.complete);
  const synced = Number(button.dataset.synced) || 0;
  const pending = Number(button.dataset.pending) || 0;
  let message;
  if (verified) {
    message = `Remove ${name} from the list?\n\nIts rows and what happened to each (synced or skipped) stay on record, so a later statement that overlaps skips them. The same file cannot be uploaded again.`;
  } else if (synced) {
    message = `Remove ${name} from the list?\n\n${synced} row${synced === 1 ? " is" : "s are"} already in the Google Sheet and stay on record. ${pending} pending row${pending === 1 ? "" : "s"} will no longer be listed here; ${pending === 1 ? "it comes" : "they come"} back if you upload this file again or a later statement that contains ${pending === 1 ? "it" : "them"}.`;
  } else {
    message = `Discard ${name}?\n\nNothing from it is in the Google Sheet. Its saved file and entries are deleted, and you can upload the PDF again later.`;
  }
  if (!window.confirm(message)) return;
  try {
    const result = await fetchJson(`/api/bank-statements/${encodeURIComponent(button.dataset.discardStatement)}`, { method: "DELETE" });
    if (button.dataset.discardStatement === currentStatement.id) clearResults();
    setNotice(`${name}: ${result.message || "discarded."}`, "success");
    loadHistory();
  } catch (error) {
    setNotice(error.message, "error");
  }
}

async function verifyOpenStatement() {
  if (!currentStatement.id || currentStatement.completed) return;
  const name = currentStatement.name || "this statement";
  const pending = counts().PENDING;
  const detail = pending
    ? `${pending} entr${pending === 1 ? "y is" : "ies are"} still pending. ${pending === 1 ? "It" : "They"} will be marked Skipped (nothing is added to the Google Sheet).`
    : "Nothing is pending.";
  if (!window.confirm(`Mark ${name} as verified?\n\n${detail}\nThe saved PDF is removed, every row and its outcome stays for reference, and this file cannot be uploaded again.`)) return;
  const button = $("verifyStatementButton");
  button.disabled = true;
  try {
    const result = await fetchJson(`/api/bank-statements/${encodeURIComponent(currentStatement.id)}/verify`, { method: "POST" });
    await openStatement(currentStatement.id);
    setNotice(`${name} is verified${result.skipped_now ? ` (${result.skipped_now} pending entr${result.skipped_now === 1 ? "y" : "ies"} marked Skipped)` : ""}.`, "success");
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function closeTable() {
  clearResults();
  currentStatement = { id: "", name: "", completed: false };
  setNotice("");
  loadHistory();
}

$("closeTableButton").addEventListener("click", closeTable);
$("verifyStatementButton").addEventListener("click", verifyOpenStatement);
$("syncAllButton").addEventListener("click", syncAll);
$("checkSheetButton").addEventListener("click", () => runSheetCheck());
$("reopenSkippedButton").addEventListener("click", reopenBulkSkipped);
$("writeCommentsButton").addEventListener("click", writeSheetComments);
$("reopenUnmatchedButton").addEventListener("click", reopenUnmatched);
$("closeSheetCheckButton").addEventListener("click", hideSheetCheck);

$("historyBody").addEventListener("click", (event) => {

  const open = event.target.closest("[data-open-statement]");
  if (open) openStatement(open.dataset.openStatement);
  const discard = event.target.closest("[data-discard-statement]");
  if (discard) discardStatement(discard);
});

// Links from the Payments page open a statement directly (?open=<id>).
async function openRequestedStatement() {
  await loadBikers();
  await loadHistory();
  const requested = new URLSearchParams(window.location.search).get("open");
  if (requested) openStatement(requested);
}

fileInput.addEventListener("change", () => selectFile(fileInput.files[0]));
uploadForm.addEventListener("submit", uploadStatement);
$("clearStatementButton").addEventListener("click", resetUpload);
dropZone.addEventListener("dragover", (event) => { event.preventDefault(); dropZone.classList.add("is-dragging"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-dragging"));
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  const file = event.dataTransfer.files[0];
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  selectFile(file);
});

$("logoutButton").addEventListener("click", async () => {
  await fetch(`${API_BASE}/api/session/logout`, { method: "POST", credentials: "same-origin" }).catch(() => {});
  window.location.assign("/login/");
});

document.querySelector('[data-nav-view="bank-statements"]')?.classList.add("active");
$("appNameLabel").textContent = runtimeConfig.appName || "Fleebee Dispatch Desk";
$("apiBaseLabel").textContent = API_BASE.replace(/^https?:\/\//, "");
openRequestedStatement();
loadAliases();
$("refreshHistoryButton").addEventListener("click", loadHistory);
