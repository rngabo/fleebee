#!/usr/bin/env bash
# Installs the bank statement service on the home computer (no Docker/Postgres/sudo there): Python venv, SQLite,
# systemd user service on 127.0.0.1:8100, and the settings the Fleebee app needs to talk to it and to the Gmail inbox.
# Secrets are generated on the target and never printed or copied off it.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-richard@192.168.1.50}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=5)

ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" 'mkdir -p ~/fleebee/current/bank-statement-service ~/.config/systemd/user ~/fleebee/backups'

rsync -a -e "ssh ${SSH_OPTS[*]}" --delete \
  --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' --exclude '.env' --exclude 'storage' --exclude '*.db' \
  "$ROOT_DIR/bank-statement-service/" "$REMOTE_HOST:~/fleebee/current/bank-statement-service/"
rsync -a -e "ssh ${SSH_OPTS[*]}" "$ROOT_DIR/deploy/home-computer/bank-statement.service" "$REMOTE_HOST:~/.config/systemd/user/bank-statement.service"

ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
SHARED="$HOME/fleebee/shared"
VENV="$HOME/fleebee/runtime/bank-venv"
APP="$HOME/fleebee/current/bank-statement-service"

# Python environment (python3-venv is not installed and sudo is not available, so pip is bootstrapped by hand)
if [ ! -x "$VENV/bin/pip" ]; then
  rm -rf "$VENV"
  python3 -m venv --without-pip "$VENV"
  python3 -c 'import urllib.request; urllib.request.urlretrieve("https://bootstrap.pypa.io/get-pip.py", "/tmp/get-pip.py")'
  "$VENV/bin/python" /tmp/get-pip.py -q
  rm -f /tmp/get-pip.py
fi
"$VENV/bin/pip" install -q --only-binary=:all: -r "$APP/requirements.txt"

# Settings file (created once; the API key is generated here and stays here)
install -d -m 700 "$SHARED/bank-statement-files"
if [ ! -f "$SHARED/bank-statement.env" ]; then
  umask 077
  {
    echo "APP_ENV=production"
    echo "API_KEY=$(openssl rand -hex 24)"
    echo "DATABASE_URL=sqlite+pysqlite:///$SHARED/bank-statements.db"
    echo "STORAGE_DIR=$SHARED/bank-statement-files"
    echo "MAX_UPLOAD_BYTES=10485760"
    echo "FILE_RETENTION_DAYS=30"
  } > "$SHARED/bank-statement.env"
fi
chmod 600 "$SHARED/bank-statement.env"

# Tests run on the target's Python before the service is (re)started
(cd "$APP" && PYTHONPATH="$APP" API_KEY=ci-key-0123456789abcdef "$VENV/bin/python" -m pytest -q 2>&1 | tail -1)

systemctl --user daemon-reload
systemctl --user enable bank-statement.service >/dev/null
systemctl --user restart bank-statement.service

# Let the Fleebee app reach it, and the Gmail inbox (appended only when missing; .env is backed up first)
ENVF="$SHARED/.env"
cp -p "$ENVF" "$HOME/fleebee/backups/env-$(date +%Y%m%d-%H%M%S).bak"
add() { grep -q "^$1=" "$ENVF" || echo "$1=$2" >> "$ENVF"; }
KEY="$(grep '^API_KEY=' "$SHARED/bank-statement.env" | cut -d= -f2-)"
add BANK_STATEMENT_SERVICE_URL "http://127.0.0.1:8100"
add BANK_STATEMENT_SERVICE_API_KEY "$KEY"
add BANK_EMAIL_STATE_FILE "$SHARED/gmail/state.json"
add BANK_EMAIL_INBOX_DIR "$SHARED/bank-statements/inbox"
chmod 600 "$ENVF"
echo "fleebee .env bank settings present: $(grep -c '^BANK_' "$ENVF")"

# Health: the service answers with its key and refuses without it
for i in $(seq 1 20); do
  curl -s -o /dev/null -H "X-API-Key: $KEY" "http://127.0.0.1:8100/api/v1/statements?page=1&page_size=1" && break
  sleep 1
done
echo "with key:    HTTP $(curl -s -o /dev/null -w '%{http_code}' -H "X-API-Key: $KEY" "http://127.0.0.1:8100/api/v1/statements?page=1&page_size=1")"
echo "without key: HTTP $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8100/api/v1/statements")"
systemctl --user is-active bank-statement.service
REMOTE
