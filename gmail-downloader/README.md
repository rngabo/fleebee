# Fleebee Gmail Bank-Statement Downloader

Polls Gmail every 5 minutes and saves new BK statement PDFs on the home computer (`richard@192.168.1.50`).
It has **read-only** Gmail access (`gmail.readonly`) and never changes, labels, moves or deletes mail.

## What it accepts

An email is processed only if **all** of these hold:

| Rule | Value |
|---|---|
| Gmail label | `Fleebee/BankStatements` (applied by your Gmail filter) |
| Sender (exact address) | `bkebanking@bk.rw` |
| Subject begins with | `BK INTERNET BANKING STATEMENT FROM` (case-insensitive) |
| Sender authentication | Gmail reports DKIM or SPF **pass** for `bk.rw` (stops forged senders) |
| Received | **after** the moment the downloader was first started (`since` in `state.json`) |

Every PDF attachment must also be a real PDF: `%PDF-` header, `%%EOF` trailer, at most 15 MB, and no
JavaScript/Launch/embedded-file content. Anything else is rejected, logged with a reason code and remembered.
Old emails are never downloaded, even if the label is applied to them later.

## Where things are (on 192.168.1.50)

```text
~/fleebee/current/gmail-downloader/        code (synced from this repo)
~/fleebee/shared/gmail/credentials.json    OAuth client (Desktop app), mode 600, never in Git
~/fleebee/shared/gmail/token.json          refresh token created by the one-time authorization, mode 600
~/fleebee/shared/gmail/state.json          start point, handled message ids, PDF hashes (mode 600)
~/fleebee/shared/bank-statements/inbox/    saved PDFs, folder mode 700, files mode 600:
                                           YYYY-MM/bk-statement_<received date>_<sha256 prefix>.pdf
```

File names are generated, never taken from the email (no path tricks). A PDF with the same SHA-256 as one
already saved is not saved again, whichever email it arrives in.

## Scheduling

`gmail-downloader.timer` (systemd **user** unit; lingering is enabled for `richard`, so it runs after a reboot
without anyone logging in): first pass 2 minutes after boot, then 5 minutes after each pass finishes.
Only one pass runs at a time (lock file).

```bash
systemctl --user list-timers gmail-downloader.timer
journalctl --user -u gmail-downloader.service -n 50 --no-pager
systemctl --user start gmail-downloader.service        # run a pass now
```

## Deploy / update

```bash
deploy/home-computer/install-gmail-downloader.sh
```

It syncs the code (no secrets), runs the tests on the target's Node, installs the units and enables the timer.
The timer is only started once a token exists.

## One-time authorization

The OAuth client is a Desktop app, so approval happens on a loopback port. From a computer with a browser:

```bash
ssh -L 8765:127.0.0.1:8765 richard@192.168.1.50
cd ~/fleebee/current/gmail-downloader && ~/fleebee/runtime/node/bin/node src/authorize.js
```

Open the printed link in your local browser, sign in as the mailbox that receives the statements and approve
**read-only** access. The script stores the token (mode 600), fixes the "only newer emails" start point,
and reports the mailbox and whether the label exists. Then start the timer:
`systemctl --user enable --now gmail-downloader.timer`.

A token that carries more than read-only Gmail access is refused. If the token is revoked or expires (e.g. the
OAuth consent screen is in "Testing" mode, where Google expires refresh tokens after 7 days — publish it to
"In production" to avoid this), the run exits with code 2 and "AUTHORIZATION PROBLEM"; authorize again.

## Configuration (optional, no secrets)

Set in `~/fleebee/shared/gmail-downloader.env`: `GMAIL_LABEL`, `GMAIL_SENDER`, `GMAIL_SUBJECT_PREFIX`,
`GMAIL_DOWNLOAD_DIR`, `GMAIL_MAX_PDF_BYTES`, `GMAIL_MAX_MESSAGES_PER_RUN`,
`GMAIL_REQUIRE_SENDER_AUTH` (`true` by default; `false` only if the bank's mail is rejected for `sender-not-authenticated`).

## Troubleshooting

* `Label ... does not exist` - create the label and the Gmail filter that applies it.
* An email was rejected: the reason is in the journal and in `state.json` (`messages.<id>.reason`). After fixing the
  cause (for example the sender-authentication setting), run `node src/run-once.js --retry-rejected`.
* Temporary failures (network, Gmail errors) are not remembered and retry automatically on the next pass.

## Tests

```bash
npm test        # Node >= 20, no dependencies; uses a mock Gmail/token server, never the real mailbox
```

## Hand-off to the statement page ("Arrived by email")

The downloader records, for every saved PDF, the email's subject, arrival time and attachment name in `state.json`.
The Fleebee backend reads that file (read-only) and shows the PDFs on **Bank Statements → Arrived by email**:
name, period, arrival time, and **New / Opened**. **Open** sends the saved PDF to the bank-statement service like a
manual upload, but tagged `email`; from then on it is listed under **Saved statements** with an **✉ Email** label (manual
uploads show **⬆ Uploaded**) and its arrival time. Nothing is synced to the sheet automatically.

Backend settings (`~/fleebee/shared/.env` on the home computer; the docker setup mounts `./.email-inbox` instead):

```text
BANK_EMAIL_STATE_FILE=/home/richard/fleebee/shared/gmail/state.json
BANK_EMAIL_INBOX_DIR=/home/richard/fleebee/shared/bank-statements/inbox
```

Leave both empty to hide the panel. PDFs saved before the subject/time were recorded can be filled in with
`node src/backfill.js` (read-only on Gmail). The bank-statement service itself must be reachable
(`BANK_STATEMENT_SERVICE_URL`). On the home computer it runs as `bank-statement.service` (Python venv + SQLite, 127.0.0.1:8100; install with `deploy/home-computer/install-bank-statement-service.sh`).
