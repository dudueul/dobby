# 11 — Remote app & the Home Assistant API seam

This defines the **narrow interface** any remote control panel talks to — a
native iOS/Swift app, an Apple Home tile, a wall tablet, or the HA Companion app.
The rule is the same as for the locks and HVAC: the app is a **thin client**;
Home Assistant is the deep module that owns every device protocol and exposes a
small set of entities. An app never speaks Z-Wave/Zigbee/RTSP/CN105 and is never
the authority or the fail-safe.

## Do you need a custom app?

Usually no — the **HA Companion app** (widgets, Apple Watch, Siri/App Intents,
actionable notifications, presence) and **Apple Home** (via HA's HomeKit Bridge:
Control Center / Lock Screen / Siri) already give a secure local panel. Build a
custom Swift app only for bespoke UX (single-glance security panel, Live
Activities, custom arm flow). If you do, build against the seam below.

## Transport — VPN-only, zero inbound

The app reaches HA **only over WireGuard/Tailscale** (per `docs/02`). No public
endpoint, no port-forward, never Nabu Casa as the control path. Pin the HA TLS
cert in the app.

## Two API surfaces (pick one)

1. **HA WebSocket + REST API** (full control, language-neutral):
   - **WebSocket** `ws://ha.home.arpa:8123/api/websocket` — auth with a
     long-lived token, then `subscribe_trigger` on `state_changed` for the entity
     set below → live state with no polling.
   - **REST** `POST /api/services/<domain>/<service>` for one-shot commands;
     `GET /api/states/<entity>` for a snapshot.
2. **Apple HomeKit framework via HA's HomeKit Bridge** (recommended for Swift):
   write only the UI; Apple handles transport, auth, encryption, and secure
   remote (needs a HomePod/Apple TV home hub). You get less to maintain at the
   cost of only what the bridge exposes.

## PWA option (TanStack Start + BFF) — recommended for a quick-view panel

For a quick-view management client (dashboards, light/HVAC controls, arm/disarm,
camera view) a **PWA is sufficient and the lighter path** than a native app:
cross-platform from one codebase, installable to the Home Screen, no App Store,
instant updates. Live camera works via **go2rtc WebRTC**.

- **Build with TanStack Start using its server functions as a small BFF** that
  **holds the HA token server-side** (keeps it out of the browser) and proxies/
  normalizes the HA API. Pair **TanStack Query** (fetched/cached state) with the
  **HA WebSocket** (live push into the UI). A plain Vite + TanStack Router SPA is
  fine too if you skip the BFF — but then the token lives in the browser, so gate
  with a passkey (below). The BFF runs as another container on the hub, reachable
  only over the VPN.
- **iOS gaps the PWA can't fill:** Home Screen widgets, Lock Screen, Live
  Activities, Apple Watch, and background location/geofencing — use the **HA
  Companion app** for presence and for the alerting below.

### Notifications — Web Push vs Companion (the split that matters)

- **Web Push works on iOS 16.4+ but only when the PWA is installed to the Home
  Screen**; iOS requires a notification be shown for every push (no silent
  pushes); payloads are E2E-encrypted (VAPID). Android Chrome Web Push is
  unrestricted.
- **Decisive limit:** iOS does **not** expose the Time-Sensitive / Critical
  interruption level to Web Push, so a Web Push alert can be **silenced by Focus /
  Do Not Disturb / Sleep**. Therefore:
  - **Use Web Push** for informational/management alerts (battery low, door left
    open, package detected).
  - **Keep the HA Companion app** for **security-critical** alerts (intrusion,
    door forced, alarm) — it can send **Time-Sensitive/Critical** that pierce
    Focus/DND. Do not make Web Push your alarm channel on iOS.
- **Custom PWA push wiring:** VAPID keypair → service-worker `push` handler →
  `PushManager.subscribe()` → store the subscription in the **BFF** (which holds
  the VAPID private key) → HA automation → `rest_command` → BFF → `web-push` to
  subscribers. (Or just use HA's built-in **`html5`** notify for the HA frontend
  PWA.)
- **Offline:** Web Push *and* APNs both need internet — neither fires if home
  internet is down. Add a **local** alert path (HomePod/Sonos TTS, or a siren on
  the alarm) so a break-in is still noticed offline.

## The entity contract (the only things the app touches)

| Capability | Entity | Command (REST service) |
|---|---|---|
| Doors | `lock.front_door_nuki`, `lock.back_door_nuki` | `lock/lock`, `lock/unlock` |
| Climate | `climate.hvac` | `climate/set_temperature`, `climate/set_hvac_mode` |
| House mode (arm/away) | `input_select.house_mode` | `input_select/select_option` |
| Lights | `light.*` | `light/turn_on`, `light/turn_off` |
| Audio | `media_player.<room>` | `media_player/*` |
| Live state | `binary_sensor.*` (presence/contact/motion), `sensor.*` (battery/temp), `climate.hvac` attrs | (read via WebSocket) |
| Cameras | Frigate / `camera.*` | live view via **go2rtc WebRTC** over the tunnel |

Read capabilities **dynamically** (`hvac_modes`, `fan_modes`, `target_temp_high/low`,
lock states) so a device swap (relay → Z-Wave thermostat, Nuki model change)
never touches the app — that's the payoff of the deep module.

## Command example (REST)

```
POST /api/services/climate/set_temperature
Authorization: Bearer <long-lived-token>
{ "entity_id": "climate.hvac", "temperature": 70 }
```

## Live-state example (WebSocket)

```
→ {"type":"auth","access_token":"<token>"}
→ {"id":1,"type":"subscribe_trigger",
   "trigger":{"platform":"state",
     "entity_id":["lock.front_door_nuki","climate.hvac","binary_sensor.front_door_contact"]}}
← {"id":1,"type":"event","event":{"variables":{"trigger":{"to_state":{...}}}}}
```

## Security checklist (this panel controls locks & cameras — treat as high-value)

- **VPN-only** transport; TLS cert pinning to HA.
- **Long-lived token in the iOS Keychain**, never in the bundle/source; use a
  least-privilege token; rotate on device loss.
- **Biometric (Face ID/Touch ID) gate** on every lock/unlock and arm/disarm
  action.
- The app is **convenience, not control**: locks (physical key + Nuki BLE) and
  the HVAC thermostat keep working if the phone, app, or hub is down.
- App-initiated changes should land in the audit trail (`admin_changes` /
  `device_events`) just like any other actor.

## Non-goals (refuse these)

- No device-protocol logic in the app (no Z-Wave/Zigbee/RTSP/CN105).
- No unlock/arm **decision** in the app — it requests; HA + the device decide.
- No public/cloud control path; no hard-coded entity assumptions that block a
  device swap.
