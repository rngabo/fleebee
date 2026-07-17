#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-richard@192.168.1.50}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=5)

ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" 'bash -s' <<'EOF'
set -euo pipefail

BASE_DIR="$HOME/fleebee"
APP_DIR="$BASE_DIR/current/fllee-backend"
LOG_DIR="$BASE_DIR/logs"
ENV_FILE="$BASE_DIR/shared/.env"
NODE_BIN="$BASE_DIR/runtime/node/bin"
APP_LOG="$LOG_DIR/manual-app.log"
PRESTART_LOG="$LOG_DIR/manual-prestart.log"

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

export PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin"
systemctl --user stop fleebee.service >/dev/null 2>&1 || true
systemctl --user disable fleebee.service >/dev/null 2>&1 || true
pkill -f "$NODE_BIN/node server.js" >/dev/null 2>&1 || true
ln -sfn "$ENV_FILE" "$APP_DIR/.env"

"$NODE_BIN/npm" run prisma:migrate >>"$PRESTART_LOG" 2>&1
nohup "$NODE_BIN/node" server.js >>"$APP_LOG" 2>&1 < /dev/null &

echo "Started temporary Fleebee process without systemd linger."
echo "The user-level fleebee.service was stopped and disabled to avoid port conflicts during this temporary mode."
echo "Check logs with: tail -n 50 $APP_LOG"
EOF
