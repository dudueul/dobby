#!/usr/bin/env bash
# Tailscale remote access for the hub — outbound-only WireGuard (no inbound
# ports, works behind CGNAT) + real HTTPS for the panel via `tailscale serve`
# (Let's Encrypt, issued over DNS-01; nothing is exposed to the internet).
#
# BEFORE RUNNING — irreversible naming choices:
#   * The first serve/cert publishes <machine>.<tailnet>.ts.net to the public
#     Certificate Transparency logs FOREVER, and the panel's future WebAuthn
#     RP ID freezes to that hostname.
#   * So: pick a randomized tailnet name in the admin console first, and keep
#     this machine's name neutral (default: hub).
#
# One-time admin-console prerequisites:
#   * Enable MagicDNS and "HTTPS Certificates".
#   * Approve the LAN route this script advertises.
#   * DISABLE key expiry for this machine and every family device — the
#     default 180-day expiry silently strands devices.
#   * ACLs: family devices -> port 443 only; admin devices add 8443/10000/22.
# NEVER enable Funnel for any of these services.
set -euo pipefail

LAN_CIDR="${LAN_CIDR:-192.168.1.0/24}"
MACHINE="${TS_HOSTNAME:-hub}"

if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

tailscale up --hostname "$MACHINE" --advertise-routes "$LAN_CIDR"

# One tailnet name, differentiated by port. All three targets are loopback-only
# on the host; serve terminates TLS and forwards with X-Forwarded-Proto=https.
tailscale serve --bg --https=443   http://127.0.0.1:8088   # control panel
tailscale serve --bg --https=8443  http://127.0.0.1:8123   # Home Assistant
tailscale serve --bg --https=10000 http://127.0.0.1:3000   # Grafana

tailscale serve status
cat <<'EOF'

Done. Next steps:
  1. Panel:          https://<machine>.<tailnet>.ts.net
     Home Assistant: https://<machine>.<tailnet>.ts.net:8443
     Grafana:        https://<machine>.<tailnet>.ts.net:10000
  2. In .env set  ALLOWED_ORIGINS=https://<machine>.<tailnet>.ts.net
     and keep COOKIE_SECURE=true (the panel now has a real HTTPS origin).
  3. Phones: install Tailscale, sign in, enable On-Demand (iOS) / Always-on
     (Android) VPN, exempt the app from battery optimization, and re-check
     both after OS updates. LAN and tailnet access coexist at home.
  4. HA Companion app: set BOTH internal and external URL to the panel's
     ts.net HA address so "open the app, it works" holds everywhere.
EOF
