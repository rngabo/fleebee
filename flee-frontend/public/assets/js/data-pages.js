const runtimeConfig = window.FLEEBEE_CONFIG || {};
const API_BASE = String(runtimeConfig.apiBaseUrl || window.location.origin).replace(/\/$/, "");
const view = document.body.dataset.view;

const $ = (id) => document.getElementById(id);
const pageNotice = $("pageNotice");
const refreshButton = $("refreshButton");
const refreshButtonLabel = $("refreshButtonLabel");
const refreshLoader = $("refreshLoader");
const syncBadge = $("syncBadge");
const updatedLabel = $("updatedLabel");
const paymentFilter = $("paymentFilter");

let latestPayload = null;
let checkInProgress = false;
let isLoading = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatRwf(value) {
  return `RWF ${(Number(value) || 0).toLocaleString("en-US")}`;
}

function formatDate(value, includeTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return includeTime ? date.toLocaleString() : date.toLocaleDateString();
}

function setNotice(message = "", kind = "") {
  pageNotice.textContent = message;
  pageNotice.className = `notice page-notice${kind ? ` ${kind}` : ""}`;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    credentials: "same-origin",
    ...options
  });
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

function setChecking(active) {
  checkInProgress = active;
  refreshButton.disabled = active;
  refreshButton.classList.toggle("is-loading", active);
  refreshLoader.classList.toggle("hidden", !active);
  refreshButtonLabel.textContent = active ? "Synchronizing…" : "Refresh";
}

function renderSyncState(payload) {
  const run = payload.latestRun;
  const active = Boolean(payload.runner?.isRunning || run?.status === "RUNNING");
  const status = active ? "RUNNING" : run?.status || "NOT SYNCED";
  const labels = {
    RUNNING: "Synchronizing",
    COMPLETED: "Up to date",
    PARTIAL: "Needs attention",
    FAILED: "Sync failed",
    "NOT SYNCED": "Not synced"
  };
  syncBadge.textContent = labels[status] || status;
  syncBadge.className = `badge status-chip ${status === "COMPLETED" ? "sent" : status === "FAILED" || status === "PARTIAL" ? "failed" : "pending"}`;
  updatedLabel.textContent = run?.completedAt
    ? `Last synchronized ${formatDate(run.completedAt, true)}`
    : "Not synchronized yet";
}

function renderDashboard(payload) {
  const snapshot = payload.snapshot;
  const rows = snapshot?.rows || [];
  const totals = snapshot?.totals || {};
  $("monthlyDueTotal").textContent = formatRwf(totals.totalMonthlyDueRwf);
  $("paidMonthTotal").textContent = formatRwf(totals.totalPaidInMonthRwf);
  $("remainingTotal").textContent = formatRwf(totals.totalBalanceRwf);
  $("overallBalanceTotal").textContent = formatRwf(totals.totalOverallBalanceRwf);
  $("tableMonthlyDueTotal").textContent = formatRwf(totals.totalMonthlyDueRwf);
  $("tablePaidMonthTotal").textContent = formatRwf(totals.totalPaidInMonthRwf);
  $("tableBalanceTotal").textContent = formatRwf(totals.totalBalanceRwf);
  $("tablePaidByDateTotal").textContent = formatRwf(totals.totalPaidByDateRwf);
  $("tableDueByDateTotal").textContent = formatRwf(totals.totalDueByDateRwf);
  $("tableOverallBalanceTotal").textContent = formatRwf(totals.totalOverallBalanceRwf);
  $("dashboardPeriod").textContent = snapshot
    ? `Snapshot for ${formatDate(snapshot.monthStart)} to ${formatDate(snapshot.monthEnd)}; selected date ${formatDate(snapshot.selectedDate)}.`
    : "Waiting for the first synchronized dashboard snapshot.";

  const sourceLink = $("sourceSheetLink");
  if (payload.sourceUrl) {
    sourceLink.href = payload.sourceUrl;
    sourceLink.classList.remove("hidden");
  }

  $("dataDashboardBody").innerHTML = rows.length
    ? rows.map((row) => `
      <tr>
        <td><div class="table-cell-strong">${escapeHtml(row.sourceName)}</div></td>
        <td>${escapeHtml(row.sourcePlate || "—")}</td>
        <td>${escapeHtml(row.batchCode || "—")}</td>
        <td>${escapeHtml(formatRwf(row.monthlyDueRwf))}</td>
        <td>${escapeHtml(formatRwf(row.paidInMonthRwf))}</td>
        <td>${escapeHtml(formatRwf(row.balanceRemainingRwf))}</td>
        <td>${escapeHtml(formatDate(row.lastPaymentDate))}</td>
        <td>${escapeHtml(formatRwf(row.paidByDateRwf))}</td>
        <td>${escapeHtml(formatRwf(row.dueByDateRwf))}</td>
        <td><div class="table-cell-strong">${escapeHtml(formatRwf(row.overallBalanceRwf))}</div></td>
        <td><span class="status-chip ${String(row.trackStatus).toLowerCase() === "behind" ? "failed" : "sent"}">${escapeHtml(row.trackStatus || "—")}</span></td>
        <td>${escapeHtml(row.note || "—")}</td>
        <td>${row.adjustmentAmountRwf == null ? "—" : escapeHtml(formatRwf(row.adjustmentAmountRwf))}${row.adjustmentNote ? `<div class="table-cell-muted">${escapeHtml(row.adjustmentNote)}</div>` : ""}</td>
      </tr>`).join("")
    : '<tr><td colspan="13" class="empty-table">No synchronized Dashboard rows yet.</td></tr>';

  const members = payload.members || [];
  $("dataMemberBody").innerHTML = members.length
    ? members.map((member) => `
      <tr>
        <td>${escapeHtml(member.sourcePersonId)}</td>
        <td><div class="table-cell-strong">${escapeHtml(member.sourceName)}</div></td>
        <td>${escapeHtml(member.sourcePlate || "—")}</td>
        <td>${escapeHtml(member.sourcePhone || "—")}</td>
        <td>${escapeHtml(member.sourceStatus || "—")}</td>
        <td><span class="status-chip ${member.matchStatus === "CONFLICT" ? "failed" : member.matchStatus === "HISTORICAL" ? "pending" : "sent"}">${escapeHtml(member.matchStatus)}</span></td>
        <td>${escapeHtml(member.matchNote || "—")}</td>
      </tr>`).join("")
    : '<tr><td colspan="7" class="empty-table">No synchronized Setup rows yet.</td></tr>';

  $("intervalInput").value = payload.schedule?.intervalDays || 2;
}

function renderPayments(payload) {
  const items = payload.items || [];
  const filter = String(paymentFilter?.value || "").trim().toLowerCase();
  const visible = filter
    ? items.filter((item) => [item.sourceName, item.sourcePlate, item.paymentMethod, item.referenceNote, item.enteredBy]
      .some((value) => String(value || "").toLowerCase().includes(filter)))
    : items;
  const total = visible.reduce((sum, item) => sum + (Number(item.amountRwf) || 0), 0);

  $("paymentEntryCount").textContent = items.length.toLocaleString("en-US");
  $("paymentAmountTotal").textContent = formatRwf(items.reduce((sum, item) => sum + (Number(item.amountRwf) || 0), 0));
  $("paymentMemberCount").textContent = new Set(items.map((item) => item.sourceName)).size.toLocaleString("en-US");
  $("latestPaymentDate").textContent = items.length ? formatDate(items[0].paymentDate) : "—";
  $("paymentTableTotal").textContent = formatRwf(total);
  $("dataPaymentsBody").innerHTML = visible.length
    ? visible.map((item) => `
      <tr>
        <td>${escapeHtml(formatDate(item.paymentDate))}</td>
        <td><div class="table-cell-strong">${escapeHtml(item.sourceName)}</div></td>
        <td>${escapeHtml(item.sourcePlate || "—")}</td>
        <td><div class="table-cell-strong">${escapeHtml(formatRwf(item.amountRwf))}</div></td>
        <td>${escapeHtml(item.paymentMethod || "—")}</td>
        <td>${escapeHtml(item.referenceNote || "—")}</td>
        <td>${escapeHtml(item.enteredBy || "—")}</td>
      </tr>`).join("")
    : '<tr><td colspan="7" class="empty-table">No payments match this filter.</td></tr>';
}

function render(payload) {
  latestPayload = payload;
  renderSyncState(payload);
  if (view === "data-dashboard") renderDashboard(payload);
  if (view === "data-payments") renderPayments(payload);
}

async function load({ quiet = false } = {}) {
  if (isLoading) return latestPayload;
  isLoading = true;
  if (!quiet) setNotice("Loading synchronized accounting data…");
  try {
    const endpoint = view === "data-payments" ? "/api/data/payments" : "/api/data/dashboard";
    const payload = await fetchJson(endpoint);
    render(payload);
    if (!quiet) {
      const configError = payload.runner?.configurationError;
      setNotice(configError || (payload.latestRun ? "Accounting data loaded." : "No data sync has completed yet."), configError ? "error" : "success");
    }
    return payload;
  } catch (error) {
    if (!quiet) setNotice(error.message, "error");
    throw error;
  } finally {
    isLoading = false;
  }
}

async function pollUntilSyncFinishes(baselineRunId, requestedAt = Date.now(), acceptBaseline = false) {
  const timeoutAt = Date.now() + 10 * 60 * 1000;
  while (Date.now() < timeoutAt) {
    await wait(2500);
    const payload = await load({ quiet: true });
    const run = payload.latestRun;
    const isNewRun = Boolean(run && run.id !== baselineRunId);
    const isWatchedRun = isNewRun || (acceptBaseline && run?.id === baselineRunId);
    if (isWatchedRun && ["COMPLETED", "PARTIAL", "FAILED"].includes(run.status) && !payload.runner?.isRunning) {
      return payload;
    }
    if (!isNewRun && !payload.runner?.isRunning && Date.now() - requestedAt > 5000) {
      throw new Error("The data sync stopped before a new result was recorded.");
    }
    setNotice("Synchronizing Setup, Payments, and Dashboard from Google Sheets…");
  }
  throw new Error("The data sync is still running. This page will continue checking automatically.");
}

async function startManualRefresh() {
  if (checkInProgress) return;
  const baselineRunId = latestPayload?.latestRun?.id || null;
  const requestedAt = Date.now();
  setChecking(true);
  setNotice("Starting Google Sheets synchronization…");
  try {
    await fetchJson("/api/data/refresh", { method: "POST" });
    const payload = await pollUntilSyncFinishes(baselineRunId, requestedAt);
    const run = payload.latestRun;
    setNotice(
      run.status === "COMPLETED"
        ? `Data sync complete: ${run.memberCount} members and ${run.paymentCount} payments synchronized.`
        : run.status === "PARTIAL"
          ? `Data sync finished with ${run.conflictCount} record${run.conflictCount === 1 ? "" : "s"} needing attention.`
          : run.errorMessage || "Data sync failed.",
      run.status === "COMPLETED" ? "success" : "error"
    );
  } catch (error) {
    if (error.status === 409) {
      await pollUntilSyncFinishes(baselineRunId, requestedAt, true).catch(() => {});
    } else {
      setNotice(error.message, "error");
    }
  } finally {
    setChecking(false);
    await load({ quiet: true }).catch(() => {});
  }
}

async function saveInterval() {
  const intervalDays = Number($("intervalInput").value);
  $("saveIntervalButton").disabled = true;
  try {
    const schedule = await fetchJson("/api/data/interval", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intervalDays })
    });
    setNotice(`Automatic data synchronization will run every ${schedule.intervalDays} day${schedule.intervalDays === 1 ? "" : "s"}.`, "success");
    await load({ quiet: true });
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    $("saveIntervalButton").disabled = false;
  }
}

$("appNameLabel").textContent = runtimeConfig.appName || "Fleebee Dispatch Desk";
$("apiBaseLabel").textContent = API_BASE;
document.querySelectorAll("[data-nav-view]").forEach((link) => {
  link.classList.toggle("active", link.dataset.navView === view);
});

refreshButton.addEventListener("click", startManualRefresh);
$("logoutButton").addEventListener("click", async () => {
  await fetchJson("/api/session/logout", { method: "POST" }).catch(() => {});
  window.location.assign("/login/");
});
if ($("saveIntervalButton")) $("saveIntervalButton").addEventListener("click", saveInterval);
if (paymentFilter) paymentFilter.addEventListener("input", () => renderPayments(latestPayload || { items: [] }));

load()
  .then((payload) => {
    if (payload?.runner?.isRunning || payload?.latestRun?.status === "RUNNING") {
      setChecking(true);
      setNotice("A data sync is already running. Waiting for it to finish…");
      return pollUntilSyncFinishes(payload.latestRun?.id || null, Date.now(), true)
        .finally(() => setChecking(false));
    }
    return null;
  })
  .catch((error) => setNotice(error.message, "error"));

setInterval(() => {
  if (!checkInProgress) load({ quiet: true }).catch(() => {});
}, 30000);
