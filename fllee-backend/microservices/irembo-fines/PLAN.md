# Irembo Fines Microservice Plan

## Goal

Automate traffic fine checks so Fleebee can regularly inspect Irembo fine status for each bike and turn matching results into fine records and recipient warnings.

## Target source

- `https://irembo.gov.rw/user/citizen/service/rnp/traffic_fines`

## Expected inputs

- operator TIN
- bike plate number
- optional schedule or poll interval

## Expected outputs

- detected fine amount
- fine reason
- due date or payment deadline if present
- raw source snapshot for audit
- status of the check attempt

## Phase plan

### Phase 1

- document login and anti-bot constraints
- confirm whether scraping is technically and legally acceptable
- define the exact selector or API strategy
- define secure storage for TIN and any session credentials

### Phase 2

- create a standalone service that:
  - loads the configured bikes
  - checks fines for each eligible plate
  - stores raw check results
  - returns normalized fine records

### Phase 3

- connect the service to Fleebee backend routes or a worker queue
- deduplicate repeated fines
- auto-create `Fine` records in the main database
- trigger workflow notifications for new fines only

### Phase 4

- add dashboard visibility:
  - last check time
  - success or failure status
  - newly found fines
  - unresolved scraping or login issues

## Important concerns

- credential security
- rate limiting
- website layout changes
- captcha or anti-automation measures
- duplicate fine detection
- audit logging for every automated check

## Recommended implementation boundary

Keep this as a separate service so:

- scraping failures do not block the main Fleebee backend
- credentials can be isolated
- retries and rate limits can be managed separately
