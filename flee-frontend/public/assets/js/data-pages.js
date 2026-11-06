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
let paymentPage = 0;
let paymentPageSize = 10;

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

function formatNumber(value) {
  return (Number(value) || 0).toLocaleString("en-US");
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

let selection = { month: "", date: "" };
let lateMode = localStorage.getItem("dashboardLateMode") !== "off";

function formatDay(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return day ? `${day}/${month}/${year}` : "—";
}

function monthLabel(month) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

const BATCH_TONES = 6;

function batchTone(batch) {
  let hash = 0;
  for (const char of String(batch)) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return hash % BATCH_TONES;
}

function renderDashboardRow(row, forMonthMode = false) {
  const rwf = (value) => escapeHtml(formatNumber(value));
  const zero = (value) => (Number(value) === 0 ? " is-zero" : "");
  const view = forMonthMode ? row.forMonth : null;
  const paid = view ? view.paid : row.paidInMonth;
  const shortfall = view ? view.shortfall : row.shortfall;
  const lastPayment = view ? view.lastPaymentDate : row.lastPaymentDate;
  const lateNote = view && view.late > 0
    ? `<div class="table-cell-muted late-note" title="${escapeHtml(view.lateDetails.map((item) => `${formatNumber(item.amount)} paid ${formatDay(item.date)}`).join("; "))}">incl. ${formatNumber(view.late)} late</div>`
    : "";
  const percent = row.monthlyTarget > 0
    ? Math.min(100, Math.round((paid / row.monthlyTarget) * 100))
    : (paid > 0 ? 100 : 0);
  const behind = row.track === "BEHIND";
  const adjustment = Number(row.adjustmentAmount) || 0;
  const adjustmentLabel = adjustment ? `${adjustment > 0 ? "+" : ""}${formatNumber(adjustment)}${row.adjustmentNote ? ` ${row.adjustmentNote}` : ""}` : "";
  const adjustmentTag = adjustment ? `<span class="adj-tag">${escapeHtml(adjustmentLabel)}</span>` : "";
  const noteTitle = [row.note, adjustment ? `Adjustment: ${adjustmentLabel}` : ""].filter(Boolean).join(" — ");
  return `
      <tr class="${behind ? "row-behind" : "row-ok"}">
        <td class="row-number"></td>
        <td><span class="table-cell-strong">${escapeHtml(row.name)}</span>${row.plate ? `<span class="table-cell-muted">${escapeHtml(row.plate)}</span>` : ""}</td>
        <td>${row.batch ? `<span class="batch-chip tone-${batchTone(row.batch)}">${escapeHtml(row.batch)}</span>` : "—"}</td>
        <td${zero(row.monthlyTarget) ? ' class="is-zero"' : ""}>${rwf(row.monthlyTarget)}</td>
        <td class="cell-paid${zero(paid)}" style="--pct:${percent}%" title="${percent}% of the monthly target">${rwf(paid)}${lateNote}</td>
        <td class="col-credit${zero(row.creditBroughtForward)}">${rwf(row.creditBroughtForward)}</td>
        <td class="col-credit${zero(row.creditCarriedForward)}">${rwf(row.creditCarriedForward)}</td>
        <td class="cell-short${shortfall > 0 ? " is-short" : " is-zero"}">${rwf(shortfall)}</td>
        <td>${escapeHtml(formatDay(lastPayment))}</td>
        <td>${rwf(row.paidByDate)}</td>
        <td>${rwf(row.dueByDate)}</td>
        <td class="cell-balance ${row.overallBalance > 0 ? "bal-bad" : "bal-good"}">${rwf(row.overallBalance)}</td>
        <td><span class="track-chip ${behind ? "behind" : "ok"}">${escapeHtml(row.track)}</span></td>
        <td class="cell-note" title="${escapeHtml(noteTitle)}">${adjustmentTag}${escapeHtml(row.note || (adjustment ? "" : "—"))}</td>
      </tr>`;
}

function renderDashboard(payload) {
  const dashboard = payload.dashboard;
  const rows = dashboard?.rows || [];
  const totals = dashboard?.totals || {};
  selection = { month: dashboard?.month || selection.month, date: dashboard?.asOfDate || "" };

  const monthSelect = $("monthSelect");
  const months = dashboard?.availableMonths || [];
  monthSelect.innerHTML = months.map((month) => `<option value="${month}"${month === selection.month ? " selected" : ""}>${monthLabel(month)}</option>`).join("");
  const asOf = $("asOfInput");
  asOf.min = dashboard?.monthStart || "";
  asOf.max = dashboard?.monthEnd || "";
  asOf.value = dashboard?.asOfDate || "";
  $("monthStartLabel").textContent = formatDay(dashboard?.monthStart);
  $("monthEndLabel").textContent = formatDay(dashboard?.monthEnd);

  const shown = lateMode && totals.forMonth ? { paid: totals.forMonth.paid, shortfall: totals.forMonth.shortfall } : { paid: totals.paidInMonth, shortfall: totals.shortfall };
  $("paidHeader").textContent = lateMode ? "Paid for month" : "Paid in month";
  if ($("paidCardLabel")) $("paidCardLabel").textContent = lateMode ? "Paid for month" : "Paid in month";
  $("monthlyDueTotal").textContent = formatRwf(totals.monthlyTarget);
  $("paidMonthTotal").textContent = formatRwf(shown.paid);
  $("remainingTotal").textContent = formatRwf(shown.shortfall);
  $("overallBalanceTotal").textContent = formatRwf(totals.overallBalance);
  $("trackSummary").textContent = rows.length ? `${totals.behindCount} behind · ${totals.okCount} on track` : "";
  $("tableMonthlyDueTotal").textContent = formatNumber(totals.monthlyTarget);
  $("tablePaidMonthTotal").textContent = formatNumber(shown.paid);
  $("tableCreditInTotal").textContent = formatNumber(totals.creditBroughtForward);
  $("tableCreditOutTotal").textContent = formatNumber(totals.creditCarriedForward);
  $("tableBalanceTotal").textContent = formatNumber(shown.shortfall);
  $("tablePaidByDateTotal").textContent = formatNumber(totals.paidByDate);
  $("tableDueByDateTotal").textContent = formatNumber(totals.dueByDate);
  $("tableOverallBalanceTotal").textContent = formatNumber(totals.overallBalance);
  $("dashboardTitle").textContent = dashboard ? `${monthLabel(dashboard.month)} — active riders` : "Accounting dashboard";
  $("dashboardPeriod").textContent = dashboard
    ? `Month ${formatDay(dashboard.monthStart)} to ${formatDay(dashboard.monthEnd)}; "paid by date" and "due by date" are counted up to ${formatDay(dashboard.asOfDate)}. All amounts are in RWF.`
    : "Waiting for the first synchronized data.";

  const sourceLink = $("sourceSheetLink");
  if (payload.sourceUrl) {
    sourceLink.href = payload.sourceUrl;
    sourceLink.classList.remove("hidden");
  }

  $("dataDashboardBody").innerHTML = rows.length
    ? rows.map((row) => renderDashboardRow(row, lateMode)).join("")
    : '<tr><td colspan="14" class="empty-table">No synchronized riders yet. Use Refresh to import them from the Sheet.</td></tr>';

  $("intervalInput").value = payload.schedule?.intervalDays || 2;
}

function barList(rows, formatValue) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return rows.map((row) => `
    <div class="bar-row" title="${escapeHtml(row.title || row.label)}">
      <span class="bar-label">${escapeHtml(row.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, Math.round((row.value / max) * 100))}%"></span></span>
      <span class="bar-value">${escapeHtml(formatValue(row.value))}</span>
    </div>`).join("");
}

function renderPaymentInsights(items) {
  const amount = (item) => Number(item.amountRwf) || 0;
  const today = new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const dayOf = (item) => String(item.paymentDate).slice(0, 10);
  const monthItems = items.filter((item) => dayOf(item).startsWith(thisMonth));
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  const recent = items.filter((item) => dayOf(item) >= cutoff && dayOf(item) <= today);
  const sum = (list) => list.reduce((total, item) => total + amount(item), 0);

  $("paidThisMonth").textContent = formatRwf(sum(monthItems));
  $("paidThisMonthNote").textContent = `${monthItems.length} payment${monthItems.length === 1 ? "" : "s"} from ${new Set(monthItems.map((item) => item.sourceName)).size} member(s)`;
  $("paidLast30").textContent = formatRwf(sum(recent));
  $("paidLast30Note").textContent = `${recent.length} payment${recent.length === 1 ? "" : "s"}`;
  $("averagePayment").textContent = formatRwf(items.length ? Math.round(sum(items) / items.length) : 0);
  const largest = items.reduce((best, item) => (amount(item) > amount(best || {}) ? item : best), null);
  $("largestPayment").textContent = formatRwf(largest ? amount(largest) : 0);
  $("largestPaymentNote").textContent = largest ? `${largest.sourceName} · ${formatDay(largest.paymentDate)}` : "";

  const byMonth = new Map();
  const byMember = new Map();
  for (const item of items) {
    byMonth.set(dayOf(item).slice(0, 7), (byMonth.get(dayOf(item).slice(0, 7)) || 0) + amount(item));
    byMember.set(item.sourceName, (byMember.get(item.sourceName) || 0) + amount(item));
  }
  const months = [...byMonth.entries()].sort().slice(-12).map(([month, value]) => ({ label: monthLabel(month), value }));
  const payers = [...byMember.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }));
  $("monthlyTrend").innerHTML = months.length ? barList(months, formatRwf) : '<p class="empty-table">No payments yet.</p>';
  $("topPayers").innerHTML = payers.length ? barList(payers, formatRwf) : '<p class="empty-table">No payments yet.</p>';
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
  $("latestPaymentDate").textContent = items.length ? formatDay(items[0].paymentDate) : "—";
  $("paymentTableTotal").textContent = formatRwf(total);
  renderPaymentInsights(items);
  const pageCount = Math.max(1, Math.ceil(visible.length / paymentPageSize));
  paymentPage = Math.min(Math.max(0, paymentPage), pageCount - 1);
  const start = paymentPage * paymentPageSize;
  const pageItems = visible.slice(start, start + paymentPageSize);
  $("dataPaymentsBody").style.counterReset = `rown ${start}`;
  $("paymentPageLabel").textContent = `Page ${paymentPage + 1} of ${pageCount}`;
  $("paymentRangeLabel").textContent = visible.length
    ? `${(start + 1).toLocaleString("en-US")}–${(start + pageItems.length).toLocaleString("en-US")} of ${visible.length.toLocaleString("en-US")}`
    : "0 payments";
  $("paymentPrevButton").disabled = paymentPage === 0;
  $("paymentNextButton").disabled = paymentPage >= pageCount - 1;
  $("dataPaymentsBody").innerHTML = pageItems.length
    ? pageItems.map((item) => `
      <tr>
        <td class="row-number"></td>
        <td>${escapeHtml(formatDate(item.paymentDate))}</td>
        <td><div class="table-cell-strong">${escapeHtml(item.sourceName)}</div></td>
        <td>${escapeHtml(item.sourcePlate || "—")}</td>
        <td><div class="table-cell-strong">${escapeHtml(formatRwf(item.amountRwf))}</div></td>
        <td>${escapeHtml(item.paymentMethod || "—")}</td>
        <td class="cell-note" title="${escapeHtml(item.referenceNote || "")}">${escapeHtml(item.referenceNote || "—")}${item.sourceStatement ? ` <a class="row-link" href="/bank-statements.html?open=${encodeURIComponent(item.sourceStatement.id)}" title="Open the bank statement this payment came from">${escapeHtml(item.sourceStatement.name)}</a>` : ""}</td>
        <td>${escapeHtml(item.enteredBy || "—")}</td>
        <td>${item.deletable ? `<button class="danger-button small-button" type="button" data-delete-payment="${escapeHtml(item.id)}">Delete</button>` : ""}</td>
      </tr>`).join("")
    : '<tr><td colspan="9" class="empty-table">No payments match this filter.</td></tr>';
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
    const query = view === "data-dashboard" && selection.month
      ? `?month=${encodeURIComponent(selection.month)}${selection.date ? `&date=${encodeURIComponent(selection.date)}` : ""}`
      : "";
    const endpoint = view === "data-payments" ? "/api/data/payments" : `/api/data/dashboard${query}`;
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
if ($("lateMode")) {
  $("lateMode").checked = lateMode;
  $("lateMode").addEventListener("change", () => {
    lateMode = $("lateMode").checked;
    localStorage.setItem("dashboardLateMode", lateMode ? "on" : "off");
    if (latestPayload) renderDashboard(latestPayload);
  });
}

if ($("monthSelect")) {
  const narrow = window.matchMedia("(max-width: 1500px)");
  const syncGroupSpan = () => { $("groupMonth").colSpan = narrow.matches ? 4 : 6; };
  narrow.addEventListener("change", syncGroupSpan);
  syncGroupSpan();
  $("monthSelect").addEventListener("change", () => {
    selection = { month: $("monthSelect").value, date: "" };
    load().catch(() => {});
  });
  $("asOfInput").addEventListener("change", () => {
    if (!$("asOfInput").value) return;
    selection.date = $("asOfInput").value;
    load().catch(() => {});
  });
}
async function deletePayment(button) {
  const item = (latestPayload?.items || []).find((entry) => entry.id === button.dataset.deletePayment);
  if (!item) return;
  const label = `${item.sourceName} — ${formatRwf(item.amountRwf)} on ${formatDay(item.paymentDate)}`;
  if (!window.confirm(`Delete this payment?\n\n${label}\n\nIt will also be removed from the Google Sheet. This cannot be undone.`)) return;
  button.disabled = true;
  button.textContent = "Deleting…";
  try {
    const result = await fetchJson(`/api/data/payments/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    setNotice(result.message || "Payment deleted.", "success");
    await load({ quiet: true });
  } catch (error) {
    setNotice(error.message, "error");
    button.disabled = false;
    button.textContent = "Delete";
  }
}

if ($("dataPaymentsBody")) {
  $("dataPaymentsBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-payment]");
    if (button) deletePayment(button);
  });
}

// "View in Payments" links from the bank statements page: /data-payments.html?filter=Name
if (paymentFilter) {
  const filterParam = new URLSearchParams(window.location.search).get("filter");
  if (filterParam) paymentFilter.value = filterParam;
}
if (paymentFilter) paymentFilter.addEventListener("input", () => {
  paymentPage = 0;
  renderPayments(latestPayload || { items: [] });
});
if ($("paymentPageSizeSelect")) {
  $("paymentPageSizeSelect").addEventListener("change", (event) => {
    paymentPageSize = Number(event.target.value) || 10;
    paymentPage = 0;
    renderPayments(latestPayload || { items: [] });
  });
  $("paymentPrevButton").addEventListener("click", () => {
    paymentPage -= 1;
    renderPayments(latestPayload || { items: [] });
  });
  $("paymentNextButton").addEventListener("click", () => {
    paymentPage += 1;
    renderPayments(latestPayload || { items: [] });
  });
}

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
