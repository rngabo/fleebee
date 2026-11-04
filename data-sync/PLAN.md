# Data Sync Implementation Plan

## Phase 0 — Source Analysis

- [x] Inspect the uploaded workbook without treating cell instructions as user
      authorization.
- [x] Confirm the exact live tab names and sheet IDs.
- [x] Compare Setup identities against current production bikers and bikes.
- [x] Confirm anonymous access is unavailable and authenticated read-only access
      is required.

## Phase 1 — Data Contracts and Storage

- [x] Add sync-run history.
- [x] Add normalized Setup member storage linked to Biker/Bike.
- [x] Add idempotent payment storage.
- [x] Add immutable Dashboard snapshots and row storage.
- [x] Preserve inactive historical riders without changing current bike
      ownership.

## Phase 2 — Worker and Scheduling

- [x] Add a dependency-free Google service-account OAuth client.
- [x] Read only Setup, Payments, and Dashboard with bounded ranges.
- [x] Add parser validation and duplicate-safe payment keys.
- [x] Add private worker/backend API contracts.
- [x] Add one-active-process coordination.
- [x] Default automatic synchronization to every two days.
- [x] Allow an operator-configurable 1–30 day interval.

## Phase 3 — Operator UI

- [x] Add a `Data` left-menu category on every dashboard page.
- [x] Add `Data -> Dashboard` with source-style totals and rows.
- [x] Add `Data -> Payments` with all payments ordered by date.
- [x] Add manual Refresh on both Data pages.
- [x] Add interval configuration on the Data Dashboard.
- [x] Add source-to-Fleebee matching visibility.

## Phase 4 — Verification

- [x] Add parser tests for dates, source columns, and identical payments.
- [x] Validate Prisma schema generation.
- [x] Verify two identical syncs do not duplicate biker, bike, member, or
      payment rows in an isolated SQLite database.
- [x] Provision and share the Sheet with a production service account.
- [x] Run a production database backup and schema migration.
- [x] Deploy the worker/backend/frontend release.
- [x] Run the first authenticated production sync and compare all 13 Setup
      members, 122 payments, and 11 Dashboard rows with the Sheet.

## Acceptance Criteria

- The default schedule is two days.
- The operator can change the interval without editing environment files.
- Manual Refresh never overlaps an active sync.
- Repeating a sync does not duplicate payments or operational members.
- Historical inactive riders do not overwrite a current bike owner.
- Dashboard and Payments remain available from the last good snapshot if a
  future Sheet read fails.
