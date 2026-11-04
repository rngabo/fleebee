const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateDashboard } = require("../src/services/dashboard-calculator");

const monthly = {
  id: "m1", sourceName: "Monthly Rider", sourceStatus: "active", startDate: new Date("2026-04-03"),
  monthlyDueRwf: 125000, weeklyDueRwf: null, durationMonths: 24, firstMonthDueRwf: 125000,
  lastMonthDueRwf: null, extraChargesRwf: 0, activeNumber: 1
};
const weekly = {
  id: "m2", sourceName: "Weekly Rider", sourceStatus: "active", startDate: new Date("2026-07-20"),
  monthlyDueRwf: 144000, weeklyDueRwf: 36000, durationMonths: 21, firstMonthDueRwf: null,
  lastMonthDueRwf: null, extraChargesRwf: 0, activeNumber: 2
};
const inactive = { ...monthly, id: "m3", sourceName: "Gone", sourceStatus: "inactive" };
const pay = (id, date, amountRwf) => ({ dataMemberId: id, paymentDate: date, amountRwf });

test("monthly payer: target, credit carry-over and overall balance", () => {
  const payments = [pay("m1", "2026-04-20", 125000), pay("m1", "2026-05-10", 250000), pay("m1", "2026-06-05", 62500)];
  const result = calculateDashboard({ members: [monthly, inactive], payments, month: "2026-06" });
  assert.equal(result.rows.length, 1, "inactive riders are not listed");
  const [row] = result.rows;
  assert.equal(row.monthlyTarget, 125000);
  assert.equal(row.paidInMonth, 62500);
  assert.equal(row.creditBroughtForward, 125000);
  assert.equal(row.shortfall, 0);
  assert.equal(row.creditCarriedForward, 437500 - 375000);
  assert.equal(row.dueByDate, 375000);
  assert.equal(row.paidByDate, 437500);
  assert.equal(row.overallBalance, 0);
  assert.equal(row.track, "OK");
  assert.equal(row.lastPaymentDate, "2026-06-05");
});

test("weekly payer first month is weekly x rounded weeks, then weekly x 4", () => {
  const july = calculateDashboard({ members: [weekly], payments: [], month: "2026-07" }).rows[0];
  assert.equal(july.monthlyTarget, 72000);
  const august = calculateDashboard({ members: [weekly], payments: [], month: "2026-08" }).rows[0];
  assert.equal(august.monthlyTarget, 144000);
  assert.equal(august.dueByDate, 72000 + 144000);
  assert.equal(august.track, "BEHIND");
});

test("due by date accrues day by day inside the month and adjustments count", () => {
  const mid = calculateDashboard({
    members: [monthly], payments: [], month: "2026-05", asOfDate: "2026-05-16",
    adjustments: new Map([["m1", { amount: 5000, note: "repair" }]])
  }).rows[0];
  assert.equal(mid.dueByDate, 125000 + Math.round(125000 * 16 / 31));
  assert.equal(mid.overallBalance, mid.dueByDate + 5000);
  assert.equal(mid.adjustmentNote, "repair");
});

test("rejects an invalid month", () => {
  assert.throws(() => calculateDashboard({ members: [], payments: [], month: "2026-13" }));
});
