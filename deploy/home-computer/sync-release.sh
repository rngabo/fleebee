#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-richard@192.168.1.50}"
REMOTE_DIR="${REMOTE_DIR:-~/fleebee/current}"
REMOTE_SYSTEMD_DIR="${REMOTE_SYSTEMD_DIR:-~/.config/systemd/user}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=5)
RSYNC_SSH="ssh ${SSH_OPTS[*]}"

ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "mkdir -p $REMOTE_DIR/fllee-backend $REMOTE_DIR/flee-frontend/public $REMOTE_DIR/deploy/home-computer"

rsync -av \
  -e "$RSYNC_SSH" \
  --delete \
  --exclude '.env' \
  --exclude 'node_modules' \
  --exclude 'fleebee.db' \
  "$ROOT_DIR/fllee-backend/" \
  "$REMOTE_HOST:$REMOTE_DIR/fllee-backend/"

rsync -av \
  -e "$RSYNC_SSH" \
  --delete \
  "$ROOT_DIR/flee-frontend/public/" \
  "$REMOTE_HOST:$REMOTE_DIR/flee-frontend/public/"

rsync -av \
  -e "$RSYNC_SSH" \
  "$ROOT_DIR/deploy/home-computer/" \
  "$REMOTE_HOST:$REMOTE_DIR/deploy/home-computer/"

rsync -av \
  -e "$RSYNC_SSH" \
  "$ROOT_DIR/architecture.md" \
  "$ROOT_DIR/progress.md" \
  "$REMOTE_HOST:$REMOTE_DIR/"

ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" 'bash -s' <<EOF
set -euo pipefail

mkdir -p $REMOTE_SYSTEMD_DIR
cp $REMOTE_DIR/deploy/home-computer/fleebee.service $REMOTE_SYSTEMD_DIR/fleebee.service
systemctl --user daemon-reload
systemctl --user enable fleebee.service >/dev/null

linger_state="\$(loginctl show-user "\$USER" -p Linger --value 2>/dev/null || true)"
if [ "\$linger_state" != "yes" ]; then
  cat <<WARN
WARNING: loginctl linger is disabled for \$USER.
Fleebee runs as a user-level systemd service, so it will stop when the SSH session ends until lingering is enabled.

Run this once on the home computer as root:
  sudo loginctl enable-linger \$USER
WARN
fi
EOF
