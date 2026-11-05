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

## 2026-07-21

### What changed

- Added shared SMS phone-number validation helpers in:
  - [workflow-support.js](/home/richard/APPS/SALVI/2026/fleebee-management/fllee-backend/src/services/workflow-support.js)
- Tightened backend biker and message validation so Fleebee now rejects SMS targets that do not contain a plausible SMS number length (`10-15` digits) in:
  - [biker-service.js](/home/richard/APPS/SALVI/2026/fleebee-management/fllee-backend/src/services/biker-service.js)
  - [message-service.js](/home/richard/APPS/SALVI/2026/fleebee-management/fllee-backend/src/services/message-service.js)
- Extended serialized biker records with `hasValidPhoneNumber` so the frontend can warn before queueing batch sends.
- Updated the shared compose modal flow in:
  - [app.js](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/js/app.js)
  - [styles.css](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/css/styles.css)
  so:
  - batch and multi-recipient sends include only active bikers with valid phone numbers
  - invalid active recipients are shown in a skipped warning section instead of silently failing later on the phone
  - zero-valid-recipient batch sends now explain which phone numbers must be fixed first
  - queue/schedule result messages now mention skipped invalid recipients
- Ran syntax checks successfully with:
  - `node --check` on the modified backend and frontend JavaScript files

### Decisions made and why

- Treated invalid recipient data as a separate failure class from the earlier multipart Android issue, because the repo handoff already showed at least one live biker record with a too-short number.
- Added the main guardrails in both backend and frontend so:
  - older cached browsers still cannot queue obviously bad targets
  - operators get immediate UI feedback before wasting a batch send attempt
- Kept validation broad (`10-15` digits after normalization) so existing local-format and international-format SMS numbers can still work.

### Current state

- New or edited biker records must now contain a plausible SMS phone number.
- Manual and batch compose flows now label invalid active recipients clearly and skip them from dispatch.
- Backend message creation now rejects invalid target numbers even if an outdated frontend tries to submit them.

### Next steps

- Correct any already-saved invalid biker numbers in live data, especially the previously noted short entry if it still exists.
- Deploy/sync the updated frontend and backend, then retest a real-mode batch send.

## 2026-07-21

### What changed

- Added persistent batch-send grouping fields to the message model in:
  - [schema.prisma](/home/richard/APPS/SALVI/2026/fleebee-management/fllee-backend/prisma/schema.prisma)
  - [message-service.js](/home/richard/APPS/SALVI/2026/fleebee-management/fllee-backend/src/services/message-service.js)
- Updated the shared compose flow in [app.js](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/js/app.js) so `Send using batch` now stamps all queued messages from one batch action with the same:
  - `sendGroupId`
  - `sendGroupKind=batch`
  - `sendGroupLabel=<batch name>`
- Reworked the overview recent table and the message-history/SMS table so batch sends now render as one summary row labeled with the batch name instead of one row per recipient.
- Added grouped-row behavior so the batch row now shows:
  - recipient count
  - summarized status counts
  - failed recipient names only when failures exist
- Added `Delete Batch` for grouped pending rows so the operator can still remove the whole pending batch before release.
- Synced the local SQLite schema and regenerated Prisma client successfully with:
  - `npm run prisma:migrate`

### Decisions made and why

- Used a real persisted batch-send group marker instead of trying to guess groups from timestamps, because visual-only grouping could merge unrelated sends or split the same batch after refresh.
- Kept grouped rows collapsed even when statuses differ, but added failed-recipient listing inside the summary row, because the user wanted less noise by default and extra detail only when something goes wrong.
- Allowed grouped pending rows to be deleted as a whole, but did not add grouped editing, because per-recipient template rendering makes safe batch editing less obvious than batch deletion.

### Current state

- New `Send using batch` actions now appear as one row with `Batch: <name>` in the overview and message log.
- That row stays compact through pending, queue, dispatch, submit, and sent states.
- If failures happen inside the batch, the row now calls out the failed recipient names in the status detail instead of exploding the whole batch into many rows.

### Next steps

- Hard refresh the browser so the new grouped-row behavior replaces any cached old message table JavaScript.
- Retest a real batch send and confirm the message log now stays on one row per batch unless failure details need attention.

## 2026-07-21

### What changed

- Added a quick-day schedule picker to the shared compose modal on:
  - [index.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/index.html)
  - [messages.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/messages.html)
  - [scheduled.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/scheduled.html)
  - [sms/index.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/sms/index.html)
- Updated the shared compose logic in [app.js](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/js/app.js) so schedule quick picks now show the next nearby dates starting after Tuesday, July 21, 2026:
  - `Tomorrow — Wednesday, Jul 22`
  - `Thursday, Jul 23`
  - `Friday, Jul 24`
  - `Saturday, Jul 25`
- Made the quick-day picker preserve the chosen send time while changing only the day.
- Made manual edits to the `Send at` datetime field resync the quick-day dropdown automatically.
- Verified the updated shared frontend JavaScript with:
  - `node --check flee-frontend/public/assets/js/app.js`

### Decisions made and why

- Kept the original `Send at` datetime input instead of replacing it, so the operator can still choose the exact hour and minute after picking a nearby day quickly.
- Used explicit weekday-plus-date labels to reduce confusion around relative words like `tomorrow`.
- Added four forward options instead of only three so the operator has a little more room without needing to open the calendar immediately.

### Current state

- When scheduling a send, the modal now offers quick future day picks above the datetime field.
- Picking one of those options changes the scheduled day and keeps the selected time.
- If the operator chooses a custom far-future date manually, the quick picker falls back to its placeholder instead of forcing the date back.

### Next steps

- Hard refresh the browser so the updated compose modal JavaScript and markup replace any cached version.
- Open `New SMS` or `New Schedule`, switch to `Schedule`, and confirm the quick picker is easier to use on the live dashboard.

## 2026-07-21

### What changed

- Deployed the latest local Fleebee changes to the home computer at `richard@192.168.1.50` with:
  - [deploy/home-computer/sync-release.sh](/home/richard/APPS/SALVI/2026/fleebee-management/deploy/home-computer/sync-release.sh)
  - [deploy/home-computer/restart-service.sh](/home/richard/APPS/SALVI/2026/fleebee-management/deploy/home-computer/restart-service.sh)
- Synced the current frontend/backend changes that include:
  - SMS phone-number validation safeguards
  - grouped batch-send rows in overview/message history
  - quick-day schedule picker in the compose modal
- Ran the remote Prisma schema/client refresh on the home computer successfully against the live shared database:
  - `npm run prisma:migrate`
- Restarted `fleebee.service` successfully on the home computer.
- Verified live backend health on the home computer with:
  - `curl http://127.0.0.1:4100/health`
  - response returned `status: ok`
- Added the next implementation plan below for a persistent overview schedule card with a countdown.

### Decisions made and why

- Used the Fleebee runtime Node path on the home computer for the remote Prisma refresh because the default shell `node` there is still old (`/usr/bin/node` `v12.22.9`) and does not match the runtime used by the live service.
- Kept the deployment path aligned with the existing home-computer scripts so the live layout under `~/fleebee/current` and the user-level systemd service stay consistent.
- For the next overview-schedule feature, chose the existing schedule model as the base because `sendAt`, `nextRunAt`, `recurrence`, `status`, and `lastDispatchStatus` already exist and are enough for a first persistent countdown card without a schema change.

### Current state

- The live home computer now has the current code for:
  - batch-send grouping rows
  - schedule quick-day selection
  - stronger SMS phone validation
- `fleebee.service` restarted cleanly and is running again on the home computer.
- The overview page still does **not** yet have a dedicated persistent `next schedule` card with a live countdown; that is the next UI feature to add.

### Plan: Persistent Overview Schedule Countdown

1. Add a dedicated overview panel in [index.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/index.html).
   - Title idea: `Next Schedule` or `Upcoming Schedule`.
   - Place it in the overview stack near the other operational cards so it stays visible without opening `Scheduled SMS`.

2. Reuse the existing schedule data already loaded into `state.schedules` in [app.js](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/js/app.js).
   - Prefer `active` schedules with the earliest `nextRunAt`.
   - Fall back to a future `sendAt` when needed.
   - Keep `paused` and `completed` out of the primary countdown selection unless there is no active future item.

3. Add a shared helper that builds a clear time label and countdown.
   - Absolute time example:
     `Wednesday, July 22, 2026 at 09:00`
   - Relative countdown example:
     `in 13h 24m`
   - When the target time is very close or overdue, switch wording cleanly instead of showing confusing negative values.

4. Render a persistent overview card from that selected schedule.
   - Show:
     - biker name
     - category
     - recurrence
     - next run date/time
     - countdown
     - last dispatch status if available
   - Keep the message body preview short so the card stays readable.

5. Make the countdown update live on the page without needing a full data refetch every second.
   - Reuse the existing lightweight interval pattern already used for pending-message countdown refreshes.
   - Refresh the overview schedule card timer label on that interval.

6. Add a graceful empty state.
   - If there is no active upcoming schedule, show:
     `No upcoming schedule yet.`
   - Optionally include a short prompt to create one from `New SMS` -> `Schedule`.

7. Verify on live data after implementation.
   - Test one one-time future schedule.
   - Test one recurring schedule.
   - Confirm the countdown survives refresh, updates on its own, and still looks correct after deployment on the home computer.

### Next steps

- Hard refresh the browser so the newly deployed batch-row and schedule-picker UI replaces any cached old frontend files.
- Implement the overview `Next Schedule` countdown card using the plan above.

## 2026-07-22

### What changed

- Added retry support for failed SMS directly from the overview `Recent SMS` table.
- Batch rows can now open a failed-recipient detail list, and each failed recipient gets its own `Retry` button.
- Single failed rows in `Recent SMS` also now show `Retry` beside the eye button.
- Retried batch recipients reuse the same batch group metadata so the grouped row keeps reflecting the latest attempt per recipient.

### Decisions made and why

- Reused the existing `/api/messages` create flow plus the existing SMS password modal instead of adding a special backend retry endpoint, because failed messages are already allowed to be queued again and this keeps the phone/gateway path unchanged.
- Kept the old failed records in storage for traceability, but changed the batch-row summary logic to use the latest attempt per recipient so a successful retry no longer leaves the whole batch visually stuck in `FAILED`.

### Current state

- Operators can retry only the failed recipient from a batch without resending the whole batch.
- Recent batch rows still stay grouped, but failed recipients can be reviewed inline and retried one by one.
- No schema change was required for this retry feature.

### Next steps

- Verify in the browser with a real failed batch example that:
  - the failed-recipient detail row opens correctly
  - password prompt appears on retry
  - the new retry enters the pending queue
  - the batch summary updates to the latest attempt per recipient after refresh

## 2026-07-23

### What changed

- Added a new overview table for recurring schedules in:
  - [index.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/index.html)
  - [app.js](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/js/app.js)
- The overview now shows daily, weekly, and monthly schedules immediately without opening the `Scheduled SMS` page.
- Reused the existing schedule actions there, so recurring schedules can still be edited, paused/resumed, or deleted directly from the overview.
- Removed the blue `New Schedule` button from [scheduled.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/scheduled.html).

### Decisions made and why

- Filtered the new overview table to recurring schedules only by excluding `ONCE`, because the request was specifically about quickly seeing repeating messages such as monthly schedules.
- Kept schedule creation behind the existing red `New SMS` flow on the overview page, then the operator can choose `Schedule` and the repeat pattern there, which avoids having two competing create buttons.

### Current state

- The overview page now has a dedicated recurring-schedules table near the top.
- The scheduled page still lists all schedules, but it no longer shows the blue `New Schedule` button.
- One-time schedules remain on the `Scheduled SMS` page and are not mixed into the new overview recurring table.

### Next steps

- Hard refresh the browser so the updated overview and scheduled-page frontend files replace any cached version.
- Verify one monthly recurring schedule and one weekly or daily recurring schedule appear correctly in the new overview table.

## 2026-07-23

### What changed

- Changed the schedule repeat model so the UI now offers:
  - `Occasionally`
  - `Monthly`
  - `After 2 months`
  - `After 3 months`
  - `After 4 months`
  - `After 5 months`
- Added backend support for the new month-based recurrence values in:
  - [schema.prisma](/home/richard/APPS/SALVI/2026/fleebee-management/fllee-backend/prisma/schema.prisma)
  - [scheduled-message-service.js](/home/richard/APPS/SALVI/2026/fleebee-management/fllee-backend/src/services/scheduled-message-service.js)
- Restored the blue `New Schedule` button on [scheduled.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/scheduled.html), and it now opens the compose modal directly in schedule mode.
- Kept batch and individual scheduling available in that schedule flow by reusing the existing shared compose target tabs.
- Changed schedule listing behavior so completed one-time schedules no longer stay visible in schedule tables; after they run, they remain only in message history.

### Decisions made and why

- Kept legacy backend support for `DAILY` and `WEEKLY` schedule values so any older saved data can still be read safely, but removed those options from the new schedule UI because the requested creation flow is now month-focused.
- Filtered schedule listings to active and paused rows only, instead of deleting completed schedule records, so operators keep a clean pending list without losing backend traceability.

### Current state

- New schedules can now be created as occasional, monthly, or every 2 to 5 months.
- The `Scheduled SMS` page now acts like a pending schedule queue rather than a long archive.
- One-time schedules disappear from schedule tables after they run and remain visible through normal message history only.

### Next steps

- Hard refresh the browser so the new repeat options and restored `New Schedule` button replace any cached frontend files.
- Verify:
  - one individual monthly schedule
  - one batch schedule
  - one occasional schedule disappearing from the schedule table after it runs

## 2026-07-23

### What changed

- Created a new `call-center/` folder: a future microservice for calling bikers with Kinyarwanda voice (TTS), the voice counterpart to the existing SMS gateway.
- Added `call-center/README.md` (purpose, intended shape, first milestone, non-goals) and `call-center/TTS_MODEL_OPTIONS.md` (three Kinyarwanda TTS options with a test plan).

### Decisions made and why

- Test `facebook/mms-tts-kin` first (VITS via Hugging Face Transformers): ~150 MB, CPU-friendly, works with the system Python 3.13, five-minute setup.
- KinyaTTS (MB-iSTFT-VITS2) is the quality fallback; DigitalUmuganda YourTTS only if voice cloning is needed (requires abandoned Coqui TTS and a separate Python 3.10/3.11 env).
- Call delivery channel (Android dial-out vs SIP/VoIP) deliberately deferred until TTS quality is proven.

### Current state

- `call-center/` contains docs only — no code, no venv yet.
- Dev machine has Python 3.13.7, which rules out Coqui TTS without pyenv but is fine for MMS-TTS.

### Next steps

- Create a venv in `call-center/`, install `transformers torch scipy`, run the MMS-TTS script to produce `out.wav`.
- Have a Kinyarwanda speaker judge intelligibility and tonal accuracy on a realistic biker dispatch phrase.
- Record verdicts in `call-center/TTS_MODEL_OPTIONS.md`; escalate to KinyaTTS only if quality fails.

### Scope clarified later the same day

- The call-center service is a **two-way Kinyarwanda voice agent**, not just outbound TTS announcements: call a biker when needed, speak in Kinyarwanda, listen to the reply (STT), and store the important information for operators.
- Rewrote `call-center/README.md` around the full pipeline (TTS -> STT -> logic -> store) with 5 milestones: TTS PoC, STT PoC, offline conversation loop with info extraction, Fleebee backend integration, telephony.
- Added `call-center/STT_MODEL_OPTIONS.md`: start with `mbazaNLP/Whisper-Small-Kinyarwanda` (~33% WER, same Transformers stack), fallbacks mbazaNLP NeMo conformer, Meta MMS ASR (`kin` adapter), SpeechBrain wav2vec2. Key design note: guide bikers toward short predictable answers (YEGO/OYA) since numbers and place names are the risky part.
- Milestone 1 (TTS PoC with `facebook/mms-tts-kin`) is unchanged and still the next step.

### Milestone 1 executed (same day)

- Created `call-center/.venv` (Python 3.13.7) with CPU-only torch 2.13, transformers 5.14, scipy 1.18; added `call-center/.gitignore` for `.venv/` and `__pycache__/`.
- Wrote `call-center/synthesize.py` (small CLI: default samples or one phrase + output path) and generated three Kinyarwanda WAVs in `call-center/samples/`: greeting, a Fleebee dispatch phrase, and a yego/oya question.
- Verified the WAVs contain real non-silent audio (16 kHz mono float32, peak ~0.2-0.3).
- Performance on this laptop CPU: ~5x faster than real-time (9.2s of audio synthesized in 1.8s; model loads in ~55s first time). Live-call generation looks feasible.

### Next steps (updated)

- Richard (or another Kinyarwanda speaker) listens to `call-center/samples/*.wav` and judges intelligibility, naturalness, and whether tone errors change meaning; record the verdict in `call-center/TTS_MODEL_OPTIONS.md`.
- If quality passes: start milestone 2 (STT proof of concept with `mbazaNLP/Whisper-Small-Kinyarwanda` in the same venv).
- If quality fails: try KinyaTTS.

### Call content wired to existing SMS templates (same day)

- Decision: calls will speak the operator's existing Fleebee SMS templates (the `SmsTemplate` table, Kinyarwanda bodies with `{{firstName}}`, `{{plate}}`, `{{fineAmount}}`, `{{fineReason}}`, `{{nextPaymentDate}}`, `{{batchName}}` placeholders) — no separate call scripts to maintain.
- Added `call-center/speak_templates.py`: loads active templates from `fllee-backend/fleebee.db` (falls back to `DEFAULT_SMS_TEMPLATES` in `workflow-defaults.js` via node when the DB is empty), renders placeholders with the same regex as backend `renderTemplateBody()`, and synthesizes each to `call-center/samples/templates/<stage>-<category>-<urgency>.wav`. Supports `--list` preview and `--stage/--category/--urgency` filters plus per-biker context flags.
- All 16 default templates synthesized successfully (~2 min of audio in 27.5s CPU).
- Note: `/api/templates` requires the dashboard login session, so the PoC reads SQLite directly; the future service integration should either use an authenticated API call or a shared DB path.

### Next steps (updated)

- Listen to `call-center/samples/templates/*.wav` — pay special attention to plate numbers, amounts, and dates (digits/Latin sequences are the likely TTS weak spots). Record verdicts in `call-center/TTS_MODEL_OPTIONS.md`.
- If digits/plates sound wrong, add a Kinyarwanda number/letter verbalizer step before synthesis (spell out digits in words).
- Then milestone 2: STT proof of concept with `mbazaNLP/Whisper-Small-Kinyarwanda`.

### Production template texts snapshotted for TTS (same day)

- Richard provided the 17 real production templates from the dashboard (they differ from code defaults: no "Muraho" prefix, plus a new AUTHORIZATION_COMPLETED template about picking up the RURA permit at the Notaire in Kicukiro).
- Saved them to `call-center/templates.snapshot.json`; `speak_templates.py` now loads DB -> snapshot -> code defaults, so the PoC speaks the real texts. Re-export the snapshot when the operator edits templates.
- Regenerated all WAVs in `call-center/samples/templates/` from the production texts (17 templates, ~2.5 min of audio in 27s CPU).

### A/B test audios generated + tokenizer findings (same day)

- Generated `call-center/samples/ab-tests/`: 12 paired WAVs testing digits vs Kinyarwanda words (amount 5000 vs "ibihumbi bitanu", date 2026-08-01 vs "ku ya mbere Kanama", time 10:30 vs "saa ine n'igice", plate raw vs spelled out, "reminder" vs "urwibutso", "plaque" vs "purake").
- Tokenizer inspection of `facebook/mms-tts-kin`: 45-char vocab; letters q and x are SILENTLY DROPPED ("plaque" is synthesized as "plaue" — affects ~8 templates). Digits 0-9 are in vocab but digit sentences produce suspiciously short audio (1.3s for a full date), suggesting the model barely voices numbers.
- Implication: a verbalizer pre-processing step (digits -> Kinyarwanda words, q/x respellings like plaque->purake) is very likely needed regardless of overall voice quality. Richard's A/B listening verdict decides the exact rules.

## 2026-07-26

### What changed

- Investigated why Fleebee is reachable on `http://192.168.1.50:4100` but not on the previously used public IP `http://41.216.122.219:4100`.
- Verified on the home computer that `fleebee.service` is active and Node is listening on `*:4100`, so the app is not bound to localhost only.
- Confirmed from outside the sandbox that:
  - `http://41.216.122.219:4100` times out
  - `http://41.173.248.47:4100/health` returns Fleebee `{"status":"ok","service":"fleebee-app","storage":"sqlite"}`
  - `http://41.173.248.47:4100/app-config.js` returns the live Fleebee browser config
- Queried the home computer's current outbound public IPv4 and found `41.173.248.47`, while `fleebee.esonga.online` still resolves to `41.216.122.219`.

### Decisions made and why

- Treated this as a WAN/DNS exposure issue, not a backend code bug, because the live service is healthy on `.50`, listens on all interfaces, and answers correctly through the current public IP.
- Did not change runtime config or deployment files yet because the first required fix is aligning public DNS / public-IP usage, not changing the app server.

### Current state

- The LAN endpoint remains healthy at `http://192.168.1.50:4100`.
- The current reachable public HTTP endpoint is `http://41.173.248.47:4100`.
- The old public IP `41.216.122.219` is stale for Fleebee and no longer reaches the app.
- `fleebee.esonga.online` is currently stale too because it still points at `41.216.122.219`.
- Standard public web exposure on `80/443` is still not live; direct `http://41.173.248.47/` timed out, which matches the earlier note that no reverse proxy is installed yet.

### Next steps

- Update DNS for `fleebee.esonga.online` to the current public IP `41.173.248.47`, or switch testing to `http://41.173.248.47:4100` immediately.
- If the public IP changes often, add a DDNS-friendly update path or move to the planned reverse-proxy/domain setup on `80/443`.
- Before broader public exposure, replace the weak test password and finish the intended HTTPS reverse proxy setup.

## 2026-07-26

### What changed

- Added a rootless public-proxy deployment bundle under `deploy/home-computer/`:
  - `Caddyfile.rootless`
  - `caddy-fleebee.service`
  - `install-user-caddy-proxy.sh`
  - `restart-proxy.sh`
- Installed and started `caddy-fleebee.service` on the home computer as the `richard` user.
- Confirmed the user-level proxy on `.50` listens on:
  - `8080` for HTTP
  - `8443` for HTTPS
  - and proxies to Fleebee on `127.0.0.1:4100`
- Updated the router mappings so public traffic now reaches the rootless proxy:
  - `80 -> 8080`
  - `443 -> 8443`
- Confirmed from the live Caddy logs that Let's Encrypt validation succeeded and the certificate for `fleebee.esonga.online` was obtained successfully on `2026-07-26`.
- Confirmed public behavior on the current IP:
  - `http://41.173.248.47` redirects to `https://fleebee.esonga.online/`
  - `https://41.173.248.47` with `Host/SNI fleebee.esonga.online` reaches Fleebee through Caddy
- Removed an accidental laptop-local `caddy-fleebee.service` and `~/fleebee/proxy` created during manual command testing, leaving only the real home-computer proxy active.
- Updated `README.md`, `DEPLOYMENT.md`, and `deploy/home-computer/README.md` to match the new live deployment shape.

### Decisions made and why

- Used a rootless Caddy deployment instead of a root-owned `80/443` install because the home computer requires a sudo password, has no Docker available, and cannot bind privileged ports as the normal user.
- Chose router translation `80 -> 8080` and `443 -> 8443` so public HTTPS could be completed immediately without waiting for root access.
- Kept direct `4100 -> 4100` forwarding in place so the old direct-IP troubleshooting path still works during DNS propagation and future debugging.

### Current state

- `fleebee.service` is active on `.50` and serves the backend on `*:4100`.
- `caddy-fleebee.service` is active on `.50` and serves the public reverse proxy on local `8080/8443`.
- `fleebee.esonga.online` now has a valid Let's Encrypt certificate on the live home-computer proxy.
- Public SSH is confirmed on `41.173.248.47:2222`.
- Public direct Fleebee is confirmed on `http://41.173.248.47:4100`.
- Public hostname service is live at `https://fleebee.esonga.online`, but some DNS resolvers were still serving the older `41.216.122.219` during this session, so not every network may see the new IP yet.

### Next steps

- Let DNS propagation finish on resolvers still caching `41.216.122.219`, then prefer testing with `https://fleebee.esonga.online`.
- Replace the weak public-facing passwords and session secret before treating the system as broadly exposed production.
- If the ISP keeps changing the WAN IP, add a DDNS-friendly update path or another stable DNS automation flow.
- Run `sudo loginctl enable-linger richard` on the home computer so both user-level services survive SSH logout without depending on the current session.

### Pending tasks to carry forward

- Confirm from the actual operator devices that `fleebee.esonga.online` now resolves to `41.173.248.47` and opens over HTTPS without using the direct-IP fallback.
- Rotate the live public-facing credentials and secret material in `~/fleebee/shared/.env`, then restart `fleebee.service` and `caddy-fleebee.service`.
- Decide whether to keep manual DNS updates or implement DDNS / another automatic public-IP update path.

## 2026-07-27

### What changed

- Added a new premium strategy framework section to the top of the dashboard overview page in `flee-frontend/public/index.html`.
- Styled the new overview hero in `flee-frontend/public/assets/css/styles.css` with a white executive-card look, soft gradients, rounded cards, subtle shadows, and responsive behavior.
- Implemented the four-stage cycle exactly as:
  - `BUILD`
  - `PROTECT`
  - `UPGRADE`
  - `REBALANCE`
- Added the supporting `Decision Compass` checklist and the closing quote block below the framework.
- Reverted an initial detour on the login page after clarifying that the framework belongs inside the protected overview dashboard, not on the public sign-in screen.

### Decisions made and why

- Put the new illustration on the overview page instead of the login page because the user clarified that the daily strategy reminder should live inside the dashboard itself.
- Kept the implementation HTML/CSS-only so it remains easy to deploy, fast to render, and independent from the dashboard API logic.
- Left the operational dashboard panels below the new hero untouched so the system health, schedules, and recent SMS views still behave the same.

### Current state

- The overview page now starts with a large strategy hero that presents the four-stage cycle, decision checklist, and quote before the existing workflow panels.
- The login page has been returned to its earlier protected-dashboard layout.
- No backend or API behavior was changed for this work.
- Local browser-style preview could not be launched from this sandbox because opening a listening socket is blocked here, so validation was done by inspecting the final markup/CSS and will be followed by deployment verification on the home computer.

### Next steps

- Sync the updated frontend assets to the home computer with the standard deploy helper.
- Restart `fleebee.service` if needed after sync and verify the new overview HTML is present on `.50`.
- If the user wants further refinement after seeing it live, tune spacing, arrow positioning, or typography directly against the deployed page.

## 2026-08-07

### What changed

- Investigated the current public reachability failure reported for Fleebee without changing runtime config or deployment files.
- Verified over LAN SSH that the home computer backend and proxy are both healthy:
  - `fleebee.service` is active
  - `caddy-fleebee.service` is active
  - `http://127.0.0.1:4100/health` returns the normal SQLite-backed `ok` status
- Queried the home computer's current outbound public IPv4 and found it has changed again to `196.12.147.159`.
- Confirmed that `fleebee.esonga.online` still resolves on the home computer to the older IP `41.173.248.47`.
- Confirmed that the older IP no longer answers Fleebee traffic from the home computer checks, while the new IP does answer the live proxy path when forced with `Host/SNI fleebee.esonga.online`.
- Confirmed that the repo and live proxy configuration are built around `fleebee.esonga.online`, not `fleebee.esonga.com`.

### Decisions made and why

- Treated this as a public-IP/DNS drift problem, not an application outage, because both user services are running and the backend health endpoint is healthy locally.
- Did not change DNS or redeploy anything from the repo because the first corrective action is outside the app code: update the public DNS target to the new WAN IP.
- Called out the `.com` hostname explicitly because using `fleebee.esonga.com` will not match the current configured public domain for the proxy/certificate path.

### Current state

- As of `2026-08-07`, the home computer's observed public IPv4 is `196.12.147.159`.
- As of `2026-08-07`, the configured public hostname in repo docs and runtime config remains `https://fleebee.esonga.online`.
- As of `2026-08-07`, `fleebee.esonga.online` is stale because it still points to `41.173.248.47`.
- As of `2026-08-07`, the old IP `41.173.248.47` no longer appears to be the live WAN IP for Fleebee.
- As of `2026-08-07`, the internal Fleebee stack on `.50` is still healthy and the reverse proxy can answer through the new public IP when addressed correctly.

### Next steps

- Update the DNS `A` record for `fleebee.esonga.online` from `41.173.248.47` to `196.12.147.159`.
- Test `https://fleebee.esonga.online` again from an outside network after DNS refresh begins.
- If users have been trying `fleebee.esonga.com`, switch them to `fleebee.esonga.online` or intentionally provision `.com` as an additional hostname if that is now the desired public domain.
- Add DDNS or another automated DNS update path if the ISP continues rotating the public IP.

## 2026-08-07

### What changed

- Recorded the follow-up DNS change for public Fleebee access.
- User updated the DNS records so that:
  - apex `esonga.online` stays on `A @ -> 208.91.197.13` for the under-construction page
  - subdomain `fleebee.esonga.online` now points to `A fleebee -> 196.12.147.159`
  - the Fleebee subdomain TTL is set to `4 Hours`
- Rechecked from the home computer after the change and found:
  - current observed WAN IP is still `196.12.147.159`
  - local resolver on the home computer still returns the previous Fleebee IP `41.173.248.47`

### Decisions made and why

- Treated the DNS edit as the correct immediate recovery action because the backend and proxy were already confirmed healthy on the home computer.
- Kept the progress note explicit about propagation status so later sessions do not mistake cached DNS for a failed update.
- Left the apex record alone in the notes because the current intent is clearly that only `fleebee.esonga.online` should serve Fleebee, while the root domain remains parked.

### Current state

- As of `2026-08-07`, the intended Fleebee public hostname target is now `196.12.147.159`.
- As of `2026-08-07`, the home computer itself still resolves `fleebee.esonga.online` to the older `41.173.248.47`, so propagation or local DNS caching is still in progress.
- As of `2026-08-07`, the backend remains healthy locally and the new public IP still matches the live WAN IP.
- The root domain `esonga.online` is still expected to show the under-construction page and is not part of the Fleebee app cutover.

### Next steps

- Wait for DNS propagation or cache expiry on resolvers still serving `41.173.248.47`.
- Recheck `https://fleebee.esonga.online` from an outside network after the TTL window begins to clear.
- If public reachability keeps breaking after future ISP IP rotations, implement DDNS or move the stable public backend role to cloud hosting.

## 2026-08-09

### What changed

- Investigated a fresh "nothing opening" report without changing runtime config, deployment scripts, or app code.
- Confirmed from the laptop that it is currently on the same LAN subnet as the documented home computer path:
  - laptop address `192.168.1.70/24`
  - router `192.168.1.254`
- Rechecked the old LAN anchor `192.168.1.50` and found it is not reachable at all:
  - `ping 192.168.1.50` returned 100% packet loss
  - ARP for `192.168.1.50` stayed `incomplete`
  - `http://192.168.1.50:4100/health` did not connect
- Ran a LAN host discovery scan and found only three live devices:
  - this laptop at `192.168.1.70`
  - one unrelated device at `192.168.1.72`
  - the router at `192.168.1.254`
- Checked the current public DNS for `fleebee.esonga.online` and confirmed it now resolves to `196.12.147.159`, so the older `41.173.248.47` value in July docs is now historical.
- Confirmed the laptop's own current public IP is also `196.12.147.159`, which means same-WAN public tests from this laptop can be affected by router hairpin/NAT-loopback behavior and are not the best proof of outside reachability.
- Reproduced and then repaired a separate local backend boot issue in the repo:
  - Prisma's SQLite adapter initially failed because the installed `better-sqlite3` binary expected `libnode.so.115`
  - this machine currently has Node `v22.22.1` with `/usr/lib/x86_64-linux-gnu/libnode.so.127`
  - rebuilding `better-sqlite3` outside the sandbox restored the native module for the current local Node runtime
  - after the rebuild, local `npm start` proceeds past Prisma startup and only stops at sandbox socket-bind restrictions (`listen EPERM`)

### Decisions made and why

- Treated the main live problem as host reachability, not a frontend regression, because the documented Fleebee machine is absent from the LAN and does not answer its service port.
- Treated the public-IP/DNS situation as updated but not the primary failure, because DNS now points to the new IP yet the app still cannot be reached while the `.50` machine itself is missing locally.
- Kept the local native-module/runtime issue separate from the live outage because it affects local repo booting, but it does not by itself prove what the home computer is doing.

### Current state

- As of `2026-08-09`, the expected Fleebee home computer is not visible on the LAN at `192.168.1.50`.
- As of `2026-08-09`, the only other discovered LAN device `192.168.1.72` is not the Fleebee host:
  - SSH on `22` is closed
  - Fleebee-related ports `4100`, `8080`, and `8443` are closed
- As of `2026-08-09`, `fleebee.esonga.online` resolves publicly to `196.12.147.159`.
- As of `2026-08-09`, the local repo Prisma/native-module issue has been repaired on this laptop by rebuilding `better-sqlite3`.
- As of `2026-08-09`, local backend boot now gets as far as opening the HTTP listener; the remaining `listen EPERM` here is a sandbox limitation, not a Fleebee app startup error.

### Next steps

- Physically check the home computer and router-side connection first:
  - is the Fleebee computer powered on
  - is it actually connected to the `192.168.1.x` network
  - did its LAN IP change outside the expected `.50` reservation
- Once the machine is back on the LAN, re-run the normal checks:
  - `ssh richard@192.168.1.50`
  - `curl http://127.0.0.1:4100/health` on the host
  - `systemctl --user status fleebee.service`
  - `systemctl --user status caddy-fleebee.service`
- If local Node is upgraded again later, rebuild `better-sqlite3` against that runtime before relying on local `npm start` for repo-side debugging.

## 2026-08-09

### What changed

- Reworked the overview page's `Decision Operating System` area to be compact, generic, and much shorter vertically.
- Removed the oversized multi-card strategy framework, checklist, and quote stack from the top of [flee-frontend/public/index.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/index.html).
- Replaced it with a single slim banner that keeps:
  - a short heading
  - one short summary sentence
  - four simple action chips: `Prioritize`, `Simplify`, `Protect`, `Improve`
- Updated the supporting CSS in [flee-frontend/public/assets/css/styles.css](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/css/styles.css) so the section stays compact and responsive.
- Copied only those two frontend files to the live home-computer release tree at:
  - `~/fleebee/current/flee-frontend/public/index.html`
  - `~/fleebee/current/flee-frontend/public/assets/css/styles.css`
- Verified on `richard-Vostro-230` that the updated files are present and `fleebee.service` is still `active`.

### Decisions made and why

- Deployed only the two touched frontend files instead of the whole repo because the worktree contains unrelated in-progress changes and those should not be pushed accidentally.
- Did not restart `fleebee.service` because the backend serves static files directly from disk, so the updated frontend assets can be picked up by a normal browser refresh.

### Current state

- As of `2026-08-09`, the live Fleebee home computer is back online and serving the updated compact overview banner.
- As of `2026-08-09`, the `Decision Operating System` section on the overview page is now a slim, generic strip rather than a tall strategy block.

### Next steps

- Refresh `https://fleebee.esonga.online`.
- If spacing still feels too tall after seeing it live, trim the heading size or chip padding one more step.

## 2026-08-09

### What changed

- Made the follow-up copy adjustment to the compact overview banner.
- Removed the visible heading `Keep decisions simple and repeatable.` from the `Decision Operating System` strip in [flee-frontend/public/index.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/index.html).
- Replaced the temporary generic chip labels with the original stage wording:
  - `Build`
  - `Protect`
  - `Upgrade`
  - `Rebalance`
- Copied the updated `index.html` to `~/fleebee/current/flee-frontend/public/index.html` on the home computer.
- Verified on `richard-Vostro-230` that the live file contains the new wording and `fleebee.service` is still `active`.

### Decisions made and why

- Kept this deploy limited to `index.html` only because the CSS did not need another change and the worktree still contains unrelated in-progress edits.
- Switched the section to `aria-label` instead of a visible heading so the banner can stay title-free without losing an accessible label.

### Current state

- As of `2026-08-09`, the live overview banner shows only the `Decision Operating System` kicker, the short summary sentence, and the four original stage chips.

### Next steps

- Refresh `https://fleebee.esonga.online`.
- If you want the summary sentence shortened too, trim that line next.

## 2026-08-09

### What changed

- Updated the shared bundle-card parser in [flee-frontend/public/assets/js/app.js](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/js/app.js) so the purchased Airtel-style USSD reply now extracts useful fields instead of leaving both bundle rows as `Not found`.
- Added optional bundle detail rows to:
  - [flee-frontend/public/bundles.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/bundles.html)
  - [flee-frontend/public/index.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/index.html)
  - [flee-frontend/public/gateway.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/gateway.html)
- The dashboard can now surface, when present:
  - bundle plan
  - voice bundle perks
  - loaded SMS bundle with expiry
  - daily data bundle with expiry
  - buy-again guidance
  - SMS usage counted since the bundle check timestamp
- Verified the browser script syntax with `node --check flee-frontend/public/assets/js/app.js`.

### Decisions made and why

- Kept the change frontend-only because the backend already stores the raw USSD reply and does not need schema or API changes for this format.
- Scoped the new SMS usage counter to purchased-bundle style replies only, so older legacy replies that likely show remaining SMS do not get misread as the original loaded cap.
- Reused the same markup on overview and gateway because those pages share the same bundle renderer and should stay consistent with `/bundles.html`.

### Current state

- As of `2026-08-09`, a reply like `3000_Bundle:Unlimited Calls (Airtel) + 200 SMS + 1024MB/day EXP 2026-09-07 ...` now maps to visible bundle fields instead of `Not found`.
- As of `2026-08-09`, the bundle UI can show `Buy again` guidance using the parsed expiry date `2026-09-07` and carrier short code when the reply includes it.

### Next steps

- Refresh the bundle page with a fresh carrier reply and confirm the live values match the phone's latest USSD message.
- If needed later, add a dedicated account-balance row for values like `MA:1998.77RWF` and `Money:0.00RWF`.

## 2026-08-09

### What changed

- Added a one-line bundle purchase reminder under the `/bundles.html` page header in [flee-frontend/public/bundles.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/bundles.html).
- The new line tells operators how to buy bundles from an MTN number to the Airtel phone by dialing `*662#` and choosing `1`.

### Decisions made and why

- Kept this change limited to `/bundles.html` because the request was specifically for that page header and did not require changing the shared bundle cards elsewhere.

### Current state

- As of `2026-08-09`, the `/bundles.html` page now shows the MTN-to-Airtel bundle purchase reminder directly below the existing workflow description.

### Next steps

- Refresh `/bundles.html` and confirm the reminder text reads clearly in the header area.

## 2026-08-09

### What changed

- Deployed the latest bundle-page frontend changes to the home computer at `192.168.1.50` by copying only these files into `~/fleebee/current/`:
  - `flee-frontend/public/assets/js/app.js`
  - `flee-frontend/public/bundles.html`
  - `flee-frontend/public/index.html`
  - `flee-frontend/public/gateway.html`
- Verified on the home computer release tree that:
  - `bundles.html` contains the MTN-to-Airtel purchase reminder with `*662#`
  - `app.js` contains the new bundle parser helper `normalizeBundleSnippet`
- Verified `fleebee.service` is still `active` after the selective frontend deploy.

### Decisions made and why

- Deployed only the touched bundle frontend files because the local worktree contains unrelated in-progress changes that should not be pushed to the live home computer.
- Did not restart `fleebee.service` because these are static frontend assets served from disk and should be picked up on the next browser refresh.

### Current state

- As of `2026-08-09`, the home computer release tree on `192.168.1.50` includes the new bundle parser and the `/bundles.html` purchase reminder.
- As of `2026-08-09`, `fleebee.service` remains active after the deploy.

### Next steps

- Refresh the live bundle page in the browser and confirm the new reminder line and bundle parsing are visible after login.

## 2026-09-19

### What changed

- Investigated the public Fleebee outage without changing the deployment or DNS.
- Confirmed the home computer is reachable on the LAN and currently reports WAN IPv4 `41.216.116.163`.
- Confirmed public DNS for `fleebee.esonga.online` still resolves to the previous WAN IPv4 `196.12.147.159`.
- Confirmed the stale hostname and old direct-IP endpoint time out from an outside-network probe.
- Confirmed the current IP is publicly reachable:
  - `http://41.216.116.163:4100/health` returns Fleebee health status `ok`.
  - HTTPS on `41.216.116.163:443`, when tested with `fleebee.esonga.online` as Host/SNI, returns Fleebee health status `ok` through Caddy.
- Confirmed on `192.168.1.50` that `fleebee.service` and `caddy-fleebee.service` are active, ports `4100`, `8080`, and `8443` are listening, and user lingering is enabled.
- Checked current capacity for cloud-sizing context: the Node process uses about `143280 KiB` RSS and the live SQLite database is about `260K`.

### Decisions made and why

- Classified the outage as another dynamic-WAN-IP/DNS mismatch, not an application, Caddy, TLS, or router-forwarding failure.
- Did not update external DNS because this session was an investigation and recommendation request, not authorization to change DNS.
- Recommended considering a small DigitalOcean Droplet for production reliability because the WAN IP has now changed repeatedly and manual DNS updates have caused recurring public outages; DDNS remains the lower-cost alternative if occasional home power/ISP downtime is acceptable.

### Current state

- As of `2026-09-19`, Fleebee is healthy on the home computer but unavailable at its normal public hostname because DNS points to stale IP `196.12.147.159` instead of current IP `41.216.116.163`.
- The live router forwarding and Caddy HTTPS path work on current IP `41.216.116.163`.

### Next steps

- Restore the hostname immediately by changing the `fleebee.esonga.online` DNS `A` record to `41.216.116.163`.
- Choose between automated DDNS for the home deployment and moving the backend/UI/SQLite database to a small cloud VM.
- If moving to DigitalOcean, use at least the 1 GiB Basic Droplet, configure backups and firewalling, migrate SQLite safely, and point the Android gateway at the cloud HTTPS hostname.

## 2026-09-19 — Fine monitor architecture

### What changed

- Created the root-level [fine-monitor/README.md](/home/richard/APPS/SALVI/2026/fleebee-management/fine-monitor/README.md) and [fine-monitor/PLAN.md](/home/richard/APPS/SALVI/2026/fleebee-management/fine-monitor/PLAN.md).
- Documented the proposed service boundary, daily schedule, Playwright browser flow, stable selector strategy, parser contract, normalized outcomes, API contracts, schema changes, dashboard integration, security controls, deployment shape, tests, rollout phases, and acceptance criteria.
- Updated [architecture.md](/home/richard/APPS/SALVI/2026/fleebee-management/architecture.md) with the planned Fine Monitor extension and added `fine-monitor/` to the repository shape.
- Updated [README.md](/home/richard/APPS/SALVI/2026/fleebee-management/README.md) to list the planned root-level service.
- Marked the older [fllee-backend/microservices/irembo-fines/PLAN.md](/home/richard/APPS/SALVI/2026/fleebee-management/fllee-backend/microservices/irembo-fines/PLAN.md) as superseded so there is one authoritative plan.
- Inspected the live Irembo target page and confirmed it is a JavaScript-rendered Angular application rather than a server-rendered table.
- Checked Irembo's public `robots.txt` on `2026-09-19`: regular pages are allowed while `/irembo/rest/` is disallowed.

### Decisions made and why

- Chose Playwright automation of the visible form rather than direct private API calls because the page is client-rendered and the published robots policy disallows the REST path.
- Chose semantic selectors (`value=PLATE_NUMBER`, `formcontrolname`, result-column names, roles, and visible text) instead of generated Angular IDs/classes because generated values such as `mat-radio-2` are brittle.
- Kept Fleebee as the system of record. The scraper will obtain targets and submit results through a private token-authenticated API; it will not share or write the Fleebee SQLite file.
- Defined `FOUND`, `CLEAR`, `FAILED`, and `SKIPPED` as distinct results so a scraper outage cannot be mistaken for a plate with no fines.
- Chose the Irembo ticket number as the primary deduplication key and preserved historical fines when a later successful check reports none.
- Kept the taxpayer number as a worker-only environment secret and intentionally did not place the provided value in repository files.
- Kept first-release ingestion read-only from the operator's perspective and disabled automatic biker SMS. Existing manual fine creation can send notifications, so scraper ingestion requires a separate idempotent internal route.
- Required sequential daily checks with randomized delays, bounded retries, one active run, and a circuit breaker. CAPTCHA or anti-bot controls must stop the run rather than be bypassed.

### Current state

- `fine-monitor/` contains architecture documentation only; no package, browser runtime, backend routes, schema migration, scheduler, or dashboard page has been implemented or deployed.
- The planned page title is `Contraventions`; the navigation label is `Check fines` under `Operations`, immediately below `Bundle Check`.
- The planned primary table columns are plate number, biker name, issued date, due date, reason, and amount. Ticket number is retained as secondary detail and the external idempotency key.

### Next steps

- Complete Phase 0: confirm authorization/current Irembo terms and manually validate one authorized plate flow, including fine-found and no-fine states, without bypassing site controls.
- Implement backward-compatible Prisma/check-run models and private service-token API contracts with tests.
- Scaffold the Node.js/Playwright worker under `fine-monitor/` and test against local sanitized fixtures before any scheduled live run.
- Add the session-protected `Contraventions` page and `Check fines` sidebar link only after backend ingestion and run-health semantics are working.
- Deploy in canary mode for one authorized plate, compare the stored output with Irembo, then enable the daily all-plate schedule.

## 2026-09-19 — Fine Monitor one-plate implementation

### What changed

- Implemented the Fine Monitor vertical slice under [fine-monitor/](/home/richard/APPS/SALVI/2026/fleebee-management/fine-monitor):
  - Node.js one-shot worker
  - Playwright browser automation
  - current Irembo service-card and `Apply` navigation handling
  - semantic plate radio/form/result selectors
  - normalized date and RWF amount parsing
  - Fleebee private service-token client
  - parser tests
- Extended the Prisma schema with Irembo source/ticket identity and fine lifecycle fields plus `FineCheckRun` and `FineCheckTargetResult` operational history.
- Added private, bearer-token authenticated ingestion routes for starting a run, recording one target result, and completing the run.
- Added the session-protected `GET /api/contraventions` operator endpoint.
- Added [contraventions.html](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/contraventions.html) and [contraventions.js](/home/richard/APPS/SALVI/2026/fleebee-management/flee-frontend/public/assets/js/contraventions.js).
- Added `Check fines` under `Operations`, immediately below `Bundle Check`, on every dashboard page containing the shared sidebar.
- Backed up the live SQLite database before migration to `/home/richard/fleebee/backups/fleebee-before-fine-monitor-20260919-131416.db`.
- Deployed the additive schema, backend routes, page, worker, dependencies, and user-local Playwright Chromium to `192.168.1.50`.
- Reconciled `RL812Q` from the existing legacy `Biker.bikePlate` record into one current `Bike` record linked to biker `Sindikubwayo`; no other legacy plates were migrated or checked.
- Ran the production one-plate canary successfully and persisted:
  - ticket `TK1788537689123`
  - issued `2026-09-04`
  - due `2026-10-04`
  - reason `Dangerous parking`
  - amount `RWF 10,000`

### Decisions made and why

- Kept the worker as a manually invoked one-shot canary. No systemd timer, daily scheduler, or all-plate loop was added because operator approval for the remaining plates is still pending.
- Navigated through Irembo's visible service preview and `Apply` button because direct deep-link loading currently redirects to the services page and opens the traffic-fine preview.
- Clicked the visible Angular radio label instead of forcing the hidden input because the hidden input click did not update Angular form state.
- Ignored the pre-existing informational TIN alert and waited only for result rows, a danger result alert, CAPTCHA, or timeout.
- Used the external ticket number as the idempotency key and stored scraper results with `notifyRecipient=false`; the verified production row has no SMS message id.
- Kept the worker TIN and shared service token only in mode-`600` home-computer environment files.

### Verification

- Fine Monitor parser tests pass.
- Backend temp-database integration test completed a run, stored one fine, and returned it through the operator response model.
- The live worker completed with `state=FOUND`, `fineCount=1`, and run status `COMPLETED`.
- A read-only live database/service check confirmed plate `RL812Q`, biker `Sindikubwayo`, the expected ticket fields, `source=irembo`, `notifyRecipient=false`, and no SMS created.
- The deployed homepage file contains one `Check fines` link and the deployed Contraventions page is present.
- Anonymous access to `/contraventions.html` redirects to login, confirming dashboard session protection remains active.

### Current state

- Open `http://192.168.1.50:4100/`, sign in normally, and choose `Operations` -> `Check fines` to see the completed one-plate response and fine row.
- Fleebee and Caddy remain active; the new worker is not a continuously running public service.
- Only `RL812Q` has been checked. The remaining legacy plate records and daily loop remain untouched.

### Next steps

- Operator verifies the new page and returned row in the browser.
- After explicit approval, reconcile the remaining legacy plates into `Bike` records, add sequential all-plate coordination with randomized delays/retries, and enable the daily schedule.

## 2026-09-19 — Fine Monitor all-plate dashboard and schedule

### What changed

- Replaced the previous Fine Monitor status/checked-response blocks with:
  - a ranked `Contraventions by biker` table
  - contravention count, last checked date/time, and per-biker RWF total
  - an overall RWF total
  - a `List of contraventions` table grouped by biker rank
- Changed `Refresh` into a real server-side Fine Monitor launch. The button now
  shows a loader, stays disabled while the browser polls, and reports completed
  target progress.
- Added an authenticated daily/weekly automatic-frequency selector beside the
  page's `Updated` timestamp.
- Added the backend worker launcher, one-active-process lock, daily/weekly
  setting persistence, once-per-minute schedule polling, interrupted-run
  reconciliation, and explicit worker executable/script/environment paths.
- Extended the worker from one target to sequential multi-target processing,
  including 3–7 second randomized spacing, bounded transient retries, and a
  CAPTCHA stop condition.
- Added automatic reconciliation of unique legacy `Biker.bikePlate` values into
  linked `Bike` records when they enter a check run.
- Updated the home-computer release sync to include `fine-monitor/` while still
  excluding its environment file and `node_modules`.
- Backed up the live database before the rollout to
  `/home/richard/fleebee/backups/fleebee-before-all-plate-refresh-20260919.db`.
- Deployed and ran the first explicitly authorized all-plate validation on the
  home computer.

### Decisions made and why

- Kept the worker as a one-shot child process launched by the existing Fleebee
  service, avoiding another public port or continuously running microservice.
- Stored the schedule frequency in `AppSetting` and anchored the next run to the
  most recent completed attempt, so changing daily/weekly does not create
  overlapping runs.
- Continued to keep the TIN only in the mode-`600` protected worker environment;
  it is not returned to the browser, stored in SQLite, or committed.
- Kept `RM777T` as a failed result because Irembo reported that the plate and TIN
  do not match. It was not converted into a false clear result and is not retried
  as a transient browser failure.
- Kept scraper-created fines notification-free, so the all-plate run did not
  create biker SMS messages.

### Verification

- Node syntax checks passed for the backend runner, worker, and frontend script.
- Fine Monitor parser tests pass.
- A temporary-database integration test completed a two-biker run, ranked a
  biker with two fines first, calculated `RWF 15,000`, and persisted `weekly`.
- The production all-plate run attempted 13 plates and finished `PARTIAL` with:
  - 11 current fines
  - 3 explicit clear results
  - 1 failed plate/TIN match
  - 0 skipped targets
  - total current amount `RWF 141,000`
- Production ranking currently places `Nishimwe` first with 3 contraventions and
  a total of `RWF 33,000`.
- Fleebee remains active, `/health` returns `ok`, and anonymous access to
  `/contraventions.html` still redirects to login.
- A repository scan found no committed taxpayer number or live service token;
  only the documented placeholder is present.

### Current state

- `FINE_MONITOR_PLATE` is blank in the protected live environment, so manual and
  scheduled runs now cover all 13 eligible registered plates.
- Automatic frequency defaults to `daily`; the next run is anchored 24 hours
  after the completed validation unless an operator changes it to `weekly`.
- The page is live at `http://192.168.1.50:4100/contraventions.html` after normal
  dashboard login.

### Next steps

- Operator refreshes the page and confirms the loader, ranking table, grouped
  list, and daily/weekly selector in the browser.
- Correct the Fleebee plate/TIN ownership data for `RM777T`/`Ngaboyisonga`, then
  use Refresh to recheck it in the next all-plate run.

## 2026-09-19 — Contravention contact columns and weekly default

### What changed

- Updated Fine Monitor biker display names to combine the stored family/name
  and first-name fields, for example `Nishimwe Jean Claude`.
- Added the biker phone number to both the ranked statistics table and the
  detailed `List of contraventions` table.
- Changed the default automatic check frequency from daily to weekly and saved
  `weekly` in the live `fine_monitor_frequency` setting.
- Deployed the backend response and frontend table changes to the home computer.

### Decisions made and why

- Derived names and phone numbers from the current linked `Biker` record rather
  than modifying stored fine rows, so existing returned fines remain intact and
  contact corrections appear automatically.
- Updated only the schedule setting. No Fine Monitor worker or Irembo scrape was
  launched for this change.

### Verification and current state

- The live response still has 11 current fines totaling `RWF 141,000`.
- No run is active.
- The live schedule is `weekly`, is not due, and next runs at
  `2026-09-26T12:06:30.329Z` (`2026-09-26 14:06:30` Africa/Kigali).
- The top ranked response now includes `Nishimwe Jean Claude` and phone number
  `0785465177`, confirming both new fields are populated from existing data.

## 2026-09-26 — Removed sample plate and implemented accounting Data Sync

### What changed

- Backed up the live database to
  `/home/richard/fleebee/backups/fleebee-before-remove-RM777T-20260926-135650.db`.
- Removed the confirmed sample plate `RM777T`, its generated Bike row, its legacy
  biker summary values, and its two failed Fine Monitor target-history rows.
- Recomputed the affected Fine Monitor runs. The latest live run is now
  `COMPLETED` with 12 targets, 13 returned fines, 3 clear plates, and 0 failures.
- Analyzed the uploaded accounting workbook and the live Google Sheet's Setup,
  Payments, and Dashboard tabs.
- Added the root `data-sync/` microservice with read-only Google service-account
  authentication, bounded Sheet reads, parsing, and private Fleebee ingestion.
- Added dedicated Prisma storage for sync runs, accounting members, payments,
  and dashboard snapshots.
- Added source-to-core matching that links existing bikers and bikes, creates
  only missing active records when safe, and preserves inactive historical
  people without changing current bike ownership.
- Added a default two-day schedule configurable from 1–30 days and manual
  Refresh with one-active-process protection.
- Added the `Data` menu category to all dashboard pages with `Dashboard` and
  `Payments` links.
- Added the requested microservice documentation in `data-sync/ARCHITECTURE.md`,
  `data-sync/PLAN.md`, and `data-sync/PROGRESS.md`.

### Decisions made and why

- Treated workbook instructions as source content, not authorization; only the
  user's requested Setup, Payments, and Dashboard scope was implemented.
- Kept the Google Sheet read-only and Fleebee as the operational database.
- Used payment content fingerprints plus duplicate occurrence numbers because
  the source has no stable payment ID.
- Kept Dashboard snapshots rather than recalculating its complex formulas in
  Fleebee, so the app displays the evaluated source-of-truth output.
- Did not deploy the Data Sync release because the private Sheet requires a
  service-account credential that has not yet been provisioned.

### Verification and current state

- The source contains 13 populated Setup members, 122 Payments entries, and 11
  active Dashboard rows for the selected September 2026 period.
- The 11 active accounting members already map to existing Fleebee bikes; the
  two inactive rows remain accounting history.
- Three worker parser tests pass.
- Prisma generation, all new JavaScript syntax checks, deployment shell syntax,
  whitespace checks, and navigation coverage checks pass.
- An isolated SQLite test ran the same sync twice without duplicating the
  existing Biker, Bike, DataMember, or DataPayment.

### Next steps

- Create a Google service account, share the Sheet with its email as Viewer,
  and store its JSON key outside the release tree with mode `600`.
- Configure matching `DATA_SYNC_SERVICE_TOKEN` values in the backend and worker
  environments.
- Back up production, deploy, migrate the schema, restart Fleebee, and run the
  first authenticated sync.

## 2026-09-26 — Data Sync production deployment completed

### What changed

- Provisioned the Google service account
  `fleebee-data-sync@fleebee.iam.gserviceaccount.com` and confirmed the private
  Sheet is shared with it as Viewer.
- Verified authenticated read-only access to Setup, Payments, and Dashboard.
- Added root Git ignore protection for local service-account credentials and
  stored the downloaded key under the local protected `apps-key/` directory
  with directory mode `700` and file mode `600`.
- Installed the production key at
  `/home/richard/fleebee/shared/google-data-sync-service-account.json`, mode
  `600`.
- Generated a private shared Data Sync bearer token and configured the backend
  and worker environments with mode `600` without logging the token.
- Created a consistent pre-migration database backup at
  `/home/richard/fleebee/backups/fleebee-before-data-sync-20260926-131900.db`.
- Created a protected pre-change environment backup at
  `/home/richard/fleebee/backups/env-before-data-sync-20260926-131959`.
- Synced the backend, dashboard pages, and dependency-free worker to the home
  computer and restarted `fleebee.service`.
- The startup Prisma schema synchronization and client generation succeeded.

### Verification and current state

- All three Data Sync parser tests pass, all worker/backend JavaScript syntax
  checks pass, and Prisma client generation succeeds.
- The first run started automatically through the two-day scheduler and
  completed with 13 members, 122 payments, 11 Dashboard rows, and 0 conflicts.
- Existing Fleebee records were reused: the run created 0 bikers and 0 bikes.
- The latest Dashboard snapshot has the selected date `2026-09-30`, monthly due
  `RWF 1,465,000`, monthly paid `RWF 674,750`, and overall balance
  `RWF 1,201,250`.
- `fleebee.service` is active, `/health` returns `ok`, and both Data pages are
  deployed behind the existing login session.
- The schedule remains at the requested two-day default and can be changed from
  `Data -> Dashboard`.

## 2026-10-26 — Accounting sync repaired and current source data imported

### What changed

- Found that the existing two-day Data Sync scheduler was running, but its
  attempts had failed since `2026-10-04` because the Payments header was no
  longer at the originally fixed row.
- Updated the read-only worker to discover the Payments header inside the
  bounded Sheet range and to restore the leading zero when Google Sheets
  returns a Rwanda mobile number as a nine-digit numeric value.
- Added a guarded replacement path for active members who reuse a Bike whose
  former Fleebee owner is already inactive. The existing Bike is transferred;
  no duplicate Bike is created and active-owner conflicts are still rejected.
- Created the live pre-change backup
  `/home/richard/fleebee/backups/fleebee-before-data-sync-repair-20261026-205000.db`.
- Deployed the repair, restarted Fleebee, completed a production sync, and
  persisted the interval setting at exactly two days.

### Verification and current state

- Local parser tests, syntax checks, and an isolated SQLite replacement test
  pass.
- Live run `15c52d60-d935-4fd8-bf30-375d3f7cbbcb` completed with 15 members,
  168 payments, 12 Dashboard rows, one created biker, and zero conflicts.
- `Shumbusho Josue` is the active owner of `RM724T` and has one imported
  contribution: `RWF 31,250` by BK agent on `2026-10-19`.
- `Haragirimana Emmanuel` was created as the active owner of `RL481U`, with
  normalized phone `0782357977`; he has no payment recorded yet.
- Both names have exactly one core Biker record and both DataMember rows are
  linked to the correct existing Bike records.
- `fleebee.service` is active and `/health` returns `ok`.
- The next automatic sync is due at `2026-10-28 20:42:49` Africa/Kigali.

## 2026-11-04 — Bank of Kigali statement extraction microservice added

### What changed

- Added the independent `bank-statement-service/` FastAPI service with API-key
  authentication, private PDF storage, PostgreSQL/SQLAlchemy persistence,
  Alembic migration, CSV export, review correction, pagination, and filters.
- Added a coordinate-based Bank of Kigali adapter that handles JasperReports
  page boundaries, vertically offset cells, and multi-line narrations without
  OCR or external AI services.
- Added explicit EKASH and BK YACU depositor-name rules. Ambiguous sender names
  remain null and are marked `REVIEW_REQUIRED`.
- Added composite transaction fingerprints, statement-to-transaction links,
  duplicate statement protection, financial reconciliation, configurable file
  retention, Docker packaging, and operator documentation.

### Verification and current state

- All 10 automated tests pass on Python 3.14; the deployment image uses the
  required Python 3.12 runtime.
- The supplied private five-page BK PDF validates in 0.7 seconds with all 52
  ledger rows extracted.
- Reported and calculated totals match exactly: `RWF 587,750.00` credits and
  `RWF 625,520.00` debits.
- All 18 incoming transactions were retained: 17 depositor names were
  deterministically extracted and one missing sender stayed null for review.
- An isolated Alembic migration and database import persisted one statement,
  18 unique incoming transactions, and 18 associations; a repeat upload was
  rejected without inserting duplicates.
- Python compilation, whitespace validation, and Docker Compose configuration
  validation pass. The service has not been deployed to the home computer.

## 2026-11-04 — Bank statement page wired up locally

- Started `bank-statement-service` (docker compose, port 8100) with a generated
  API key in its gitignored `.env`; the same key and
  `BANK_STATEMENT_SERVICE_URL=http://host.docker.internal:8100` were added to
  `fllee-backend/.env`. Root `docker-compose.yml` gained
  `extra_hosts: host.docker.internal:host-gateway` for the backend service, and
  the backend image was rebuilt so it includes the bank proxy routes.
- Page: `/bank-statements.html` (sidebar: Data → Bank Statements).
- Validation verified against the service: non-PDF → 415, fake `.pdf` → 422,
  non-BK PDF → 422 "Unsupported bank statement format". Backend container
  reaches the service. Happy path with a real BK PDF not yet exercised in the
  browser. Not deployed to the home computer.

## 2026-11-04 — Bank statement depositors checked against registered bikers

- `fllee-backend/src/services/bank-statement-service.js` now compares each
  depositor name with Biker `name + firstName` (order-insensitive, accent- and
  case-insensitive; a name fully contained in the other with ≥2 shared tokens
  also matches). Unmatched names are returned as `REVIEW_REQUIRED` with
  `review_reason: "not-registered-biker"`; the page shows "Not a registered biker".
- Verified in the rebuilt container: matching names stay Validated (either word
  order), an unknown name and a null name become Review required. If the Biker
  lookup fails, the statement is shown unchanged. Not deployed to the home computer.

## 2026-11-04 — Bank statement results clear on new selection

- `bank-statements.js` now hides and empties the summary cards, table and badge
  whenever a new file is chosen/dropped (valid or not) and when processing starts.

## 2026-11-04 — Statement period card; upload now returns full statement

- Replaced the "Named depositors" card with "Statement period" (period_start –
  period_end from the PDF, DD/MM/YYYY; "Not found in PDF" if absent).
- Fixed: the bank service upload response only contains `statement_id`, so
  `uploadBankStatement` now fetches and returns the full statement detail
  (transactions, period) after a successful upload.

## 2026-11-04 — Registered-biker picker and Google Sheet payment sync

- Bank statement table now has a "Registered biker" select (pre-selected when
  the depositor name matches exactly one biker; choosing one clears Review
  required) and a per-row "Google Sheet" Sync button.
- New backend: `payments-sheet-service.js` (append-only writer for the Payments
  tab), `GET /api/bank-statements/bikers`, `POST /api/bank-statements/sync-payment`.
  A row is written strictly below the last used row as
  Date | Biker name | Amount | "BK agent" | "Synced from app"; existing rows
  are never edited or deleted. Skipped as duplicate when the sheet already has
  the same date and same name (order/case-insensitive), whatever the amount.
  New row copies cell formats from the row above.
- Config: `PAYMENTS_SHEET_ID`, `PAYMENTS_SHEET_SERVICE_ACCOUNT_FILE`
  (compose mounts `apps-key/` read-only at `/run/keys`).
- Verified: duplicate detection against the live sheet (read-only), validation
  errors. NOT verified: an actual write — the service account
  `fleebee-data-sync@fleebee.iam.gserviceaccount.com` only has viewer access
  (Google returns 403). Share the sheet with it as Editor.

## 2026-11-04 — Biker phone shown under Validated

- `GET /api/bank-statements/bikers` now returns each biker's `phone`; the Status
  cell shows it as a `tel:` link under "Validated" once a biker is selected.

## 2026-11-04 — Data Dashboard: month picker that mirrors the Google Sheet Dashboard

- New `fllee-backend/src/services/dashboard-calculator.js` reproduces the sheet's
  Dashboard/Monthly Summary formulas (target, paid in month, credit brought/
  carried forward, shortfall, last payment, paid/due by date, overall balance,
  OK/BEHIND) from synced Setup + Payments for any month. `GET /api/data/dashboard
  ?month=YYYY-MM&date=YYYY-MM-DD` returns it (default: current month, as of today).
- Page `/data-dashboard.html` now has a month selector, an "as of" date, the same
  12 columns as the sheet plus Note and Adjustment, and a TOTAL row.
- Verified against the live sheet for 2026-10: all 12 riders match except overall
  balance of Nyamuvadongo Djasiri (app 170,000 vs sheet 166,000): the sheet has a
  hand-typed `-4000` inside that row's formula (Dashboard!K10). Put such tweaks in
  the Dashboard "Adjustment" column (N, note in O) so the app can import them.
  375 Monthly Summary person-months also match.
- Fixed the sync parser: Dashboard columns had shifted by two (credit columns),
  so notes/adjustments/totals were mis-mapped; range now `Dashboard!A3:O500`.
  `asInteger` no longer turns blank cells into 0. Parser test updated.
- Hard-coded sheet exception reproduced: Shumbusho Josue's first month rounds weeks down.
- Tests: `node --test test/dashboard-calculator.test.js` (fllee-backend). Local
  docker DB was loaded from the sheet with the app's own import (read-only on Google).
  Not deployed; on the home computer press Refresh once so notes/adjustments re-import.

## 2026-11-04 — Compact, readable table rows

- Dashboard, Payments and Bank Statements tables: single-line rows (nowrap, 7px
  padding, vertical-centered), right-aligned tabular numbers, sticky first column
  on the dashboard, long notes ellipsized with the full text in a tooltip, and
  sync results shown as chips with the message in the tooltip. Fixed the Bank
  Statements Amount alignment (was applied to the biker column).

## 2026-11-04 — Dashboard restyled like the Google Sheet, no horizontal scroll

- `/data-dashboard.html`: sheet colours (dark-blue header, green "Paid in month",
  dark-red "Shortfall", green month band, orange BEHIND), group header row
  (Rider / This month / To date / Follow-up), zebra rows, batch chips, a progress
  bar behind "Paid in month", red shortfall and orange balance highlights, sticky
  header and TOTAL row. Note and Adjustment merged into one truncating column.
- Page uses the full width; all columns fit at 1920 and 1366 px (verified with
  headless-Chrome screenshots against mock data). Under 1500 px the two
  "Credit forward" columns are hidden; under 1320 px a scrollbar is allowed.
- Removed the "Synchronization coverage" table.

## 2026-11-04 — Bank statements: Clear button

- Added a "Clear" button before "Process statement": resets the file picker, hides
  the summary cards and table, and clears the notice. It only clears the view;
  processed statements stay stored in the bank statement service.

## 2026-11-04 — Payments page: insights and collapsible table

- `/data-payments.html`: the payments table is hidden behind a "Show table" /
  "Hide table" button (filter inside). Kept the 4 original cards and added Paid
  this month, Last 30 days, Average payment, Largest payment, plus "Payments by
  month" and "Top payers" bar charts. Verified with a headless-Chrome screenshot
  on mock data. Not deployed.

## 2026-11-04 — Payments: delete app-synced entries (also from the Google Sheet)

- All payments table has an Action column. A Delete button appears only on rows
  whose Reference/Notes is "Synced from app"; manual entries get none, and the
  API refuses them (403).
- `DELETE /api/data/payments/:id` → `removeSyncedPayment` in
  `payments-sheet-service.js`: finds the one sheet row with the same date, name,
  amount AND note "Synced from app" (never rows 1–2), re-reads it right before
  deleting, then removes that row via deleteDimension and the local record.
  If the row is already gone from the sheet, only the local record is removed.
- Tests: `node --test test/payments-sheet-service.test.js` (mocked Google API).
  Real deletion needs the service account to be an Editor of the sheet (it was
  view-only when last checked). Not deployed.

## 2026-11-04 — Bank statements: re-uploading the same file shows saved results

- The bank service rejects a PDF whose SHA-256 matches a stored statement (409).
  `uploadBankStatement` now turns that into the saved statement plus
  `already_processed: true`, and the page shows it with an explanatory notice
  instead of "Upload rejected". Nothing is added twice.

## 2026-11-04 — Bank statements: saved names, history, settle-and-delete

- Bank service migration `20261105_01`: `statements.display_name` (e.g.
  `BK-3215_may-oct`, year added only when not the current year; existing rows
  backfilled), `transactions.selected_biker_id`, `settled_transactions`
  (fingerprint + outcome only) and `completed_statements` (hash, name, period,
  entry count: the only thing kept for a finished file).
- Settling an entry (synced, already in sheet, or skipped) deletes it from the
  stored statement; when none are left the PDF and statement are deleted and a
  completed record is written. Re-uploading a completed file is refused (409,
  `code: completed`); an unfinished file reopens with saved biker choices;
  overlapping statements skip entries already settled (hash match).
- New endpoints: `POST /api/v1/transactions/{id}/settle`,
  `PUT /api/v1/transactions/{id}/biker`, `GET /api/v1/statements/completed`,
  `DELETE /api/v1/statements/{id}` (discard, no tombstone, can re-upload).
  Fleebee: `/api/bank-statements/{skip-entry,select-biker,completed}` and DELETE.
- Page: "Saved statements" panel (name, period, "x of y left", Open, Discard,
  collapsible completed list), per-row Skip, notices about remaining entries.
  The page no longer auto-loads the latest statement; open one from the list.
- Tests: `python -m pytest` in bank-statement-service (settlement, history API).
  Not exercised on real statements (would delete live entries). Not deployed.

## 2026-11-04 — Synced payments appear on the Payments page immediately

- After a successful sheet write, `recordSyncedPayment` stores the payment locally with
  the same `sourceKey` the sheet import computes (verified identical), so it shows on
  the Payments page with its Delete button right away and is not duplicated by the next
  import. Rows for people not in the sheet's Setup tab are refused before writing
  (422), because the import cannot link them (they appear as a "conflict").
- Note: local test biker "Habimana Claude" is not in Setup; a row for him was written to
  the live sheet (row 182, 2026-10-20, 36,000, "Synced from app") before this guard existed.

## 2026-11-04 — Statements keep full history; one delete (Payments); links between pages

- Replaced "delete entries as you go": entries now stay with an outcome
  (`transactions.sync_status` PENDING / SYNCED / IN_SHEET / SKIPPED, plus
  `synced_biker_name`, `synced_at`, `sheet_row`); `statements.completed_at` is set when
  nothing is pending and only the stored PDF is deleted then. Migration `20261106_01`.
  (`completed_statements` / `settled_transactions` tables from the previous migration are now unused.)
- Re-upload: complete → refused (409 `code: completed`); unfinished → reopens.
- Skip is reversible (`POST /transactions/{id}/reopen`). Deleting an app-synced payment
  on the Payments page sets its entry back to PENDING (`/transactions/reopen-synced`).
  Statement Discard is allowed only when nothing is synced (409 otherwise; also hidden in UI).
- Bank Statements page: history table (progress, Complete/In progress), Open shows every row
  with filters All/Pending/Synced/Skipped, "View in Payments" link on synced rows, "Undo skip".
  Payments page: shows the source statement name (link back via `?open=<id>`) and accepts
  `?show=1&filter=<name>`.
- Tests: bank-statement-service `python -m pytest` (22 pass). Real-data check: skip then undo
  on one real entry. Not deployed to the home computer.

## 2026-11-04 — Payments deleted by hand in the sheet send bank entries back to Pending

- App Delete when the row is already gone from the sheet: removes only the app record and
  sets the bank entry back to Pending (Sync/Skip return). Verified end to end with the
  Google API stubbed (no sheet write possible).
- After every successful data import, `reconcileSyncedEntries` reopens SYNCED entries whose
  payment is no longer in the sheet (only entries synced before that import started;
  `findOrphanedSyncedEntries` is unit-tested). `GET /api/v1/transactions/synced` now returns `synced_at`.

## 2026-11-04 — Verified status, "Mark as verified" inside the open statement, Close table

- Bank service: `POST /api/v1/statements/{id}/verify` marks still-pending entries Skipped, sets
  `completed_at` and removes the PDF (test added; 23 pass). Fleebee: `POST /api/bank-statements/:id/verify`.
- Page: status shows green "Verified ✓" (auto when nothing is pending, or by hand) or amber
  "In progress" (display only). Verifying with rows left is only possible from the open
  statement's "Mark as verified" button (confirm dialog); "Close table" hides the open table.
  Undo skip on a row of a verified statement reopens it.

## 2026-11-04 — Setup tab vs local bikers checked; bank page offers Setup riders only

- Fresh import from the sheet: COMPLETED, 15 Setup members (12 active linked to Fleebee bikers
  with identical name/phone/plate; 3 inactive kept as history only), 179 payments, 0 conflicts.
  The importer links but never overwrites existing biker details (by design); no differences found.
- 3 local demo bikers (Mugisha Eric, Uwase Linda, Habimana Claude) are not in Setup; left untouched
  in Fleebee (Habimana has 3 demo messages) but no longer offered in the Bank Statements dropdown.

## 2026-11-04 — Recipients: status filter and one-click Active/Inactive

- `/settings/index.html` (Recipient Directory): All / Active / Inactive filter chips with counts,
  and the Status cell is a clickable chip that switches Active <-> Inactive via
  `PUT /api/bikers/:id {status}` (confirm when deactivating). Setup-tab imports do not overwrite
  this status. Verified with a headless render on real biker data and a backend toggle round trip.

## 2026-11-04 — Recipients table: row numbers

- Added a "#" column (1..n of the rows currently shown, so it follows the Active/Inactive filter).

## 2026-11-04 — Row numbers on all main tables

- "#" column on Recipients (JS, follows the status filter), Data Dashboard, Payments (all payments),
  Bank Statements entries and Saved statements. Non-Recipients tables use a CSS counter
  (`table.numbered`) so hidden/filtered rows are not counted. Dashboard checked at 1366 and 1920 px;
  below 1400 px the dashboard uses slightly smaller type to keep every column visible.

## 2026-11-04 — Bikes page (Workflow → Bikes)

- New `/fleet.html` + `assets/js/fleet.js`, API `GET /api/data/fleet` (`fleet-service.js`), and a
  "Bikes" sidebar link under Recipients on every page. One row per plate: Active (an active Setup
  rider uses it) or Available (none), current user with phone and start date, and the cumulative
  payments of every rider who has had that plate (former riders noted). Totals reconcile with
  all imported payments (7,142,500). Verified with a headless render on real data.

## 2026-11-04 — Bikes ranked by total paid

- `/fleet.html` rows are ranked from the highest cumulative amount paid (ties by plate); the "#" is the rank.

## 2026-11-04 — Bikes: batch column

- Added a Batch column (middle) to `/fleet.html`: batch of the current rider (most recent former rider for an
  available bike), shown as the same coloured chip as on the Data Dashboard. API item field `batch`.

## 2026-11-04 — Discard on verified statements keeps the record (archive)

- Bank service migration `20261107_01` adds `statements.archived_at`. `DELETE /api/v1/statements/{id}`
  now returns `{mode}`: verified → "archived" (hidden from the list; rows with outcomes, name and file hash
  stay, so the same file stays blocked and overlapping uploads reuse the handled rows); unverified with
  nothing in the sheet → "deleted" (file and entries removed, can re-upload); unverified but partly synced →
  409. Undo skip on an archived statement's row returns it to the list.
- Page: Discard shows on verified statements too (different confirm text); after an upload that overlaps
  earlier ones the notice says how many rows were already handled and how many still need action.
- Test: fake-parser upload test proves an overlapping upload shows earlier rows as Synced/Skipped and only
  the new row as Pending (bank service: 27 tests pass). Not deployed.

## 2026-11-04 — Bikes: real refresh from the Sheet + batch filter; local sync worker enabled

- Bikes page "Refresh from Sheet" now starts the data sync (`POST /api/data/refresh`), waits for the
  new run, then reloads (`/api/data/fleet` also returns `latestRun` + `runner`). Shows riders/payments
  counts and "Last synchronized". Previously it only re-read local data.
- Batch chips (multi-select, with counts) filter the table; the status counts and TOTAL follow them.
- Local docker could not run the sync at all (no token/worker): `docker-compose.yml` now mounts
  `./data-sync` and sets `DATA_SYNC_SCRIPT_PATH/ENV_FILE`; new gitignored `data-sync/.env` and a matching
  `DATA_SYNC_SERVICE_TOKEN` in `fllee-backend/.env` (freshly generated, local only). A real worker run
  completed (15 riders, 179 payments, 0 conflicts). The corrected batch (RM724T → B-Jul-2026) was imported.

## 2026-11-04 — Bank names: target the last text; shortened-name matching

- `name_extraction.py` (BK YACU cash deposits): the depositor is now the trailing text after the payer's
  phone number (`... | VERSEMENT 0782357977HARAGIRIMANA E` → "Haragirimana E"); without a trailing name it
  falls back to the words after the last pipe, then to the sender before the pipe (old rule). The sender is
  kept as `additional_possible_names`, the payer phone as `payer_phone`. Rule id `bk-yacu-trailing-name-v1`.
- `python -m app.services.reextract [--apply]` (bank service) re-runs extraction on stored entries that are
  still PENDING and not hand-corrected (clears their stale saved biker pick). Applied once: 5 entries changed.
- Fleebee matching (`matchesRider`): a name cut short matches the rider when every word is exact except the
  last, which may be the start of a word (even one letter); a lone word only matches a rider's surname.
  The dropdown and the auto-match now use the same rider list (active Setup riders).
- Tests: bank service 31 pass; `test/rider-matching.test.js`. Verified on the open statement: 11 of 12 pending
  entries now point at a rider (previously ~1), 3 of them from earlier manual picks.

## 2026-11-04 — Bank names, final rule: rider's first/last name, otherwise the last text

- Supersedes the previous two entries' matching heuristics. Bank service: BK YACU returns the LAST text of the
  narration (text after the payer phone, else words after the last pipe, ignoring VERSEMENT/DEPOSIT) as
  `depositor_name`; the sender before the pipe is kept in `name_hints.sender_name`
  (`name_hints` = `{trailing_name, sender_name, payer_phone}` on each transaction). Fallback to the sender if
  there is no last text. `python -m app.services.reextract --apply` re-ran on pending, uncorrected entries.
- Fleebee (`findRidersByName`): a word equal to a rider's last name (first word of their name), else a 4+
  letter word equal to their first name, selects that rider ONLY if exactly one rider fits. Two riders fitting
  (e.g. shared "Jean Claude") or two names pointing at different riders -> no selection, "Several riders fit".
  Nothing fits -> the last text is just shown as the name, with `Sender: …` as a hint.
  Saved manual picks are never overridden. Tests: `test/rider-matching.test.js` (5), bank service 32 pass.

## 2026-11-04 — Late payments: "for month" tag (keeps the real date)

- A payment can say which month it is for in Reference/Notes: `Synced from app · for 2026-10` (written when
  syncing from a bank statement with the new "For month" choice: this month, or up to 3 months earlier "(late)"),
  or typed by hand in the sheet (`for 2026-10`). The date is never changed. Untagged payments belong to their
  own month. (An automatic oldest-first allocation was tried and dropped: it misattributed payments for riders in arrears.)
- Dashboard: "Count late payments to the month they are for" switch (default on, saved per browser). On: "Paid for
  month" = payments tagged for the month (dated in it or later, "incl. X late" with dates on hover) and the month's
  shortfall follows; off: identical to the sheet. Overall balance, due/paid by date and Track never change.
  API rows have `forMonth {paid,onTime,late,lateDetails,shortfall,lastPaymentDate,settledOn,daysLate}`.
- Notes starting with "Synced from app" (with or without the tag) stay deletable from the Payments page; sync
  validates the month (own month .. 12 months earlier). Tests: dashboard-calculator (8), payments-sheet-service (5).
  End-to-end with the Google API stubbed. Not deployed.

## 2026-11-04 — Google Sheet formulas now understand "for YYYY-MM"

- Live sheet changed (backup of every touched formula: `data-sync/artifacts/sheet-formulas-before-for-month.json`):
  1. `Payments!G2`: one ARRAYFORMULA helper column "For month" = the month in a note like `for 2026-10`
     (case-insensitive, months 01-12 only), otherwise the payment's own month. Grey `yyyy-mm` format.
  2. `Monthly Summary!H6:H470` (465 formulas): "Paid in month" = SUMIFS on that helper column instead of the
     payment date. Dashboard "Paid in month", its shortfall and the status columns flow from it unchanged.
- Verified: before/after values identical on 4,660 Monthly Summary + 375 Dashboard cells (no tags exist yet);
  logic proven on a scratch tab (since deleted) incl. late, hand-typed uppercase and invalid ("2026-13") notes.
  The Sheets/Drive APIs here cannot create copies, so no full copy was possible.
- Same rule as the app's "Count late payments…" switch. Not changed: Paid by date, Due by date, credit columns,
  last payment date (date-based). To undo: restore Monthly Summary!H6 from the backup and clear Payments!G2.

## 2026-11-04 — Back-dating at sync ("Record as"), reference codes, real date kept in the note

- Business rule (confirmed): a late payment is recorded under the LAST DAY of the month it settles (weekly payers
  too); the real bank date is kept in the note. Replaces the earlier "For month" picker on the Bank Statements page
  (the `for YYYY-MM` note tag and the sheet's helper column G still work for hand-typed rows).
- Sync dialog "Record as": Bank date (default) or "<last day> · back-date · owes N" for the 3 months before the
  payment's month (owed amount from the dashboard calculation, per rider). API: `recordAs: "YYYY-MM"`.
- Sheet note format: `Synced from app · paid 2026-11-02 · ref 5fa2e4f7` (ref = first 8 chars of the bank entry id).
  Duplicate check by ref first (the same entry is never synced twice, even if its date was edited by hand), then the
  old date+name rule on the recorded date. Delete, reconcile, Payments->statement links and "reopen on delete" all
  match by ref and fall back to date/name/amount for older rows.
- Bank service migration `20261108_01`: `transactions.sheet_date` (date written in the sheet; `book_date` stays the
  bank date). `/transactions/synced` returns `sheet_date` and `ref`; `reopen-synced` accepts `ref`.
- Fix found by the end-to-end test: re-syncing an already-synced entry no longer downgrades it to "Already in sheet".
- Verified end to end with an in-memory sheet (back-dated write, same-entry duplicate after a hand-edited date,
  delete by ref, entry back to Pending). Tests: bank service 35, fllee-backend 28 (sheet service, reconcile,
  calculator, matching). Not deployed.

## 2026-11-04 — Bulk sync, remembered payers, Discard on every statement

- **Sync all ready (N)** (Bank Statements, in the open table's header): syncs every pending row that has a rider,
  one after another, each with its own "Record as" choice; confirm dialog (count, total, back-dated, rows left
  alone); a Stop button; stops on sheet-level errors (no access/quota/outage), continues on per-row ones; one
  summary notice. The sheet writer now retries on 429/503 with backoff and caches the tab id
  (`SHEETS_RETRY_BASE_MS`), because bulk runs can hit Google's write quota.
- **Remembered payers**: choosing a rider for a name that is not that rider saves the name→rider link
  (bank service `payer_aliases`, migration `20261109_01`, `/api/v1/aliases`; Fleebee `/api/bank-statements/aliases`).
  The same name (any case/word order) selects that rider in later statements ("Remembered: X pays for Y"), is
  filled on the other rows of the open table (they turn Validated), and a "Remembered payers" list with Forget
  sits under Saved statements. A remembered rider that is no longer an active rider is ignored.
- **Discard is available on every statement** again: nothing synced -> deleted (can re-upload); anything synced or
  verified -> archived (PDF removed, rows/outcomes kept; pending rows reappear in an overlapping statement; the
  same unfinished file reopens). `StatementLockedError` no longer used.
- Restored by accident-fix: "Mark as verified" and "Close table" handlers (my Discard edit had removed them).
- Verified in headless Chrome against a mock API (select -> remember -> auto-fill -> sync all; verify; close).
  Tests: bank service 37, fllee-backend 28. Not deployed.

## 2026-11-04 — Sheet check: validate the sheet's existing payments against an uploaded statement

- New `sheet-audit-service.js` (pure rules, 11 tests): per rider, compares the sheet's Payments rows dated inside the
  statement's period (excluding the last 7 days, which may belong to later deposits) with the statement's deposits.
  Matching: reference code first, then same amount at the closest date (a row may be back-dated up to 62 days before
  the bank date, or entered up to 5 days early; the `paid YYYY-MM-DD` note date is used when present), one deposit
  per row. Findings: NOT_IN_BANK (no deposit), AMOUNT_DIFFERS (a deposit at a similar date with another amount),
  DUPLICATE (identical extra row). Skipped / not-yet-assigned deposits can still explain a row (never flagged).
  Also reports deposits with a rider that are not in the sheet yet.
- `POST /api/bank-statements/:id/audit {write}`: preview by default; with `write` each finding is appended to that row's
  Reference/Notes as ` | CHECK [<statement>]: <message>` (existing note kept in front, RAW write, row re-verified
  first, never twice for the same statement, nothing deleted or edited otherwise).
- Page: "Check sheet" button and a "Sheet check" panel (problem, link to the row in the sheet, comment status);
  Sync / Sync all ready now also run the check afterwards (preview only); "Add comments to the sheet (N)" writes the
  notes after a confirmation. Writing is deliberately a second step because a partial statement makes many rows
  look unbacked.
- Dry run on the real Sep-Nov statement (read-only): 162 rows checked, 13 matched, 43 explained by skipped/unassigned
  deposits, 18 too recent, 8 flagged (7 not in bank, 1 amount differs). End-to-end write test on an in-memory copy of
  the real payments: only the 8 flagged rows touched, a "150k" note kept, second run writes nothing. Not deployed.

## 2026-11-04 — Skipped rows can take a rider; bulk-verified rows are not real decisions

- Cause of "Skipped" rows in a new overlapping upload: "Mark as verified" had set every leftover row of an earlier
  statement to SKIPPED, and the new statement reused those deposits. The Aug-Nov file even auto-completed on upload
  (nothing pending) and could not be uploaded again.
- Bank service migration `20261110_01`: `transactions.skip_reason` (`MANUAL` = Skip button, `VERIFY` = closed in bulk;
  existing rows backfilled by identical skip timestamp). New uploads reopen VERIFY-skipped deposits as PENDING;
  uploading a file that only looked complete because of bulk skips reopens it instead of refusing it;
  `POST /statements/{id}/reopen-skipped?only_bulk=`; `POST /statements/{id}/restore`.
  Archived statements no longer resurface when a shared row changes.
- Page: a skipped row has a rider choice (picking one reopens it and remembers the payer; the same payer on other
  skipped rows is reopened and filled too); "Reopen skipped (N)" reopens the bulk-skipped rows of the open statement.
- Restored `BK-3215_aug-nov` for the operator: 109 rows pending (40 with a rider suggested), 15 already synced.
- Tests: bank service 41, fllee-backend 42; headless-Chrome check of the skipped-row flow. Not deployed.

## 2026-11-04 — Same logic on every row: last text first, similar names follow the pick

- Cause of rows showing the sender instead of the last text: deposits that were skipped / reused from older statements
  kept the name an older rule had stored. Now `refresh_extraction` re-reads an entry with the current rules whenever it
  becomes pending again (reopen skipped, upload that reuses it); operator corrections are never touched; the
  re-extract tool uses the same helper. Applied to the open Aug-Nov statement: 61 rows re-read; riders suggested
  for 85 of 109 pending rows (was 40).
- A pick now cascades to SIMILAR names on the page: same words in any order or one cut-off word
  (`similarNames`, same rule in the page and the server; "Uwurukundo Co" ~ "Uwurukundo Cos" ~ "COS Uwurukundo"),
  including rows that were skipped (reopened and filled). Remembered payers also match by similarity on later statements.
- A sender that fits several riders no longer produces "Several riders fit" when the shown (last text) name fits none.
- Columns unchanged: # | Date | Depositor name | Registered biker | Amount | Status | Google Sheet.
- Tests: bank service 42, fllee-backend 45; headless-Chrome run of pick -> similar rows validate -> next pick. Not deployed.

## 2026-11-04 — Bank Statements tables fit without sideways scrolling

- Measured in headless Chrome: the entries table needed ~1,100 px but the page was capped at 1,200 px, so it scrolled
  by ~100 px at 1366 and ~190 px at 1280 (Saved statements also at 1280). Now the page uses the full width and the
  flexible columns wrap; no table scrolls sideways at 1280-1920 px (within 12 px at 1180).
- Rows kept to one line: the "Record as" dropdown only appears on a row when the chosen rider owes an earlier month
  (amount in the label), when a back-date is already chosen, or after clicking "Back-date"; "Not a registered biker" moved
  into the status tooltip; header buttons never break words and wrap as a group.

## 2026-11-04 — Sync never adds a payment the sheet already has (one-to-one matching)

- Incident: Sync only treated an exact same date+name as "already there", so deposits the operator had already typed
  (usually back-dated to a month end) were added again: 40 rows (sheet rows 182-221) written by the app, most of them
  duplicates (e.g. 1 Aug 30,000 vs the operator's 31 Jul row 69). The operator removed them from the sheet; the
  refresh reconcile put the 40 deposits back to Pending.
- Fix: `assignDeposits` / `findRecordedDeposit` (sheet-audit-service) pair each deposit of the statement with ONE sheet
  row of the same rider and amount within the back-dating window (62 days back, 5 days early; `paid` note date used),
  preferring hand-typed rows; identical weekly payments are paired one row per deposit. Sync consults it with the whole
  statement as context (`statementId` sent by the page) before writing: found -> "Already in the Google Sheet as row N
  (date, amount). Nothing was added." and the entry becomes IN_SHEET with that row; not found -> added. The old
  date+name check remains as a backstop.
- Sheet check: new finding APP_DUPLICATE (a row the app wrote for a payment already present, hand-typed row preferred);
  deposits marked "already in the sheet" with no matching row are listed (`recordedWithoutRow`) with a
  "Reopen N with no matching row" button (`POST /bank-statements/:id/reopen-unmatched`); the bank service
  `reopen` now also accepts IN_SHEET entries (SYNCED stay protected).
- Replay of the Aug-Nov sync on an in-memory copy of the real sheet: 40 ready -> 32 skipped as already present,
  8 added (before the fix: all 40 were added). Read-only check of the real sheet: 154 rows judged, 90 matched,
  5 amount differences, 1 not in bank, 8 deposits missing, 5 deposits wrongly marked "already in sheet".
- Tests: sheet-audit 17, fllee-backend 51, bank service 43. Not deployed.

## 2026-11-04 — Riders offered for a statement depend on its period (inactive riders included)

- `GET /api/bank-statements/bikers?from=&to=` (page sends the open statement's period; loaded when a statement is
  opened or uploaded). Rule (`wasRiderDuring`): a rider who started after the period's end is not offered; an active
  rider who started on or before the end is; an inactive rider is offered if they started on or before the end and
  last paid within 31 days before the period starts (so a rider who left in June is not offered for Aug-Nov).
  Without a period only active riders are offered; before Setup data exists every biker is.
- The list is built from the Setup riders, because inactive riders have no Fleebee biker record: they are addressed as
  `m:<member id>` (name from the sheet). Dropdown: active riders first, then a group "No longer riding (were riding in
  this period)" marked "(inactive)". Name matching, remembered payers, Sync (rider resolved by `resolveRider`),
  the sheet check and "reopen unmatched" all use the same period-aware list.
- Real data: Aug-Nov -> 14 riders (Gilbert and Habarurema inactive, Pacifique left out); Mar-Oct -> 15 (Pacifique in);
  no statement -> the 12 active ones. Aug-Nov "Gilbert" deposits now match Turajyayo Gilbert and Sync finds their rows.
- Tests: rider-matching 12 (incl. the Gilbert/Eric examples), fllee-backend 54, bank service 43. Not deployed.

## 2026-11-05 — Current Fleebee release deployed to the home computer

- Synced the current local release to `richard@192.168.1.50:~/fleebee/current` using the repository deployment
  layout and exclusions. The live `shared/.env`, `shared/fleebee.db`, installed `node_modules`, Fine Monitor env,
  and Data Sync service-account credentials were preserved.
- The local and remote backend `package-lock.json` hashes already matched, so no dependency reinstall was needed.
- Refreshed the user-level `fleebee.service`, reloaded systemd, and restarted Fleebee. Prisma reported that the live
  SQLite database was already in sync and regenerated Prisma Client successfully.
- Validated after the restart: `fleebee.service` is active and enabled, `caddy-fleebee.service` remains active,
  `/health` reports `status: ok` with SQLite storage, `/` responds with the expected login redirect, and the service
  journal has no warnings or errors since the restart.
- Deployment note: the development machine's system SSH include has unsafe ownership, so this deployment used
  `ssh -F /dev/null` while retaining the helper script's connection options and file exclusions.

## 2026-11-05 — Gmail downloader OAuth public pages prepared

- Added upload-ready static pages under `oauth-public-pages/fleebee-statement-downloader/`: an application homepage
  and a nested `privacy/` policy page for the private Gmail bank-statement attachment downloader.
- The pages describe the restricted owner-operated workflow, Gmail read-only use, local credential and attachment
  storage, retention/deletion, revocation, non-sharing, and Google API Services User Data Policy Limited Use terms.
- Both pages use the intended public `esonga.com` URLs and link to each other. They have not yet been uploaded to
  `esonga.com`; OAuth branding must not reference the URLs until both public HTTPS pages are reachable.
- Added WordPress Custom HTML fragments under `oauth-public-pages/wordpress/` after the live WordPress pages were
  created. These fragments use the site's current `/index.php/fleebee-statement-downloader/` homepage and nested
  `/policy/` URL and still need to be pasted into the corresponding published pages.

## 2026-11-05 - Gmail statements arrive on the Bank Statements page

- Gmail downloader (`gmail-downloader/`, read-only OAuth, label `Fleebee/BankStatements`, sender `bkebanking@bk.rw`, systemd user timer every 5 min on 192.168.1.50) authorized and verified with two real BK emails; Gmail filter now applies the label.
- Downloader now records subject / arrival time / attachment name per PDF (`state.json`); `src/backfill.js` filled the two existing records.
- Backend: `email-statements-service.js` (`GET /api/bank-statements/email`, `POST /api/bank-statements/email/:id/open`), env `BANK_EMAIL_STATE_FILE` / `BANK_EMAIL_INBOX_DIR`, docker mount `./.email-inbox`.
- Bank service: `statements.source` (`upload`|`email`) and `received_at` (migration `20261111_01`), `file_hash` exposed in the summary.
- Page: "Arrived by email" panel (name, period, arrived, New/Opened, Open) and ✉ Email / ⬆ Uploaded labels in Saved statements.
- Validated: downloader 15 tests, backend 62, bank service 44 (+1 skipped); real PDF opened end to end on the local stack (statement tagged email, list switched to Opened); headless Chrome render checked.
- Deployed to the home computer the same day: bank-statement service installed there (no Docker/Postgres/sudo: Python venv bootstrapped with get-pip, SQLite built from the models and stamped at head by `scripts/init_db.py`, systemd user unit `bank-statement.service` on 127.0.0.1:8100, API key generated on the target), app code synced, `fleebee.service` restarted; backups `~/fleebee/backups/*before-bank-email-20261105-164426*`. Open items: sheet writing is not configured on the home app (no PAYMENTS_SHEET service-account settings), and its bank database starts empty (local history/aliases were not copied).

## 2026-11-05 - Overview becomes a control center

- New `GET /api/system/overview` (`system-status-service.js`): one card per component (Fleebee app, bank statement service, Gmail downloader, Google Sheet import, Google Sheet writing, fine monitor, SMS phone gateway, scheduled SMS) with state ok/warn/down/off, plus a "Timers & schedules" table (repeat interval, last run, next run).
- Gmail downloader now writes a heartbeat (`status.json` beside `state.json`: last check, outcome, authorization state, counts; no secrets), also on failure, so the card can show "Authorization needed" or "timer stopped" (no check for 3 intervals; interval from `GMAIL_POLL_MINUTES`, default 5).
- Overview page: Control center section on top (auto-refresh 30 s), Recent SMS collapsed behind a "Show recent SMS" button.
- Validated: downloader 17 tests, backend 67 tests (5 new for the Gmail card), headless Chrome render of healthy and failing states. Overview later reorganized (Server Health / Phone Gateway / Bundle Check as a card row under the control center, full page width).
- Deployed to the home computer 2026-11-05 17:10 (backups `~/fleebee/backups/*before-control-center-20261105-170926*`): downloader with heartbeat, app synced and restarted; home control center shows Gmail checking, bank service OK; sheet writing not configured and the phone gateway reads Offline there.
