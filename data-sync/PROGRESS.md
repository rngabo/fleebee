# Data Sync Progress

## 2026-09-26 — Initial implementation

### Source findings

- Analyzed `/home/richard/Downloads/Accounting_MT-updated.xlsx` in read-only
  mode and confirmed it matches the live Google Sheet dimensions and latest
  Payment rows.
- Relevant source volume:
  - 13 populated Setup members: 11 active and 2 inactive
  - 122 Payment entries in rows 6–127
  - 11 Dashboard member rows plus totals
- Confirmed the live tab identifiers:
  - Setup: `73144687`
  - Payments: `1642781045`
  - Dashboard: `1071825727`
- Confirmed the Sheet is private: the unauthenticated CSV endpoint returns 401.
- Compared production identities and found that the 11 active Sheet members
  already map to current Fleebee bikes. Source phone differences are retained
  as reviewable source data rather than silently overwriting Fleebee.

### Implemented

- Added the dependency-free `data-sync` one-shot worker.
- Added Google service-account JWT/OAuth and read-only Sheets batch reads.
- Added Setup, Payments, and Dashboard parsers with stable fingerprints.
- Added dedicated Prisma models for runs, members, payments, and dashboard
  snapshots.
- Added safe matching and missing-active-record creation rules.
- Added internal bearer-authenticated ingestion routes.
- Added manual refresh, two-day default scheduling, and 1–30 day configuration.
- Added `Data -> Dashboard` and `Data -> Payments` to all dashboard sidebars.
- Added full dashboard totals/rows, sync coverage, payment list, filtering, and
  Refresh controls.
- Added environment and deployment-sync templates.

### Verification

- All three parser tests pass.
- All new worker and backend JavaScript files pass `node --check`.
- Prisma schema formatting and client generation pass.
- An isolated SQLite integration check ran the same payload twice and confirmed:
  - 1 existing Biker remained 1
  - 1 existing Bike remained 1
  - 1 DataMember remained 1
  - 1 DataPayment remained 1
  - each run kept its own Dashboard snapshot
  - default interval is 2 days

### Current blocker

The code is ready for production configuration, but the private Sheet cannot be
read by the home-computer worker until a Google service-account JSON key is
provided and the Sheet is shared with that service-account email as Viewer.

### Next steps

1. Provision the read-only service account and protected environment file.
2. Back up the live database.
3. Deploy, migrate, and restart Fleebee.
4. Run the first production sync and compare counts and totals with the source.

## 2026-09-26 — Production authentication and deployment

### Completed

- Created and enabled the production Google service account
  `fleebee-data-sync@fleebee.iam.gserviceaccount.com`.
- Shared the private accounting Sheet with that account as Viewer.
- Verified the `spreadsheets.readonly` OAuth flow against all three bounded
  ranges before deployment without printing source contents.
- Stored the JSON credential outside the release tree at
  `/home/richard/fleebee/shared/google-data-sync-service-account.json`, mode
  `600`.
- Created matching private backend and worker tokens in mode-`600` environment
  files without exposing the token in logs.
- Backed up the live database to
  `/home/richard/fleebee/backups/fleebee-before-data-sync-20260926-131900.db`.
- Backed up the preceding live environment to
  `/home/richard/fleebee/backups/env-before-data-sync-20260926-131959`.
- Deployed the backend, frontend, and worker; the additive Prisma schema update
  and client generation completed successfully during service restart.

### First production synchronization

- The two-day scheduler automatically launched the first run after restart.
- Run `a86fa5d7-34f5-431c-99c1-054127ef1e1c` completed with:
  - 13 members
  - 122 payments
  - 11 Dashboard rows
  - 12 linked accounting members
  - 0 created bikers
  - 0 created bikes
  - 0 conflicts
- The imported Dashboard snapshot selected `2026-09-30` and stored:
  - monthly due: `RWF 1,465,000`
  - paid in month: `RWF 674,750`
  - remaining monthly balance: `RWF 790,250`
  - paid by selected date: `RWF 4,539,750`
  - due by selected date: `RWF 5,695,000`
  - overall balance: `RWF 1,201,250`

### Current state

- Fleebee is active and `/health` returns `ok`.
- Data Dashboard and Payments are deployed and redirect unauthenticated access
  to login as expected.
- The automatic interval remains the requested two-day default.

## 2026-10-26 — Repaired scheduled sync and imported two replacement members

### Completed

- Investigated the live two-day scheduler and found that it was still firing,
  but every attempt since `2026-10-04` failed because the Payments header moved
  from its original fixed row.
- Changed the worker to read `Payments!A1:F5000` and locate the `Payment date`
  header dynamically while retaining absolute Sheet row numbers.
- Added normalization for numeric Rwanda phone cells that lose their leading
  zero in Google Sheets.
- Added safe active-replacement handling for plates owned by bikers already
  marked inactive. The existing Bike is transferred instead of duplicated;
  plates owned by active bikers remain conflicts.
- Backed up production before the repair to
  `/home/richard/fleebee/backups/fleebee-before-data-sync-repair-20261026-205000.db`.
- Deployed the worker/backend repair and ran a successful production sync.
- Explicitly persisted `data_sync_interval_days=2` in production.

### Verification and current state

- Parser tests, JavaScript syntax checks, and an isolated SQLite replacement
  integration test pass.
- Production run `15c52d60-d935-4fd8-bf30-375d3f7cbbcb` completed with:
  - 15 members
  - 168 payments
  - 12 Dashboard rows
  - 1 created biker
  - 0 created bikes
  - 0 conflicts
- `Shumbusho Josue` is active, uniquely present, and linked to existing Bike
  `RM724T`. His first imported contribution is `RWF 31,250`, paid by BK agent
  on `2026-10-19`.
- `Haragirimana Emmanuel` is active, uniquely present, and linked to existing
  Bike `RL481U`. His normalized phone is `0782357977`; no payment is recorded
  for him yet.
- The next automatic sync is scheduled for `2026-10-28 20:42:49`
  Africa/Kigali, two days after the completed run.
- The original Google authentication blocker is resolved.
