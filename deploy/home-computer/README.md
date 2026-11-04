# Fleebee Home Computer Deployment

This folder holds the first deployment shape for the local home computer target at `richard@192.168.1.50`.

For the current LAN, public-IP, and SSH status notes, also see:

- `DEPLOYMENT.md` at the project root

## Target layout

```text
~/fleebee/
├── current/
│   ├── fllee-backend/
│   ├── flee-frontend/
│   └── fine-monitor/
├── logs/
├── runtime/
└── shared/
    ├── .env
    ├── fine-monitor.env
    └── fleebee.db
```

## Why this layout

- `current/` holds the deployable app code
- `shared/.env` keeps runtime config outside the release tree
- `shared/fleebee.db` keeps SQLite data across code syncs
- `logs/` keeps startup and manual-run logs in one predictable place
- `runtime/` is reserved for a user-level Node install when the target machine supports it
- `shared/fine-monitor.env` holds the private Irembo TIN and worker token outside the release tree

## Prerequisites

The current backend depends on Prisma 7, which requires:

- `Node.js >= 20.19`
- `npm`

The current remote machine is Ubuntu `18.04`, so it could not run the official `node-v20.19.4-linux-x64` binary because that binary requires `glibc 2.28`, while Ubuntu 18.04 ships `glibc 2.27`.

That means one of these must happen before Fleebee can start there:

1. Install a compatible Node 20 runtime on the machine with admin support.
2. Upgrade the machine to a newer Ubuntu release.
3. Switch the deployment target to a newer computer.

## Files in this folder

- `sync-release.sh`
  Syncs the Fleebee runtime files from the development machine to `~/fleebee/current/`, refreshes `~/.config/systemd/user/fleebee.service`, and warns if user lingering is still disabled.
- `restart-service.sh`
  Restarts `fleebee.service` over SSH, but fails fast with the exact `loginctl enable-linger` fix if the user service would die after logout.
- `install-user-caddy-proxy.sh`
  Installs a user-level Caddy binary and starts `caddy-fleebee.service` on the home computer for public HTTP/HTTPS.
- `restart-proxy.sh`
  Syncs the Caddy config/service files and restarts `caddy-fleebee.service`.
- `fleebee.env.example`
  Remote runtime configuration template for `~/fleebee/shared/.env`.
- `fleebee.service`
  `systemd --user` unit for keeping Fleebee running after login.
- `caddy-fleebee.service`
  `systemd --user` unit for the rootless Caddy reverse proxy on the home computer.
- `Caddyfile.example`
  Example Caddy config for the classic root-owned `80/443` binding shape.
- `Caddyfile.rootless`
  Active live Caddy config for the rootless deployment shape that listens on local `8080/8443`.

## First sync

From the development machine:

```bash
cd /home/richard/APPS/SALVI/2026/fleebee-management
./deploy/home-computer/sync-release.sh
```

## Remote env file

On the remote computer:

```bash
cp ~/fleebee/current/deploy/home-computer/fleebee.env.example ~/fleebee/shared/.env
```

Important values in `~/fleebee/shared/.env`:

- `PORT=4100`
- `PUBLIC_APP_URL=https://fleebee.esonga.online`
- `CORS_ALLOW_ORIGIN=https://fleebee.esonga.online`
- `DATABASE_URL=file:/home/richard/fleebee/shared/fleebee.db`
- `SMS_SEND_PASSWORD=1234`
- `SMS_GATEWAY_TARGET_NUMBER=0788690545`
- `FINE_MONITOR_NODE_BINARY=/home/richard/fleebee/runtime/node/bin/node`
- `FINE_MONITOR_SCRIPT_PATH=/home/richard/fleebee/current/fine-monitor/src/run-once.js`
- `FINE_MONITOR_ENV_FILE=/home/richard/fleebee/shared/fine-monitor.env`

Install the worker dependencies once, and again whenever its lockfile changes:

```bash
cd ~/fleebee/current/fine-monitor
~/fleebee/runtime/node/bin/npm ci --omit=dev
```

The backend still listens on local port `4100`.

As of `2026-07-26`, the live public HTTPS path uses a rootless Caddy service on the home computer:

- local `8080 ->` Caddy HTTP listener
- local `8443 ->` Caddy HTTPS listener
- Caddy reverse proxies to `127.0.0.1:4100`
- router maps public `80 -> 8080`
- router maps public `443 -> 8443`

This avoids the need for sudo/root binding on ports `80/443`.

If the machine later gets a root-owned web stack, `deploy/home-computer/Caddyfile.example` remains the simpler direct `80/443` variant.

## Start with user systemd

After Node 20.19+ is available on the machine, install and start the user service:

```bash
mkdir -p ~/.config/systemd/user
cp ~/fleebee/current/deploy/home-computer/fleebee.service ~/.config/systemd/user/fleebee.service
systemctl --user daemon-reload
systemctl --user enable --now fleebee.service
```

One-time requirement for a user service that must stay up after SSH logout:

```bash
ssh -tt richard@192.168.1.50 'sudo loginctl enable-linger richard'
```

Without lingering, `systemctl --user restart fleebee.service` can look successful during SSH, but the service will be stopped cleanly as soon as that SSH session ends.

From the development machine, the safer restart flow is:

```bash
cd /home/richard/APPS/SALVI/2026/fleebee-management
./deploy/home-computer/sync-release.sh
./deploy/home-computer/restart-service.sh
./deploy/home-computer/install-user-caddy-proxy.sh
./deploy/home-computer/restart-proxy.sh
```

If sudo access is available but linger has not been enabled yet, the command above must be run interactively because sudo needs a TTY for the password prompt.

Temporary fallback if you need the page back before fixing linger:

```bash
cd /home/richard/APPS/SALVI/2026/fleebee-management
./deploy/home-computer/start-without-linger.sh
```

This bypasses `systemd --user` and starts the backend with `nohup`, so it can stay up even though `fleebee.service` still cannot survive SSH logout.

## View logs

```bash
journalctl --user -u fleebee.service -f
journalctl --user -u caddy-fleebee.service -f
```

## Rootless public proxy

The active live proxy shape is:

```text
internet :80   -> router -> 192.168.1.50:8080 -> Caddy -> 127.0.0.1:4100
internet :443  -> router -> 192.168.1.50:8443 -> Caddy -> 127.0.0.1:4100
```

Install or refresh it from the development machine:

```bash
cd /home/richard/APPS/SALVI/2026/fleebee-management
./deploy/home-computer/install-user-caddy-proxy.sh
```

Later config-only refresh:

```bash
cd /home/richard/APPS/SALVI/2026/fleebee-management
./deploy/home-computer/restart-proxy.sh
```

Verify on the home computer:

```bash
systemctl --user status caddy-fleebee.service --no-pager
ss -ltn | egrep ':(8080|8443|4100) '
```

Expected router mappings:

- `2222 -> 22`
- `4100 -> 4100`
- `80 -> 8080`
- `443 -> 8443`

## Pending Ops Checklist

- On the home computer, run:

```bash
sudo loginctl enable-linger richard
```

This is still needed so `fleebee.service` and `caddy-fleebee.service` survive SSH logout.

- In `~/fleebee/shared/.env`, replace the public-facing weak values and restart the services:
  - `SMS_SEND_PASSWORD`
  - `SMS_ADMIN_PASSWORD`
  - `APP_LOGIN_PASSWORD`
  - `APP_SESSION_SECRET`

- After DNS propagation finishes, verify from a real outside network:

```bash
curl -I http://fleebee.esonga.online
curl -I https://fleebee.esonga.online
```

- If the WAN IP changes again, update DNS or add DDNS automation before the stale record breaks public access again.
