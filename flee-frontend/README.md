# flee-frontend

Static dashboard source for Fleebee Management.

Project-wide runtime config, service control commands, and confirmed connection details now live in:

- `../README.md`

## Current scope
- Browser dashboard for bikers, phone status, and queued SMS requests
- Password confirmation modal before a remote SMS can be queued
- Top-level settings workspace with biker CRUD, message tables, gateway details, and board metrics
- Connects directly to the local backend API
- Works without external frontend dependencies
- Auto-refreshes live queue status from the backend
- Waits for a `sent` or `failed` result after queueing a message so the operator gets clearer feedback

## Current architecture role
- Production now serves this dashboard from `fllee-backend` on `http://localhost:4100`
- This folder remains the source of the dashboard static assets and an optional standalone preview server
- The legacy standalone preview server still defaults to `http://localhost:4173`

## Structure
```text
flee-frontend/
├── public/
│   ├── assets/
│   │   ├── css/
│   │   │   └── styles.css
│   │   └── js/
│   │       └── app.js
│   └── index.html
├── src/
│   ├── config/
│   │   ├── browser-config.js
│   │   └── env.js
│   ├── server/
│   │   └── mime-types.js
│   └── server.js
├── .env
├── .env.example
└── server.js
```

## Run
```bash
node server.js
```

Default URL:

```text
http://localhost:4173
```

## Backend dependency
The frontend expects the backend API at:

```text
http://localhost:4100
```

The backend is now SQLite-backed through Prisma.

## Config
- `.env` holds the active frontend setup for the local machine
- `.env.example` shows the expected values for a fresh setup
- The browser reads runtime settings from `/app-config.js`, so the API base URL is no longer hardcoded inside the dashboard JavaScript
- In the new production architecture, the backend serves the dashboard and leaves `DASHBOARD_API_BASE_URL` blank for same-origin API calls
