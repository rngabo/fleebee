const runtimeConfig = window.FLEEBEE_CONFIG || {};
const API_BASE = String(runtimeConfig.apiBaseUrl || window.location.origin).replace(/\/$/, "");

const $ = (id) => document.getElementById(id);
let fleet = { items: [], totals: {} };
let filter = "ALL";
const selectedBatches = new Set();
let syncing = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const formatNumber = (value) => (Number(value) || 0).toLocaleString("en-US");

function formatDay(value) {
  if (!value) return "";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return day ? `${day}/${month}/${year}` : "";
}

function setNotice(message = "", kind = "") {
  $("pageNotice").textContent = message;
  $("pageNotice").className = `notice page-notice${kind ? ` ${kind}` : ""}`;
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

// Same batch colours as the Data Dashboard.
function batchTone(batch) {
  let hash = 0;
  for (const char of String(batch)) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return hash % 6;
}

const inSelectedBatches = (item) => selectedBatches.size === 0 || selectedBatches.has(item.batch);

function renderFilters() {
  const scoped = fleet.items.filter(inSelectedBatches);
  const options = [
    ["ALL", "All", scoped.length],
    ["ACTIVE", "Active", scoped.filter((item) => item.status === "ACTIVE").length],
    ["AVAILABLE", "Available", scoped.filter((item) => item.status === "AVAILABLE").length]
  ];
  $("fleetFilters").innerHTML = options.map(([key, label, count]) =>
    `<button type="button" class="filter-chip${filter === key ? " active" : ""}" data-filter="${key}">${label} <span>${count}</span></button>`).join("");
}

// Batch chips (multi-select): click one or more batches to see only their bikes; none selected = all.
function renderBatchFilters() {
  const counts = new Map();
  for (const item of fleet.items) {
    const key = item.batch || "";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const batch of [...selectedBatches]) if (!counts.has(batch)) selectedBatches.delete(batch);
  const batches = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  $("batchFilters").innerHTML = [
    `<button type="button" class="batch-chip toggle all${selectedBatches.size === 0 ? " active" : ""}" data-batch="">All batches</button>`,
    ...batches.map((batch) =>
      `<button type="button" class="batch-chip toggle tone-${batchTone(batch)}${selectedBatches.has(batch) ? " active" : ""}${selectedBatches.size && !selectedBatches.has(batch) ? " dim" : ""}" data-batch="${escapeHtml(batch)}">${escapeHtml(batch || "No batch")} <span>${counts.get(batch)}</span></button>`)
  ].join("");
}

function render() {
  const items = fleet.items.filter((item) => inSelectedBatches(item) && (filter === "ALL" || item.status === filter));
  $("fleetBody").innerHTML = items.length
    ? items.map((item) => {
      const user = item.currentUser;
      const former = item.formerRiders.length
        ? `<div class="table-cell-muted">incl. former: ${escapeHtml(item.formerRiders.join(", "))}</div>`
        : "";
      const detail = `${item.paymentCount} payment${item.paymentCount === 1 ? "" : "s"} from ${item.riderCount} rider${item.riderCount === 1 ? "" : "s"}`;
      return `
        <tr>
          <td class="row-number"></td>
          <td><span class="table-cell-strong">${escapeHtml(item.plate)}</span>${item.model ? `<span class="table-cell-muted"> ${escapeHtml(item.model)}</span>` : ""}</td>
          <td><span class="status-chip ${item.status === "ACTIVE" ? "sent" : "pending"}">${item.status === "ACTIVE" ? "Active" : "Available"}</span></td>
          <td>${item.batch ? `<span class="batch-chip tone-${batchTone(item.batch)}">${escapeHtml(item.batch)}</span>` : '<span class="table-cell-muted">—</span>'}</td>
          <td>${user
            ? `<span class="table-cell-strong">${escapeHtml(user.name)}</span>${user.phone ? `<span class="table-cell-muted"> · ${escapeHtml(user.phone)}</span>` : ""}${user.since ? `<span class="table-cell-muted"> · since ${escapeHtml(formatDay(user.since))}</span>` : ""}`
            : '<span class="table-cell-muted">No current rider</span>'}</td>
          <td class="amount-cell" title="${escapeHtml(detail)}"><span class="table-cell-strong">${formatNumber(item.totalPaidRwf)}</span>${former}</td>
        </tr>`;
    }).join("")
    : '<tr><td colspan="6" class="empty-table">No bikes to show. Use Refresh on the Data Dashboard to import them from the Sheet.</td></tr>';
  $("fleetTotal").textContent = formatNumber(items.reduce((sum, item) => sum + item.totalPaidRwf, 0));
  renderFilters();
  renderBatchFilters();
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function renderSyncLabel() {
  const run = fleet.latestRun;
  $("updatedLabel").textContent = run?.completedAt ? `Last synchronized from the Sheet: ${formatDateTime(run.completedAt)}.` : "Not synchronized from the Sheet yet.";
}

async function load({ quiet = false } = {}) {
  if (!quiet) setNotice("Loading bikes…");
  try {
    fleet = await fetchJson("/api/data/fleet");
    render();
    renderSyncLabel();
    if (!quiet) setNotice("");
  } catch (error) {
    setNotice(error.message, "error");
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finished = (run) => run && ["COMPLETED", "PARTIAL", "FAILED"].includes(run.status);

// Refresh re-imports Setup (batches, plates, riders) and Payments from the Google Sheet, then reloads the table.
async function refreshFromSheet() {
  if (syncing) return;
  syncing = true;
  $("refreshButton").disabled = true;
  $("refreshLoader").classList.remove("hidden");
  $("refreshLabel").textContent = "Synchronizing…";
  const baselineRunId = fleet.latestRun?.id || null;
  setNotice("Synchronizing from the Google Sheet…");
  try {
    try {
      await fetchJson("/api/data/refresh", { method: "POST" });
    } catch (error) {
      if (error.status !== 409) throw error; // 409: a sync is already running, just wait for it
    }
    const deadline = Date.now() + 3 * 60 * 1000;
    let result = null;
    while (Date.now() < deadline) {
      await wait(2000);
      const payload = await fetchJson("/api/data/fleet");
      if (payload.latestRun?.id !== baselineRunId && finished(payload.latestRun) && !payload.runner?.isRunning) {
        result = payload;
        break;
      }
    }
    if (!result) throw new Error("The synchronization is taking longer than expected. Press Refresh again in a moment.");
    fleet = result;
    render();
    renderSyncLabel();
    const run = result.latestRun;
    setNotice(
      run.status === "FAILED"
        ? run.errorMessage || "The synchronization failed."
        : `Synchronized from the Google Sheet: ${run.memberCount} riders and ${run.paymentCount} payments${run.conflictCount ? `, ${run.conflictCount} need attention` : ""}.`,
      run.status === "FAILED" ? "error" : "success"
    );
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    syncing = false;
    $("refreshButton").disabled = false;
    $("refreshLoader").classList.add("hidden");
    $("refreshLabel").textContent = "Refresh from Sheet";
  }
}

$("fleetFilters").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-filter]");
  if (!chip) return;
  filter = chip.dataset.filter;
  render();
});
$("batchFilters").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-batch]");
  if (!chip) return;
  const batch = chip.dataset.batch;
  if (batch === "") selectedBatches.clear();
  else if (selectedBatches.has(batch)) selectedBatches.delete(batch);
  else selectedBatches.add(batch);
  render();
});
$("refreshButton").addEventListener("click", refreshFromSheet);
$("logoutButton").addEventListener("click", async () => {
  await fetch(`${API_BASE}/api/session/logout`, { method: "POST", credentials: "same-origin" }).catch(() => {});
  window.location.assign("/login/");
});

document.querySelector('[data-nav-view="fleet"]')?.classList.add("active");
$("appNameLabel").textContent = runtimeConfig.appName || "Fleebee Dispatch Desk";
$("apiBaseLabel").textContent = API_BASE.replace(/^https?:\/\//, "");
load();
