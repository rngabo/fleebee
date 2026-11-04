# Data Sync Architecture

## Purpose

The Data Sync microservice imports the operational accounting data currently
entered in the Google Sheet identified by `GOOGLE_SPREADSHEET_ID`. It is a
read-only Sheet consumer. Fleebee remains the application database and never
writes back to the source workbook.

The first supported tabs are exactly:

- `Setup`
- `Payments`
- `Dashboard`

The uploaded `Accounting_MT-updated.xlsx` and the live Sheet were analyzed on
2026-09-26. They contain 13 populated Setup members, 122 Payments entries, and
11 active Dashboard rows for the selected September 2026 period.

## Runtime Flow

```text
Fleebee scheduler or operator Refresh
  -> one-shot data-sync worker
  -> Google Sheets API (read-only service account)
  -> parse and validate Setup, Payments, Dashboard
  -> private bearer-authenticated Fleebee API
  -> one SQLite transaction
  -> Data Dashboard and Payments pages
```

The backend launches one worker process at a time. The default interval is two
days and the operator can configure 1–30 days from `Data -> Dashboard`.

## Authentication and Secrets

The Sheet currently rejects anonymous CSV access with HTTP 401. Production must
therefore use a Google service account with read-only access:

1. Create a service account and JSON key.
2. Share the source Sheet with the service account's `client_email` as Viewer.
3. Store the JSON outside the release tree, mode `600`.
4. Set `GOOGLE_SERVICE_ACCOUNT_FILE` in the protected `data-sync.env`.
5. Use the same private `DATA_SYNC_SERVICE_TOKEN` in the backend and worker
   environments.

The worker creates its OAuth JWT and requests the
`spreadsheets.readonly` scope without a third-party runtime dependency.

The Payments reader requests a bounded `A1:F5000` range and discovers the
`Payment date` header instead of assuming a fixed row. Numeric nine-digit
Rwanda mobile values are restored to their ten-digit local form when Google
Sheets strips the leading zero.

## Database Model

### `DataSyncRun`

Operational history for manual and scheduled attempts, including imported row
counts, link/create counts, conflicts, status, timing, and errors.

### `DataMember`

Normalized Setup rows keyed by the Sheet's stable `Person ID`. It stores the
accounting contract fields and optional links to existing `Biker` and `Bike`
records.

The Sheet row is retained independently because inactive historical people can
share a plate with its current biker. For example, former rider Uwabakurikiza
Pacifique and current rider Sindikubwayo Jean Claude both appear with `RL812Q`.
The inactive historical row must not take ownership of the current Bike.

### `DataPayment`

Payments are keyed by a SHA-256 fingerprint of member, date, amount, method,
reference, and entered-by values, plus an occurrence number. This prevents
repeat sync duplication while preserving legitimate identical payment rows.
Rows removed from the source are marked `isPresent=false` instead of being
destroyed.

### `DataDashboardSnapshot` and `DataDashboardRow`

Each successful sync stores the evaluated Dashboard output, selected period,
totals, and member rows. Historical snapshots are preserved. The UI reads the
latest snapshot and reproduces the source Dashboard columns, including notes
and adjustments.

## Core Data Deduplication

The importer checks Fleebee before creating operational records:

1. exact normalized plate
2. exact normalized full name
3. unique normalized phone number

Active Sheet rows may create a missing Biker/Bike only when no identifier
conflicts and the phone number is valid for SMS. Existing core records are not
silently overwritten when the Sheet differs; the source value and match note
are stored for operator review. Inactive unmatched rows remain accounting-only
history.

When an active Sheet member reuses a plate whose current Fleebee owner is
already marked inactive, the importer treats it as an explicit replacement. It
links or creates the new active biker and transfers the existing Bike record;
it does not create a duplicate Bike. A plate owned by another active biker
remains a conflict and is never transferred automatically.

## Failure Semantics

- `COMPLETED`: all rows were validated and stored.
- `PARTIAL`: valid data was stored, but at least one record could not be linked
  or imported safely.
- `FAILED`: the Sheet could not be read or the import transaction failed.

One failed sync does not erase the last good dashboard snapshot or payment
history. A transaction prevents partial database writes within an import.

## API Boundary

Worker-only routes:

- `POST /api/internal/data-sync/v1/runs`
- `PUT /api/internal/data-sync/v1/runs/:runId/data`
- `POST /api/internal/data-sync/v1/runs/:runId/fail`

Session-protected operator routes:

- `GET /api/data/dashboard`
- `GET /api/data/payments`
- `POST /api/data/refresh`
- `PUT /api/data/interval`

## Deployment Shape

The worker is deployed under `data-sync/` with no `node_modules` requirement.
The protected runtime files live outside the release tree:

- `/home/richard/fleebee/shared/data-sync.env`
- `/home/richard/fleebee/shared/google-data-sync-service-account.json`

No new public port or continuously running microservice is introduced.
