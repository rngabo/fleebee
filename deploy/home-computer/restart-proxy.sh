#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-richard@192.168.1.50}"
REMOTE_DEPLOY_DIR="${REMOTE_DEPLOY_DIR:-/home/richard/fleebee/current/deploy/home-computer}"
REMOTE_PROXY_DIR="${REMOTE_PROXY_DIR:-/home/richard/fleebee/proxy}"
REMOTE_SYSTEMD_DIR="${REMOTE_SYSTEMD_DIR:-/home/richard/.config/systemd/user}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=5)
RSYNC_SSH="ssh -F /dev/null ${SSH_OPTS[*]}"

rsync -av \
  -e "$RSYNC_SSH" \
  "$ROOT_DIR/deploy/home-computer/Caddyfile.rootless" \
  "$ROOT_DIR/deploy/home-computer/caddy-fleebee.service" \
  "$REMOTE_HOST:$REMOTE_DEPLOY_DIR/"

ssh -F /dev/null "${SSH_OPTS[@]}" "$REMOTE_HOST" 'bash -s' <<EOF
set -euo pipefail

REMOTE_DEPLOY_DIR="$REMOTE_DEPLOY_DIR"
REMOTE_PROXY_DIR="$REMOTE_PROXY_DIR"
REMOTE_SYSTEMD_DIR="$REMOTE_SYSTEMD_DIR"

cp "\$REMOTE_DEPLOY_DIR/Caddyfile.rootless" "\$REMOTE_PROXY_DIR/config/Caddyfile"
cp "\$REMOTE_DEPLOY_DIR/caddy-fleebee.service" "\$REMOTE_SYSTEMD_DIR/caddy-fleebee.service"

systemctl --user daemon-reload
systemctl --user restart caddy-fleebee.service
systemctl --user status caddy-fleebee.service --no-pager -l | sed -n '1,80p'
EOF
