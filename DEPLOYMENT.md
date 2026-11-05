# Fleebee Deployment

## Current Home Computer Target

As of `2026-07-05`, the current home-computer deployment target is:

- Hostname: `richard-Vostro-230`
- LAN user/host: `richard@192.168.1.50`
- Fleebee app URL on the local network: `http://192.168.1.50:4100`
- Local SSH command on the same network: `ssh richard@192.168.1.50`

## Current SSH Listener

The machine is currently listening for SSH on standard port `22`, not `2222`.

Confirmed listeners:

- `0.0.0.0:22`
- `[::]:22`

That means the local-network SSH command should be:

```bash
ssh richard@192.168.1.50
```

## Public Access Notes

### Current public IPv4 setup

As of `2026-07-26`, the currently working public access path is:

- Public IPv4: `41.173.248.47`
- Public SSH command: `ssh -p 2222 richard@41.173.248.47`
- Direct public app URL: `http://41.173.248.47:4100`
- Public hostname target: `https://fleebee.esonga.online`

Router forwards currently in use:

- `2222 -> 22` on `192.168.1.50`
- `4100 -> 4100` on `192.168.1.50`
- `80 -> 8080` on `192.168.1.50`
- `443 -> 8443` on `192.168.1.50`

### Current test result for active public IPv4 path

On `2026-07-26`, testing confirmed:

```text
public-ssh-ok
host=richard-Vostro-230
```

and the public Fleebee paths reached the live app:

```text
http://41.173.248.47:4100/health -> {"status":"ok","service":"fleebee-app","storage":"sqlite"}
http://41.173.248.47:80 -> 301 Location: https://fleebee.esonga.online/
https://41.173.248.47:443 (with Host/SNI fleebee.esonga.online) -> Fleebee via Caddy with a valid Let's Encrypt certificate
```

So the current public IPv4 SSH path and the public Fleebee HTTP/HTTPS service are **confirmed working** on the current IP.

### Older public IPv4 notes

Earlier public IP values seen during the project included:

- `196.12.139.27`
- `196.216.80.163`
- `41.216.122.219`

These should now be treated as historical/stale notes, not current endpoints.

## IPv6 Notes

### Browser-reported public IPv6

The IPv6 reported in the browser was:

- `2c0f:fe30:4bf9:0:54ba:3d72:a0a1:90c0`

### Actual IPv6 addresses currently on the home computer

When checked directly on `richard-Vostro-230` on `2026-07-05`, the machine reported:

- `2c0f:fe30:4bf9:0:ac7e:56d5:34a1:f9b1` (temporary dynamic)
- `2c0f:fe30:4bf9:0:7eb7:5064:c0e4:c654` (global dynamic)

Important note:

- The browser-reported IPv6 `2c0f:fe30:4bf9:0:54ba:3d72:a0a1:90c0` did **not** match the actual IPv6 addresses currently assigned to the home computer when checked over SSH.

### Current test result for direct IPv6 SSH

Testing the machine's currently reported global IPv6 gave:

```text
ssh: connect to host 2c0f:fe30:4bf9:0:7eb7:5064:c0e4:c654 port 22: No route to host
```

So IPv6 SSH is also **not currently confirmed working** from this machine.

## What We Can Safely Use Right Now

For current Fleebee setup and deployment work, use:

- LAN SSH: `ssh richard@192.168.1.50`
- Public SSH: `ssh -p 2222 richard@41.173.248.47`
- LAN app URL: `http://192.168.1.50:4100`
- Direct public app URL: `http://41.173.248.47:4100`
- Public hostname: `https://fleebee.esonga.online`

Important DNS note:

- On `2026-07-26`, the authoritative HostGator DNS and Cloudflare `1.1.1.1` already returned `41.173.248.47`, while Google `8.8.8.8` was still returning the older `41.216.122.219`.
- If a device still resolves Fleebee to the old IP during propagation, use the direct IP temporarily.

These are the currently confirmed working connection details.

## Best Real External Test

To confirm access from outside the home network, the cleanest test is:

1. Turn off Wi-Fi on another device.
2. Use mobile data or another internet connection.
3. Try the public SSH path from that outside network.
4. If SSH works, then test the Fleebee app URL from the same outside network.

Suggested checks:

```bash
ssh -p 2222 richard@41.173.248.47
```

Then test:

```bash
curl -I http://41.173.248.47:4100/health
curl -I http://fleebee.esonga.online
curl -I https://fleebee.esonga.online
```

or, if IPv6 is intentionally opened and confirmed later:

```bash
ssh -6 -l richard 2c0f:fe30:4bf9:0:7eb7:5064:c0e4:c654
```

## Fleebee Runtime Values

For the current local deployment shape, the key values remain:

- `PORT=4100`
- `PUBLIC_APP_URL=https://fleebee.esonga.online`
- `DATABASE_URL=file:/home/richard/fleebee/shared/fleebee.db`
- `SMS_SEND_PASSWORD=1234`
- `SMS_GATEWAY_TARGET_NUMBER=0788690545`

Important note:

- Public SSH forwarding is confirmed.
- Public HTTP forwarding for Fleebee on port `4100` is confirmed.
- Public HTTPS for `fleebee.esonga.online` is live through a rootless Caddy proxy on `.50` that listens on local `8080/8443`.

## Pending Deployment Tasks

- Recheck `fleebee.esonga.online` from at least one outside network after DNS propagation fully settles, especially on resolvers that previously still returned `41.216.122.219`.
- Keep the current router forwards as-is:
  - `2222 -> 22`
  - `4100 -> 4100`
  - `80 -> 8080`
  - `443 -> 8443`
- Enable lingering once on `.50` with `sudo loginctl enable-linger richard` so both user-level services survive logout.
- Rotate the public-facing passwords and session secret before treating the new HTTPS endpoint as normal production access.
- If the ISP keeps changing the WAN IP, add DDNS or another automated DNS update path so `fleebee.esonga.online` stays aligned with the live public IP.

## Fine Monitor

As of `2026-09-19`, the home computer has the all-plate Fine Monitor:

- worker directory: `/home/richard/fleebee/current/fine-monitor`
- protected worker environment: `/home/richard/fleebee/shared/fine-monitor.env`
- browser runtime: user-local Playwright Chromium
- Fleebee page: `/contraventions.html`
- navigation label: `Check fines` under `Operations`
- current plate scope: all eligible registered plates (`FINE_MONITOR_PLATE` is blank)
- automatic schedule: enabled; weekly by default, daily selectable in the UI
- backend scheduler poll: once per minute

Manual worker command:

```bash
cd /home/richard/fleebee/current/fine-monitor
FINE_MONITOR_ENV_FILE=/home/richard/fleebee/shared/fine-monitor.env \
  /home/richard/fleebee/runtime/node/bin/node src/run-once.js
```

The Fleebee and worker environment files contain the same private service token.
Never copy the TIN or token into source control, browser code, or logs.

The first all-plate validation attempted 13 plates, stored 11 current fines,
confirmed 3 clear plates, and preserved one plate/TIN mismatch as a failed
lookup. The current displayed total from that run is `RWF 141,000`.

Before the production schema update, the database was backed up to:

- `/home/richard/fleebee/backups/fleebee-before-fine-monitor-20260919-131416.db`

## Services on the home computer (added 2026-11-05)

Everything runs as `systemd --user` units (lingering is enabled, so they start at boot without a login). There is no
Docker, Postgres or `sudo` on this machine. The computer reboots itself every night at 11:00 (`/etc/cron.d/nightly-system-reboot`).

| Unit | What it is | Where it listens / runs |
|---|---|---|
| `fleebee.service` | Fleebee app (Node 20, SQLite) | port 4100 |
| `caddy-fleebee.service` | HTTPS proxy | 8080 / 8443 |
| `bank-statement.service` | Bank statement service (Python venv, SQLite) | 127.0.0.1:8100, API key required |
| `gmail-downloader.timer` | Fetches BK statement emails from Gmail (read-only) | every 5 min |
| `fleebee-backup.timer` | Nightly backup | 03:30 |

Install / update scripts (run from the development computer, all idempotent):

```bash
deploy/home-computer/sync-release.sh                      # app code
deploy/home-computer/restart-service.sh                   # restart the app
deploy/home-computer/install-bank-statement-service.sh    # bank service (venv, SQLite, unit, .env settings)
deploy/home-computer/install-gmail-downloader.sh          # Gmail downloader (see gmail-downloader/README.md)
deploy/home-computer/install-backups.sh                   # nightly backup
deploy/home-computer/verify-health.sh                     # PASS/FAIL check of everything; run it after the 11:00 reboot
```

### Files (`~/fleebee/shared/`, all private)

```text
.env                              app settings (BANK_STATEMENT_SERVICE_*, BANK_EMAIL_*, PAYMENTS_SHEET_SERVICE_ACCOUNT_FILE, BACKUP_STATUS_FILE)
bank-statement.env                bank service settings incl. its API key (generated on the machine)
bank-statements.db                bank service database (SQLite; built from the models, migrations are Postgres-only)
gmail/credentials.json, token.json, state.json, status.json     Gmail OAuth client, token, downloader records, heartbeat
bank-statements/inbox/YYYY-MM/    PDFs fetched from Gmail (deleted after GMAIL_RETENTION_DAYS, default 90; records stay)
google-data-sync-service-account.json   service account used to read AND write the sheet (Editor on the workbook)
```

### Backups

`backup_home.py` writes `~/fleebee/backups/daily/<date>/` every night (consistent copies of `fleebee.db` and
`bank-statements.db`, the downloader records, the inbox PDFs, and the `.env` files; the Gmail token is NOT included) and keeps
14 days. `backup-status.json` feeds the "Backups" card in the Overview control center. Manual backups made before
deployments (`~/fleebee/backups/*before*`) are never pruned.

These copies live on the same disk: they protect against mistakes and corruption, not against losing the computer.
Pull them to another machine regularly, for example:

```bash
rsync -a richard@192.168.1.50:fleebee/backups/daily/ ~/fleebee-home-backups/
```

Restore a database: stop the service, copy the file back from `daily/<date>/`, start the service
(`systemctl --user stop bank-statement.service`, `cp .../bank-statements.db ~/fleebee/shared/`, `start`).
Keep the folder private: the config archive contains secrets.

### Moving statement history between computers

`bank-statement-service/scripts/history_copy.py` exports statements, transactions and remembered payers from one bank database
and imports them into another, translating rider ids by name (dry run by default; `--apply` to write; repeatable).
It was used on 2026-11-05 to copy the local history to the home computer. The export file contains financial data: delete it
afterwards.

### After the nightly reboot

Run `deploy/home-computer/verify-health.sh`. Units reported as "started by itself N s after boot" came back without help;
"restarted by hand" means that boot does not prove them (for example after a deployment the same day).
