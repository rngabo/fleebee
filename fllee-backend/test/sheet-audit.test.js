const test = require("node:test");
const assert = require("node:assert/strict");

const { auditSheetAgainstBank, findRecordedDeposit } = require("../src/services/sheet-audit-service");

const period = { start: "2026-08-01", end: "2026-11-04" };
const statementName = "BK-3215_aug-nov";
const sheet = (row, date, name, amount, note = "") => ({ row, date, name, amount, method: "BK agent", note });
const bank = (date, amount, rider, extra = {}) => ({ ref: extra.ref || `r${date}${amount}`, date, amount, rider, depositor: rider, status: "PENDING", ...extra });
const audit = (sheetRows, entries) => auditSheetAgainstBank({ sheetRows, entries, period, statementName });
const kinds = (result) => result.findings.map((finding) => `${finding.kind}@${finding.row}`);

test("rows backed by a deposit of the same amount are fine, including back-dated ones", () => {
  const result = audit(
    [sheet(5, "2026-09-30", "Nyandwi Fabien", 36000), sheet(6, "2026-10-12", "Nyandwi Fabien", 36000)],
    [bank("2026-10-02", 36000, "Nyandwi Fabien"), bank("2026-10-12", 36000, "Nyandwi Fabien")]   // first one back-dated to month end
  );
  assert.deepEqual(result.findings, []);
  assert.equal(result.matched, 2);
});

test("a row with no deposit at all is flagged to remove or verify", () => {
  const result = audit([sheet(7, "2026-09-10", "Nyandwi Fabien", 36000)], [bank("2026-09-20", 10000, "Someone Else")]);
  assert.deepEqual(kinds(result), ["NOT_IN_BANK@7"]);
  assert.match(result.findings[0].note, /^CHECK \[BK-3215_aug-nov\]: no deposit of 36,000/);
});

test("a different amount at a similar date is reported as an amount difference, not as missing", () => {
  const result = audit([sheet(8, "2026-10-05", "Hagenimana Gedeon", 36000)], [bank("2026-10-06", 63000, "Hagenimana Gedeon")]);
  assert.deepEqual(kinds(result), ["AMOUNT_DIFFERS@8"]);
  assert.match(result.findings[0].message, /bank shows 63,000 on 06\/10\/2026 but this row says 36,000/);
});

test("two identical rows but one deposit: the extra one is a duplicate", () => {
  const result = audit(
    [sheet(9, "2026-10-05", "Hagenimana Gedeon", 36000), sheet(10, "2026-10-05", "Hagenimana Gedeon", 36000)],
    [bank("2026-10-05", 36000, "Hagenimana Gedeon")]
  );
  assert.deepEqual(kinds(result), ["DUPLICATE@10"]);
});

test("identical weekly payments are paired one to one, nothing is flagged", () => {
  const rows = [3, 10, 17, 24].map((day, i) => sheet(20 + i, `2026-10-${String(day).padStart(2, "0")}`, "Uwizeyimana Francois", 36000));
  const deposits = [3, 10, 17, 24].map((day) => bank(`2026-10-${String(day).padStart(2, "0")}`, 36000, "Uwizeyimana Francois"));
  assert.deepEqual(audit(rows, deposits).findings, []);
});

test("a row written by the app is matched by its reference code even if its date was edited", () => {
  const result = audit(
    [sheet(11, "2026-08-20", "Nyandwi Fabien", 36000, "Synced from app · paid 2026-11-02 · ref 5fa2e4f7")],
    [bank("2026-11-02", 36000, "Nyandwi Fabien", { ref: "5fa2e4f7", status: "SYNCED" })]
  );
  assert.deepEqual(result.findings, []);
});

test("a row that may belong to a deposit whose rider is not chosen yet is not flagged", () => {
  const result = audit([sheet(12, "2026-10-10", "Sindikubwayo Jean Claude", 10000)], [bank("2026-10-10", 10000, "", { depositor: "Olivier Ishimwe" })]);
  assert.deepEqual(result.findings, []);
  assert.equal(result.undecided.length, 1);
  assert.equal(result.undecided[0].depositor, "Olivier Ishimwe");
});

test("rows outside the statement period, or in its last week, are not judged", () => {
  const result = audit(
    [sheet(13, "2026-07-15", "Nyandwi Fabien", 36000), sheet(14, "2026-11-01", "Nyandwi Fabien", 36000)],
    []
  );
  assert.deepEqual(result.findings, []);
  assert.equal(result.tooRecent, 1);
});

test("deposits already synced are not 'missing', skipped ones are never reported, but a skipped deposit can explain a row", () => {
  const result = audit(
    [sheet(16, "2026-10-03", "Nyandwi Fabien", 5000)],
    [bank("2026-10-02", 36000, "Nyandwi Fabien"), bank("2026-10-03", 5000, "", { status: "SKIPPED", depositor: "Some Payer" }), bank("2026-10-04", 1000, "Nyandwi Fabien", { status: "SYNCED" })]
  );
  assert.deepEqual(result.missingInSheet.map((entry) => entry.amount), [36000]);   // only the pending deposit with a rider
  assert.deepEqual(result.findings, []);
  assert.equal(result.undecided.length, 1);
  assert.equal(result.undecided[0].status, "SKIPPED");
});

test("one undecided deposit explains only one row", () => {
  const result = audit(
    [sheet(17, "2026-10-10", "Nyandwi Fabien", 36000), sheet(18, "2026-10-10", "Hakorimana Benjamin", 36000)],
    [bank("2026-10-10", 36000, "", { depositor: "Shared Payer" })]
  );
  assert.equal(result.undecided.length, 1);
  assert.deepEqual(kinds(result), ["NOT_IN_BANK@18"]);
});

test("names are compared in any order and case", () => {
  const result = audit([sheet(15, "2026-10-02", "NYANDWI fabien", 36000)], [bank("2026-10-02", 36000, "Fabien Nyandwi")]);
  assert.deepEqual(result.findings, []);
});


// ---------- Sync must not add what the sheet already has ----------

test("a deposit already typed by hand under a back-dated date is recognised as recorded", () => {
  const sheetRows = [sheet(69, "2026-07-31", "Sindikubwayo Jean Claude", 30000)];          // back-dated by the operator
  const entries = [bank("2026-08-01", 30000, "Sindikubwayo Jean Claude", { ref: "1b145d18" })];
  const found = findRecordedDeposit({ sheetRows, entries, ref: "1b145d18" });
  assert.equal(found.kind, "manual");
  assert.equal(found.row.row, 69);
});

test("a deposit with no matching row is really missing", () => {
  const entries = [bank("2026-08-01", 30000, "Sindikubwayo Jean Claude", { ref: "1b145d18" })];
  assert.equal(findRecordedDeposit({ sheetRows: [sheet(70, "2026-08-01", "Sindikubwayo Jean Claude", 10000)], entries, ref: "1b145d18" }), null);
  assert.equal(findRecordedDeposit({ sheetRows: [sheet(70, "2026-08-01", "Someone Else", 30000)], entries, ref: "1b145d18" }), null);
  assert.equal(findRecordedDeposit({ sheetRows: [sheet(70, "2026-05-01", "Sindikubwayo Jean Claude", 30000)], entries, ref: "1b145d18" }), null);   // far too old
});

test("identical weekly payments are matched one row per deposit, so only the really missing one is added", () => {
  const sheetRows = [sheet(10, "2026-10-03", "Uwizeyimana Francois", 36000), sheet(11, "2026-10-10", "Uwizeyimana Francois", 36000)];
  const entries = ["2026-10-03", "2026-10-10", "2026-10-17"].map((date) => bank(date, 36000, "Uwizeyimana Francois", { ref: `r${date}` }));
  const recorded = entries.map((entry) => Boolean(findRecordedDeposit({ sheetRows, entries, ref: entry.ref })));
  assert.deepEqual(recorded, [true, true, false]);
});

test("a row the app wrote earlier is found by its reference code", () => {
  const sheetRows = [sheet(190, "2026-08-01", "Nyandwi Fabien", 36000, "Synced from app \u00b7 ref 73756a16")];
  const entries = [bank("2026-08-01", 36000, "Nyandwi Fabien", { ref: "73756a16", status: "SYNCED" })];
  assert.equal(findRecordedDeposit({ sheetRows, entries, ref: "73756a16" }).kind, "app");
});

// ---------- Duplicates the app already wrote ----------

test("an app row for a payment that was already in the sheet is flagged as the extra copy", () => {
  const result = audit(
    [sheet(69, "2026-07-31", "Sindikubwayo Jean Claude", 30000), sheet(190, "2026-08-01", "Sindikubwayo Jean Claude", 30000, "Synced from app \u00b7 ref 1b145d18")],
    [bank("2026-08-01", 30000, "Sindikubwayo Jean Claude", { ref: "1b145d18", status: "SYNCED" })]
  );
  assert.deepEqual(kinds(result), ["APP_DUPLICATE@190"]);
  assert.equal(result.findings[0].duplicateOf, 69);
  assert.deepEqual(result.appDuplicates, [{ ref: "1b145d18", appRow: 190, manualRow: 69 }]);
  assert.match(result.findings[0].note, /remove this extra row/);
});

test("an app row is NOT a duplicate when it records a payment that only exists once", () => {
  const result = audit(
    [sheet(69, "2026-07-31", "Sindikubwayo Jean Claude", 30000), sheet(190, "2026-08-01", "Sindikubwayo Jean Claude", 30000, "Synced from app \u00b7 ref 1b145d18")],
    [bank("2026-07-30", 30000, "Sindikubwayo Jean Claude", { ref: "aaaa0001" }), bank("2026-08-01", 30000, "Sindikubwayo Jean Claude", { ref: "1b145d18", status: "SYNCED" })]
  );
  assert.deepEqual(result.findings, []);          // two deposits, two rows
});
