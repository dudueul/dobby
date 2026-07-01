#!/usr/bin/env bash
# Lightweight host/stack health check. Run from cron every few minutes; it emits
# one line per problem to stdout (wire to ntfy/HA for alerts) and exits non-zero
# if anything is wrong. Silence = healthy.
set -uo pipefail

MOUNT="/srv/dobby/media"
LOW_WATER="${DISK_LOW_WATER_PCT:-15}"
problems=0
say(){ echo "[health] $*"; problems=$((problems+1)); }

# 1. surveillance disk mounted and encrypted-mapper present
mountpoint -q "$MOUNT" || say "media disk not mounted at $MOUNT"

# 2. free space above low-water mark
free_pct="$(df --output=pcent "$MOUNT" 2>/dev/null | tail -1 | tr -dc '0-9')"
if [[ -n "$free_pct" ]]; then
  used=$free_pct; avail=$((100-used))
  [[ $avail -lt $LOW_WATER ]] && say "media free ${avail}% < ${LOW_WATER}% (trigger archive eviction)"
fi

# 3. core containers running
for c in lockhub_postgres lockhub_mosquitto lockhub_homeassistant lockhub_frigate; do
  state="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)"
  [[ "$state" == "running" ]] || say "container $c is $state"
done

# 4. SMART health of the surveillance disk
for d in /dev/sd?; do
  smartctl -H "$d" 2>/dev/null | grep -qi 'PASSED' || say "SMART not PASSED on $d"
done

# 5. NVMe wear (warn over 80% used)
for n in /dev/nvme?n1; do
  pct="$(nvme smart-log "$n" 2>/dev/null | awk -F: '/percentage_used/{gsub(/[^0-9]/,"",$2);print $2}')"
  [[ -n "${pct:-}" && "$pct" -gt 80 ]] && say "NVMe $n wear ${pct}%"
done

# 6. page a human: problems go out as a critical push (best effort — a dead
# panel is itself one of the problems this reports, hence the journal too)
if [[ $problems -gt 0 && -f /opt/dobby/.env ]]; then
  secret="$(grep -E '^PUSH_SHARED_SECRET=' /opt/dobby/.env | cut -d= -f2-)"
  if [[ -n "$secret" && "$secret" != CHANGE_ME* ]]; then
    curl -m 5 -s -o /dev/null -X POST http://127.0.0.1:8088/api/push/notify \
      -H "x-push-secret: $secret" -H 'Content-Type: application/json' \
      -d "{\"title\":\"dobby health\",\"body\":\"$problems problem(s) — see journalctl -u dobby-maintenance\",\"tier\":\"critical\"}" || true
  fi
fi

exit $problems
