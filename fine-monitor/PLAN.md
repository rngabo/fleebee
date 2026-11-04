# Fine Monitor Architecture Plan

## Status and scope

This document defines the implementation plan for the root-level
`fine-monitor/` microservice. As of `2026-09-19`, the all-plate vertical slice
is implemented and deployed: schema, private ingestion routes, sequential
Playwright worker, protected operator controls, daily/weekly scheduler,
ranked statistics, grouped contravention table, and live production results.

The first release must:

1. read every eligible Fleebee bike plate and its linked biker
2. check each plate once per day through the visible Irembo traffic-fines form
3. use the same configured taxpayer number for every plate
4. store fines without duplicating a ticket found on later runs
5. record a successful no-fine result separately from a scraper failure
6. show the latest normalized findings on a protected Fleebee page

The first release must not:

- pay or select a fine for payment
- bypass CAPTCHA, rate limits, access controls, or other anti-bot measures
- call Irembo's private `/irembo/rest/` endpoints directly
- expose the taxpayer number to the browser, Fleebee API responses, logs, or Git
- automatically notify bikers by SMS merely because a fine was scraped
- let the scraper write directly to Fleebee's SQLite database

## Source and automation policy

Target page:

- `https://irembo.gov.rw/user/citizen/service/rnp/traffic_fines`

The page is a JavaScript-rendered Angular application. Its public HTML only
loads the application shell, so HTTP/HTML-only scraping is not sufficient.

Irembo's `robots.txt`, checked on `2026-09-19`, allows regular pages and
disallows `/irembo/rest/`. The implemented integration therefore uses Playwright
to operate the same visible form as a user. Before production activation, the
owner must confirm that this recurring lookup is authorized for the supplied
plates and taxpayer number and is consistent with Irembo's current terms.

If Irembo provides an official API or partner integration later, prefer it over
browser automation.

## Component boundary

```text
Fleebee browser
    |
    | authenticated same-origin requests
    v
Fleebee backend :4100 --------------------> Fleebee SQLite
    |    ^                                        |
    |    | private service-token API              | bikes, bikers,
    |    |                                        | fines, check runs
    v    |
fine-monitor one-shot process
    |
    | controlled sequential Playwright checks
    v
Visible Irembo traffic-fines page
```

Ownership rules:

- Fleebee remains the system of record for bikes, bikers, contraventions, and
  check history.
- The Fleebee backend owns manual/scheduled launch coordination and the stored
  daily/weekly frequency. `fine-monitor` owns browser automation, parsing,
  request spacing, and temporary diagnostic artifacts.
- The browser never calls `fine-monitor` directly.
- `fine-monitor` never opens the Fleebee SQLite file.
- Communication between the two services uses a private, versioned JSON API
  authenticated with a dedicated service token.

## Proposed folder shape

```text
fine-monitor/
  README.md
  PLAN.md
  package.json
  .env.example
  src/
    config.js
    fleebee-client.js
    irembo-scraper.js
    parse-result.js
    run-once.js
  test/
    fixtures/
    parse-results.test.js
    run-coordinator.test.js
```

The deployed worker is a one-shot Node.js process rather than a second public
HTTP server. The Fleebee backend launches it with an explicit executable,
script, and protected environment path; no additional port is exposed.

## Configuration and secrets

Planned environment values:

```dotenv
FLEEBEE_BASE_URL=http://127.0.0.1:4100
FINE_MONITOR_SERVICE_TOKEN=replace-with-a-long-random-token
IREMBO_TIN=set-only-in-the-live-environment
FINE_MONITOR_PLATE=
FINE_CHECK_DELAY_MIN_MS=3000
FINE_CHECK_DELAY_MAX_MS=7000
FINE_CHECK_PAGE_TIMEOUT_MS=60000
```

Rules:

- Commit only `.env.example`, never the live taxpayer number or service token.
- Validate the taxpayer number at startup but never print it.
- Redact taxpayer numbers, service tokens, cookies, and form values from logs.
- Store the live environment outside the release directory with restrictive
  file permissions, following the existing home-computer deployment pattern.

## Plate selection

The Fleebee backend should return bike records that have:

- a non-empty `Bike.plateNumber`
- a valid linked `Biker`
- a stable `bikeId` and `bikerId`

Normalize each plate to uppercase and remove spaces used only for display.
Deduplicate normalized plates inside a run. If two active bike records claim the
same plate but link to different bikers, mark that target as a data conflict and
do not query Irembo until the operator resolves it.

The initial default is to check every registered `Bike` with a plate, not only
bikes whose biker is currently eligible for SMS notifications.

## Browser workflow for one plate

Use one browser context per run and process plates sequentially. Do not run
parallel Irembo queries.

1. Navigate to the target page and wait for the Angular form to become ready.
2. Select the radio input with `value="PLATE_NUMBER"`.
   - Fallback: locate the radio through the visible label `Nomero ya Pulaki`.
   - Do not depend on generated IDs such as `mat-radio-2`.
3. Wait for both conditional inputs to become visible.
4. Fill `input[formcontrolname="plateNumberFormControl"]` with the normalized
   plate.
5. Fill `input[formcontrolname="taxpayerNoFormControl"]` with the configured
   taxpayer number.
6. Wait for the form's search button to become enabled, then click it.
7. Wait for exactly one terminal outcome:
   - at least one result row inside `div.table-container mat-table`
   - a danger alert containing
     `Iki kinyabiziga nta konterevasiyo gifite.`
   - a known validation error, CAPTCHA/anti-bot challenge, or timeout
8. Parse all result rows before moving to the next plate.
9. Clear/reset the form, wait a randomized delay, and continue.

Selector priority:

1. semantic form attributes such as `formcontrolname` and input `value`
2. column classes such as `cdk-column-ticketNumber`
3. role plus visible text
4. structural selectors scoped to the result table

Never depend primarily on Angular-generated element IDs, `ng-star-inserted`, or
the exact order of general-purpose CSS classes.

## Parsing and normalization

For every table row, collect:

- `ticketNumber` from `cdk-column-ticketNumber`
- `issuedDate` from `cdk-column-ticketIssuanceDate`
- `dueDate` from `cdk-column-ticketValidityDate`
- `reason` from `cdk-column-ticketDescription`
- `amountDisplay` from `cdk-column-ticketAmount`

Add the known Fleebee context:

- `bikeId`
- `bikerId`
- `bikerName`
- normalized `plateNumber`

Normalize dates to `YYYY-MM-DD`. Normalize money into integer Rwandan francs
and preserve `RWF` as the currency while retaining the original display string
for audit/debugging. Reject a result row rather than silently storing it if its
ticket number, issued date, reason, or amount cannot be parsed.

The ticket number is the primary external idempotency key. If Irembo ever omits
it, use a documented fallback hash of plate, issued date, due date, normalized
reason, and amount; flag such records for review.

## Outcome semantics

Every plate check must finish in one of these states:

- `FOUND`: one or more valid table rows were parsed
- `CLEAR`: the explicit no-contravention alert was observed
- `FAILED`: the form, network, page, validation, CAPTCHA, or parser failed
- `SKIPPED`: invalid/duplicate plate data or a run-level circuit breaker stopped
  the check

Important behavior:

- `CLEAR` may mark previously open scraped fines for that plate as no longer
  reported, but it must not delete history.
- `FAILED` and `SKIPPED` must never clear or resolve existing fines.
- A run is not globally successful merely because some plates succeeded.
- The UI must not show `No contraventions` when the latest check actually failed.

## Fleebee data model changes

Extend the existing `Fine` model instead of creating a second independent fines
table. Preserve current manually entered fine behavior.

Planned additive fields include:

- `source` (`manual` or `irembo`)
- `externalTicketNumber` (nullable for legacy/manual records)
- `currency` (default `RWF`)
- `amountRwf` (integer normalized amount)
- `firstSeenAt`
- `lastSeenAt`
- `lastCheckedAt`
- `isCurrentlyReported`
- `resolvedAt` (nullable; status observation, not proof of payment)

Add a unique constraint for Irembo ticket identity. Existing `amount`, `reason`,
`fineDate`, `paymentDeadline`, bike, and biker relations remain available for
the current workflow and display code.

Add `FineCheckRun` and `FineCheckTargetResult` records for operational truth:

- run id, trigger, status, start/end timestamps, and target/found/clear/failure
  counts
- per-bike result state, checked timestamp, fine count, safe error code/message,
  and retry count

Do not store the taxpayer number, browser cookies, or full page HTML in these
tables.

## Private service API

All routes in this section require a dedicated bearer token and should only be
reachable from loopback or the private deployment network.

### Get targets

`GET /api/internal/fine-monitor/v1/targets`

Response fields per target:

```json
{
  "bikeId": "bike-id",
  "bikerId": "biker-id",
  "bikerName": "Example Biker",
  "plateNumber": "RL812Q"
}
```

### Start a run

`POST /api/internal/fine-monitor/v1/runs`

The backend returns a unique `runId` and the immutable target snapshot for that
run. Starting a second daily run while one is active returns `409`.

### Post one target result

`PUT /api/internal/fine-monitor/v1/runs/:runId/targets/:bikeId`

This is an idempotent upsert containing `FOUND`, `CLEAR`, `FAILED`, or `SKIPPED`
and zero or more normalized fine rows. Backend ingestion owns validation,
ticket deduplication, transactions, and fine lifecycle updates.

### Complete a run

`POST /api/internal/fine-monitor/v1/runs/:runId/complete`

The backend derives final counts from stored target results rather than trusting
client-supplied totals.

The scraper must not use the existing operator `POST /api/fines` route because
that route can trigger SMS notifications and does not provide external-ticket
idempotency.

## Operator API and frontend

Add a session-protected endpoint owned by Fleebee:

- `GET /api/contraventions`

It returns normalized fine rows plus latest-run health and freshness metadata.
The frontend continues to use same-origin Fleebee requests.

Create `flee-frontend/public/contraventions.html` with page title
`Contraventions`. Add a sidebar link named `Check fines` under `Operations`,
immediately below `Bundle Check`, on every page that contains the shared
sidebar markup.

The primary table displays exactly the requested operator fields:

- Plate number
- Biker name
- Issued date
- Due date
- Reason
- Amount

Store the ticket number for deduplication and make it available as secondary
detail, even if it is not a primary table column.

The page also shows a ranked biker statistics table, per-biker totals, the
overall RWF total, latest run health, and a daily/weekly selector. `Refresh`
launches a server-side run, shows a loader, remains disabled while the browser
polls, and cannot bypass the backend's active-run lock. No payment action or
taxpayer number is exposed.

## Scheduling, retries, and load control

- Run daily or weekly, selected by an authenticated operator. The next run is
  anchored to the last completed attempt.
- Allow only one active run.
- Check plates sequentially with randomized delays between requests.
- Retry a transient page/network failure at most twice with exponential backoff.
- Do not retry an explicit `CLEAR` result or a successfully parsed `FOUND` result.
- Stop the run with a circuit breaker after repeated site-wide failures or any
  CAPTCHA/anti-bot challenge. Do not attempt evasion.
- Resume safely using the stored run/target state rather than duplicating fines.

## Security, privacy, and diagnostics

- Keep both Fleebee dashboard authentication and the internal service token.
- Bind the microservice to loopback and firewall it from public access.
- Never log raw taxpayer numbers, cookies, authorization headers, or full form
  payloads.
- Log plate number only where operationally necessary; otherwise prefer bike id
  and a masked plate.
- Save screenshots/traces only for failed checks, behind a configuration flag,
  with restrictive permissions and short retention. Clear sensitive form values
  before capture where possible.
- Escape all Irembo text before rendering it in the Fleebee page.
- Rotate the service token independently from dashboard and Android secrets.

## Observability

Fleebee is the authoritative source for operator-visible run history and worker
process state. The one-shot worker exposes no HTTP listener.
Structured logs should include run id, bike id, outcome, duration, retry count,
and safe error code. Alert when no successful daily run has completed within
26 hours.

## Deployment plan

On the home computer:

- install Playwright and its Chromium runtime in a versioned service directory
- let the existing unprivileged Fleebee service launch one-shot workers
- keep its environment outside the synced release tree
- enable restart-on-failure with bounded backoff
- start it only after Fleebee is healthy
- do not expose a new port in Caddy or router forwarding

If Fleebee moves to a cloud VM, budget for Playwright/Chromium memory as well as
the Node backend. Validate the Irembo page from the selected cloud region before
migration because site access rules may differ by network or geography.

## Testing strategy

1. Parser unit tests with sanitized HTML fixtures for:
   - one fine
   - multiple fines
   - explicit no-fine alert
   - malformed/missing cells
   - unexpected amount and date formats
2. Browser-flow integration tests against a local fixture page that reproduces
   the relevant Angular DOM states.
3. Backend contract tests for token rejection, idempotent retries, ticket
   deduplication, and `CLEAR` versus `FAILED` lifecycle behavior.
4. Frontend tests for found, empty, stale, partial, and failed states.
5. A controlled live canary with one authorized plate before enabling the daily
   schedule for all plates.

Do not run live Irembo checks in normal CI.

## Delivery phases

### Phase 0: authorization and live reconnaissance

- confirm authorization and current Irembo terms
- manually verify one authorized plate flow and terminal states
- confirm CAPTCHA/rate-limit behavior without bypassing it
- save sanitized fixtures, never production credentials

### Phase 1: contracts and storage

- add backward-compatible Prisma fields and check-run models
- add authenticated internal API routes
- add operator contraventions read endpoint
- add idempotency and lifecycle tests

### Phase 2: scraper microservice

- scaffold the root `fine-monitor/` package
- implement Playwright locators and parsing
- implement sequential coordination, delays, retries, and circuit breaker
- implement safe structured logging and health endpoints

### Phase 3: dashboard

- add `contraventions.html`
- add `Check fines` under `Operations` below `Bundle Check` across all sidebars
- render the required six columns and run-health states

### Phase 4: controlled deployment — complete

- deploy without the daily schedule and run one authorized canary
- compare stored data with the visible Irembo table
- daily scheduling and the operator-selectable weekly option are enabled
- monitor for at least several runs before considering optional notifications

## Acceptance criteria

- Every eligible unique plate receives one terminal result per completed run.
- Multiple returned table rows are all stored and displayed.
- Re-running the same ticket does not create another fine.
- A `CLEAR` response is visible as a successful check and never confused with a
  failure.
- A failed check does not resolve or delete previously found fines.
- The dashboard shows plate, biker, issued date, due date, reason, and amount.
- The TIN and service token never appear in browser responses, logs, Git, or the
  Fleebee database.
- No SMS is created by scraper ingestion in the first release.
- CAPTCHA or anti-bot detection stops safely and produces an operator warning.
