const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { env } = require("../config/env");
const { prisma } = require("../lib/prisma");
const { getDataSyncRunnerState } = require("./data-sync-runner-service");
const { getFineMonitorRunnerState } = require("./fine-monitor-runner-service");
const { getDataSyncSchedule, latestDataSyncRun } = require("./data-sync-service");
const { getFineMonitorSchedule } = require("./fine-monitor-service");
const { isPhoneOnline } = require("./phone-service");
const { isConfigured: sheetWritingConfigured } = require("./payments-sheet-service");
const { listEmailStatements } = require("./email-statements-service");

// The control center's data: one card per component (state ok | warn | down | off) and a table of timers.
// Everything here only reads; a component that cannot be read becomes a "down" card instead of failing the page.
// Kept so a test can confirm that every function this file calls is really exported by the module it comes from.
const DEPENDENCIES = { getDataSyncRunnerState, getFineMonitorRunnerState, getDataSyncSchedule, latestDataSyncRun, getFineMonitorSchedule, isPhoneOnline, sheetWritingConfigured, listEmailStatements };
const STARTED_AT = Date.now();
const GMAIL_POLL_MINUTES = Number(process.env.GMAIL_POLL_MINUTES) > 0 ? Number(process.env.GMAIL_POLL_MINUTES) : 5;
const iso = (value) => (value ? new Date(value).toISOString() : null);
const row = (label, value) => ({ label, value: value === null || value === undefined || value === "" ? "—" : String(value) });

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return null; }
}

function human(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

async function appCard() {
  const started = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  return {
    id: "app", title: "Fleebee app", state: "ok", headline: "Running",
    details: [row("App running for", human(Date.now() - STARTED_AT)), row("Computer up for", human(os.uptime() * 1000)), row("Database", `reachable (${Date.now() - started} ms)`), row("Node", process.version), row("Address", env.PUBLIC_APP_URL)]
  };
}

async function bankCard() {
  if (!env.BANK_STATEMENT_SERVICE_URL || !env.BANK_STATEMENT_SERVICE_API_KEY) {
    return { id: "bank", title: "Bank statement service", state: "off", headline: "Not configured", details: [row("Setting", "BANK_STATEMENT_SERVICE_URL / API key")] };
  }
  const started = Date.now();
  try {
    const response = await fetch(`${env.BANK_STATEMENT_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { id: "bank", title: "Bank statement service", state: "ok", headline: "Running", details: [row("Response", `${Date.now() - started} ms`), row("Address", env.BANK_STATEMENT_SERVICE_URL)] };
  } catch (error) {
    return { id: "bank", title: "Bank statement service", state: "down", headline: "Not answering", details: [row("Problem", error.message), row("Effect", "Uploads and emailed statements cannot be read until it is back")] };
  }
}

// The Gmail downloader leaves a heartbeat (status.json) next to its state file on every pass.
async function gmailCard() {
  if (!env.BANK_EMAIL_STATE_FILE) {
    return { id: "gmail", title: "Gmail statement downloader", state: "off", headline: "Not set up on this server", details: [row("Setting", "BANK_EMAIL_STATE_FILE")] };
  }
  const status = readJson(path.join(path.dirname(env.BANK_EMAIL_STATE_FILE), "status.json"));
  if (!status) {
    return { id: "gmail", title: "Gmail statement downloader", state: "warn", headline: "No check recorded yet", details: [row("Meaning", "The downloader has not run since the control center was added, or is not authorized yet")] };
  }
  const ageMs = Date.now() - Date.parse(status.checkedAt);
  const stale = ageMs > GMAIL_POLL_MINUTES * 3 * 60000;
  const needsAuth = status.auth === "needs-authorization";
  const state = needsAuth || stale ? "down" : status.outcome === "ok" ? "ok" : "warn";
  const headline = needsAuth ? "Authorization needed" : stale ? "Not checking (timer stopped?)" : status.outcome === "ok" ? "Checking mail" : status.outcome === "partial" ? "Checked, some emails failed" : "Last check failed";
  const emailed = await listEmailStatements().catch(() => null);
  return {
    id: "gmail", title: "Gmail statement downloader", state, headline,
    details: [
      row("Gmail access", needsAuth ? "needs authorization again" : status.auth === "ok" ? `active, read-only${status.authorizedAt ? ` (granted ${status.authorizedAt.slice(0, 10)})` : ""}` : "unknown"),
      row("Last check", `${human(ageMs)} ago`),
      row("Last result", status.summary ? `${status.summary.saved} saved, ${status.summary.duplicates} duplicate, ${status.summary.rejected} rejected, ${status.summary.errors} errors` : status.message),
      row("Watching", `${status.label} from ${status.sender}`),
      row("Only mail after", status.since ? status.since.replace("T", " ").slice(0, 16) + " UTC" : null),
      row("PDFs saved so far", status.totals?.pdfsSaved),
      row("Waiting to be opened", emailed?.body?.enabled ? emailed.body.new_count : null),
      ...(status.message && status.outcome !== "ok" ? [row("Problem", status.message)] : [])
    ],
    link: { href: "/bank-statements.html", label: "Open statements" }
  };
}

async function backupCard() {
  if (!env.BACKUP_STATUS_FILE) {
    return { id: "backup", title: "Backups", state: "off", headline: "Not set up on this server", details: [row("Setting", "BACKUP_STATUS_FILE")] };
  }
  const status = readJson(env.BACKUP_STATUS_FILE);
  if (!status) return { id: "backup", title: "Backups", state: "warn", headline: "No backup recorded yet", details: [row("Schedule", "every night at 03:30")] };
  const ageMs = Date.now() - Date.parse(status.finishedAt);
  const state = !status.ok || ageMs > 36 * 3600000 ? (ageMs > 72 * 3600000 || !status.ok ? "down" : "warn") : "ok";
  const mb = (status.bytes / 1048576).toFixed(1);
  return {
    id: "backup", title: "Backups", state,
    headline: !status.ok ? "Last backup had problems" : ageMs > 36 * 3600000 ? "Backup is overdue" : "Up to date",
    details: [
      row("Last backup", `${human(ageMs)} ago`),
      row("Size", `${mb} MB`),
      row("Copies kept", `${status.copiesKept} (${status.keepDays} days)`),
      row("Contains", (status.parts || []).join(", ")),
      row("Next backup", "every night at 03:30"),
      ...(status.problems?.length ? [row("Problem", status.problems.join("; ").slice(0, 200))] : [])
    ]
  };
}

async function sheetImportCard() {
  const [run, schedule] = await Promise.all([latestDataSyncRun(), getDataSyncSchedule()]);
  const runner = getDataSyncRunnerState();
  const failed = run && /FAIL|ERROR/i.test(run.status);
  const state = runner.configurationError ? "warn" : failed ? "warn" : "ok";
  return {
    id: "sheet-import", title: "Google Sheet import", state,
    headline: runner.isRunning ? "Importing now" : runner.configurationError ? "Not configured" : failed ? "Last import failed" : "Up to date",
    details: [
      row("Last import", run ? `${run.status.toLowerCase()} · ${iso(run.completedAt || run.startedAt).slice(0, 16).replace("T", " ")} UTC` : "never"),
      row("Riders / payments", run ? `${run.memberCount} / ${run.paymentCount}` : null),
      row("Repeats every", `${schedule.intervalDays} day${schedule.intervalDays === 1 ? "" : "s"}`),
      row("Next import", schedule.due ? "due now" : `in ${human(Date.parse(schedule.nextRunAt) - Date.now())}`),
      ...(run?.errorMessage ? [row("Problem", run.errorMessage.slice(0, 160))] : []),
      ...(runner.configurationError ? [row("Setup", runner.configurationError)] : [])
    ],
    link: { href: "/data-dashboard.html", label: "Open dashboard" }
  };
}

async function sheetWriteCard() {
  const ok = sheetWritingConfigured();
  return {
    id: "sheet-write", title: "Google Sheet writing", state: ok ? "ok" : "off", headline: ok ? "Configured" : "Not configured",
    details: [row("Used by", "Sync on the Bank Statements page and Delete on Payments"), row("Credentials", ok ? "service-account file present" : "no service-account file on this server"), ...(ok ? [] : [row("Effect", "Sync will say it is not configured")])]
  };
}

async function fineCard() {
  const [schedule, run] = await Promise.all([getFineMonitorSchedule(), prisma.fineCheckRun.findFirst({ orderBy: { startedAt: "desc" } })]);
  const runner = getFineMonitorRunnerState();
  const failed = run && /FAIL|ERROR/i.test(run.status);
  return {
    id: "fines", title: "Fine monitor", state: failed ? "warn" : "ok",
    headline: runner.isRunning ? "Checking now" : failed ? "Last check failed" : "Idle",
    details: [
      row("Last check", run ? `${run.status.toLowerCase()} · ${iso(run.completedAt || run.startedAt).slice(0, 16).replace("T", " ")} UTC` : "never"),
      row("Found / clear / failed", run ? `${run.foundCount} / ${run.clearCount} / ${run.failedCount}` : null),
      row("Repeats", schedule.frequency),
      row("Next check", schedule.due ? "due now" : `in ${human(Date.parse(schedule.nextRunAt) - Date.now())}`),
      ...(run?.errorMessage ? [row("Problem", run.errorMessage.slice(0, 160))] : [])
    ],
    link: { href: "/contraventions.html", label: "Open fines" }
  };
}

async function phoneCard() {
  const phone = await prisma.phoneState.findFirst({ orderBy: { lastHeartbeatAt: "desc" } });
  if (!phone) return { id: "phone", title: "SMS phone gateway", state: "off", headline: "No phone registered", details: [] };
  const online = isPhoneOnline(phone);
  return {
    id: "phone", title: "SMS phone gateway", state: online ? "ok" : "down", headline: online ? "Online" : "Offline",
    details: [row("Last heartbeat", `${human(Date.now() - phone.lastHeartbeatAt.getTime())} ago`), row("Bundle", phone.bundleStatus), row("Route", `${phone.fixedLocation} → ${phone.targetNumber}`)],
    link: { href: "/gateway.html", label: "Open gateway" }
  };
}

async function smsSchedulerCard() {
  const active = await prisma.scheduledMessage.findMany({ where: { status: "active" }, select: { nextRunAt: true } });
  const next = active.map((item) => item.nextRunAt).filter(Boolean).sort((a, b) => a - b)[0];
  return {
    id: "sms-scheduler", title: "Scheduled SMS", state: "ok", headline: active.length ? `${active.length} active schedule${active.length === 1 ? "" : "s"}` : "No active schedules",
    details: [row("Checks every", human(env.SCHEDULE_POLL_MS)), row("Next send", next ? `${next.toISOString().slice(0, 16).replace("T", " ")} UTC` : null)],
    link: { href: "/scheduled.html", label: "Open schedules" }
  };
}

function timers(cards) {
  const byId = Object.fromEntries(cards.map((card) => [card.id, card]));
  const detail = (id, label) => byId[id]?.details?.find((item) => item.label === label)?.value || "—";
  return [
    { name: "Gmail statement downloader", does: "Looks for new BK statement emails", every: `${GMAIL_POLL_MINUTES} min (systemd timer)`, last: detail("gmail", "Last check"), next: byId.gmail?.state === "off" ? "—" : `about ${GMAIL_POLL_MINUTES} min after the last check`, state: byId.gmail?.state },
    { name: "Google Sheet import", does: "Reads riders and payments from the sheet", every: detail("sheet-import", "Repeats every"), last: detail("sheet-import", "Last import"), next: detail("sheet-import", "Next import"), state: byId["sheet-import"]?.state },
    { name: "Fine monitor", does: "Checks plates for new fines", every: detail("fines", "Repeats"), last: detail("fines", "Last check"), next: detail("fines", "Next check"), state: byId.fines?.state },
    { name: "Scheduled SMS", does: "Sends recurring messages when due", every: detail("sms-scheduler", "Checks every"), last: "—", next: detail("sms-scheduler", "Next send"), state: byId["sms-scheduler"]?.state },
    { name: "Backups", does: "Copies databases, PDFs and settings", every: "every night at 03:30", last: detail("backup", "Last backup"), next: detail("backup", "Next backup"), state: byId.backup?.state },
    { name: "Phone heartbeat", does: "The phone reports it is alive", every: `every ~${human(env.PHONE_HEARTBEAT_STALE_MS)} or less`, last: detail("phone", "Last heartbeat"), next: "—", state: byId.phone?.state }
  ].filter((item) => item.state);
}

async function buildSystemOverview() {
  const collectors = [
    ["app", "Fleebee app", appCard], ["bank", "Bank statement service", bankCard], ["gmail", "Gmail statement downloader", gmailCard],
    ["sheet-import", "Google Sheet import", sheetImportCard], ["sheet-write", "Google Sheet writing", sheetWriteCard], ["backup", "Backups", backupCard],
    ["fines", "Fine monitor", fineCard], ["phone", "SMS phone gateway", phoneCard], ["sms-scheduler", "Scheduled SMS", smsSchedulerCard]
  ];
  const cards = await Promise.all(collectors.map(([id, title, collect]) => collect().catch((error) => ({
    id, title, state: "down", headline: "Could not be read", details: [row("Problem", String(error.message || error).slice(0, 160))]
  }))));
  const count = (state) => cards.filter((card) => card.state === state).length;
  return { generatedAt: new Date().toISOString(), summary: { ok: count("ok"), warn: count("warn"), down: count("down"), off: count("off") }, services: cards, timers: timers(cards) };
}

module.exports = { buildSystemOverview, gmailCard, backupCard, DEPENDENCIES };
