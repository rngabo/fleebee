const test = require("node:test");
const assert = require("node:assert/strict");

// The bank service is stubbed: no remembered payers unless a test says so.
process.env.BANK_STATEMENT_SERVICE_URL = "http://bank.test";
process.env.BANK_STATEMENT_SERVICE_API_KEY = "test-key";
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) });

const bank = require("../src/services/bank-statement-service");
const { prisma } = require("../src/lib/prisma");

const riders = [
  { id: "b1", name: "Haragirimana", firstName: "Emmanuel", phoneNumber: "0782357977" },
  { id: "b2", name: "Nishimwe", firstName: "Jean Claude", phoneNumber: "0785465177" },
  { id: "b3", name: "Sindikubwayo", firstName: "Jean Claude", phoneNumber: "0781527006" },
  { id: "b4", name: "Munyemana", firstName: "Jean de dieu", phoneNumber: "0788840030" }
];

async function mark(entries) {
  const originalMember = prisma.dataMember;
  const originalBiker = prisma.biker;
  prisma.dataMember = { count: async () => 0, findMany: async () => [] };
  prisma.biker = { findMany: async () => riders };
  try {
    const { transactions } = await bank.markUnregisteredDepositors({
      transactions: entries.map((entry, index) => ({ id: `t${index}`, sync_status: "PENDING", review_status: "VALIDATED", name_hints: {}, ...entry }))
    });
    return transactions;
  } finally {
    prisma.dataMember = originalMember;
    prisma.biker = originalBiker;
  }
}

test("a last name or first name that matches exactly one real rider selects that rider", async () => {
  const [lastNameCut, firstNameOnly, fullReversed, lastNameOnly] = await mark([
    { depositor_name: "Haragirimana E", name_hints: { trailing_name: "Haragirimana E", sender_name: "Sylvestre Nsanzi" } },
    { depositor_name: "Emmanuel", name_hints: {} },
    { depositor_name: "Jean Claude Nishimwe", name_hints: {} },
    { depositor_name: "Munyemana", name_hints: {} }
  ]);
  assert.equal(lastNameCut.suggested_biker_id, "b1");
  assert.equal(lastNameCut.name_hint, "Sender: Sylvestre Nsanzi");
  assert.equal(firstNameOnly.suggested_biker_id, "b1");
  assert.equal(fullReversed.suggested_biker_id, "b2");      // last name wins over the shared "Jean Claude"
  assert.equal(lastNameOnly.suggested_biker_id, "b4");
});

test("it never guesses: a shared first name, or two different riders, selects nobody", async () => {
  const [sharedFirstName, conflict] = await mark([
    { depositor_name: "Claude", name_hints: {} },                                                     // Nishimwe or Sindikubwayo
    { depositor_name: "Haragirimana E", name_hints: { trailing_name: "Haragirimana E", sender_name: "Nishimwe" } }
  ]);
  assert.equal(sharedFirstName.suggested_biker_id, undefined);
  assert.equal(sharedFirstName.review_reason, "ambiguous-rider");
  assert.match(sharedFirstName.name_hint, /Nishimwe Jean Claude or Sindikubwayo Jean Claude/);
  assert.equal(conflict.suggested_biker_id, undefined);
  assert.equal(conflict.review_reason, "ambiguous-rider");
});

test("short or unrelated words do not match; the last text is just shown as the name", async () => {
  const [stranger, initial, withSender] = await mark([
    { depositor_name: "Starcom Internat", name_hints: {} },
    { depositor_name: "E", name_hints: {} },
    { depositor_name: "Some Payer", name_hints: { trailing_name: "Some Payer", sender_name: "Starcom Internat" } }
  ]);
  for (const entry of [stranger, initial, withSender]) {
    assert.equal(entry.suggested_biker_id, undefined);
    assert.equal(entry.review_reason, "not-registered-biker");
  }
  assert.equal(withSender.depositor_name, "Some Payer");
  assert.equal(withSender.name_hint, "Sender: Starcom Internat");
});

test("when only the sender fits a rider the sender is used and the last text becomes the hint", async () => {
  const [entry] = await mark([{ depositor_name: "Some Payer", name_hints: { trailing_name: "Some Payer", sender_name: "Dany Nishimwe" } }]);
  assert.equal(entry.suggested_biker_id, "b2");
  assert.equal(entry.depositor_name, "Dany Nishimwe");
  assert.match(entry.name_hint, /Narration ends with .*Some Payer/);
});

test("entries already synced or skipped are left alone", async () => {
  const [done] = await mark([{ sync_status: "SYNCED", depositor_name: "Haragirimana E" }]);
  assert.equal(done.suggested_biker_id, undefined);
  assert.equal(done.review_reason, undefined);
});


test("a remembered payer name selects its rider, and beats guessing from the name", async () => {
  const originalMember = prisma.dataMember;
  const originalBiker = prisma.biker;
  const originalFetch = global.fetch;
  prisma.dataMember = { count: async () => 0, findMany: async () => [] };
  prisma.biker = { findMany: async () => riders };
  global.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).includes("/api/v1/aliases")
      ? { items: [{ name_key: "ishimwe olivier", display_name: "Olivier Ishimwe", biker_id: "b3", biker_name: "Sindikubwayo Jean Claude" },
                  { name_key: "ghost payer", display_name: "Ghost Payer", biker_id: "gone", biker_name: "Not In The List" }] }
      : {})
  });
  try {
    const { transactions } = await bank.markUnregisteredDepositors({ transactions: [
      { id: "a", sync_status: "PENDING", review_status: "REVIEW_REQUIRED", name_hints: {}, depositor_name: "ISHIMWE Olivier" },
      { id: "b", sync_status: "PENDING", review_status: "REVIEW_REQUIRED", name_hints: {}, depositor_name: "Ghost Payer" },
      { id: "c", sync_status: "PENDING", review_status: "REVIEW_REQUIRED", name_hints: {}, depositor_name: "Someone New" }
    ] });
    const by = Object.fromEntries(transactions.map((entry) => [entry.id, entry]));
    assert.equal(by.a.suggested_biker_id, "b3");
    assert.equal(by.a.suggestion_source, "alias");
    assert.match(by.a.name_hint, /Olivier Ishimwe pays for Sindikubwayo Jean Claude/);
    assert.equal(by.b.suggested_biker_id, undefined, "an alias whose rider is no longer eligible is ignored");
    assert.equal(by.c.suggested_biker_id, undefined);
  } finally {
    prisma.dataMember = originalMember;
    prisma.biker = originalBiker;
    global.fetch = originalFetch;
  }
});


test("similar payer names: same words in any order, or one cut-off word; never a different person", () => {
  const { similarNames } = bank;
  assert.ok(similarNames("Olivier Ishimwe", "ISHIMWE Olivier"));
  assert.ok(similarNames("Uwurukundo Co", "Uwurukundo Cos"));
  assert.ok(similarNames("Mushimiyimana Cl", "Mushimiyimana Claude"));
  assert.ok(similarNames("Olivier Ishimw", "Olivier Ishimwe"));
  assert.equal(similarNames("Hakorimana Janvi", "Hakorimana Benjamin"), false);   // different second name
  assert.equal(similarNames("Jean Cl", "Jean Claude"), false);                    // no strong shared word
  assert.equal(similarNames("Olivier Ishimwe", "Olivier"), false);                // different number of words
  assert.equal(similarNames("Ndayishimiye Dany", "Nyandwi Fabien"), false);
});

test("a remembered payer is also recognised when the name is cut off differently", async () => {
  const originalMember = prisma.dataMember;
  const originalBiker = prisma.biker;
  const originalFetch = global.fetch;
  prisma.dataMember = { count: async () => 0, findMany: async () => [] };
  prisma.biker = { findMany: async () => riders };
  global.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).includes("/api/v1/aliases")
      ? { items: [{ name_key: "ishimwe olivier", display_name: "Olivier Ishimwe", biker_id: "b3", biker_name: "Sindikubwayo Jean Claude" }] }
      : {})
  });
  try {
    const { transactions } = await bank.markUnregisteredDepositors({ transactions: [
      { id: "a", sync_status: "PENDING", review_status: "REVIEW_REQUIRED", name_hints: {}, depositor_name: "Olivier Ishimw" }
    ] });
    assert.equal(transactions[0].suggested_biker_id, "b3");
    assert.equal(transactions[0].suggestion_source, "alias");
  } finally {
    prisma.dataMember = originalMember;
    prisma.biker = originalBiker;
    global.fetch = originalFetch;
  }
});

test("a sender that fits several riders does not make a row ambiguous when the last text is another name", async () => {
  const [row] = await mark([{ depositor_name: "Hakoromana Ben", name_hints: { trailing_name: "Hakoromana Ben", sender_name: "Jean Pierre" } }]);
  assert.equal(row.suggested_biker_id, undefined);
  assert.equal(row.review_reason, "not-registered-biker");        // not "Several riders fit"
});
