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
  $("statementTransactionsBody").innerHTML = "";
  $("statementTableTotal").textContent = formatRwf(0);
  $("statementSummary").classList.add("hidden");
  $("statementResults").classList.add("hidden");
  $("statementBadge").textContent = "No statement loaded";
  $("statementBadge").className = "badge status-chip pending";
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

function normalizeTransactions(payload) {
  return (payload.transactions || [])
    .filter((item) => Number(item.credit ?? item.amount) > 0)
    .map((item) => ({
      date: item.book_date || item.date,
      depositorName: item.depositor_name,
      amount: item.credit ?? item.amount,
      reviewReason: item.review_reason || "",
      bikerId: item.suggested_biker_id || "",
      sync: { state: "idle", message: "" },
      reviewStatus: item.review_status || (item.depositor_name ? "VALIDATED" : "REVIEW_REQUIRED")
    }));
}

// A deposit is resolved once it is tied to a registered biker, so selecting one clears "Review required".
function isReview(item) {
  return !item.bikerId && (item.reviewStatus === "REVIEW_REQUIRED" || !item.depositorName);
}

function bikerOptions(selectedId) {
  return `<option value="">— Select biker —</option>${registeredBikers.map((biker) =>
    `<option value="${escapeHtml(biker.id)}"${biker.id === selectedId ? " selected" : ""}>${escapeHtml(biker.name)}</option>`).join("")}`;
}

function syncCell(item) {
  const { state, message } = item.sync;
  if (state === "synced") return `<span class="status-chip sent">Synced</span><div class="mini-note">${escapeHtml(message)}</div>`;
  if (state === "duplicate") return `<span class="status-chip pending">Already in sheet</span><div class="mini-note">${escapeHtml(message)}</div>`;
  const busy = state === "syncing";
  const error = state === "error" ? `<div class="mini-note sync-error">${escapeHtml(message)}</div>` : "";
  return `<button class="ghost-button" type="button" data-sync${item.bikerId && !busy ? "" : " disabled"}>${busy ? "Syncing…" : state === "error" ? "Retry" : "Sync"}</button>${error}`;
}

function statusCell(item) {
  const review = isReview(item);
  const note = review && item.reviewReason === "not-registered-biker" ? '<div class="mini-note">Not a registered biker</div>' : "";
  return `<span class="status-chip ${review ? "failed" : "sent"}">${review ? "Review required" : "Validated"}</span>${note}`;
}

function renderSummary(description) {
  const total = rows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const reviews = rows.filter(isReview).length;
  $("incomingCount").textContent = rows.length.toLocaleString("en-US");
  $("incomingTotal").textContent = formatRwf(total);
  $("reviewCount").textContent = reviews.toLocaleString("en-US");
  $("statementTableTotal").textContent = formatRwf(total);
  if (description) $("statementDescription").textContent = description;
  $("statementBadge").textContent = reviews ? `${reviews} need review` : "Statement processed";
  $("statementBadge").className = `badge status-chip ${reviews ? "pending" : "sent"}`;
}

function renderRow(item, index) {
  return `
      <tr data-index="${index}">
        <td>${escapeHtml(formatDate(item.date))}</td>
        <td><div class="table-cell-strong">${escapeHtml(item.depositorName || "Name not identified")}</div></td>
        <td><select class="biker-select" data-biker aria-label="Registered biker for ${escapeHtml(item.depositorName || "this deposit")}"${item.sync.state === "synced" || item.sync.state === "syncing" ? " disabled" : ""}>${bikerOptions(item.bikerId)}</select></td>
        <td><div class="table-cell-strong">${escapeHtml(formatRwf(item.amount))}</div></td>
        <td data-cell="status">${statusCell(item)}</td>
        <td data-cell="sync">${syncCell(item)}</td>
      </tr>`;
}

function renderStatement(payload, description = "Statement processed successfully.") {
  rows = normalizeTransactions(payload);
  $("statementPeriod").textContent = payload.period_start || payload.period_end
    ? `${formatDate(payload.period_start)} – ${formatDate(payload.period_end)}`
    : "Not found in PDF";
  $("statementTransactionsBody").innerHTML = rows.length
    ? rows.map(renderRow).join("")
    : '<tr><td colspan="6" class="empty-table">No incoming transactions were found in this statement.</td></tr>';
  $("statementSummary").classList.remove("hidden");
  $("statementResults").classList.remove("hidden");
  renderSummary(description);
}

function refreshRow(tr) {
  const item = rows[Number(tr.dataset.index)];
  tr.querySelector('[data-cell="status"]').innerHTML = statusCell(item);
  tr.querySelector('[data-cell="sync"]').innerHTML = syncCell(item);
  const select = tr.querySelector("[data-biker]");
  select.disabled = item.sync.state === "synced" || item.sync.state === "syncing";
  renderSummary();
}

async function syncRow(tr) {
  const item = rows[Number(tr.dataset.index)];
  if (!item?.bikerId || item.sync.state === "syncing") return;
  item.sync = { state: "syncing", message: "" };
  refreshRow(tr);
  try {
    const result = await fetchJson("/api/bank-statements/sync-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: String(item.date).slice(0, 10), amount: item.amount, bikerId: item.bikerId })
    });
    item.sync = { state: result.status === "duplicate" ? "duplicate" : "synced", message: result.message || "" };
  } catch (error) {
    item.sync = { state: "error", message: error.message };
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

$("statementTransactionsBody").addEventListener("change", (event) => {
  const select = event.target.closest("[data-biker]");
  if (!select) return;
  const tr = select.closest("tr");
  const item = rows[Number(tr.dataset.index)];
  item.bikerId = select.value;
  if (item.sync.state === "error" || item.sync.state === "duplicate") item.sync = { state: "idle", message: "" };
  refreshRow(tr);
});

$("statementTransactionsBody").addEventListener("click", (event) => {
  const button = event.target.closest("[data-sync]");
  if (button) syncRow(button.closest("tr"));
});

function setUploading(active) {
  fileInput.disabled = active;
  processButton.disabled = active;
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
    renderStatement(payload, `Processed in ${payload.processing_duration_ms || 0} ms. Ambiguous names stay marked for review.`);
    setNotice(`Statement processed: ${payload.transactions?.length || 0} incoming transactions loaded.`, "success");
  } catch (error) {
    setNotice(error.message, "error");
    $("statementBadge").textContent = "Upload rejected";
    $("statementBadge").className = "badge status-chip failed";
  } finally {
    setUploading(false);
    processButton.disabled = !fileInput.files[0];
  }
}

async function loadLatestStatement() {
  try {
    const list = await fetchJson("/api/bank-statements");
    const latest = list.items?.[0];
    if (!latest) return;
    const detail = await fetchJson(`/api/bank-statements/${encodeURIComponent(latest.id)}`);
    renderStatement(detail, `Latest statement: ${latest.period_start || "unknown start"} to ${latest.period_end || "unknown end"}.`);
    setNotice("Latest processed statement loaded.", "success");
  } catch (error) {
    if (error.status !== 503) setNotice(error.message, "error");
  }
}

fileInput.addEventListener("change", () => selectFile(fileInput.files[0]));
uploadForm.addEventListener("submit", uploadStatement);
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
loadBikers().then(loadLatestStatement);
