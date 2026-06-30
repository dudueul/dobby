# control-panel

A local home-management panel for the dobby hub: a **BFF** (server) + a **PWA**
(web). It ingests Home Assistant events live, streams cameras over WebRTC, and
drives doors/climate/lights/house-mode — as a **thin client over the entity
seam** (`docs/11`). The browser never holds the HA token and never speaks a
device protocol; Home Assistant stays the authority.

## Shape

```
server/   Fastify BFF — holds the HA token, proxies HA (live + commands),
          proxies go2rtc WebRTC, fans out Web Push. The allow-list IS the seam.
  config.ts   entity + service allow-list, cameras, env
  ha.ts       HA WebSocket state cache + allow-listed REST call_service
  push.ts     VAPID Web Push fan-out (HA -> /api/push/notify)
  index.ts    /api/state, /api/stream (SSE), /api/command, /api/webrtc/:cam
web/      Vite + React PWA (TanStack-friendly; add Router/Query as it grows)
  src/api.ts        useLiveState (SSE), sendCommand, startCamera (WebRTC), enablePush
  src/App.tsx       dashboard: house-mode, doors, climate, cameras, sensors
  public/sw.js      service worker (offline shell + push handler)
```

## Endpoints (BFF)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/state` | snapshot of allow-listed entities |
| GET | `/api/stream` | **SSE** live state (snapshot + per-change) |
| POST | `/api/command` | `{entity_id, service, data}` — allow-listed only |
| POST | `/api/webrtc/:camera` | WebRTC offer → go2rtc answer (live view) |
| GET/POST | `/api/push/*` | VAPID pubkey, subscribe, notify (HA-triggered) |

## Run

Dev (two processes, web proxies `/api` to the BFF on :8088):
```bash
cd apps/control-panel
npm install
HA_BASE_URL=http://homeassistant:8123 HA_TOKEN=<long-lived> npm run dev
# web on :5173, BFF on :8088
```

Prod (Docker; built PWA served by the BFF on :8088) — wired into the root
`docker-compose.yml` as the `control-panel` service. Set the env in `.env`.

## Configure

- Edit `server/config.ts` `ENTITY_ALLOW` / `SERVICE_ALLOW` / `CAMERAS` to match
  your entity ids and go2rtc stream names. This list is the security boundary.
- Web Push: `npx web-push generate-vapid-keys` → put the keys in `.env`
  (`VAPID_PUBLIC`/`VAPID_PRIVATE`), and have HA fire a `rest_command` to
  `/api/push/notify` (header `x-push-secret: $PUSH_SHARED_SECRET`).

## Security / boundaries (per docs/11)

- **VPN-only**: reach the panel through WireGuard/Tailscale, never a public port.
- The HA token lives **only in the BFF** env, never in the browser.
- `lock.unlock` / arm are **sensitive** — the UI confirms; replace `confirm()`
  with a **WebAuthn/passkey (Face ID)** gate for production.
- The panel is **convenience, not control**: locks and the thermostat keep
  working if the panel/BFF/hub is down.
- **Web Push = informational alerts** only; keep the HA Companion app for
  security-critical (Time-Sensitive/Critical) alarms.

## Not done yet (scaffold)

Auth on the panel itself (beyond VPN), persisted push subscriptions, multi-user
roles, capability-driven UI for multi-zone HVAC, icons, and tests/CI for this
app. See the repo gap analysis for the prioritized list.
