#!/usr/bin/env bash
# Installs the nightly backup (systemd user timer) on the home computer and runs it once to prove it works.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-richard@192.168.1.50}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=5)

ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" 'mkdir -p ~/fleebee/current/deploy/home-computer ~/.config/systemd/user'
rsync -a -e "ssh ${SSH_OPTS[*]}" \
  "$ROOT_DIR/deploy/home-computer/backup_home.py" "$ROOT_DIR/deploy/home-computer/tests" \
  "$REMOTE_HOST:~/fleebee/current/deploy/home-computer/"
rsync -a -e "ssh ${SSH_OPTS[*]}" \
  "$ROOT_DIR/deploy/home-computer/fleebee-backup.service" "$ROOT_DIR/deploy/home-computer/fleebee-backup.timer" \
  "$REMOTE_HOST:~/.config/systemd/user/"

ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
cd ~/fleebee/current/deploy/home-computer && python3 -m unittest discover -s tests 2>&1 | tail -1
systemctl --user daemon-reload
systemctl --user enable --now fleebee-backup.timer
systemctl --user start fleebee-backup.service
journalctl --user -u fleebee-backup.service -n 3 --no-pager | grep -v systemd | cut -c1-170
systemctl --user list-timers fleebee-backup.timer --no-pager | head -2
ls -la ~/fleebee/backups/daily/*/ | tail -8
REMOTE
