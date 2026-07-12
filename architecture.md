# Fleebee Management Architecture

## Purpose

Fleebee is a remote SMS dispatch system.

The operator uses a web UI.
The backend stores data and coordinates work.
The Android phone is the real SMS gateway that sends the SMS through its SIM card.

This is the intended chain:

`Web UI -> Frontend -> Backend -> Android app -> Mobile carrier -> Recipient`

## Current Recommended Architecture

Assume the main backend is already available at:

- `http://192.168.1.50:4100`

This should be treated as the stable backend address for the home deployment.

The Android phone should work without USB and without being plugged into the laptop.
USB and `adb reverse` are only for temporary development/debugging.

## System Components

### 1. Web UI

The operator-facing browser dashboard.

Responsibilities:

- show bikers
- create direct SMS
- create scheduled SMS plans
- edit or delete pending messages before release
- show phone online/offline state
- show final SMS status such as `submitted`, `sent`, or `failed`

### 2. Frontend

Static dashboard assets used by the browser.

Responsibilities:

- collect operator actions
- call backend API endpoints
- poll for dashboard updates
- render queue state, schedules, and dispatch outcomes

Production note:

- the frontend should be served by the backend on the same port when possible
- this keeps the deployment simple

### 3. Backend

The backend is the control plane.
It does not send SMS directly.

Responsibilities:

- serve the dashboard UI
- expose API endpoints for browser and Android app
- store bikers, messages, schedules, and phone state
- keep the pending review queue
- release messages after the waiting window
- let the Android phone claim work
- store truthful final dispatch results

Current backend storage:

- Node.js app
- Prisma
- SQLite

### 4. Android App

The Android app is the worker and SMS gateway.

Responsibilities:

- stay online in the background
- heartbeat to the backend
- poll the backend for available jobs
- claim jobs one at a time
- send SMS using the phone SIM
- report result back to the backend

The phone is not the control plane.
It is the execution worker.

## Core Design Principle

The backend should be stable.
The phone should be replaceable.

That means:

- the backend should have the stable address
- the phone does not need a static IP for the normal design
- the phone only needs internet access to reach the backend

For the home deployment, the important fixed address is:

- backend host: `192.168.1.50`

Best practice:

- reserve `192.168.1.50` in the router for the backend machine

## High-Level Data Flow

### Direct SMS flow

1. Operator opens the web UI.
2. Frontend sends the direct SMS request to the backend.
3. Backend validates password and request data.
4. Backend creates a `Message` in `pending`.
5. Backend sets `availableAt` to about 2 minutes later.
6. During that window, the operator can edit or delete the message.
7. When `availableAt` is reached, the Android app can claim the job.
8. Android app sends the SMS through the SIM card.
9. Android app reports back `submitted`, `sent`, or `failed`.
10. Backend stores the result and frontend displays it.

### Scheduled SMS flow

1. Operator creates a schedule in the web UI.
2. Backend stores the schedule rule.
3. Backend scheduler checks for due plans.
4. When due, backend creates a new `Message` from the schedule.
5. That message also enters the same `pending` review queue first.
6. After the review window, the Android app may claim and send it.
7. Backend updates both message history and schedule dispatch state.

### Phone heartbeat flow

1. Android app starts foreground sync service.
2. Every few seconds it sends heartbeat to `/api/phone/heartbeat`.
3. Backend updates `PhoneState.lastHeartbeatAt`.
4. Frontend shows the phone as online or offline based on heartbeat freshness.

### Job claim flow

1. Android app calls `/api/gateway/jobs/claim`.
2. Backend returns the oldest eligible job.
3. Backend marks the job as claimed/dispatched.
4. Android app sends SMS and later calls `/api/gateway/jobs/:id/result`.

## Message Lifecycle

Current backend message statuses are:

- `pending`
- `queued`
- `dispatched`
- `submitted`
- `sent`
- `failed`

Recommended meaning:

- `pending`
  Waiting in the operator review window. Still editable and deletable.
- `queued`
  Reserved for backend-created items that are ready or legacy queue cases.
- `dispatched`
  Claimed by the Android app and being processed.
- `submitted`
  Submitted to the mobile carrier, waiting for delivery confirmation.
- `sent`
  Delivery confirmed.
- `failed`
  Send or delivery failed, or delivery was not confirmed.

For the operator, the most important visible states are:

- `pending review`
- `sending`
- `sent to carrier`
- `delivered`
- `failed`

## Why The Phone Does Not Need A Static IP

In this design, the backend does not call the phone directly.
The phone calls the backend.

So the phone only needs:

- internet access
- app running
- background execution allowed
- correct backend URL configured

The phone would only need a fixed IP if:

- the backend must initiate direct connections to the phone
- you add phone-hosted APIs
- you want easier router/firewall debugging

For the current Fleebee design, a static phone IP is optional, not required.

## Network Modes

### Mode A: Home LAN only

Use this when:

- backend is on the home network
- phone is also on the home network
- operator uses local access or VPN/remote desktop into home network

Recommended backend URL for Android app:

- `http://192.168.1.50:4100`

### Mode B: Public remote access later

Use this when:

- operator needs access from outside home
- phone may be on mobile data
- backend must be reachable from anywhere

Recommended backend URL for Android app:

- `https://app.your-domain.example`

To reach that future state, add one of:

- public reverse proxy with HTTPS
- port forwarding plus domain and TLS
- VPN overlay such as Tailscale or ZeroTier

## Operational Requirements

### Backend machine

Must:

- stay powered on
- keep stable IP `192.168.1.50`
- run the Node backend continuously
- keep SQLite data backed up
- expose port `4100` on the LAN or through a proper public endpoint

### Android phone

Must:

- stay powered on
- stay charged
- stay connected to Wi-Fi or mobile data
- have SMS permission granted
- have notification permission granted
- run foreground sync service
- be exempt from aggressive battery restrictions
- restart sync after reboot

Recommended Samsung settings:

- Battery: `Unrestricted`
- Auto restart if available
- Allow background data
- Keep notifications enabled
- Keep app out of sleeping apps lists

## Security Model

Minimum controls now:

- backend requires SMS dispatch password before queueing direct SMS
- Android app only claims jobs from the configured backend
- backend stores status changes and history

Recommended next hardening:

- add backend auth for browser operators
- add per-device secret/token for Android gateway
- require HTTPS when accessed outside the home LAN
- log all message creation, edits, deletes, claims, and results

## Current Repository Shape

- `fllee-backend/`
  Main backend app and API
- `flee-frontend/`
  Dashboard static assets
- `android-app/`
  SMS gateway application

Recommended production behavior:

- backend serves frontend assets directly
- browser and API share the same origin
- Android app talks only to the backend

## API Responsibilities By Direction

### Browser to backend

Main operations:

- dashboard summary
- biker CRUD
- direct SMS creation
- pending SMS edit/delete
- schedule CRUD
- phone status display
- message history display

### Android app to backend

Main operations:

- heartbeat
- claim next job
- report job result

There should be no need for the backend to open a direct connection to the phone in the current design.

## Recommended Final Home Architecture

```text
Operator Browser
    |
    v
Web UI / Frontend
    |
    v
Backend API + Scheduler + SQLite
at http://192.168.1.50:4100
    ^
    |
Android Fleebee Gateway App
on Samsung phone
    |
    v
SMS via SIM card and mobile carrier
```

## Suggested Near-Term Plan

1. Keep backend fixed on `192.168.1.50:4100`.
2. Build Android app config around that backend URL.
3. Keep the frontend served by the backend.
4. Keep all new direct and scheduled messages in `pending` for about 2 minutes.
5. Let the Android phone poll and claim jobs without USB.
6. Show truthful final result instead of fake queue success.
7. Later decide whether outside-home access should use:
   - public HTTPS endpoint
   - or VPN overlay

## Final Architecture Decision

The correct Fleebee architecture is:

- web UI for operator control
- frontend for browser interaction
- backend as the single control plane
- Android app as the SMS worker
- backend stability centered on `192.168.1.50`
- no USB dependency in normal use
- no phone static IP requirement in the current design
