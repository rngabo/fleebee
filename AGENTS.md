# AGENTS.md

Project instructions for AI agents working in this repository.

## Start Here

- Read `progress.md` first for the latest live-state notes, deployment caveats, and pending operational work.
- Read `README.md` next for the current repo shape, runtime entrypoints, and confirmed access details.
- Read `DEPLOYMENT.md` before changing anything related to SSH, public URLs, DNS, router forwarding, the home computer, or Caddy.
- Read `architecture.md` before changing message flow, gateway behavior, or the boundary between backend, frontend, and Android worker.

## Repo Map

- `fllee-backend/` is the main Node service. It serves both the dashboard UI and the API. Use this exact path spelling.
- `fllee-backend/prisma/schema.prisma` defines the SQLite-backed data model.
- `fllee-backend/src/services/` holds the main business logic for bikers, messages, schedules, dashboard state, and gateway workflows.
- `flee-frontend/` contains the dashboard source assets and optional standalone preview server.
- `flee-frontend/public/assets/js/app.js` is the main browser-side dashboard logic.
- `flee-frontend/public/assets/css/styles.css` is the main dashboard stylesheet.
- `android-app/` is the Android SMS gateway app that heartbeats, claims jobs, sends SMS, and reports final results.
- `deploy/home-computer/` contains the preferred sync, restart, and proxy scripts for the live home-computer deployment.
- `call-center/` is experimental Kinyarwanda voice-agent work. It is not part of the main production SMS flow unless the task explicitly touches it.

## Runtime Rules

- Treat Fleebee as a single-service production app: the backend serves both UI and API on port `4100`.
- The normal home deployment anchor is the backend computer on `192.168.1.50:4100`, unless newer notes in `progress.md` or `DEPLOYMENT.md` say otherwise.
- The backend is the control plane. The Android app is the execution worker. Keep that separation intact unless the user asks for an architectural change.
- For direct backend runs, use `fllee-backend/.env`.
- `docker-compose.yml` also uses `fllee-backend/.env`, and overrides `DATABASE_URL` to the container data path.
- Frontend preview config lives in `flee-frontend/.env`.
- Android gateway config should come from Gradle properties or environment variables, not hardcoded source values.

## Common Commands

- Backend local run: `cd fllee-backend && npm run prisma:migrate && npm start`
- Backend watch mode: `cd fllee-backend && npm run dev`
- Frontend preview: `cd flee-frontend && node server.js`
- Full container stack: `docker compose up --build`
- Android debug build: `cd android-app && ./gradlew -g /tmp/gradle-home assembleDebug`

## Deployment Notes

- Prefer the repo deployment helpers instead of ad hoc remote commands:
  - `./deploy/home-computer/sync-release.sh`
  - `./deploy/home-computer/restart-service.sh`
  - `./deploy/home-computer/install-user-caddy-proxy.sh`
  - `./deploy/home-computer/restart-proxy.sh`
- Read `deploy/home-computer/README.md` before changing deployment scripts, `systemd` units, or the rootless Caddy setup.
- Public IP, DNS, and proxy details are time-sensitive. When repeating them, include the date from the source doc instead of speaking as if they are timeless facts.
- Do not rotate live secrets, overwrite remote `.env` values, or touch the production SQLite database unless the user explicitly asks.

## Data And Behavior Notes

- SQLite is the live storage layer, managed through Prisma 7.
- Keep same-origin dashboard/backend behavior by default; do not split the UI and API again unless the task requires it.
- The Android phone is expected to reach the backend over LAN or internet without USB during normal operation. `adb reverse` is only for temporary development/testing.
- `call-center/` can depend on real SMS templates from Fleebee. If templates change and the task touches voice work, review its snapshot/export flow before editing.

## Session Handoff

- Append a dated entry to `progress.md` at the end of each session with what changed, decisions made, current state, and next steps.
- Keep `AGENTS.md` focused on durable repo guidance. Put live status, temporary caveats, and dated connection details in `progress.md` or deployment docs instead.
