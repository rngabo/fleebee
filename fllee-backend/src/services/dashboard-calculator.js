// Reproduces the "Dashboard" tab of the Fleebee accounting Google Sheet for any month.
// Inputs are Setup rows (members) and Payments rows; nothing here touches the database.

const DAY_MS = 86400000;

// The sheet hard-codes one rider whose first (partial) month is billed with ROUNDDOWN
// instead of ROUND on the weekly count. Kept here so figures match the sheet exactly.
const ROUND_DOWN_FIRST_MONTH = new Set(["shumbusho josue"]);

function utcDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function monthStartOf(day, offset = 0) {
  const date = new Date(day);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1);
}

function monthEndOf(day) {
  return monthStartOf(day, 1) - DAY_MS;
}

function daysInMonth(day) {
  return (monthEndOf(day) - monthStartOf(day)) / DAY_MS + 1;
}

function isoDate(day) {
  return new Date(day).toISOString().slice(0, 10);
}

function normalizeName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sheetRound(value) {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

// A blank override/weekly cell means "not set"; older imports stored blanks as 0, so 0 counts as unset.
function hasValue(value) {
  return typeof value === "number" && value > 0;
}

// Monthly due for month number `k` (1-based) of a member, as in the Monthly Summary tab.
function monthlyDue(member, k) {
  const start = utcDay(member.startDate);
  const duration = member.durationMonths ?? 0;
  if (k > duration) return 0;
  const regular = hasValue(member.weeklyDueRwf) ? member.weeklyDueRwf * 4 : (member.monthlyDueRwf ?? 0);
  if (k === 1) {
    if (hasValue(member.firstMonthDueRwf)) return member.firstMonthDueRwf;
    const remainingDays = (monthEndOf(start) - start) / DAY_MS + 1;
    if (hasValue(member.weeklyDueRwf)) return member.weeklyDueRwf * sheetRound(remainingDays / 7);
    return sheetRound((member.monthlyDueRwf ?? 0) * remainingDays / daysInMonth(start));
  }
  if (k === duration && hasValue(member.lastMonthDueRwf)) return member.lastMonthDueRwf;
  return regular;
}

// A payment can say which month it is for in its Reference/Notes: "Synced from app · for 2026-10" or, typed by
// hand in the sheet, "for 2026-10". Without that, a payment belongs to the month of its date.
const FOR_MONTH_NOTE = /\bfor\s+(\d{4})-(\d{2})\b/i;

function paymentForMonth(payment) {
  const match = FOR_MONTH_NOTE.exec(String(payment.referenceNote || ""));
  if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) return `${match[1]}-${match[2]}`;
  return isoDate(utcDay(payment.paymentDate)).slice(0, 7);
}

/**
 * The selected month seen by "the month a payment is for": payments dated later but tagged for this month
 * count here as late; payments dated in this month but tagged for an earlier month do not. Dates never change.
 */
function forMonthView(payments, monthKey, monthEnd, target, creditBroughtForward) {
  const mine = payments.filter((payment) => paymentForMonth(payment) === monthKey);
  const sum = (items) => items.reduce((total, payment) => total + payment.amountRwf, 0);
  const late = mine.filter((payment) => utcDay(payment.paymentDate) > monthEnd);
  const lateByDay = new Map();
  for (const payment of late) {
    const day = isoDate(utcDay(payment.paymentDate));
    lateByDay.set(day, (lateByDay.get(day) || 0) + payment.amountRwf);
  }
  const paid = sum(mine);
  const lastDay = mine.length ? Math.max(...mine.map((payment) => utcDay(payment.paymentDate))) : null;
  const settled = target > 0 && lastDay !== null && paid + creditBroughtForward >= target;
  return {
    paid,
    onTime: paid - sum(late),
    late: sum(late),
    lateDetails: [...lateByDay].map(([date, amount]) => ({ date, amount })),
    shortfall: Math.max(0, target - paid - creditBroughtForward),
    lastPaymentDate: lastDay === null ? null : isoDate(lastDay),
    settledOn: settled && lastDay !== null ? isoDate(lastDay) : null,
    daysLate: settled && lastDay > monthEnd ? Math.round((lastDay - monthEnd) / DAY_MS) : 0
  };
}

function weeklyRoundingCorrection(member, start) {
  const remainingDays = (monthEndOf(start) - start) / DAY_MS + 1;
  return member.weeklyDueRwf * (sheetRound(remainingDays / 7) - Math.floor(remainingDays / 7));
}

function monthNumberOf(start, targetMonthStart) {
  const first = new Date(start);
  const target = new Date(targetMonthStart);
  return (target.getUTCFullYear() - first.getUTCFullYear()) * 12
    + (target.getUTCMonth() - first.getUTCMonth()) + 1;
}

function sumPayments(payments, from, to) {
  return payments.reduce((sum, payment) => {
    const day = utcDay(payment.paymentDate);
    return day >= from && day <= to ? sum + payment.amountRwf : sum;
  }, 0);
}

function buildRow(member, payments, monthStart, monthEnd, asOf, adjustment) {
  const start = utcDay(member.startDate);
  const nameKey = normalizeName(member.sourceName);
  const roundDownFirst = ROUND_DOWN_FIRST_MONTH.has(nameKey) && hasValue(member.weeklyDueRwf);
  const k = monthNumberOf(start, monthStart);

  let target = k >= 1 ? monthlyDue(member, k) : 0;
  if (roundDownFirst && monthEndOf(start) === monthEnd) {
    const remainingDays = (monthEndOf(start) - start) / DAY_MS + 1;
    target = member.weeklyDueRwf * Math.floor(remainingDays / 7);
  }

  // Dues of all earlier months, less the sheet's rounding exception for the special rider.
  let priorDue = 0;
  for (let index = 1; index < k; index += 1) priorDue += monthlyDue(member, index);
  if (roundDownFirst && monthStart > monthEndOf(start)) priorDue -= weeklyRoundingCorrection(member, start);

  const paidInMonth = sumPayments(payments, monthStart, monthEnd);
  const paidBefore = sumPayments(payments, -Infinity, monthStart - DAY_MS);
  const paidThroughMonth = sumPayments(payments, -Infinity, monthEnd);
  const paidByDate = sumPayments(payments, -Infinity, asOf);

  const creditBroughtForward = Math.max(0, paidBefore - priorDue);
  const creditCarriedForward = Math.max(0, paidThroughMonth - (priorDue + target));
  const shortfall = Math.max(0, target - paidInMonth - creditBroughtForward);

  let accrued = 0;
  if (start <= asOf) {
    const from = Math.max(monthStart, start);
    const ratio = Math.min(1, ((asOf - from) / DAY_MS + 1) / ((monthEnd - from) / DAY_MS + 1));
    accrued = target * ratio;
  }
  const dueByDate = sheetRound(priorDue + accrued);
  // Manual adjustment typed in the sheet's Dashboard "Adjustment" column is part of the balance there too.
  const adjustmentAmount = adjustment?.amount || 0;
  const overallBalance = Math.max(0, dueByDate - paidByDate + (member.extraChargesRwf || 0) + adjustmentAmount);

  const monthPayments = payments.filter((payment) => {
    const day = utcDay(payment.paymentDate);
    return day >= monthStart && day <= monthEnd;
  });
  const lastPayment = paidInMonth === 0 || !monthPayments.length
    ? null
    : isoDate(Math.max(...monthPayments.map((payment) => utcDay(payment.paymentDate))));

  return {
    memberId: member.id ?? member.sourcePersonId ?? "",
    name: member.sourceName,
    plate: member.sourcePlate || "",
    batch: member.batchCode || "",
    monthlyTarget: target,
    paidInMonth,
    creditBroughtForward,
    creditCarriedForward,
    shortfall,
    lastPaymentDate: lastPayment,
    paidByDate,
    dueByDate,
    overallBalance,
    track: overallBalance === 0 ? "OK" : "BEHIND",
    forMonth: forMonthView(payments, isoDate(monthStart).slice(0, 7), monthEnd, target, creditBroughtForward),
    adjustmentAmount: adjustment?.amount ?? null,
    adjustmentNote: adjustment?.note || "",
    note: adjustment?.rowNote || ""
  };
}

function buildTotals(rows) {
  const total = (key) => rows.reduce((sum, row) => sum + row[key], 0);
  return {
    monthlyTarget: total("monthlyTarget"),
    paidInMonth: total("paidInMonth"),
    creditBroughtForward: total("creditBroughtForward"),
    creditCarriedForward: total("creditCarriedForward"),
    shortfall: total("shortfall"),
    paidByDate: total("paidByDate"),
    dueByDate: total("dueByDate"),
    overallBalance: total("overallBalance"),
    forMonth: {
      paid: rows.reduce((sum, row) => sum + row.forMonth.paid, 0),
      late: rows.reduce((sum, row) => sum + row.forMonth.late, 0),
      shortfall: rows.reduce((sum, row) => sum + row.forMonth.shortfall, 0)
    },
    behindCount: rows.filter((row) => row.track === "BEHIND").length,
    okCount: rows.filter((row) => row.track === "OK").length
  };
}

/**
 * @param members  Setup rows: { id, sourceName, sourceStatus, startDate, batchCode, monthlyDueRwf,
 *                 weeklyDueRwf, durationMonths, firstMonthDueRwf, lastMonthDueRwf, extraChargesRwf, sourcePlate, activeNumber }
 * @param payments { dataMemberId|memberId, paymentDate, amountRwf }
 * @param adjustments optional Map memberId -> { amount, note, rowNote } from the sheet's Dashboard N/O/M columns
 * @param month    "YYYY-MM"
 * @param asOfDate optional "YYYY-MM-DD" inside that month (the sheet's "selected date")
 */
function calculateDashboard({ members, payments, month, asOfDate, adjustments = new Map() }) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error("Month must look like 2026-10.");
  const monthStart = Date.UTC(Number(match[1]), Number(match[2]) - 1, 1);
  const monthEnd = monthEndOf(monthStart);

  let asOf = monthEnd;
  if (asOfDate) {
    const parsed = Date.parse(`${asOfDate}T00:00:00Z`);
    if (Number.isNaN(parsed)) throw new Error("Date must look like 2026-10-31.");
    asOf = Math.min(Math.max(parsed, monthStart), monthEnd);
  }

  const paymentsByMember = new Map();
  for (const payment of payments) {
    const key = payment.dataMemberId ?? payment.memberId;
    if (!paymentsByMember.has(key)) paymentsByMember.set(key, []);
    paymentsByMember.get(key).push(payment);
  }

  const rows = members
    .filter((member) => String(member.sourceStatus).toLowerCase() === "active" && member.startDate)
    .sort((a, b) => (a.activeNumber ?? 9999) - (b.activeNumber ?? 9999))
    .map((member) => {
      const memberPayments = paymentsByMember.get(member.id) || [];
      return buildRow(member, memberPayments, monthStart, monthEnd, asOf, adjustments.get(member.id));
    });

  return {
    month,
    monthStart: isoDate(monthStart),
    monthEnd: isoDate(monthEnd),
    asOfDate: isoDate(asOf),
    rows,
    totals: buildTotals(rows)
  };
}

module.exports = { calculateDashboard, monthlyDue, normalizeName, paymentForMonth };
