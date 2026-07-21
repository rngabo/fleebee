# Fleebee Progress Handoff

## Date
Updated on `2026-07-18`.

## Main Goal
Keep Fleebee working as a real remote SMS system:

- operator uses the web UI
- frontend talks to backend APIs
- backend coordinates messages and schedules
- Android phone app claims jobs and sends SMS with its SIM
- operator sees truthful final result

## Current Agreed Production Path

`Web UI -> Backend/UI on 192.168.1.50:4100 -> Android phone app -> SMS carrier -> recipient`

Public-hostname target now being prepared:

- `https://fleebee.esonga.online -> HTTPS reverse proxy on .50 -> Fleebee on 127.0.0.1:4100`

Important deployment assumptions:

- the real backend is `http://192.168.1.50:4100`
- the intended public hostname is `https://fleebee.esonga.online`
- the phone is supposed to work normally without USB
- USB/ADB is still important for app upgrades and recovery work
- the backend computer `.50` is the stable anchor on the network

## Current Live State

- `fleebee.service` is enabled on `.50`
- `adb-server.service` is enabled on `.50`
- `loginctl linger` is enabled for user `richard`
- the phone is reporting heartbeat back to the backend
- the phone can appear as an ADB `device` on `.50` after proper authorization
- the home computer now has a daily machine reboot scheduled at `21:00` local time through cron
- the live shared env on `.50` now sets:
  - `PUBLIC_APP_URL=https://fleebee.esonga.online`
  - `CORS_ALLOW_ORIGIN=https://fleebee.esonga.online`
- the live backend on `.50` now serves `/app-config.js` with `publicAppUrl=https://fleebee.esonga.online`
- the live backend on `.50` now returns API CORS as `https://fleebee.esonga.online`
- the backend still listens only on local port `4100`
- no live `80/443` reverse proxy has been installed yet

## Issues Solved

### 1. Scheduled SMS could stay stuck and status reporting was not truthful

Issue:

- earlier live tests showed messages getting stuck or ending with misleading status

How it was solved:

- synced the real backend/frontend deployment to `.50`
- pointed the Android app to the real backend on `.50`
- fixed Android SMS result handling so missing delivery receipts no longer become false `failed`
- rebuilt and reinstalled the APK

Result:

- the backend, phone app, and web UI now follow the same real queue flow
- message results are more truthful

### 2. Bundle and subscription information required manual phone checking with `*131#`

Issue:

- operator had to manually dial `*131#` on the phone to inspect SMS/data bundles

How it was solved:

- added automated USSD bundle checking in the Android app
- backend now stores the latest bundle response
- backend now exposes bundle status and next auto-check time to the dashboard

Result:

- Fleebee can now collect bundle information automatically and expose it in the web UI

### 3. Raw USSD response was too noisy for the homepage

Issue:

- the carrier reply was one long raw string and not useful for quick reading

How it was solved:

- parsed the stored raw response into the important visible items:
  - `984 SMS. EXP 2026-07-31`
  - `Data:15360MB EXP:2026-07-30`
- kept the full raw reply hidden behind a small details button

Result:

- homepage now shows only the important bundle values by default
- the operator can still reveal the full raw carrier text when needed

### 4. Manual bundle check button was exposed in the wrong place

Issue:

- the homepage should stay clean
- manual `Check now` should exist, but not directly on the main bundle summary card

How it was solved:

- removed the visible manual bundle trigger from the homepage card
- moved `Check now` to the SMS page above the dispatch password section
- added auto-check timing display under server health

Result:

- homepage is cleaner
- manual control still exists on the SMS page

### 5. Bundle expiry needed a clear warning before running out

Issue:

- operator needed a visible warning when SMS or data expiry is close

How it was solved:

- added a top red `Check phone bundles` alert next to the phone status badge
- alert appears when the latest stored SMS or data bundle expiry is within 2 days

Result:

- bundle expiry becomes visible before it becomes an operational problem

### 6. The home computer `.50` could see the phone only as MTP and not as an ADB device

Issue:

- when the phone was plugged into `.50`, it showed as Samsung MTP only
- `.50` did not have a working `adb`, so the phone could not enter the normal USB debugging trust flow

How it was solved:

- installed a user-local ADB runtime under `/home/richard/android-sdk-local`
- created wrapper command `/home/richard/bin/adb-home`
- created and enabled `adb-server.service` as a user service on `.50`

Result:

- `.50` can now run ADB locally
- USB debugging trust flow became possible from `.50`

### 7. USB debugging trust did not persist correctly after earlier tests

Issue:

- phone could return as `unauthorized`
- at one point `Always allow from this computer` had not been selected

How it was solved:

- aligned the ADB identity used on `.50`
- re-ran authorization flow
- explicitly accepted `Always allow from this computer` on the phone

Result:

- phone can appear as ADB `device` on `.50`
- remote app upgrade access is available again when the phone is plugged into `.50`

### 8. Needed proof that reboot recovery actually works, not just that services start once

Issue:

- after restart or power-cycle, it was unclear whether Fleebee and ADB would both come back cleanly

How it was solved:

- verified `fleebee.service` is enabled and active
- verified `adb-server.service` is enabled and active
- verified `linger=yes`
- performed reboot tests and confirmed successful recovery

Result:

- after a clean reboot, `.50` can come back with:
  - Fleebee running
  - ADB running
  - phone available as ADB `device`
  - backend heartbeat restored

### 9. Daily restart requirement was for the whole computer, not for Fleebee

Issue:

- a system-level nightly restart was requested
- this should be independent from Fleebee-specific service logic

How it was solved:

- removed the earlier Fleebee-specific reboot timer files
- replaced them with a plain root cron file:
  - `/etc/cron.d/nightly-system-reboot`
- installed cron entry:
  - `0 21 * * * root /sbin/shutdown -r now`

Result:

- the home computer is now scheduled to reboot every day at `21:00` Africa/Kigali time
- this reboot does not depend on Wi-Fi, Fleebee, or the laptop

### 10. Domain migration prep to `fleebee.esonga.online` was inconsistent across local config, live config, and docs

Issue:

- runtime config still used local-IP style URLs
- deployment examples still used wildcard CORS and `192.168.1.50:4100`
- the live home-computer env was still serving the old values even after local repo edits

How it was solved:

- updated local backend env to:
  - `PUBLIC_APP_URL=https://fleebee.esonga.online`
  - `CORS_ALLOW_ORIGIN=https://fleebee.esonga.online`
- updated `/home/richard/fleebee/shared/.env` on `.50` with the same values
- restarted `fleebee.service`
- verified on `.50` that:
  - `/app-config.js` now exposes `publicAppUrl=https://fleebee.esonga.online`
  - API responses now return `Access-Control-Allow-Origin: https://fleebee.esonga.online`
- updated deployment examples and docs to match the new hostname
- added `deploy/home-computer/Caddyfile.example` as the HTTPS reverse-proxy template

Result:

- Fleebee runtime and deployment docs now agree on `fleebee.esonga.online`
- the backend is prepared for the public hostname even though public HTTPS is not live yet

### 11. Home-computer deploy helper scripts were brittle under nested shell execution

Issue:

- helper scripts relied on stdin-fed SSH shell execution
- this made scripted restarts/sync less predictable in some runner contexts

How it was solved:

- updated deploy helpers to use explicit SSH options
- switched the remote script execution pattern to `ssh ... 'bash -s'`
- confirmed `restart-service.sh` and `sync-release.sh` work again from a non-login shell

Result:

- normal home-computer deployment helpers are more predictable for future sync/restart work

## Remaining Caveats

### 1. Cron reboot only helps if Linux is already alive

- if the machine fails before Linux fully boots, cron cannot help
- if the machine is frozen hard, cron may also not run

This is a hardware/boot-path caveat, not a Fleebee app issue.

### 2. AC-loss behavior may still depend on BIOS and hardware state

- during power-extension testing, there was a case where the fan stayed on until power was toggled again
- that points more to boot/power behavior than to Fleebee

Recommended non-app checks:

- BIOS setting like `Restore on AC Power Loss` or `After Power Failure` should be `Power On`
- avoid ultra-fast off/on toggles during AC testing
- a UPS would reduce weird half-boot situations

### 3. Samsung battery policy should remain friendly to the gateway app

- the dashboard still reminds that Samsung battery restrictions can interfere
- keep the gateway app on `Unrestricted` battery mode

### 4. `fleebee.esonga.online` is configured, but not yet browser-live end to end

- on `.50`, `getent hosts fleebee.esonga.online` already resolves to `41.216.122.219`
- from the laptop used in this session, the hostname was still not resolving yet
- `.50` is still listening only on `:4100`
- no process is yet listening on `:80` or `:443`
- public HTTPS still needs:
  - DNS propagation everywhere
  - router forwarding for ports `80` and `443`
  - a live reverse proxy such as Caddy using `deploy/home-computer/Caddyfile.example`

### 5. Public exposure should not happen with the current SMS password

- `SMS_SEND_PASSWORD=1234` is still present in the runtime env
- this is acceptable for current controlled testing, but should be replaced before public browser exposure

## Important Files

- [README.md](/home/richard/APPS/SALVI/2026/fleebee-management/README.md)
- [architecture.md](/home/richard/APPS/SALVI/2026/fleebee-management/architecture.md)
- [deploy/home-computer/README.md](/home/richard/APPS/SALVI/2026/fleebee-management/deploy/home-computer/README.md)
- [deploy/home-computer/Caddyfile.example](/home/richard/APPS/SALVI/2026/fleebee-management/deploy/home-computer/Caddyfile.example)
- [fllee-backend/src/services/phone-service.js](/home/richard/APPS/SALVI/2026/fleebee-management/fllee-backend/src/services/phone-service.js)
- [flee-frontend/public/assets/js/app.js](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/js/app.js)
- [android-app/app/src/main/java/com/salvi/fleebeemanagement/sync/GatewaySyncService.kt](/home/richard/APPS/SALVI/2026/fleebee-management/android-app/app/src/main/java/com/salvi/fleebeemanagement/sync/GatewaySyncService.kt)

## Most Important Practical Reminder

When debugging anything operational, start with:

- is the real backend still `http://192.168.1.50:4100`?
- if testing the public hostname, does `fleebee.esonga.online` resolve on the current device?
- is the phone heartbeat fresh?
- if USB is involved, does `.50` see the phone as ADB `device`?

## One-Sentence Resume Note

The big recent wins were bundle automation, persistent ADB recovery on `.50`, nightly machine rebooting, and preparing `fleebee.esonga.online`, while the remaining gap is finishing public HTTPS exposure rather than backend/phone queue logic.

## 2026-07-17

### What changed

- Switched Fleebee toward live recipient routing instead of the old single-number test route.
- Updated backend queueing so:
  - `SMS_GATEWAY_MODE=registered-bikers` sends to each biker's stored `phoneNumber`
  - `test-routing` still exists as an explicit fallback mode
- Made message creation and schedule creation reject bikers whose status is not `Active`.
- Limited the compose recipient picker to active bikers while keeping full add/edit/delete access in Settings.
- Stopped default demo bikers from being auto-seeded unless `SEED_DEFAULT_BIKERS=true` is set explicitly.
- Updated repo env templates so production starts in `registered-bikers` mode.

### Decisions made and why

- Kept `test-routing` available because it is still useful for safe diagnostics, but made live biker routing the default because production now needs real recipients.
- Used biker `status` as the sendability switch so one field controls both visibility in the picker and backend permission to receive SMS.
- Disabled automatic demo seeding by default so clearing the table stays cleared and real rider onboarding can begin cleanly.

### Current state

- Active bikers are now the only valid SMS or schedule recipients.
- Inactive bikers can still be stored, edited, reviewed, and reactivated later from the Settings UI.
- Fresh databases no longer refill with demo riders unless seeding is explicitly re-enabled.
- Existing live deployments still need their shared `.env` synced and their current dummy biker rows removed from the active database.

### Next steps

- Sync the updated release to `.50`.
- Update `/home/richard/fleebee/shared/.env` on `.50` to `SMS_GATEWAY_MODE=registered-bikers` and `SEED_DEFAULT_BIKERS=false`.
- Remove demo biker rows from the live database, then add the real riders and keep only the intended test number active during initial SMS verification.

## 2026-07-17

### What changed

- Added DB-backed SMS settings for:
  - the SMS send password
  - the outgoing SMS signature
- Added admin-gated SMS settings updates through the SMS page using `SMS_ADMIN_PASSWORD`.
- Changed direct-send flow so `Send now` always requires the operator to enter the SMS send password as the last step.
- Added a `deliveryBody` snapshot on queued messages so the final sent text can include the configured signature without breaking pending-message edits.
- Updated the SMS page to manage the signature and admin-controlled SMS settings instead of the old saved-password shortcut.

### Decisions made and why

- Kept admin control intentionally simple by using an env-backed admin password because the project still has no full user-auth system.
- Stored the actual send password in `AppSetting` so it can be changed live from the UI without editing `.env` on every rotation.
- Stored both raw message text and final delivery text so:
  - editing keeps the clean operator-entered body
  - sent/queued logs show the real signed SMS body

### Current state

- The backend now seeds a DB-backed send password from `SMS_SEND_PASSWORD` only when no password exists yet.
- The SMS page can change the DB-backed send password and signature when the correct admin password is provided.
- Direct sends no longer bypass password entry even if the page refreshes or another device opens the dashboard.
- Signed message text is now preserved per queued message instead of being recomputed later.

### Next steps

- Sync this SMS-settings change to `.50`.
- Add `SMS_ADMIN_PASSWORD` to the live shared env on `.50`.
- Verify from the live SMS page that:
  - the admin password can change the send password
  - the signature appears in queued/sent message rows
  - direct send rejects a wrong password and accepts the new DB-backed one

## 2026-07-17

### What changed

- Added a browser login gate in front of the Fleebee dashboard pages.
- Added signed cookie sessions with an inactivity timeout and explicit logout.
- Kept phone-gateway routes public so the Android app can still claim jobs, post send results, heartbeat, and bundle reports without operator login.
- Added a dedicated `/login` page and wired the existing frontend to redirect there when the session expires.
- Added session env examples for password, secret, cookie behavior, and idle timeout.

### Decisions made and why

- Used a lightweight in-memory session layer because the current backend is a small Node HTTP app and this keeps the login feature simple to deploy quickly.
- Treated only real browser activity as session refresh so the 5-second dashboard auto-refresh does not keep the session alive forever.
- Defaulted the new browser login password to the admin password path so the current install can start using the login page immediately without a separate secret migration step.
- Left `APP_SESSION_COOKIE_SECURE=false` in examples because the current live operator path can still be local HTTP; this should be switched to `true` once access is HTTPS-only.

### Current state

- Browser pages should now require login first.
- Idle sessions should expire and send the operator back to `/login`.
- Existing phone automation routes should continue working without UI authentication.

### Next steps

- Run syntax checks on the updated backend/frontend JS files.
- Sync to the home computer and restart `fleebee.service`.
- Verify live login, logout, idle expiry, and that the Android gateway still heartbeats normally.

## 2026-07-17

### What changed

- Reorganized the dashboard navigation around the real operator jobs instead of the old `Home / SMS / Settings` labels.
- Added grouped sidebar sections for:
  - Overview
  - Messaging
  - Monitoring
  - Directory
  - Admin
- Added direct menu targets for:
  - `Send SMS`
  - `Scheduled SMS`
  - `Message History`
  - `Gateway`
  - `Bundles`
  - `Recipients`
  - `Admin Settings`
- Added real anchor sections on the pages so those sidebar links land on meaningful content.
- Renamed page headings to better match operator language:
  - `Home` -> `Overview`
  - `SMS` -> `Messaging`
  - `Settings` -> `Recipients`

### Decisions made and why

- Kept the current three-page architecture, but made it feel like a larger organized dashboard by using grouped sidebar links and in-page anchors.
- Added a dedicated `Send SMS` section on the messaging page so the sidebar has a clear place to land for direct sending.
- Left the underlying biker data model unchanged while changing user-facing labels toward `Recipients`, because the app still stores rider and bike details.

### Current state

- The sidebar now reflects the operator workflow more clearly.
- Navigation should highlight the current section based on the page hash.
- The messaging page now has clearer section ordering and labels for direct send, schedules, history, admin controls, and bundle tools.

### Next steps

- Sync the updated frontend files to `.50`.
- Verify the new sidebar and section links in the live browser UI.

## 2026-07-17

### What changed

- Replaced the anchor-based sidebar navigation with real standalone dashboard pages so menu clicks no longer jump-scroll within the same page.
- Kept the existing routes for:
  - `Overview` at `/`
  - `Send SMS` at `/sms/index.html`
  - `Recipients` at `/settings/index.html`
- Added dedicated new pages for:
  - `Scheduled SMS` at `/scheduled.html`
  - `Message History` at `/messages.html`
  - `Gateway` at `/gateway.html`
  - `Bundles` at `/bundles.html`
  - `Admin Settings` at `/admin.html`
- Updated shared frontend nav logic to highlight by page view instead of URL hash.

### Decisions made and why

- Used plain `.html` pages in the existing `public/` root instead of new subdirectories because the current filesystem access path allowed file creation there without needing extra directory management.
- Left the existing overview and send pages mostly intact so the new navigation change stayed low-risk while still solving the scroll-jump problem.
- Kept all pages on the same shared `app.js` runtime so live data, login protection, and compose/edit behavior stay consistent.

### Current state

- Sidebar clicks should now open dedicated pages instead of scrolling to in-page anchors.
- Schedule and message-history pages still support edit flows because they include the compose modal.
- Monitoring and admin pages now have focused views for their specific tasks.

### Next steps

- Sync the new standalone pages to `.50`.
- Verify each new route loads correctly behind the login screen.

## 2026-07-18

### What changed

- Added [BIKER_WORKFLOW_REQUIREMENTS.md](/home/richard/APPS/SALVI/2026/fleebee-management/BIKER_WORKFLOW_REQUIREMENTS.md) as a dedicated workflow reference for the real biker lifecycle.
- Documented the full operational flow from head hunting, bike ordering, plate and chassis assignment, insurance, RURA authorization, pickup, notary, delivery, payment reminders, fines, bulk notices, emergency SMS, and batch-based messaging.
- Documented that bike progress updates should support a visible default-checked `Send notification` control and automatic stage-based Kinyarwanda SMS selection from SMS page templates.

### Decisions made and why

- Future Fleebee work should treat `BIKER_WORKFLOW_REQUIREMENTS.md` as the business-process source document for bike and biker workflow features so new development stays aligned with the real operations flow.
- Stage-based template configuration should live on the SMS page, while progress updates should trigger automatic notifications from those templates.
- Bike records should support plate number, chassis number, and bike model as part of the workflow because those details arrive at different times and drive recipient updates.

### Current state

- The workflow and requirements are now documented, but the schema, UI, and automation needed to support them are not yet implemented.
- The project now has a shared reference for future design, data-model, and notification decisions.

### Next steps

- Add the required workflow data model for bikes, batches, stages, fines, and templates.
- Build a bike or applications UI for progress tracking and automatic notification control.
- Connect progress updates to automatic SMS generation using configured Kinyarwanda templates.

## 2026-07-18

### What changed

- Reviewed and reorganized [BIKER_WORKFLOW_REQUIREMENTS.md](/home/richard/APPS/SALVI/2026/fleebee-management/BIKER_WORKFLOW_REQUIREMENTS.md) into a cleaner product specification.
- Reworked the document structure around:
  - product outcome
  - actors
  - real business workflow
  - functional requirements
  - recommended data model
  - lifecycle stages
  - notification categories
  - automatic notification rules
  - UI guidance
  - implementation priorities
  - open design decisions
- Clarified template rules, audit trail expectations, duplicate protection, and the role of the SMS page in stage-based configuration.

### Decisions made and why

- Kept the document focused on real operational behavior rather than implementation details only, so it can guide both product decisions and schema or UI work.
- Separated lifecycle stages from notification categories because they serve different purposes and were previously mixed together.
- Added explicit open design questions so future implementation work can confirm the few remaining business-rule choices instead of guessing.

### Current state

- `BIKER_WORKFLOW_REQUIREMENTS.md` is now a stronger source document for future Fleebee workflow development.
- No application code changed in this step; this was a documentation refinement pass only.

### Next steps

- Confirm the open design decisions in the workflow document.
- Start Phase 1 implementation with schema and backend support for bikes, stages, templates, and automatic notifications.

## 2026-07-18

### What changed

- Implemented the first major workflow slice across backend schema, backend routes, and frontend dashboard pages.
- Added new Prisma models for:
  - batches
  - bikes
  - bike progress updates
  - fines
  - stage-based SMS templates
- Extended the recipient model with:
  - first name
  - notifications enabled
  - batch link
  - team leader flag
  - notes
- Extended message records so workflow-triggered SMS can carry bike, stage, category, urgency, and template metadata.
- Added backend services and API routes for:
  - `/api/batches`
  - `/api/bikes`
  - `/api/bikes/:id/progress`
  - `/api/fines`
  - `/api/templates`
  - `/api/workflow/options`
- Added default Kinyarwanda workflow templates and automatic workflow notification behavior after progress or fine saves.
- Added new dashboard pages:
  - `/bikes.html`
  - `/batches.html`
- Reworked the Recipients page to capture richer rider details and batch assignment.
- Reworked the SMS page to include stage-based workflow template management in addition to manual send, schedules, history, and SMS settings.
- Added microservice planning files for future external automation:
  - `fllee-backend/microservices/irembo-fines/PLAN.md`
  - `fllee-backend/microservices/rura-authorization/PLAN.md`

### Decisions made and why

- Kept manual SMS and scheduled SMS intact while introducing a separate workflow layer, so the existing live messaging path remains usable during the transition.
- Used stage, category, and urgency as the template selection key because that matches the operational workflow better than the old generic message categories alone.
- Stored workflow templates in the main Fleebee database so the operator can manage them from the dashboard without editing files.
- Left the external Irembo and RURA automation at the planning stage only for now, because those integrations need separate credential, scraping, and reliability decisions.

### Verification

- Ran syntax checks successfully on:
  - `fllee-backend/src/app.js`
  - `fllee-backend/src/server.js`
  - `fllee-backend/src/services/biker-service.js`
  - `fllee-backend/src/services/bike-service.js`
  - `fllee-backend/src/services/template-service.js`
  - `flee-frontend/public/assets/js/app.js`
- Ran `npm run prisma:migrate` successfully on Saturday, July 18, 2026, which synced the SQLite schema and regenerated the Prisma client.

### Current state

- Fleebee now has the core data model and UI foundations for recipient batches, bikes, workflow progress, fines, and stage-based automatic SMS templates.
- The new workflow pages and APIs exist locally and the database schema is updated locally.
- The work has not yet been synced to the home computer `.50` in this session.
- Bulk batch messaging, recurring payment automation, and external Irembo or RURA checking are still future phases.

### Next steps

- Run live browser verification against the new pages and flows after syncing to `.50`.
- Test the full bike-progress-to-SMS path using one active recipient number first.
- Decide whether to add separate batch broadcast tools next or deepen the bike progress and fines workflow first.

## 2026-07-18

### What changed

- Reorganized the dashboard sidebar to match the workflow work already implemented instead of the older SMS-first structure.
- Moved workflow pages earlier in the menu and renamed the groups to:
  - `Workflow`
  - `Messaging`
  - `Operations`
  - `Access`
- Renamed key navigation labels for clarity:
  - `Send SMS` to `SMS & Templates`
  - `Bikes / Applications` to `Bike Workflow`
  - `Gateway` to `Phone Gateway`
  - `Bundles` to `Bundle Check`
- Updated the related browser titles and page headings so the new navigation wording stays consistent.

### Decisions made and why

- Put the workflow pages ahead of messaging because bikes, recipients, batches, progress, and fines now form the main operating flow.
- Kept the routes unchanged while improving labels, so the dashboard becomes clearer without forcing backend or deployment changes.
- Used `SMS & Templates` because that page now handles both manual messaging and workflow template setup.

### Current state

- The sidebar now reflects the current Fleebee product shape more accurately.
- Workflow pages are easier to find, and the naming is more consistent with the biker workflow requirements.

### Next steps

- Consider adding a workflow-aware overview summary so the landing page matches the new navigation emphasis.
- Decide later whether fines deserve their own dedicated menu page or should remain inside the bike workflow page.

## 2026-07-18

### What changed

- Improved the batch-to-recipient workflow so a newly created batch now hands off directly into the recipient form.
- Added an `Add Recipients` action to each batch row on the batches page.
- Added a recipient-page batch context banner so the chosen batch stays visible and preselected while adding multiple related riders.

### Decisions made and why

- Used a direct page handoff with the saved batch id in the URL so the flow stays simple and works immediately on the live dashboard.
- Kept the existing recipient batch selector, but now prefill it from the chosen batch context instead of forcing the operator to reselect it each time.

### Current state

- Creating a batch now moves smoothly into adding riders for that same batch.
- The recipient form keeps the selected batch ready until the operator clears that batch target.

### Next steps

- Consider showing the related recipients directly on the batch page as the next refinement.

## 2026-07-18

### What changed

- Updated the handoff to reflect the current workflow-oriented dashboard structure already introduced in the July 18 work:
  - `Overview`
  - `Workflow -> Recipients, Bike Workflow, Batches`
  - `Messaging -> SMS & Templates, Scheduled SMS, Message History`
  - `Operations -> Phone Gateway, Bundle Check`
  - `Access -> Admin Settings`
- Recorded the current batch handoff behavior more clearly: after creating a batch, the intended next operator step is adding the related recipients under that batch.
- Added the next requested UI reorganization to the handoff so it is not lost in later work: templates should move out of the mixed SMS page into their own dedicated area.

### Decisions made and why

- Kept this update documentation-only so the progress file stays aligned with the work already captured in the surrounding July 18 entries.
- Documented the requested SMS/templates separation as pending work rather than marking it complete before the UI split is actually built.

### Current state

- The progress file now reflects the current workflow menu direction more explicitly.
- Batch creation and recipient onboarding are documented as part of the same operator flow.
- The mixed `SMS & Templates` setup is now clearly recorded as the next dashboard cleanup item.

### Next steps

- Create a dedicated `Templates` page and menu item.
- Keep manual `Send SMS`, `Scheduled SMS`, and `Message History` focused on separate messaging jobs.
- Update this handoff again once that UI split is implemented.

## 2026-07-21

### What changed

- Reworked the manual SMS compose flow so `New SMS` now supports two recipient tabs:
  - `Current setup`
  - `Send using batch`
- Added a message-body source chooser in the compose modal:
  - `Custom message`
  - `Presaved template`
- Wired template sends to render per biker in the browser so placeholders such as `{{firstName}}`, `{{plate}}`, and `{{batchName}}` can be used for manual sends and batch sends.
- Made template-based manual sends carry template and workflow metadata into queued message records.
- Added admin-controlled SMS route mode settings:
  - `Real mode` routes to the selected active biker numbers
  - `Testing mode` routes every SMS to the configured test number `0788690545`
- Changed backend phone-state config loading so the live/test routing mode comes from saved settings instead of only env defaults.
- Updated Admin Settings UI to show the routing mode selector and the fixed testing target number.

### Decisions made and why

- Kept the new batch-send flow inside the existing compose modal instead of creating a separate page, because the operator asked for the change specifically when clicking `Send SMS`.
- Kept the testing target fixed to `0788690545` so testing mode gives a clear safety guarantee even when a saved biker is selected.
- Used DB-backed admin settings for route mode so the dashboard, backend queue logic, and phone status all reflect the same current behavior without editing env files.
- Avoided live SMS execution during implementation because real rider numbers are now in the system.

### Current state

- Manual sends can now target either explicitly selected active bikers or all active registered bikers inside a chosen batch.
- Operators can choose between a custom SMS body and a saved template before queueing or scheduling messages.
- Admin Settings can now switch routing safely between real delivery and forced test delivery to `0788690545`.
- Syntax checks passed for the updated frontend compose logic and backend settings services.

### Next steps

- Open the dashboard in the browser and verify the new modal flow visually on:
  - `SMS & Templates`
  - `Admin Settings`
- Confirm that switching to `Testing mode` updates the visible route summary immediately and that queued messages show the test target number.
- If needed later, extend scheduled-template handling further so even more workflow-specific placeholders can be sourced from richer backend context.

## 2026-07-21

### What changed

- Fixed a follow-up UI gap after the first deploy:
  - updated the duplicated compose modal on `Overview`
  - updated the duplicated compose modal on `Message History`
  - updated the duplicated compose modal on `Scheduled SMS`
  - updated the inline `Admin Settings` block inside `SMS & Templates`
- Replaced the SMS route mode dropdown with large toggle-style buttons for:
  - `Real mode`
  - `Testing mode`
- Synced those corrected frontend files to the home computer over the verified public SSH route.

### Decisions made and why

- Kept the same backend behavior and corrected the duplicated frontend surfaces instead, because the missing UI came from older page-specific HTML copies rather than from the routing logic itself.
- Switched the mode control from a dropdown to large toggle buttons because the operator wanted a more visible and safer control for live-vs-test routing.

### Current state

- The red `New SMS` button on the overview flow should now open the new two-tab compose modal instead of the older one.
- Both the standalone `Admin Settings` page and the inline `Admin Settings` area on `SMS & Templates` should now show the large `Real mode` / `Testing mode` toggle.
- Frontend-only corrections were synced without another backend behavior change.

### Next steps

- Hard refresh the browser page if the older modal or old admin controls still appear from cache.
- Verify the updated UI on:
  - `/`
  - `/sms/index.html`
  - `/admin.html`

## 2026-07-21

### What changed

- Replaced the large `Real mode` / `Testing mode` segmented selector with a true toggle-switch control in:
  - the standalone `Admin Settings` page
  - the inline `Admin Settings` section on `SMS & Templates`
- Updated the frontend logic so the switch:
  - maps off -> `registered-bikers`
  - maps on -> `test-routing`
  - updates the visible mode label and help text live before saving

### Decisions made and why

- Switched to a true toggle because the operator explicitly wanted a switch-style control rather than a two-button selector.
- Kept the same backend values and save path so this remains a presentation change only and does not alter the tested routing behavior.

### Current state

- The route mode should now appear as a real switch with clear `Real` and `Testing` labels.
- Saving still persists the same safe behavior:
  - real mode sends to registered biker numbers
  - testing mode forces all SMS to `0788690545`

### Next steps

- Hard refresh `/sms/index.html` and `/admin.html` if the old selector still appears from browser cache.

## 2026-07-21

### What changed

- Updated the compose SMS modal preview so it now shows the final SMS text that would actually be delivered:
  - saved-template preview now includes the appended admin signature
  - custom-message preview now also stays visible and includes the appended admin signature
- Added a live route-status pill beside the `Send SMS` and `Cancel` buttons:
  - green for `Live mode`
  - red for `Testing mode`
  - testing mode also shows the forced test number
- Synced the updated frontend files to keep this change frontend-only and avoid touching live send behavior.

### Decisions made and why

- Mirrored the backend signature-appending behavior in the frontend preview so the operator can see the exact final SMS text before queueing it.
- Kept the red/green mode signal inside the modal action row so the current route mode is visible at the last confirmation moment.

### Current state

- In the compose modal, the preview area should now remain visible for both:
  - `Presaved template`
  - `Custom message`
- The preview should include the configured signature automatically whenever the message body has content.
- The action row should now show an immediate route indicator:
  - `Live mode` in green
  - `Testing mode: 0788690545` in red when test routing is active

### Next steps

- Hard refresh the browser if the modal still shows the old preview behavior from cache.
- Verify this on the compose modal opened from `/`, `/sms/index.html`, `/messages.html`, and `/scheduled.html`.

## 2026-07-21

### What changed

- Fixed the admin route-mode toggle so it can actually be switched before saving.
- Synced the corrected `app.js` to the real live frontend path on the home computer:
  - `~/fleebee/current/flee-frontend/public/assets/js/app.js`

### Decisions made and why

- Kept the existing switch design and fixed the render logic instead of redesigning the control.
- The root cause was frontend state handling:
  - clicking the switch changed the hidden route-mode field
  - the next render immediately overwrote that draft value with the old saved mode
  - the switch therefore snapped back and looked untoggleable

### Current state

- The live home-computer frontend now contains the `preserveDraft` admin-toggle fix.
- The switch should stay on the chosen position long enough for the operator to review it and press `Save SMS Settings`.

### Next steps

- Hard refresh `/admin.html` or `/sms/index.html` once so the browser loads the new `app.js`.
- After refresh, toggle the switch and then click `Save SMS Settings` to persist the chosen mode.

## 2026-07-21

### What changed

- Fixed a second admin-toggle issue caused by the 5-second live auto-refresh loop.
- The admin settings form now keeps unsaved route-mode and signature changes in a local browser draft until `Save SMS Settings` is pressed.
- Synced the corrected frontend logic to the live home-computer path again:
  - `~/fleebee/current/flee-frontend/public/assets/js/app.js`

### Decisions made and why

- Kept live auto-refresh enabled for the rest of Fleebee, but stopped it from overwriting unsaved admin settings edits.
- This was safer than disabling refresh globally because dashboard, queue, and phone-state pages still depend on frequent live updates.

### Current state

- Toggling to `Testing mode` should now stay visible in the form instead of snapping back to `Real mode` before save.
- The admin settings notice now warns when there are unsaved SMS settings changes in the browser.

### Next steps

- Hard refresh the current Fleebee tab so it loads the new JavaScript.
- Toggle the switch again, confirm it stays where selected, then press `Save SMS Settings`.

## 2026-07-21

### What changed

- Refined the compose modal for testing-mode safety and clarity:
  - removed the signature text from the note above the preview
  - kept the signature only inside the final preview text itself
  - changed the modal route wording to show `Testing mode` or `Active mode`
  - changed testing-mode batch/multi-recipient sends so only 1 SMS is queued, using the first selected biker's values
- Added a browser leave-page warning when SMS settings have unsaved admin changes.
- Updated the admin save success message so it explicitly says whether `Testing mode` or `Real mode` is now saved.
- Synced the updated frontend logic to the live home-computer path:
  - `~/fleebee/current/flee-frontend/public/assets/js/app.js`

### Decisions made and why

- Kept the one-SMS testing-mode rule in the frontend compose flow so the operator can safely preview one test message even when a whole batch is selected.
- Added the unsaved-change warning because the live saved backend value was still `registered-bikers`, which showed that the earlier page flow could leave testing-mode edits unsaved when the operator navigated away.

### Current state

- In testing mode, the compose modal now explains that only 1 SMS will be queued to the test number.
- The preview still uses the first selected biker's values so the operator can see exactly what that one test SMS will look like.
- As of `2026-07-21`, the currently saved live backend mode was verified as:
  - `smsGatewayMode = registered-bikers`
  This means testing mode is not active yet on the server until the operator saves it.

### Next steps

- Hard refresh the Fleebee tab so the newest frontend JS is loaded.
- Toggle `Testing mode`, confirm the notice says there are unsaved changes, then press `Save SMS Settings`.
- After save, the success message should explicitly confirm that `Testing mode` is now saved.

## 2026-07-21

### What changed

- Added a visible mode frame directly around the compose preview text:
  - green frame with `Real mode` guidance
  - red frame with `Testing mode` guidance
- Changed template preview wording from `Final SMS text for ...` to `Sample final SMS for ...` when a saved template is being previewed for a biker.
- Added explicit copy that the saved template stays unchanged and that the shown batch/template message is only a sample preview.
- Synced the updated frontend files to the live home-computer paths and verified the served files contain the new mode-frame and sample-preview text.

### Decisions made and why

- Put the mode signal directly around the preview area because the action-row badge was easy to miss on taller modals.
- Kept the preview sample driven by the first selected biker so the operator can understand the real rendered SMS while still sending personalized values for each biker in real mode.

### Current state

- In real mode, the preview area should now show a green frame and bottom text explaining it is a sample preview and the template stays unchanged.
- In testing mode, the preview area should now show a red frame and bottom text explaining only 1 SMS will be queued to the test number.
- For batch template sends, the preview is a sample only; it does not overwrite the saved template.

### Next steps

- Hard refresh the Fleebee tab if the old plain preview still appears from browser cache.
- Reopen `New SMS` and check the preview frame color and bottom mode text in both real mode and testing mode.

## 2026-07-21

### What changed

- Converted `/sms/index.html` from `SMS & Templates` into a focused `Templates` page.
- Removed these sections from that page:
  - `Send SMS`
  - `Scheduled SMS`
  - `Message History`
  - `Admin Settings`
  - `Bundle Tools`
- Renamed the sidebar menu label from `SMS & Templates` to `Templates` across the frontend.
- Updated the browser/page title mapping so the `send-sms` view now reads `Templates`.
- Synced the updated frontend files to the live home-computer paths and verified the live `/sms/index.html` page now shows only the workflow templates section.

### Decisions made and why

- Left the route itself as `/sms/index.html` for stability, but repurposed the page contents to templates-only so existing links keep working.
- Kept the shared frontend JavaScript in place and removed only the page-specific sections, because the shared code already guards against missing DOM blocks safely.

### Current state

- The sidebar menu item now reads `Templates`.
- The live templates page now shows:
  - the page notice area
  - the workflow template form/table
- The removed sections no longer appear on that page.

### Next steps

- Hard refresh the Fleebee tab if the old `SMS & Templates` page still appears from browser cache.
- Open `/sms/index.html` again and confirm it now behaves like a templates-only page.

## 2026-07-21

### What changed

- Investigated a real-mode batch send failure where all six queued SMS came back with `Android returned SMS send result code 0`.
- Verified from the live home-computer database that:
  - the failed batch was sent in `registered-bikers` mode
  - the Android gateway was still heartbeating normally
  - the phone still had bundle capacity available (`979 SMS` remaining)
  - the failed delivered-body lengths were mostly `166-170` characters after the signature was appended
- Updated the Android gateway app to support multipart SMS sending in:
  - [GatewaySyncService.kt](/home/richard/APPS/SALVI/2026/fleebee-management/android-app/app/src/main/java/com/salvi/fleebeemanagement/sync/GatewaySyncService.kt)
  - [GatewaySmsResultReceiver.kt](/home/richard/APPS/SALVI/2026/fleebee-management/android-app/app/src/main/java/com/salvi/fleebeemanagement/sync/GatewaySmsResultReceiver.kt)
- Updated the Android manual compose screen to use multipart sending too in:
  - [ComposeMessageFragment.kt](/home/richard/APPS/SALVI/2026/fleebee-management/android-app/app/src/main/java/com/salvi/fleebeemanagement/ui/compose/ComposeMessageFragment.kt)
- Built the updated debug APK successfully:
  - `android-app/app/build/outputs/apk/debug/app-debug.apk`

### Decisions made and why

- Treated the Android gateway as the main suspect instead of the web batch UI because the backend records showed the jobs were queued and claimed correctly, then failed only when the phone reported the send result.
- Added multipart SMS support because the failing workflow/template messages were long enough to exceed a single normal SMS segment after the signature was appended.
- Improved the receiver logic so Android send `result code 0` is treated as a canceled request rather than an unknown code.

### Current state

- The code fix is implemented and the APK builds successfully.
- The updated app is not yet installed on the live gateway phone because no ADB-visible device was connected from either the local machine or the home computer during this session.
- One live data issue still exists independently of the multipart fix:
  - `HAKORIMANA` has `078390524`, which appears too short to be a valid target number.

### Next steps

- Reconnect the gateway phone over ADB or USB so the updated APK can be installed.
- Retest the same batch send after the gateway APK is updated.

## 2026-07-21

### What changed

- Added live ADB visibility to the shared Phone Gateway card on both the overview and gateway pages.
- Extended the backend dashboard payload to include an `adb` status object gathered from the home computer with a short cache to avoid probing ADB on every repaint.
- Added backend config defaults for:
  - `SMS_GATEWAY_ADB_COMMAND`
  - `SMS_GATEWAY_ADB_SERIAL`
  - `SMS_GATEWAY_ADB_TIMEOUT_MS`
- Synced the updated frontend and backend files to the home computer over the public SSH endpoint `41.216.122.219:2222`.
- Restarted the live `fleebee.service` after deployment.

### Decisions made and why

- Used a backend-side ADB probe instead of frontend polling logic so the browser can show one simple truthful status without needing direct machine access.
- Defaulted the live probe to `/home/richard/bin/adb-home` with fallback to `adb` so the home computer keeps working with the existing helper setup.
- Kept the UI to a single extra `ADB` row because the user asked for quick visibility, not a larger maintenance panel.

### Current state

- The live dashboard now includes an `ADB` row under Phone Gateway.
- The live backend currently reports ADB as `Disconnected`.
- This matches the earlier investigation result: Fleebee heartbeat and SMS gateway connectivity can still be online over Wi-Fi while USB/ADB remains detached.

### Next steps

- Refresh the overview or gateway page in the browser to see the new `ADB` line.
- If USB debugging is reconnected later, the same card should switch from `Disconnected` to `Connected (...)` automatically on refresh.

## 2026-07-21

### What changed

- Updated the dedicated [gateway.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/gateway.html) page to include the full `Bundle Check` panel in addition to `Server Health` and `Phone Gateway`.
- Switched the gateway page layout to a two-column status view so the monitoring cards fill the page width better on desktop.
- Added a small `.gateway-grid` CSS helper in [styles.css](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/css/styles.css) for equal-width gateway columns.
- Synced the updated frontend files to the home computer over the public SSH endpoint.

### Decisions made and why

- Kept the gateway page focused on monitoring cards instead of adding unrelated workflow panels because the request was specifically about seeing the full phone/server/bundle status there.
- Reused the same bundle markup and IDs as the overview page so the existing frontend render code continues to populate the values without extra JavaScript changes.

### Current state

- The live `Phone Gateway` page now has:
  - `Server Health` in the left column
  - `Phone Gateway` under it
  - `Bundle Check` in the right column
- Mobile still falls back to a single-column layout through the existing responsive CSS.

### Next steps

- Hard refresh the browser if the old narrower gateway layout is still cached.

## 2026-07-21

### What changed

- Simplified the shared SMS compose modal across:
  - [index.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/index.html)
  - [messages.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/messages.html)
  - [scheduled.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/scheduled.html)
  - [sms/index.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/sms/index.html)
- Replaced the large `Message type` button group with a smaller `Type` dropdown.
- Moved `Send` beside `Type` in one compact row.
- Shortened labels:
  - `Message body` -> `Source`
  - `Custom message` -> `Custom`
  - `Presaved template` -> `Template`
  - `Message` -> `Write message`
  - `Final SMS text` -> `Preview`
  - `SMS send password` -> `Send password`
- Changed the custom-message flow so it opens blank instead of pre-filling a reminder and showing the same content twice.
- Made the preview box stay hidden for custom messages until there is actual text to preview.
- Updated the shared compose logic in [app.js](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/js/app.js) and added a responsive `.compose-meta-row` helper in [styles.css](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/css/styles.css).
- Synced the updated frontend files to the home computer over the public SSH endpoint and verified the live files.

### Decisions made and why

- Kept template/custom switching, preview, scheduling, and test/real safeguards because those are operationally important.
- Removed noise mainly by cutting duplication, shortening copy, and hiding preview until it becomes useful.
- Switched the category control to a dropdown because the old three large pills consumed too much space for a secondary setting.

### Current state

- The live compose modal is now more compact and opens with less clutter.
- Custom SMS starts blank.
- Template SMS still shows a live personalized preview.
- The real/testing mode indicator remains in place.

### Next steps

- Hard refresh the browser if the old compose modal is still cached.

## 2026-07-21

### What changed

- Changed the shared compose modal logic in [app.js](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/js/app.js) so `New SMS` opens with `Template` selected by default.
- Added a safe fallback so the modal automatically reverts to `Custom` only when there are no active templates available.
- Synced the updated frontend JS to the home computer and verified the live file.

### Decisions made and why

- Defaulted to `Template` because that now matches the operator’s main SMS workflow.
- Kept the no-template fallback to avoid opening the modal in a dead-end template state.

### Current state

- On the live system, `New SMS` now opens in `Template` mode first.
- If all templates are inactive or missing, the modal will still open in `Custom`.

### Next steps

- Hard refresh the browser if it still opens with `Custom` from cache.

## 2026-07-21

### What changed

- Removed the long preview-helper sentence from the shared SMS compose modal preview area.
- Updated [app.js](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/js/app.js) so the preview helper text is blank and hidden while the colored preview frame still updates for real/testing mode.
- Updated the shared compose modal markup in:
  - [index.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/index.html)
  - [messages.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/messages.html)
  - [scheduled.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/scheduled.html)
  - [sms/index.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/sms/index.html)
  so the helper element starts hidden.
- Synced the updated frontend files to the home computer and verified the deployed files.

### Decisions made and why

- Kept the mode signal through the green/red preview frame and the bottom mode pill because the user only asked to remove the long text, not the safety indication itself.

### Current state

- The preview no longer shows the long `Real mode • Green frame ...` sentence on the live system.

### Next steps

- Hard refresh the browser if the old text is still cached in the current tab.

## 2026-07-21

### What changed

- Removed the inline `Send password` field from the shared SMS compose modal on:
  - [index.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/index.html)
  - [messages.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/messages.html)
  - [scheduled.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/scheduled.html)
  - [sms/index.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/sms/index.html)
- Added a separate `Confirm Send` password prompt modal that opens only when the operator clicks `Send SMS` for an immediate send.
- Updated the shared frontend logic in [app.js](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/js/app.js) so:
  - immediate sends request the password in the new prompt
  - schedules still save without the send-password prompt
  - empty prompt input shows an inline error in the password modal
  - `Cancel`, backdrop click, and `Escape` close the password prompt cleanly
- Added a small `.password-modal` width helper in [styles.css](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/css/styles.css).
- Synced the updated frontend files to the home computer and verified the deployed files.

### Decisions made and why

- Kept password entry as a dedicated final confirmation step because the user wanted less clutter in the compose form while still protecting live sends.
- Limited the prompt to direct sends only, since scheduled messages are not sent immediately from the browser.

### Current state

- The live compose modal no longer shows the password field inline.
- Clicking `Send SMS` now opens a separate password prompt before queueing the SMS.

### Next steps

- Hard refresh the browser if the old inline password field is still cached in the current tab.

## 2026-07-21

### What changed

- Removed the top helper note from the `New SMS` compose modal across the shared frontend pages:
  - [index.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/index.html)
  - [messages.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/messages.html)
  - [scheduled.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/scheduled.html)
  - [sms/index.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/sms/index.html)
- Updated the shared compose rendering in [app.js](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/js/app.js) so:
  - `New SMS` hides the note entirely
  - edit flows still show their specific guidance text
- Synced the updated frontend files to the home computer and verified the deployed files.

### Decisions made and why

- Hid the note only for `New SMS` because that was the noisy text the user wanted removed, while keeping edit-specific warnings helpful.

### Current state

- The live `New SMS` modal no longer shows the `Saved templates fill... Real mode...` sentence at the top.

### Next steps

- Hard refresh the browser if that old top note is still cached in the current tab.
