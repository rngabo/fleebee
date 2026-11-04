const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isoDate,
  normalizePhone,
  parseAccountingWorkbook,
  parsePayments
} = require("../src/parse-workbook");

test("converts Excel serial dates without a timezone shift", () => {
  assert.equal(isoDate(46288), "2026-09-23");
});

test("restores a leading zero stripped from a numeric Rwanda mobile value", () => {
  assert.equal(normalizePhone(782357977), "0782357977");
  assert.equal(normalizePhone("0782357977"), "0782357977");
});

test("parses setup, payments, and dashboard values", () => {
  const workbook = {
    setup: [
      ["Person ID", "Status (edit)", "Name (edit)", "Start date (edit)", "Batch code (edit)", "Monthly due (RWF, edit)", "Weekly due (RWF, edit)", "Duration (months, edit)", "Due day #1", "Due day #2", "First month due override (optional)", "Last month due override (optional)", "Notes", "Phone", "Plate", "", "", "", "", "Charging code", "Extra charges (RWF, edit)", "Active # (auto)", "Comment"],
      [8, "active", "Sindikubwayo Jean Claude", "2026-07-23", "B-Jul-2026", 120000, 30000, 24, 15, "EOM", "", 130000, "Replaced former rider", "0781527006", "RL812Q", "", "", "", "", "", 50000, 6, "support maintenance"]
    ],
    payments: [
      ["Payment date", "Name", "Amount paid (RWF)", "Payment method", "Reference/Notes", "Entered by"],
      ["2026-09-13", "Sindikubwayo Jean Claude", 15000, "BK agent", "", "Richard"]
    ],
    dashboard: [
      ["Select a month to view balances:", "", "2026-09-30"],
      [],
      ["Month start", "", "2026-09-01"],
      ["Month end", "", "2026-09-30"],
      [],
      ["Name", "Batch", "Monthly due (RWF)", "Paid in month (RWF)", "Balance remaining (RWF)", "Last payment date", "Paid by date (RWF)", "Due by date (RWF)", "Overall balance (RWF)", "Track"],
      ["Sindikubwayo Jean Claude", "B-Jul-2026", 120000, 45000, 75000, "2026-09-13", 201000, 270000, 119000, "BEHIND", "Thursday 23", 50000, "support maintenance"],
      ["TOTAL", "", 120000, 45000, 75000, "", 201000, 270000, 119000]
    ]
  };

  const parsed = parseAccountingWorkbook(workbook);
  assert.equal(parsed.members.length, 1);
  assert.equal(parsed.members[0].sourcePlate, "RL812Q");
  assert.equal(parsed.members[0].extraChargesRwf, 50000);
  assert.equal(parsed.payments[0].sourcePersonId, "8");
  assert.equal(parsed.dashboard.rows[0].overallBalanceRwf, 119000);
  assert.equal(parsed.dashboard.totals.totalPaidInMonthRwf, 45000);
});

test("keeps legitimate identical payment rows with stable occurrence keys", () => {
  const members = [{ sourcePersonId: "1", normalizedName: "example rider" }];
  const rows = [
    ["Payment date", "Name", "Amount paid (RWF)", "Payment method", "Reference/Notes", "Entered by"],
    ["2026-09-01", "Example Rider", 30000, "BK agent"],
    ["2026-09-01", "Example Rider", 30000, "BK agent"]
  ];
  const payments = parsePayments(rows, members);
  assert.equal(payments.length, 2);
  assert.notEqual(payments[0].sourceKey, payments[1].sourceKey);
  assert.equal(payments[0].sourceFingerprint, payments[1].sourceFingerprint);
});

test("finds a moved Payments header and retains absolute row numbers", () => {
  const members = [{ sourcePersonId: "16", normalizedName: "new rider" }];
  const rows = [
    ["Payments"],
    [],
    ["Payment date", "Name", "Amount paid (RWF)", "Payment method"],
    ["2026-10-25", "New Rider", 36000, "BK agent"]
  ];

  const payments = parsePayments(rows, members);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].sourcePersonId, "16");
  assert.equal(payments[0].sourceRowNumber, 4);
});
