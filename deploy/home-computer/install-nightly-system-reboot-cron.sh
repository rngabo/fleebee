#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script with sudo on the home computer."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRON_NAME="nightly-system-reboot"
CRON_SOURCE="$ROOT_DIR/nightly-system-reboot.cron"
CRON_TARGET="/etc/cron.d/$CRON_NAME"

install -m 0644 "$CRON_SOURCE" "$CRON_TARGET"

echo
echo "Installed $CRON_TARGET"
cat "$CRON_TARGET"
