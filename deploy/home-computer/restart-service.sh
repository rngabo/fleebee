#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-richard@192.168.1.50}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=5)

ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" 'bash -s' <<'EOF'
set -euo pipefail

linger_state="$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || true)"
if [ "$linger_state" != "yes" ]; then
  echo "ERROR: loginctl linger is disabled for $USER."
  echo "Run this once on the home computer as root:"
  echo "  sudo loginctl enable-linger $USER"
  exit 1
fi

systemctl --user restart fleebee.service
systemctl --user status fleebee.service --no-pager
EOF
