# Fleebee Management

Fleebee is a home-computer + Android SMS gateway system for managing bikers and sending remote SMS through a Samsung phone.

## Current Shape

- `fllee-backend/`
  Single web app that serves both the dashboard UI and API
- `flee-frontend/`
  Source for the dashboard static assets
- `android-app/`
  Samsung phone gateway that claims jobs and sends SMS

## Confirmed Access

As of `2026-07-05`, these paths are confirmed:

- LAN SSH: `ssh richard@192.168.1.50`
- Public SSH: `ssh -p 2222 richard@196.12.139.27`
- LAN app URL: `http://192.168.1.50:4100`
- Configured public hostname: `https://fleebee.esonga.online`

Important note:

- Public SSH forwarding is confirmed.
- Public browser access to Fleebee on port `4100` is not yet confirmed.

## Important Runtime Config

Primary runtime config file:

- `fllee-backend/.env`

Most important keys:

- `PORT=4100`
  Fleebee app port. The dashboard and API are both served on this same port.
- `PUBLIC_APP_URL=https://fleebee.esonga.online`
  Human-facing public app URL once HTTPS reverse proxying is in place.
- `DASHBOARD_API_BASE_URL=`
  Leave blank for same-origin dashboard requests.
- `DATABASE_URL=file:/home/richard/fleebee/shared/fleebee.db`
  SQLite database path for the home-computer deployment.
- `SMS_SEND_PASSWORD=1234`
  Initial SMS send password used to seed the database if no DB-backed password exists yet.
- `SMS_ADMIN_PASSWORD=1234`
  Admin-only password for changing the SMS send password and signature from the SMS page.
- `APP_LOGIN_PASSWORD=1234`
  Browser login password for opening the dashboard.
- `APP_SESSION_SECRET=change-this-before-public-https`
  Cookie-signing secret for the dashboard login session.
- `APP_SESSION_IDLE_TIMEOUT_MS=900000`
  Session idle timeout in milliseconds before the login expires.
- `SMS_GATEWAY_MODE=registered-bikers`
  `registered-bikers` sends to each active biker's stored phone number.
- `SMS_GATEWAY_TARGET_NUMBER=0788690545`
  Used only when `SMS_GATEWAY_MODE=test-routing`.
- `SMS_GATEWAY_DEVICE_ID=android-home-gateway`
  Device identity used by the Android gateway heartbeat and job claim flow.

Android gateway build-time config example:

- `android-app/gradle.properties.example`

Most important Android keys:

- `gatewayBackendBaseUrl=http://192.168.1.50:4100`
  Stable home LAN connection to the backend computer
- `gatewayDeviceId=android-home-gateway`
- `gatewayFixedLocation=Home gateway`
- `gatewayNetworkLabel=Wi-Fi / mobile fallback`

USB note:

- `gatewayBackendBaseUrl=http://127.0.0.1:4100` is only for temporary `adb reverse` testing over USB.

## Service Control

The home computer uses a user-level systemd service:

- `~/.config/systemd/user/fleebee.service`

Connect first:

```bash
ssh -p 2222 richard@196.12.139.27
```

Then use:

```bash
systemctl --user start fleebee.service
systemctl --user stop fleebee.service
systemctl --user restart fleebee.service
systemctl --user status fleebee.service
journalctl --user -u fleebee.service -f
```

One-time requirement on the home computer:

```bash
ssh -tt richard@192.168.1.50 'sudo loginctl enable-linger richard'
```

Without lingering, the user-level service can start successfully during SSH and then get a clean `SIGTERM` as soon as that SSH session ends.

Preferred restart flow from the development machine:

```bash
cd /home/richard/APPS/SALVI/2026/fleebee-management
./deploy/home-computer/sync-release.sh
./deploy/home-computer/restart-service.sh
```

Temporary workaround if you still cannot enable linger yet:

```bash
cd /home/richard/APPS/SALVI/2026/fleebee-management
./deploy/home-computer/start-without-linger.sh
```

That starts Fleebee directly with `nohup` so the page can come back without relying on the user-level systemd manager.

Current status note:

- The backend now boots successfully on the home computer with the current Node runtime bundle.
- The remaining service-lifetime issue is user-systemd lingering: until `loginctl enable-linger` is enabled once for `richard`, `fleebee.service` will stop when the SSH session that restarted it ends.

## Local Run

Backend app:

```bash
cd fllee-backend
npm run prisma:migrate
npm start
```

Docker:

```bash
docker compose up --build
```

## Where To Look Next

- Project deployment notes: [DEPLOYMENT.md](./DEPLOYMENT.md)
- Architecture notes: [architecture.md](./architecture.md)
- Progress log: [progress.md](./progress.md)
- Backend details: [fllee-backend/README.md](./fllee-backend/README.md)
- Frontend details: [flee-frontend/README.md](./flee-frontend/README.md)
- Home-computer deployment kit: [deploy/home-computer/README.md](./deploy/home-computer/README.md)
# fleebee
