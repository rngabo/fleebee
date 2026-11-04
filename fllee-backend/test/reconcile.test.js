const test = require("node:test");
const assert = require("node:assert/strict");

const { findOrphanedSyncedEntries } = require("../src/services/bank-statement-service");

const imported = [{ date: "2026-10-31", amount: 36000, name: "Nyandwi Fabien" }];
const importStartedAt = new Date("2026-11-05T10:00:00Z");

test("entry whose payment vanished from the sheet is orphaned; present ones and newer ones are not", () => {
  const entries = [
    { book_date: "2026-10-31", amount: "36000.00", biker_name: "Fabien Nyandwi", synced_at: "2026-11-04T09:00:00Z" },
    { book_date: "2026-10-30", amount: "10000.00", biker_name: "Gone Rider", synced_at: "2026-11-04T09:00:00Z" },
    { book_date: "2026-11-01", amount: "5000.00", biker_name: "Fresh Rider", synced_at: "2026-11-05T11:00:00Z" },
    { book_date: "2026-11-01", amount: "5000.00", biker_name: "No Time", synced_at: null }
  ];
  const orphaned = findOrphanedSyncedEntries(entries, imported, importStartedAt);
  assert.deepEqual(orphaned.map((entry) => entry.biker_name), ["Gone Rider"]);
});

test("a hand-edited date does not make an entry look deleted when its reference code is still in the sheet", () => {
  const entries = [
    { book_date: "2026-11-02", sheet_date: "2026-10-31", amount: "36000.00", biker_name: "Nyandwi Fabien", ref: "5fa2e4f7", synced_at: "2026-11-04T09:00:00Z" },
    { book_date: "2026-11-02", sheet_date: "2026-10-31", amount: "10000.00", biker_name: "Gone Rider", ref: "aaaa1111", synced_at: "2026-11-04T09:00:00Z" }
  ];
  const imported = [{ date: "2026-10-29", amount: 36000, name: "Nyandwi Fabien", ref: "5fa2e4f7" }];   // date changed by hand
  assert.deepEqual(findOrphanedSyncedEntries(entries, imported, importStartedAt).map((entry) => entry.ref), ["aaaa1111"]);
});

test("entries synced before reference codes existed fall back to the recorded date", () => {
  const imported = [{ date: "2026-10-31", amount: 36000, name: "Nyandwi Fabien", ref: "" }];
  const old = { book_date: "2026-11-02", sheet_date: "2026-10-31", amount: "36000.00", biker_name: "Nyandwi Fabien", synced_at: "2026-11-04T09:00:00Z" };
  assert.deepEqual(findOrphanedSyncedEntries([old], imported, importStartedAt), []);
});
