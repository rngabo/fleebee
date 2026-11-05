#!/usr/bin/env bash
# Checks the home computer's services over SSH. Run it after the nightly 11:00 reboot to prove everything came back by itself:
#   deploy/home-computer/verify-health.sh
# For each service it reports whether it was started automatically after boot, or restarted by hand since then.
set -uo pipefail

REMOTE_HOST="${REMOTE_HOST:-richard@192.168.1.50}"
ssh -o BatchMode=yes -o ConnectTimeout=5 "$REMOTE_HOST" 'bash -s' <<'REMOTE'
fail=0
pass() { echo "PASS  $*"; }
bad()  { echo "FAIL  $*"; fail=1; }
info() { echo "INFO  $*"; }

boot_epoch=$(date -d "$(uptime -s)" +%s)
echo "Computer started: $(uptime -s)  (up $(uptime -p | sed 's/^up //'))"

for unit in fleebee.service bank-statement.service caddy-fleebee.service gmail-downloader.timer fleebee-backup.timer; do
  if [ "$(systemctl --user is-active "$unit")" = "active" ]; then
    started=$(date -d "$(systemctl --user show -p ActiveEnterTimestamp --value "$unit")" +%s 2>/dev/null || echo 0)
    if [ "$started" -ge "$boot_epoch" ] && [ $((started - boot_epoch)) -le 900 ]; then
      pass "$unit active, started by itself $((started - boot_epoch)) s after boot"
    else
      info "$unit active (restarted by hand since boot, so this boot does not prove it)"
    fi
  else
    bad "$unit is not active"
  fi
done

[ "$(curl -s -m 5 localhost:4100/health | tr -d ' \n')" = '{"status":"ok","service":"fleebee-app","storage":"sqlite"}' ] && pass "Fleebee app answers" || bad "Fleebee app does not answer"
KEY=$(grep '^API_KEY=' ~/fleebee/shared/bank-statement.env | cut -d= -f2-)
[ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -H "X-API-Key: $KEY" 'http://127.0.0.1:8100/api/v1/statements?page=1&page_size=1')" = "200" ] && pass "Bank statement service answers" || bad "Bank statement service does not answer"
[ "$(curl -sk -m 5 -o /dev/null -w '%{http_code}' --resolve fleebee.esonga.online:8443:127.0.0.1 https://fleebee.esonga.online:8443/health)" = "200" ] && pass "Proxy (Caddy) serves the app" || bad "Proxy does not serve the app"

age_min() { echo $(( ($(date +%s) - $(date -d "$1" +%s)) / 60 )); }
checked=$(python3 -c "import json;print(json.load(open('$HOME/fleebee/shared/gmail/status.json'))['checkedAt'])" 2>/dev/null)
if [ -n "$checked" ]; then a=$(age_min "$checked"); [ "$a" -le 15 ] && pass "Gmail downloader checked ${a} min ago" || bad "Gmail downloader last checked ${a} min ago (timer not running?)"; else bad "No Gmail heartbeat found"; fi
done_at=$(python3 -c "import json;s=json.load(open('$HOME/fleebee/backups/backup-status.json'));print(s['finishedAt'] if s['ok'] else '')" 2>/dev/null)
if [ -n "$done_at" ]; then a=$(age_min "$done_at"); [ "$a" -le 2160 ] && pass "Last good backup $((a / 60)) h ago" || bad "Last good backup $((a / 60)) h ago (overdue)"; else bad "No good backup recorded"; fi

[ "$fail" = 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $fail
REMOTE
