# 14 — Remote access (Tailscale + tailnet HTTPS)

How a family phone reaches the hub from anywhere, with **zero public
exposure** and **zero per-use VPN toggling**:

```
phone (Tailscale, On-Demand/Always-on, split-tunnel)
  │  WireGuard tunnel (outbound-only; no port-forward; works behind CGNAT)
  ▼
NUC: tailscaled (subnet router for the LAN)
  │  tailscale serve — terminates TLS with a real Let's Encrypt cert
  │  for  https://hub.<tailnet>.ts.net  (issued via DNS-01; tailnet-only)
  ▼
127.0.0.1:8088 control-panel BFF  ·  :8123 Home Assistant  ·  :3000 Grafana
```

Run `provisioning/setup-tailscale.sh` (read its header first — the tailnet /
machine name is permanent: certificates land in public CT logs, and the
future WebAuthn RP ID freezes to the hostname).

## Why this shape

- **No public listeners.** The panel binds to loopback (`127.0.0.1:8088` in
  compose); the only ingress is `serve`. UFW stays default-deny. There is no
  origin for an internet attacker to hit — remote access requires a device
  key in your tailnet *and then* the panel's session auth. Two independent
  gates.
- **A real HTTPS origin with no exposure.** `serve` auto-provisions/renews a
  publicly-trusted cert for the ts.net name. That makes `COOKIE_SECURE=true`
  correct (Secure cookies work), lets the PWA install properly on iOS, and
  unlocks the WebAuthn/passkey step-up follow-up (WebAuthn requires a secure
  context and a domain RP ID — a LAN IP can never do it).
- **No toggle friction.** iOS "VPN On Demand" / Android Always-on keeps the
  tunnel up without anyone thinking about it. At home, Tailscale uses the
  direct LAN path — nothing detours through a relay.
- **No third party sees plaintext.** WireGuard is end-to-end between the
  phone and the hub; Tailscale coordinates keys but does not hold them. (This
  is the property a Cloudflare-proxied setup cannot give you — its edge
  terminates TLS. If a non-tailnet convenience door is ever wanted, scope it
  to a read-only status page, never locks/cameras/HA.)

## Family-device runbook

1. Install Tailscale, sign in (free plan: 6 users, unlimited devices).
2. Enable **On-Demand** (iOS) / **Always-on VPN** (Android). Note iOS cannot
   enforce always-on — a user *can* toggle it off; the LAN path still works
   at home either way.
3. **Disable key expiry** for the device in the admin console (default
   180-day expiry silently strands it).
4. Exempt the app from battery optimization (Samsung/Xiaomi especially) and
   re-check after OS updates. Don't route through an exit node — that's the
   documented battery killer.
5. HA Companion app: internal AND external URL = `https://hub.<tailnet>.ts.net:8443`.
6. ACLs: family → 443 only; admin devices add 8443 (HA), 10000 (Grafana), 22.

## Failure modes

- **Tailscale control-plane outage:** existing tunnels generally stay up; new
  connections may fail. LAN access and all local automation are unaffected —
  the panel is convenience, locks/HVAC/alarm run on the hub and devices.
- **Break-glass:** plain WireGuard on the router (UFW already allows
  51820/udp) if you have a public IP; strictly worse UX, keep it dormant.
- **Cert renewal:** `serve` renews the 90-day certs itself; `tailscale serve
  status` in the healthcheck would catch a wedged state.
