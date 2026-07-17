# Fleebee Progress Handoff

## Date
Updated on `2026-07-12`.

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
