# CODEBASE_UPGRADE_PLAN.md

Code-review-driven upgrade plan for the Fleebee Management project.

This plan focuses on five directions:

- improve the architecture
- remove flaky text-reading paths
- delete or replace non-useful tests
- unify duplicated abstractions
- use a safer phase-gated workflow for upgrades

Working assumption for this plan:

- the browser dashboard is the real operator control plane
- the Android app should be the SMS gateway worker, not a second operator-facing system

If that assumption is wrong, Phase 1 should branch into "backend-driven Android companion UI"
instead of removing legacy operator flows from the phone app.

## Review Findings

### 1. The codebase currently has two monoliths and two control-plane shapes

`fllee-backend/src/app.js` is only about 330 lines, but it already mixes too many concerns:

- static asset file serving:
  `fllee-backend/src/app.js:41`
- config script serving:
  `fllee-backend/src/app.js:74`
- dashboard and CRUD routing:
  `fllee-backend/src/app.js:132`
  `fllee-backend/src/app.js:137`
  `fllee-backend/src/app.js:171`
  `fllee-backend/src/app.js:200`
- gateway job claim/result flow:
  `fllee-backend/src/app.js:229`
  `fllee-backend/src/app.js:243`
- phone heartbeat and bundle APIs:
  `fllee-backend/src/app.js:263`
  `fllee-backend/src/app.js:288`

At the same time, `flee-frontend/public/assets/js/app.js` is about 1.9k lines and mixes:

- API transport:
  `flee-frontend/public/assets/js/app.js:299`
- global UI state and DOM wiring:
  `flee-frontend/public/assets/js/app.js:36`
  `flee-frontend/public/assets/js/app.js:63`
- bundle parsing and rendering:
  `flee-frontend/public/assets/js/app.js:522`
  `flee-frontend/public/assets/js/app.js:598`
- SMS table rendering:
  `flee-frontend/public/assets/js/app.js:798`
- schedule rendering:
  `flee-frontend/public/assets/js/app.js:862`
- compose/send orchestration:
  `flee-frontend/public/assets/js/app.js:1320`

That means the backend and frontend both have a "main file that knows everything" problem.

There is also a control-plane mismatch in the Android app:

- `android-app/app/src/main/java/com/salvi/fleebeemanagement/data/FleetRepository.kt:6`
  still holds hard-coded biker data
- `android-app/app/src/main/java/com/salvi/fleebeemanagement/ui/compose/ComposeMessageFragment.kt:150`
  sends SMS directly with `SmsManager`
- that bypasses the backend queue, pending-review window, duplicate protection, and truthful
  dispatch history

### 2. The bundle/text-reading path is brittle end to end

The current bundle feature depends on raw carrier text surviving three different interpretations:

- Android collects raw USSD text and mostly keeps the first line:
  `android-app/app/src/main/java/com/salvi/fleebeemanagement/sync/GatewayBundleMonitor.kt:33`
  `android-app/app/src/main/java/com/salvi/fleebeemanagement/sync/GatewayBundleMonitor.kt:133`
- backend stores summary/details/error strings, but not structured bundle fields:
  `fllee-backend/prisma/schema.prisma:63`
  `fllee-backend/src/services/phone-service.js:13`
  `fllee-backend/src/services/phone-service.js:190`
- frontend regexes raw text for one expected carrier format:
  `flee-frontend/public/assets/js/app.js:516`
  `flee-frontend/public/assets/js/app.js:522`
  `flee-frontend/public/assets/js/app.js:558`

Two flake patterns stand out:

- Android timeouts or response-shape changes collapse into generic `error` without structured parse
  diagnostics:
  `android-app/app/src/main/java/com/salvi/fleebeemanagement/sync/GatewayBundleMonitor.kt:54-113`
- the dashboard only recognizes patterns like `123 SMS. EXP 2026-07-31` and
  `Data:15360MB EXP:2026-07-30`, so even a small spacing or wording change can make the card show
  "Not found" while a real response still exists:
  `flee-frontend/public/assets/js/app.js:525-533`

### 3. The current tests are mostly absent, and the only real ones are placeholders

There is no first-party backend test script in:

- `fllee-backend/package.json:6`

There is no frontend test script in:

- `flee-frontend/package.json:6`

The Android module includes only placeholder tests:

- `android-app/app/src/test/java/com/salvi/fleebeemanagement/ExampleUnitTest.kt:6`
- `android-app/app/src/androidTest/java/com/salvi/fleebeemanagement/ExampleInstrumentedTest.kt:10`

Those tests only verify `2 + 2 == 4` and the package name. They create false confidence and
should not survive a serious upgrade track.

### 4. Small abstractions are duplicated enough to drift

Concrete duplicates already in the repo:

- message-body normalization:
  - `fllee-backend/src/services/message-service.js:17`
  - `fllee-backend/src/services/scheduled-message-service.js:20`
- browser config script generation:
  - `fllee-backend/src/config/browser-config.js:3`
  - `flee-frontend/src/config/browser-config.js:3`
- MIME type lookup:
  - `fllee-backend/src/server/mime-types.js:3`
  - `flee-frontend/src/server/mime-types.js:1`
- static file server helpers:
  - `fllee-backend/src/app.js:41`
  - `flee-frontend/src/server.js:9`

Each duplicate is individually small, but together they create behavioral drift and extra review
surface.

### 5. The upgrade workflow is not yet strong enough for safe refactors

Current signals:

- there is no `.github/workflows/` validation pipeline in this repo
- backend and frontend do not expose `test` scripts
- Android only exposes the default unit/instrumentation scaffolding:
  `android-app/app/build.gradle.kts:44`
  `android-app/app/build.gradle.kts:77`

That makes large changes tempting to batch together, which is exactly what we should avoid in a
codebase that controls real SMS dispatch.

## Upgrade Targets

By the end of this upgrade track, the codebase should have:

- one clear control plane: browser dashboard + backend
- one clear worker plane: Android gateway app
- backend routes split by domain instead of one router file
- frontend modules split by workflow instead of one huge browser script
- structured bundle parsing owned by the backend, not by dashboard regexes
- placeholder tests removed
- a small deterministic test suite around the highest-risk pure logic
- one reusable home for normalization, browser-config, and static-serving helpers
- a repeatable workflow with CI and phase exit gates

## Recommended Target Architecture

### Backend target split

Keep the HTTP API stable while moving code behind domain seams:

- `fllee-backend/src/routes/dashboard-routes.js`
- `fllee-backend/src/routes/biker-routes.js`
- `fllee-backend/src/routes/message-routes.js`
- `fllee-backend/src/routes/schedule-routes.js`
- `fllee-backend/src/routes/gateway-routes.js`
- `fllee-backend/src/routes/phone-routes.js`
- `fllee-backend/src/services/bundle-parser.js`
- `fllee-backend/src/services/normalization.js`

`fllee-backend/src/app.js` should shrink into server bootstrap + route registration only.

### Frontend target split

Split `flee-frontend/public/assets/js/app.js` by responsibility:

- `public/assets/js/api.js`
- `public/assets/js/state.js`
- `public/assets/js/pages/home.js`
- `public/assets/js/pages/sms.js`
- `public/assets/js/pages/settings.js`
- `public/assets/js/bundle/view-model.js`
- `public/assets/js/compose/workflow.js`

The browser should render structured bundle fields from the backend instead of parsing raw carrier
text itself.

### Android target split

Treat the Android app as a gateway worker plus a small diagnostics shell:

- keep:
  `sync/`
  permission setup
  service status
  bundle-check trigger/diagnostics if needed
- remove or quarantine:
  hard-coded biker repository
  local operator dashboard
  direct SMS compose flow that bypasses the backend

### Data model target

Extend `PhoneState` or add a related bundle snapshot model so the backend stores both:

- raw carrier text for audit/debugging
- structured parse output for the dashboard

Suggested structured fields:

- `smsRemaining`
- `smsExpiryDate`
- `dataRemainingMb`
- `dataExpiryDate`
- `parseVersion`
- `parseWarnings`

## Work Plan

### Phase 0 - Stabilize the workflow before refactoring

Goals:

- make the repo safe for incremental change
- stop fake tests from looking like meaningful coverage
- define one validation path for every phase

Work:

- add a repo-level validation workflow:
  - local: `scripts/validate.sh` or `make validate`
  - CI: `.github/workflows/validate.yml`
- delete the placeholder Android tests:
  - `ExampleUnitTest.kt`
  - `ExampleInstrumentedTest.kt`
- add temporary syntax gates until better tests exist:
  - `node --check fllee-backend/server.js`
  - `node --check fllee-backend/src/app.js`
  - `node --check flee-frontend/src/server.js`
  - `node --check flee-frontend/public/assets/js/app.js`
- add real command wrappers so later phases can use:
  - `npm --prefix fllee-backend test`
  - `npm --prefix flee-frontend test`
  - `./android-app/gradlew testDebugUnitTest`
- document the phase checklist in `progress.md`

Exit gate:

- fake tests are gone
- CI exists
- every phase has one shared validation command list

### Phase 1 - Collapse the control-plane mismatch

Goals:

- keep the browser dashboard as the source of truth
- stop the Android app from owning a parallel operator workflow
- make backend responsibilities easier to split

Work:

- remove or isolate `FleetRepository` and the local compose/dashboard screens from the Android app
- if a phone UI is still needed, convert it into diagnostics backed by gateway health, not fake biker
  data
- split `fllee-backend/src/app.js` into domain route modules while preserving current endpoints
- decide whether the standalone frontend dev server should survive
  `flee-frontend/src/server.js`
  or whether backend-served static assets are the only supported runtime

Priority hotspots:

- `fllee-backend/src/app.js:82-325`
- `android-app/app/src/main/java/com/salvi/fleebeemanagement/data/FleetRepository.kt:6-70`
- `android-app/app/src/main/java/com/salvi/fleebeemanagement/ui/compose/ComposeMessageFragment.kt:42-177`

Exit gate:

- Android no longer sends operator messages directly through `SmsManager`
- backend route definitions are split by domain
- browser UI behavior is unchanged from the user perspective

### Phase 2 - Make bundle reading deterministic

Goals:

- remove dashboard regex dependency on raw carrier text
- make parse failures visible and testable
- keep raw responses for debugging without making them the runtime contract

Work:

- add a backend-owned `bundle-parser` module
- parse raw USSD replies into structured fields on the backend
- version the parser so changes are traceable
- keep raw `summary/details/error` fields for audit/debugging only
- change the dashboard to render backend structured fields first and raw text second
- add fixture files with real anonymized carrier responses and expected structured outputs
- report parse warnings when a response is partially understood instead of silently showing
  "Not found"

Priority hotspots:

- `android-app/app/src/main/java/com/salvi/fleebeemanagement/sync/GatewayBundleMonitor.kt:60-113`
- `fllee-backend/src/services/phone-service.js:13-51`
- `flee-frontend/public/assets/js/app.js:516-630`

Exit gate:

- at least 3 representative carrier response fixtures parse consistently
- the dashboard no longer depends on `extractBundleHighlights(...)` regexes for the primary view
- parse failures surface as diagnostics, not silent empty values

### Phase 3 - Replace fake confidence with useful tests

Goals:

- cover pure logic that can fail silently
- keep tests deterministic and local

Work:

- add backend unit tests for:
  - `normalizeMessageBody`
  - duplicate-message detection rules
  - bundle parser fixture outputs
  - schedule date math
- add frontend unit tests for:
  - bundle view-model formatting
  - expiry alert logic
- add Android unit tests only for logic that remains on-device:
  - gateway config helpers
  - service-side decision helpers
- avoid live-network or real-SMS tests inside the normal automated suite

First test targets:

- `fllee-backend/src/services/message-service.js:17-25`
- `fllee-backend/src/services/scheduled-message-service.js:27-139`
- `flee-frontend/public/assets/js/app.js:537-583`

Exit gate:

- placeholder tests are replaced by deterministic logic tests
- the highest-risk parsing/date logic has fixture coverage

### Phase 4 - Unify duplicated abstractions

Goals:

- stop copying small helpers across backend and frontend runtimes
- reduce drift in normalization and config behavior

Work:

- extract backend shared helpers:
  - `src/lib/normalization.js`
  - `src/lib/http-response.js`
  - `src/lib/static-assets.js`
- either share or delete duplicate browser-config builders
- either share or delete duplicate MIME-type tables
- move message and schedule normalization to one backend helper module
- remove unused duplicate server code paths where backend serving already replaces them

Priority duplicates:

- `message-service.js:17-25`
- `scheduled-message-service.js:20-25`
- `fllee-backend/src/config/browser-config.js:3-17`
- `flee-frontend/src/config/browser-config.js:3-15`
- `fllee-backend/src/server/mime-types.js:3-13`
- `flee-frontend/src/server/mime-types.js:1-12`

Exit gate:

- each duplicated helper family has one owner
- route/static/config behavior matches before and after consolidation

### Phase 5 - Finish the workflow and keep refactors small

Goals:

- make future cleanup cheaper than it is today
- prevent the codebase from drifting back into the same shape

Work:

- require one domain-focused change per branch or PR
- keep frontend modularization and backend modularization in separate branches
- require fixture updates when bundle parsing changes
- require `progress.md` updates after each completed phase
- add a short manual smoke checklist for real operations:
  - queue a manual SMS
  - edit/delete a pending SMS
  - let a scheduled SMS fire
  - claim/send from the Android phone
  - run one bundle refresh

Exit gate:

- CI and local workflow agree
- manual smoke steps are documented
- future refactors have clear seams and validation rules

## Keep / Remove Decisions

Keep:

- backend as the source of truth for bikers, messages, schedules, phone state, and dispatch results
- Android foreground service, heartbeat flow, job claim flow, and SMS result reporting
- raw USSD response storage for diagnostics

Remove or shrink:

- placeholder Android tests
- hard-coded Android biker repository
- Android direct-send compose flow that bypasses the backend
- frontend raw-text bundle regexes as the primary parsing path
- duplicated config/static helper implementations where one source of truth is enough

## Recommended Phase Order

Do not combine these in one branch:

1. workflow + delete fake tests
2. Android control-plane cleanup
3. backend route split
4. bundle parser move
5. frontend module split
6. helper unification

That order keeps the riskiest behavior changes isolated and makes regressions easier to pinpoint.
