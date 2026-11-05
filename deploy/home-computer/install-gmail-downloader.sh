#!/usr/bin/env bash
# Copies the Gmail downloader to the home computer and enables its systemd user timer.
# Secrets are never copied by this script: the OAuth client file and token already live in ~/fleebee/shared/gmail/.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-richard@192.168.1.50}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=5)

ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" 'mkdir -p ~/fleebee/current/gmail-downloader ~/.config/systemd/user'

rsync -av -e "ssh ${SSH_OPTS[*]}" --delete \
  --exclude 'node_modules' --exclude '.env' --exclude 'token.json' --exclude 'credentials.json' \
  "$ROOT_DIR/gmail-downloader/" "$REMOTE_HOST:~/fleebee/current/gmail-downloader/"

ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
NODE="$HOME/fleebee/runtime/node/bin/node"
SHARED="$HOME/fleebee/shared"

# private directories
install -d -m 700 "$SHARED/gmail" "$SHARED/bank-statements" "$SHARED/bank-statements/inbox"
[ -f "$SHARED/gmail/credentials.json" ] || { echo "Missing $SHARED/gmail/credentials.json (OAuth client)."; exit 1; }
chmod 600 "$SHARED/gmail/credentials.json"
[ ! -f "$SHARED/gmail/token.json" ] || chmod 600 "$SHARED/gmail/token.json"

# tests must pass on the target's Node before the timer is enabled
(cd "$HOME/fleebee/current/gmail-downloader" && "$NODE" --test test/*.test.js >/dev/null) && echo "tests pass on $("$NODE" -v)"

cp "$HOME/fleebee/current/gmail-downloader/deploy/gmail-downloader.service" "$HOME/.config/systemd/user/"
cp "$HOME/fleebee/current/gmail-downloader/deploy/gmail-downloader.timer" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload

if [ -f "$SHARED/gmail/token.json" ]; then
  systemctl --user enable --now gmail-downloader.timer
  systemctl --user list-timers gmail-downloader.timer --no-pager
else
  systemctl --user enable gmail-downloader.timer >/dev/null
  echo "Timer enabled but NOT started: authorize Gmail once first (see gmail-downloader/README.md)."
fi
[ "$(loginctl show-user "$USER" -p Linger --value)" = "yes" ] || echo "WARNING: linger is off; run: sudo loginctl enable-linger $USER"
REMOTE
