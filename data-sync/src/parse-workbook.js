const { createHash } = require("node:crypto");

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeName(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizePlate(value) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function normalizePhone(value) {
  const digits = text(value).replace(/\D/g, "");
  return /^7\d{8}$/.test(digits) ? `0${digits}` : digits;
}

function integer(value, fallback = null) {
  if (value === "" || value === null || value === undefined) return fallback;
  const parsed = typeof value === "number"
    ? value
    : Number(text(value).replace(/[(),\s]/g, "").replace(/[A-Za-z]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function isoDate(value) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Date.UTC(1899, 11, 30) + Math.round(value) * 86400000;
    return new Date(milliseconds).toISOString().slice(0, 10);
  }
  const raw = text(value);
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseMembers(rows) {
  if (!rows.length || text(rows[0]?.[0]).toLowerCase() !== "person id") {
    throw new Error("Setup range is missing the Person ID header row.");
  }

  return rows.slice(1).map((row, index) => {
    const sourcePersonId = text(row[0]);
    const sourceName = text(row[2]);
    if (!sourcePersonId || !sourceName) return null;
    const member = {
      sourcePersonId,
      sourceStatus: text(row[1]).toLowerCase(),
      sourceName,
      normalizedName: normalizeName(sourceName),
      startDate: isoDate(row[3]),
      batchCode: text(row[4]),
      monthlyDueRwf: integer(row[5]),
      weeklyDueRwf: integer(row[6]),
      durationMonths: integer(row[7]),
      dueDayOne: text(row[8]),
      dueDayTwo: text(row[9]),
      firstMonthDueRwf: integer(row[10]),
      lastMonthDueRwf: integer(row[11]),
      notes: text(row[12]),
      sourcePhone: normalizePhone(row[13]),
      sourcePlate: normalizePlate(row[14]),
      chargingCode: text(row[19]),
      extraChargesRwf: integer(row[20], 0),
      activeNumber: integer(row[21]),
      comment: text(row[22]),
      sourceRowNumber: index + 9
    };
    return { ...member, sourceFingerprint: fingerprint(member) };
  }).filter(Boolean);
}

function parsePayments(rows, members) {
  const headerIndex = rows.findIndex(
    (row) => text(row?.[0]).toLowerCase() === "payment date"
  );
  if (headerIndex < 0) {
    throw new Error("Payments range is missing the Payment date header row.");
  }
  const memberByName = new Map(members.map((member) => [member.normalizedName, member]));
  const occurrences = new Map();

  return rows.slice(headerIndex + 1).map((row, index) => {
    const paymentDate = isoDate(row[0]);
    const sourceName = text(row[1]);
    const amountRwf = integer(row[2]);
    if (!paymentDate || !sourceName || !Number.isInteger(amountRwf)) return null;
    const normalizedName = normalizeName(sourceName);
    const member = memberByName.get(normalizedName);
    const payment = {
      sourcePersonId: member?.sourcePersonId || "",
      sourceName,
      normalizedName,
      paymentDate,
      amountRwf,
      paymentMethod: text(row[3]),
      referenceNote: text(row[4]),
      enteredBy: text(row[5]),
      sourceRowNumber: headerIndex + index + 2
    };
    const sourceFingerprint = fingerprint({
      sourcePersonId: payment.sourcePersonId,
      normalizedName,
      paymentDate,
      amountRwf,
      paymentMethod: payment.paymentMethod,
      referenceNote: payment.referenceNote,
      enteredBy: payment.enteredBy
    });
    const occurrence = (occurrences.get(sourceFingerprint) || 0) + 1;
    occurrences.set(sourceFingerprint, occurrence);
    return {
      ...payment,
      sourceFingerprint,
      sourceKey: `${sourceFingerprint}:${occurrence}`
    };
  }).filter(Boolean);
}

function parseDashboard(rows, members) {
  const memberByName = new Map(members.map((member) => [member.normalizedName, member]));
  let selectedDate = null;
  let monthStart = null;
  let monthEnd = null;
  let headerIndex = -1;

  for (let index = 0; index < rows.length; index += 1) {
    const label = text(rows[index]?.[0]).toLowerCase();
    if (label.startsWith("select a month")) selectedDate = isoDate(rows[index]?.[2]);
    if (label === "month start") monthStart = isoDate(rows[index]?.[2]);
    if (label === "month end") monthEnd = isoDate(rows[index]?.[2]);
    if (label === "name") headerIndex = index;
  }
  if (headerIndex < 0) throw new Error("Dashboard range is missing the Name header row.");

  let totals = null;
  const dashboardRows = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const sourceName = text(row[0]);
    if (!sourceName) continue;
    if (sourceName.toUpperCase() === "TOTAL") {
      totals = {
        totalMonthlyDueRwf: integer(row[2], 0),
        totalPaidInMonthRwf: integer(row[3], 0),
        totalBalanceRwf: integer(row[4], 0),
        totalPaidByDateRwf: integer(row[6], 0),
        totalDueByDateRwf: integer(row[7], 0),
        totalOverallBalanceRwf: integer(row[8], 0)
      };
      continue;
    }
    const member = memberByName.get(normalizeName(sourceName));
    dashboardRows.push({
      sourcePersonId: member?.sourcePersonId || "",
      sourceName,
      batchCode: text(row[1]),
      monthlyDueRwf: integer(row[2], 0),
      paidInMonthRwf: integer(row[3], 0),
      balanceRemainingRwf: integer(row[4], 0),
      lastPaymentDate: isoDate(row[5]),
      paidByDateRwf: integer(row[6], 0),
      dueByDateRwf: integer(row[7], 0),
      overallBalanceRwf: integer(row[8], 0),
      trackStatus: text(row[9]),
      note: text(row[10]),
      adjustmentAmountRwf: integer(row[11]),
      adjustmentNote: text(row[12]),
      sourceRowNumber: index + 3
    });
  }

  return {
    selectedDate,
    monthStart,
    monthEnd,
    totals: totals || {
      totalMonthlyDueRwf: 0,
      totalPaidInMonthRwf: 0,
      totalBalanceRwf: 0,
      totalPaidByDateRwf: 0,
      totalDueByDateRwf: 0,
      totalOverallBalanceRwf: 0
    },
    rows: dashboardRows
  };
}

function parseAccountingWorkbook(workbook) {
  const members = parseMembers(workbook.setup || []);
  const payments = parsePayments(workbook.payments || [], members);
  const dashboard = parseDashboard(workbook.dashboard || [], members);
  return { members, payments, dashboard };
}

module.exports = {
  fingerprint,
  integer,
  isoDate,
  normalizeName,
  normalizePhone,
  normalizePlate,
  parseAccountingWorkbook,
  parseDashboard,
  parseMembers,
  parsePayments
};
