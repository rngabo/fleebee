const assert = require("node:assert/strict");
const test = require("node:test");

const { parseFineRow } = require("../src/parse-result");

test("parses an Irembo fine row", () => {
  assert.deepEqual(parseFineRow({
    ticketNumber: " TK1788537689123 ",
    issuedDate: "2026-09-04",
    dueDate: "2026-10-04",
    reason: " Dangerous parking ",
    amount: " RWF 10,000 "
  }), {
    ticketNumber: "TK1788537689123",
    issuedDate: "2026-09-04",
    dueDate: "2026-10-04",
    reason: "Dangerous parking",
    amountDisplay: "RWF 10,000",
    amountRwf: 10000
  });
});

test("rejects incomplete rows", () => {
  assert.throws(() => parseFineRow({
    ticketNumber: "",
    issuedDate: "2026-09-04",
    reason: "Dangerous parking",
    amount: "RWF 10,000"
  }), /missing or invalid/);
});

