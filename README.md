# Fleebee Management

Fleebee is a home-computer + Android SMS gateway system for managing bikers and sending remote SMS through a Samsung phone.

## Current Shape

- `fllee-backend/`
  Single web app that serves both the dashboard UI and API
- `flee-frontend/`
  Source for the dashboard static assets
- `android-app/`
  Samsung phone gateway that claims jobs and sends SMS
- `fine-monitor/`
  Sequential Irembo traffic-fine worker with manual refresh and daily/weekly scheduling
- `data-sync/`
  Read-only Google Sheets accounting worker with manual refresh and a configurable two-day default schedule

## Confirmed Access

As of `2026-07-26`, these paths are confirmed:

- LAN SSH: `ssh richard@192.168.1.50`
- Public SSH: `ssh -p 2222 richard@41.173.248.47`
- LAN app URL: `http://192.168.1.50:4100`
- Direct public app URL: `http://41.173.248.47:4100`
- Configured public hostname: `https://fleebee.esonga.online`

Important notes:

- Public SSH forwarding is confirmed on `41.173.248.47`.
- Public HTTPS service is live through the home-computer Caddy proxy.
- Some DNS resolvers may still cache the older Fleebee IP until propagation finishes, so direct-IP testing can still be useful during cutover.

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
- `~/.config/systemd/user/caddy-fleebee.service`

Connect first:

```bash
ssh -p 2222 richard@41.173.248.47
```

Then use:

```bash
systemctl --user start fleebee.service
systemctl --user stop fleebee.service
systemctl --user restart fleebee.service
systemctl --user status fleebee.service
journalctl --user -u fleebee.service -f

systemctl --user restart caddy-fleebee.service
systemctl --user status caddy-fleebee.service
journalctl --user -u caddy-fleebee.service -f
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
./deploy/home-computer/install-user-caddy-proxy.sh
./deploy/home-computer/restart-proxy.sh
```

Temporary workaround if you still cannot enable linger yet:

```bash
cd /home/richard/APPS/SALVI/2026/fleebee-management
./deploy/home-computer/start-without-linger.sh
```

That starts Fleebee directly with `nohup` so the page can come back without relying on the user-level systemd manager.

Current status note:

- The backend now boots successfully on the home computer with the current Node runtime bundle.
- `caddy-fleebee.service` now proxies public `http/https` traffic to Fleebee using a rootless Caddy install on the home computer.
- The router now maps public `80 -> 8080` and `443 -> 8443` to support that rootless proxy without sudo.
- The remaining service-lifetime issue is user-systemd lingering: until `loginctl enable-linger` is enabled once for `richard`, both user services can stop when the SSH session that restarted them ends.

## Pending Tasks

- Confirm that `https://fleebee.esonga.online` resolves to `41.173.248.47` from the main operator devices after DNS propagation finishes, then treat the hostname as the default public entrypoint.
- Replace the public-facing weak credentials on the home-computer deployment:
  - `SMS_SEND_PASSWORD`
  - `SMS_ADMIN_PASSWORD`
  - `APP_LOGIN_PASSWORD`
  - `APP_SESSION_SECRET`
- Run `sudo loginctl enable-linger richard` on the home computer so `fleebee.service` and `caddy-fleebee.service` survive SSH logout cleanly.
- Decide whether to keep the current dynamic-public-IP workflow or add DDNS / another stable DNS update path if the WAN IP keeps changing.

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
