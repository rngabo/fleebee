# fllee-backend

Single web service for Fleebee Management.

Project-wide runtime config, service control commands, and confirmed connection details now live in:

- `../README.md`

## Current scope
- Serves the browser dashboard and API from the same Node process
- Serves a lightweight local API backed by Prisma + SQLite
- Accepts new bikers from the web dashboard
- Supports update and guarded delete flows for biker records
- Accepts remote SMS queue requests from the web dashboard
- Requires a dispatch password before queueing SMS requests
- Supports one-time and recurring scheduled message plans
- Exposes phone gateway status and dashboard summary data
- Lets the Android gateway claim queued jobs and report sent/failed results
- Blocks duplicate SMS requests to the same target within a short cooldown window

## Structure
```text
fllee-backend/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── config/
│   │   └── env.js
│   ├── data/
│   │   └── defaults.js
│   ├── lib/
│   │   ├── http.js
│   │   └── prisma.js
│   ├── services/
│   │   ├── biker-service.js
│   │   ├── dashboard-service.js
│   │   ├── message-service.js
│   │   ├── scheduled-message-service.js
│   │   └── phone-service.js
│   ├── app.js
│   └── server.js
├── .env
├── .env.example
├── prisma.config.ts
└── server.js
```

## Run
```bash
npm run prisma:migrate
node server.js
```

You can also start directly with:

```bash
npm start
```

On startup, Fleebee now ensures the configured SQLite file exists and runs `prisma db push` before the server initializes its default phone state.

Default app URL:

```text
http://localhost:4100
```

## Docker
From the project root:

```bash
docker compose up --build
```

The app container:
- listens on `http://localhost:4100`
- serves both the dashboard UI and API on port `4100`
- stores SQLite data in the named Docker volume `fleebee_app_data`
- runs `prisma db push` on startup before launching the server

## Important `.env` keys
- `PORT=4100`
  The only production app port now. There is no separate dashboard port in the new architecture.
- `PUBLIC_APP_URL=http://localhost:4100`
  Human-facing app URL for docs and runtime context.
- `DASHBOARD_PUBLIC_DIR=`
  Optional override for where the dashboard static files live. Leave blank locally unless you moved them.
- `DASHBOARD_API_BASE_URL=`
  Leave blank for same-origin dashboard requests. Set only if you intentionally split the UI and API again.
- `APP_NAME=Fleebee Dispatch Desk`
  Browser-visible app title.
- `BOARD_REFRESH_INTERVAL_MS=5000`
  Dashboard polling interval.
- `MESSAGE_RESULT_TIMEOUT_MS=18000`
  How long the dashboard waits for the phone to report a final SMS result.
- `MESSAGE_RESULT_POLL_MS=1500`
  Polling interval while waiting for a sent or failed SMS result.
- `SCHEDULE_POLL_MS=30000`
  How often the backend checks for due scheduled messages and turns them into queued SMS jobs.
- `SMS_SEND_PASSWORD=1234`
  Initial SMS send password used only to seed the database if no DB-backed password exists yet.
- `SMS_ADMIN_PASSWORD=1234`
  Admin-only password for changing the DB-backed SMS send password and signature from the SMS page.
- `APP_LOGIN_PASSWORD=1234`
  Browser login password for the dashboard UI.
- `APP_SESSION_SECRET=change-this-before-public-https`
  Cookie-signing secret used for the browser login session.
- `APP_SESSION_IDLE_TIMEOUT_MS=900000`
  How long an authenticated browser session can stay idle before the operator must sign in again.
- `APP_SESSION_COOKIE_SECURE=false`
  Keep `false` while using local HTTP access; switch to `true` once Fleebee is only served through HTTPS.
- `SMS_GATEWAY_MODE=registered-bikers`
  `registered-bikers` sends to each active biker's saved phone number. `test-routing` keeps the old single-number safety route.
- `SMS_GATEWAY_TARGET_NUMBER=0788690545`
  Used only when `SMS_GATEWAY_MODE=test-routing`.
- `SEED_DEFAULT_BIKERS=false`
  Keeps fresh databases empty so production starts with real riders instead of demo records.

## Important endpoints
- `GET /health`
- `GET /`
- `GET /app-config.js`
- `GET /api/dashboard`
- `GET /api/bikers`
- `POST /api/bikers`
- `PUT /api/bikers/:id`
- `DELETE /api/bikers/:id`
- `GET /api/messages`
- `POST /api/messages`
- `GET /api/schedules`
- `POST /api/schedules`
- `PUT /api/schedules/:id`
- `DELETE /api/schedules/:id`
- `GET /api/phone`
- `POST /api/phone/heartbeat`
- `POST /api/phone/bundle/request`
- `POST /api/phone/bundle/report`
- `POST /api/gateway/jobs/claim`
- `POST /api/gateway/jobs/:id/result`

## Notes
- Data now persists in `fleebee.db`
- The backend uses SQLite now because it is simple, fast, and fits a single-home-gateway setup well
- Prisma 7 is configured through `prisma.config.ts` and uses the `@prisma/adapter-better-sqlite3` driver at runtime
- `npm start` and `node server.js` now prepare the configured SQLite database automatically, which helps if the app is started outside Docker or outside the `systemd` service path
- Important setup values now live in `.env`, with a safe starting template in `.env.example`
- The browser dashboard is now served directly by this backend, using the static assets under `flee-frontend/public`
- The actual SMS send password now lives in the database and is checked on every direct send
- `SMS_SEND_PASSWORD` is now only the bootstrap default for fresh databases
- `SMS_ADMIN_PASSWORD` gates changes to the SMS send password and signature from the SMS page
- Scheduled messages run from the backend worker, which checks due plans every `SCHEDULE_POLL_MS` and queues them automatically
- Gateway behavior such as duplicate windows, heartbeat timing, routing mode, fixed location, and device identity is env-driven now
- Only bikers marked `Active` can be selected for live SMS or schedules
- Duplicate protection currently prevents the same message body from being queued to the same target number again for 10 minutes
- During current USB testing, the Android app reaches this backend through `adb reverse tcp:4100 tcp:4100`
- The Docker setup still works with `adb reverse tcp:4100 tcp:4100` because the app is published on host port `4100`
