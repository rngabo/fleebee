#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-richard@192.168.1.50}"
REMOTE_DIR="${REMOTE_DIR:-~/fleebee/current}"
SSH_OPTS=(-o ConnectTimeout=5)

ssh "${SSH_OPTS[@]}" -tt "$REMOTE_HOST" "sudo $REMOTE_DIR/deploy/home-computer/install-nightly-system-reboot-cron.sh"
