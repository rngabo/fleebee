const DAY_MS = 86400000;

// A row can be recorded under a date earlier than the bank date (back-dating to a month end), or entered a day
// or two before the statement shows the money. These windows say how far apart the two dates may be.
const MAX_BACKDATED_DAYS = 62;
const MAX_EARLY_DAYS = 5;
// A row dated in the last days of the statement may belong to a deposit that falls after it ends: not judged yet.
const RECENT_DAYS = 7;

const dayNumber = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

function nameKey(value) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).sort().join(" ");
}

function formatNumber(value) {
  return (Number(value) || 0).toLocaleString("en-US");
}

function formatDay(iso) {
  const [year, month, day] = String(iso).slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function refOf(note) {
  const match = /\bref\s+([0-9a-f]{6,36})\b/i.exec(String(note ?? ""));
  return match ? match[1].toLowerCase() : "";
}

// The real bank date when the row was back-dated by the app ("paid 2026-11-02"), otherwise the row's own date.
function effectiveDate(row) {
  const match = /\bpaid\s+(\d{4}-\d{2}-\d{2})\b/i.exec(row.note || "");
  return match ? match[1] : row.date;
}

// How well a sheet date fits a bank date: null when it does not fit at all, otherwise the distance in days.
function dateFit(sheetIso, bankIso) {
  const gap = dayNumber(bankIso) - dayNumber(sheetIso);          // >0 when the sheet row is dated earlier
  if (gap < -MAX_EARLY_DAYS || gap > MAX_BACKDATED_DAYS) return null;
  return Math.abs(gap);
}

function bestMatch(deposit, rows, predicate) {
  let best = null;
  for (const row of rows) {
    if (row.claimed || !predicate(row)) continue;
    const fit = dateFit(effectiveDate(row), deposit.date);
    if (fit === null) continue;
    if (!best || fit < best.fit) best = { row, fit };
  }
  return best?.row || null;
}

function bestDeposit(row, deposits, predicate) {
  let best = null;
  for (const deposit of deposits) {
    if (deposit.used || !predicate(deposit)) continue;
    const fit = dateFit(effectiveDate(row), deposit.date);
    if (fit === null) continue;
    if (!best || fit < best.fit) best = { deposit, fit };
  }
  return best?.deposit || null;
}

const isAppRow = (row) => Boolean(refOf(row.note));

/**
 * Pairs every deposit of a statement with the sheet row that already records it, one row per deposit.
 *
 * Rows typed by hand are preferred over rows the app wrote: when a payment exists both ways, the hand-typed row is
 * the original and the app's row is the extra one (`appDuplicates`). A deposit with no hand-typed row falls back to
 * the row the app wrote for it (found by its reference code).
 *
 * sheetRows: [{ row, date, name, amount, note }]   entries: [{ ref, date, amount, rider }] (rider = name or "")
 * Returns { assignments: Map(ref -> { row, kind: "manual" | "app" }), appDuplicates: [{ appRow, manualRow, ref }] }
 */
function assignDeposits({ sheetRows, entries }) {
  const assignments = new Map();
  const appDuplicates = [];
  const rowsByRider = new Map();
  for (const row of sheetRows) {
    const key = nameKey(row.name);
    if (!rowsByRider.has(key)) rowsByRider.set(key, []);
    rowsByRider.get(key).push(row);
  }
  const depositsByRider = new Map();
  for (const entry of entries) {
    if (!entry.rider) continue;
    const key = nameKey(entry.rider);
    if (!depositsByRider.has(key)) depositsByRider.set(key, []);
    depositsByRider.get(key).push(entry);
  }

  for (const [riderKey, deposits] of depositsByRider) {
    const rows = rowsByRider.get(riderKey) || [];
    for (const row of rows) row.claimed = false;
    deposits.sort((a, b) => a.date.localeCompare(b.date));
    const manual = rows.filter((row) => !isAppRow(row));
    const app = rows.filter(isAppRow);

    // A) a hand-typed row of the same amount, closest date (back-dating allowed), one row per deposit
    for (const deposit of deposits) {
      const row = bestMatch(deposit, manual, (candidate) => candidate.amount === deposit.amount);
      if (row) {
        row.claimed = true;
        assignments.set(deposit.ref, { row, kind: "manual" });
      }
    }
    // B) otherwise the row the app wrote for this very deposit
    for (const deposit of deposits) {
      if (assignments.has(deposit.ref)) continue;
      const row = app.find((candidate) => !candidate.claimed && refOf(candidate.note) === deposit.ref);
      if (row) {
        row.claimed = true;
        assignments.set(deposit.ref, { row, kind: "app" });
      }
    }
    // C) an app row whose deposit already has a hand-typed row is the extra copy
    for (const deposit of deposits) {
      const found = assignments.get(deposit.ref);
      if (!found || found.kind !== "manual") continue;
      const extra = app.find((candidate) => refOf(candidate.note) === deposit.ref);
      if (extra) appDuplicates.push({ appRow: extra, manualRow: found.row, ref: deposit.ref });
    }
  }
  return { assignments, appDuplicates };
}

/**
 * Decides whether one deposit is already recorded in the sheet (used by Sync before it adds anything).
 * Returns { row, kind } for a recorded deposit, or null when it is really missing.
 */
function findRecordedDeposit({ sheetRows, entries, ref }) {
  return assignDeposits({ sheetRows: sheetRows.map((row) => ({ ...row })), entries }).assignments.get(ref) || null;
}

/**
 * Compares the sheet's Payments rows with one bank statement, rider by rider, and reports what looks wrong in the
 * sheet. Nothing is changed here.
 *
 * sheetRows: [{ row, date, name, amount, method, note }]
 * entries:   [{ ref, date, amount, rider, depositor, status }]   rider = name the deposit was tied to ("" if not yet)
 * period:    { start, end }  only sheet rows dated inside it are judged
 *
 * Findings concern a sheet row: NOT_IN_BANK, AMOUNT_DIFFERS, DUPLICATE, and APP_DUPLICATE (a row the app wrote for a
 * payment that was already in the sheet). Also returns deposits that are not in the sheet yet (missingInSheet) and
 * sheet rows that may match deposits whose rider is not chosen yet (undecided), which are never flagged.
 */
function auditSheetAgainstBank({ sheetRows, entries, period, statementName }) {
  const findings = [];
  const undecided = [];
  // Skipped deposits are kept: "skipped" often means "already handled in the sheet", so they can still explain a row.
  const live = entries.map((entry) => ({ ...entry, used: false }));
  const lastJudged = new Date(dayNumber(period.end) * DAY_MS - RECENT_DAYS * DAY_MS).toISOString().slice(0, 10);
  const judged = (iso) => iso >= period.start && iso <= lastJudged;

  const rows = sheetRows.map((row) => ({ ...row, claimed: false }));
  const { assignments, appDuplicates } = assignDeposits({ sheetRows: rows, entries: live });
  const claimedRows = new Set([...assignments.values()].map((found) => found.row.row));

  let matched = 0;
  for (const deposit of live) {
    if (assignments.has(deposit.ref)) {
      deposit.used = true;
      matched += 1;
    }
  }

  for (const { appRow, manualRow } of appDuplicates) {
    findings.push({
      kind: "APP_DUPLICATE", row: appRow.row, rider: appRow.name, date: appRow.date, amount: appRow.amount, duplicateOf: manualRow.row,
      message: `added by the app, but this payment was already in the sheet as row ${manualRow.row} (${formatDay(manualRow.date)}); remove this extra row`
    });
  }
  const flaggedAppRows = new Set(appDuplicates.map((item) => item.appRow.row));

  const unassigned = live.filter((deposit) => !deposit.rider);
  const bankByRider = new Map();
  for (const deposit of live) {
    if (!deposit.rider) continue;
    const key = nameKey(deposit.rider);
    if (!bankByRider.has(key)) bankByRider.set(key, []);
    bankByRider.get(key).push(deposit);
  }

  const leftovers = new Map();
  for (const row of rows) {
    if (claimedRows.has(row.row) || flaggedAppRows.has(row.row) || isAppRow(row) || !judged(row.date)) continue;
    const key = nameKey(row.name);
    if (!leftovers.has(key)) leftovers.set(key, []);
    leftovers.get(key).push(row);
  }

  for (const [riderKey, rowsLeft] of leftovers) {
    const deposits = bankByRider.get(riderKey) || [];
    rowsLeft.sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row);

    // a deposit of the same amount that is not tied to a rider yet (or was skipped) can still explain the row
    for (const row of rowsLeft) {
      const maybe = bestDeposit(row, unassigned, (candidate) => candidate.amount === row.amount);
      if (maybe) {
        maybe.used = true;           // one deposit explains one row
        row.explained = true;
        undecided.push({ row: row.row, rider: row.name, date: row.date, amount: row.amount, depositor: maybe.depositor || "", status: maybe.status });
      }
    }

    // what is left: a different amount at a similar date, an identical extra row, or nothing at all
    const seenIdentical = new Map();
    for (const row of sheetRows) {
      if (nameKey(row.name) === riderKey && claimedRows.has(row.row)) {
        const identity = `${row.date}|${row.amount}`;
        seenIdentical.set(identity, (seenIdentical.get(identity) || 0) + 1);
      }
    }
    for (const row of rowsLeft) {
      if (row.explained) continue;
      const identity = `${row.date}|${row.amount}`;
      const differing = bestDeposit(row, deposits, (candidate) => !assignments.has(candidate.ref));
      if (differing) {
        differing.used = true;
        findings.push({
          kind: "AMOUNT_DIFFERS", row: row.row, rider: row.name, date: row.date, amount: row.amount,
          message: `bank shows ${formatNumber(differing.amount)} on ${formatDay(differing.date)} but this row says ${formatNumber(row.amount)}`
        });
        continue;
      }
      if (seenIdentical.get(identity)) {
        findings.push({
          kind: "DUPLICATE", row: row.row, rider: row.name, date: row.date, amount: row.amount,
          message: `same date, name and amount as another row but the statement has only one such deposit`
        });
        continue;
      }
      findings.push({
        kind: "NOT_IN_BANK", row: row.row, rider: row.name, date: row.date, amount: row.amount,
        message: `no deposit of ${formatNumber(row.amount)} found in the statement for ${formatDay(period.start)} - ${formatDay(period.end)}; remove it or verify it`
      });
    }
  }

  const missingInSheet = live
    .filter((entry) => entry.rider && !assignments.has(entry.ref) && !["SYNCED", "IN_SHEET", "SKIPPED"].includes(entry.status))
    .map((entry) => ({ ref: entry.ref, date: entry.date, amount: entry.amount, rider: entry.rider }));

  for (const finding of findings) finding.note = `CHECK [${statementName}]: ${finding.message}`;
  findings.sort((a, b) => a.row - b.row);
  const tooRecent = sheetRows.filter((row) => row.date > lastJudged && row.date <= period.end).length;
  return {
    findings,
    undecided,
    missingInSheet,
    matched,
    tooRecent,
    appDuplicates: appDuplicates.map(({ appRow, manualRow, ref }) => ({ ref, appRow: appRow.row, manualRow: manualRow.row }))
  };
}

module.exports = { assignDeposits, auditSheetAgainstBank, effectiveDate, findRecordedDeposit, nameKey, refOf };
