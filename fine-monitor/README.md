# Fine Monitor

`fine-monitor` checks registered Fleebee bike plates through the visible Irembo
traffic-fines form and posts normalized results back to Fleebee.

Current status: **all-plate checks and configurable scheduling are deployed**.

The worker:

- obtains plate numbers and linked biker names from the Fleebee backend
- uses the configured taxpayer number only inside the protected worker process
- operates the visible Irembo form with Playwright
- processes plates sequentially with randomized delays
- distinguishes fines found, confirmed clear plates, and failed checks
- deduplicates findings by Irembo ticket number
- stops rather than bypassing a CAPTCHA or anti-automation challenge
- never creates automatic SMS messages for scraped fines

The Fleebee backend launches the worker when an authenticated operator clicks
`Refresh` and polls the stored daily/weekly schedule once per minute. The
frequency is selected on the session-protected `Contraventions` page. Only one
run may be active at a time. The default and current production frequency is
weekly.

## Production configuration

The backend reads worker-launch paths from `/home/richard/fleebee/shared/.env`.
The worker reads its backend URL, shared service token, TIN, optional plate
scope, and scrape timing from `/home/richard/fleebee/shared/fine-monitor.env`.
Both files must remain outside the release tree and must not be printed or
committed.

`FINE_MONITOR_PLATE` controls rollout scope:

- blank: check every eligible registered plate
- a normalized plate such as `RL812Q`: check only that canary plate

## Manual worker command

```bash
FINE_MONITOR_ENV_FILE=/home/richard/fleebee/shared/fine-monitor.env \
  /home/richard/fleebee/runtime/node/bin/node \
  /home/richard/fleebee/current/fine-monitor/src/run-once.js
```

Normal operator use should go through `Operations` -> `Check fines` ->
`Refresh`, which displays a loader and remains disabled until the recorded run
finishes.

## First all-plate result

The production validation run on `2026-09-19` attempted 13 plates and returned:

- 11 current contravention records
- 3 explicitly clear plates
- 1 failed plate/TIN match (`RM777T`, retained as a failure rather than clear)
- total current amount: `RWF 141,000`
- run status: `PARTIAL`

The detailed architecture, contracts, safety rules, and acceptance criteria are
in [PLAN.md](./PLAN.md).
