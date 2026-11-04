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

mkdir -p \
  "\$REMOTE_PROXY_DIR/bin" \
  "\$REMOTE_PROXY_DIR/config" \
  "\$REMOTE_PROXY_DIR/data" \
  "\$REMOTE_PROXY_DIR/state" \
  "\$REMOTE_PROXY_DIR/logs" \
  "\$REMOTE_SYSTEMD_DIR"

arch="\$(uname -m)"
case "\$arch" in
  x86_64|amd64)
    caddy_arch="amd64"
    ;;
  aarch64|arm64)
    caddy_arch="arm64"
    ;;
  *)
    echo "Unsupported architecture for Caddy: \$arch" >&2
    exit 1
    ;;
esac

latest_url="\$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/caddyserver/caddy/releases/latest)"
latest_tag="\${latest_url##*/}"
latest_version="\${latest_tag#v}"

if [ -z "\$latest_version" ] || [ "\$latest_version" = "\$latest_url" ]; then
  echo "Could not determine latest Caddy release version." >&2
  exit 1
fi

tmpdir="\$(mktemp -d)"
trap 'rm -rf "\$tmpdir"' EXIT

asset="caddy_\${latest_version}_linux_\${caddy_arch}.tar.gz"
curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v\${latest_version}/\${asset}" -o "\$tmpdir/\$asset"
tar -xzf "\$tmpdir/\$asset" -C "\$tmpdir" caddy
install -m 0755 "\$tmpdir/caddy" "\$REMOTE_PROXY_DIR/bin/caddy"

cp "\$REMOTE_DEPLOY_DIR/Caddyfile.rootless" "\$REMOTE_PROXY_DIR/config/Caddyfile"
cp "\$REMOTE_DEPLOY_DIR/caddy-fleebee.service" "\$REMOTE_SYSTEMD_DIR/caddy-fleebee.service"

systemctl --user daemon-reload
systemctl --user enable --now caddy-fleebee.service >/dev/null
systemctl --user status caddy-fleebee.service --no-pager -l | sed -n '1,80p'
EOF
