# Fleebee Home Computer Deployment

This folder holds the first deployment shape for the local home computer target at `richard@192.168.1.50`.

For the current LAN, public-IP, and SSH status notes, also see:

- `DEPLOYMENT.md` at the project root

## Target layout

```text
~/fleebee/
├── current/
│   ├── fllee-backend/
│   └── flee-frontend/
├── logs/
├── runtime/
└── shared/
    ├── .env
    └── fleebee.db
```

## Why this layout

- `current/` holds the deployable app code
- `shared/.env` keeps runtime config outside the release tree
- `shared/fleebee.db` keeps SQLite data across code syncs
- `logs/` keeps startup and manual-run logs in one predictable place
- `runtime/` is reserved for a user-level Node install when the target machine supports it

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
- `fleebee.env.example`
  Remote runtime configuration template for `~/fleebee/shared/.env`.
- `fleebee.service`
  `systemd --user` unit for keeping Fleebee running after login.

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
- `PUBLIC_APP_URL=http://192.168.1.50:4100`
- `DATABASE_URL=file:/home/richard/fleebee/shared/fleebee.db`
- `SMS_SEND_PASSWORD=1234`
- `SMS_GATEWAY_TARGET_NUMBER=0788690545`

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
```
