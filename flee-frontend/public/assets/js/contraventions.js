const runtimeConfig = window.FLEEBEE_CONFIG || {};
const API_BASE = String(runtimeConfig.apiBaseUrl || window.location.origin).replace(/\/$/, "");
const TERMINAL_RUN_STATES = new Set(["COMPLETED", "PARTIAL", "INCOMPLETE"]);

const $ = (id) => document.getElementById(id);
const appNameLabel = $("appNameLabel");
const apiBaseLabel = $("apiBaseLabel");
const pageNotice = $("pageNotice");
const refreshButton = $("refreshButton");
const refreshButtonLabel = $("refreshButtonLabel");
const refreshLoader = $("refreshLoader");
const logoutButton = $("logoutButton");
const runBadge = $("runBadge");
const updatedLabel = $("updatedLabel");
const frequencySelect = $("frequencySelect");
const statsTable = $("contraventionStatsBody");
const statsTotal = $("contraventionStatsTotal");
const fineTable = $("contraventionTableBody");
const listTotal = $("contraventionListTotal");

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

function formatDate(value, dateOnly = false) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return dateOnly ? date.toLocaleDateString() : date.toLocaleString();
}

function formatRwf(value) {
  return `RWF ${(Number(value) || 0).toLocaleString("en-US")}`;
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
    const error = new Error(payload.error || `Request failed with HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function resultClass(state) {
  if (state === "COMPLETED") return "sent";
  if (state === "PARTIAL" || state === "INCOMPLETE") return "failed";
  return "pending";
}

function setChecking(active) {
  checkInProgress = active;
  refreshButton.disabled = active;
  refreshButton.classList.toggle("is-loading", active);
  refreshLoader.classList.toggle("hidden", !active);
  refreshButtonLabel.textContent = active ? "Checking fines…" : "Refresh";
}

function renderRun(payload) {
  const run = payload.latestRun;
  const active = Boolean(payload.runner?.isRunning || run?.status === "RUNNING");
  const status = active ? "RUNNING" : run?.status || "No check yet";
  runBadge.textContent = active ? "Checking fines" : status;
  runBadge.className = `badge status-chip ${resultClass(status)}`;
}

function renderStatistics(statistics = [], totalAmountRwf = 0) {
  if (!statistics.length) {
    statsTable.innerHTML = '<tr><td colspan="6">No currently reported contraventions.</td></tr>';
  } else {
    statsTable.innerHTML = statistics.map((item, index) => `
      <tr>
        <td><div class="table-cell-strong">${index + 1}</div></td>
        <td><div class="table-cell-strong">${escapeHtml(item.bikerName || "-")}</div></td>
        <td>${escapeHtml(item.phoneNumber || "-")}</td>
        <td>${escapeHtml(item.contraventionCount)}</td>
        <td>${escapeHtml(formatDate(item.lastCheckedAt))}</td>
        <td><div class="table-cell-strong">${escapeHtml(formatRwf(item.totalAmountRwf))}</div></td>
      </tr>`).join("");
  }
  statsTotal.textContent = formatRwf(totalAmountRwf);
}

function renderFines(items = [], statistics = [], totalAmountRwf = 0) {
  const rankByBiker = new Map(statistics.map((item, index) => [item.bikerId || item.bikerName, index]));
  const current = items
    .filter((item) => item.isCurrentlyReported)
    .sort((left, right) => {
      const leftRank = rankByBiker.get(left.bikerId || left.bikerName) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rankByBiker.get(right.bikerId || right.bikerName) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank
        || String(right.issuedDate).localeCompare(String(left.issuedDate))
        || String(left.plateNumber).localeCompare(String(right.plateNumber));
    });

  if (!current.length) {
    fineTable.innerHTML = '<tr><td colspan="7">No currently reported contraventions.</td></tr>';
    listTotal.textContent = formatRwf(totalAmountRwf);
    return;
  }

  const rows = [];
  let previousBikerKey = null;
  for (const item of current) {
    const bikerKey = item.bikerId || item.bikerName;
    if (bikerKey !== previousBikerKey) {
      const rank = (rankByBiker.get(bikerKey) ?? 0) + 1;
      const statistic = statistics[rank - 1];
      rows.push(`
        <tr class="contravention-group-row">
          <td colspan="7">${rank}. ${escapeHtml(item.bikerName || "-")} — ${escapeHtml(statistic?.contraventionCount || 0)} contravention${statistic?.contraventionCount === 1 ? "" : "s"}</td>
        </tr>`);
      previousBikerKey = bikerKey;
    }
    rows.push(`
      <tr title="Ticket ${escapeHtml(item.ticketNumber || "not supplied")}">
        <td><div class="table-cell-strong">${escapeHtml(item.plateNumber)}</div></td>
        <td>${escapeHtml(item.bikerName || "-")}</td>
        <td>${escapeHtml(item.phoneNumber || "-")}</td>
        <td>${escapeHtml(formatDate(item.issuedDate, true))}</td>
        <td>${escapeHtml(formatDate(item.dueDate, true))}</td>
        <td>${escapeHtml(item.reason)}</td>
        <td><div class="table-cell-strong">${escapeHtml(formatRwf(item.amountRwf))}</div></td>
      </tr>`);
  }
  fineTable.innerHTML = rows.join("");
  listTotal.textContent = formatRwf(totalAmountRwf);
}

function render(payload) {
  latestPayload = payload;
  renderRun(payload);
  renderStatistics(payload.statistics || [], payload.totalAmountRwf || 0);
  renderFines(payload.items || [], payload.statistics || [], payload.totalAmountRwf || 0);
  frequencySelect.value = payload.schedule?.frequency || "weekly";
  updatedLabel.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

async function load({ quiet = false } = {}) {
  if (isLoading) return latestPayload;
  isLoading = true;
  if (!quiet) setNotice("Loading the latest contraventions...");
  try {
    const payload = await fetchJson("/api/contraventions");
    render(payload);
    if (!quiet) setNotice("Contraventions are up to date.", "success");
    return payload;
  } catch (error) {
    if (!quiet) setNotice(error.message, "error");
    throw error;
  } finally {
    isLoading = false;
  }
}

async function pollUntilRunFinishes(baselineRunId, requestedAt = Date.now(), acceptBaseline = false) {
  const timeoutAt = Date.now() + 20 * 60 * 1000;
  while (Date.now() < timeoutAt) {
    await wait(3000);
    const payload = await load({ quiet: true });
    const run = payload?.latestRun;
    const isNewRun = Boolean(run && run.id !== baselineRunId);
    const runnerActive = Boolean(payload?.runner?.isRunning);

    const isWatchedRun = isNewRun || (acceptBaseline && run?.id === baselineRunId);
    if (isWatchedRun && TERMINAL_RUN_STATES.has(run.status) && !runnerActive) {
      return payload;
    }
    if (!isNewRun && !runnerActive && Date.now() - requestedAt > 5000) {
      throw new Error("The fine check stopped before a new result was recorded.");
    }

    const completedTargets = (run?.targets || [])
      .filter((target) => target.state !== "PENDING")
      .length;
    setNotice(`Checking configured plates… ${completedTargets} of ${run?.targetCount || 0} completed.`);
  }
  throw new Error("The fine check is still running. This page will continue to update automatically.");
}

async function startManualRefresh() {
  if (checkInProgress) return;
  const baselineRunId = latestPayload?.latestRun?.id || null;
  const requestedAt = Date.now();
  setChecking(true);
  setNotice("Starting a new check for the configured plate scope...");

  try {
    await fetchJson("/api/contraventions/refresh", { method: "POST" });
    const payload = await pollUntilRunFinishes(baselineRunId, requestedAt);
    const run = payload.latestRun;
    const failed = (run?.failedCount || 0) + (run?.skippedCount || 0);
    setNotice(
      failed
        ? `Fine check finished with ${failed} plate${failed === 1 ? "" : "s"} not completed.`
        : `Fine check complete. ${run?.targetCount || 0} plate${run?.targetCount === 1 ? "" : "s"} checked.`,
      failed ? "error" : "success"
    );
  } catch (error) {
    if (error.status === 409) {
      await pollUntilRunFinishes(baselineRunId, requestedAt).catch(() => {});
    } else {
      setNotice(error.message, "error");
    }
  } finally {
    setChecking(false);
    await load({ quiet: true }).catch(() => {});
  }
}

async function saveFrequency() {
  const frequency = frequencySelect.value;
  frequencySelect.disabled = true;
  try {
    await fetchJson("/api/contraventions/frequency", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frequency })
    });
    setNotice(`Automatic fine checks will run ${frequency}.`, "success");
    await load({ quiet: true });
  } catch (error) {
    setNotice(error.message, "error");
    if (latestPayload?.schedule?.frequency) {
      frequencySelect.value = latestPayload.schedule.frequency;
    }
  } finally {
    frequencySelect.disabled = false;
  }
}

appNameLabel.textContent = runtimeConfig.appName || "Fleebee Dispatch Desk";
apiBaseLabel.textContent = API_BASE;
document.querySelectorAll("[data-nav-view]").forEach((link) => {
  link.classList.toggle("active", link.dataset.navView === "contraventions");
});

refreshButton.addEventListener("click", startManualRefresh);
frequencySelect.addEventListener("change", saveFrequency);
logoutButton.addEventListener("click", async () => {
  await fetchJson("/api/session/logout", { method: "POST" }).catch(() => {});
  window.location.assign("/login/");
});

load()
  .then((payload) => {
    if (payload?.runner?.isRunning || payload?.latestRun?.status === "RUNNING") {
      setChecking(true);
      setNotice("A fine check is already running. Waiting for its response...");
      return pollUntilRunFinishes(payload.latestRun?.id || null, Date.now(), true)
        .finally(() => setChecking(false));
    }
    return null;
  })
  .catch((error) => setNotice(error.message, "error"));

setInterval(() => {
  if (!checkInProgress) {
    load({ quiet: true }).catch(() => {});
  }
}, 30000);
