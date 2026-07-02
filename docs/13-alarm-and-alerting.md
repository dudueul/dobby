# 13 — Alarm core & alerting

The gap this closes: dobby *recorded* a break-in (correlator, clips, audit rows)
but did not *respond* to one. Alarmo supplies the armed-state machine; this repo
wires it to the house (`packages/alarm.yaml`), to the family's phones
(`packages/notify.yaml` → BFF Web Push), and to the forensic mirror
(event-correlator).

## The state machine (Alarmo)

Install **Alarmo** via HACS → it creates `alarm_control_panel.dobby` (name the
area "dobby"). Configure **in the Alarmo UI**:

| Mode | Sensors | Delays |
|---|---|---|
| `armed_away` | perimeter contacts + interior motion | exit 60 s, entry 45 s (front door only) |
| `armed_night` | perimeter contacts only (instant), interior motion **off** | no delays |
| `armed_home` | perimeter contacts (instant) | no delays |

- **Codes:** one per person (attribution + revocation), disarm-only codes for
  guests. Alarmo has **no native duress code** (open feature request), so
  dobby approximates one: create a user literally named **`Duress`** and hand
  its code out as "the code you enter if someone forces you to disarm" — the
  house disarms normally, nothing visible changes, and the other adults get a
  silent critical alert (`alarm_duress_silent_alert` in `alarm.yaml`). Know
  the limitation: it alerts humans; it does not dispatch anyone.
- **MQTT:** enable Alarmo's MQTT option (state topic `alarmo/state`). The
  event-correlator subscribes to it so intrusion detection also runs *outside*
  HA (same independence rationale as the rest of the correlator).
- **Policy — no auto-disarm.** Arming may be automated (presence/schedule, see
  `packages/presence.yaml`); disarming always requires a deliberate act: a
  code, or the panel's step-up-gated house-mode change. A geofence must never
  open the house.

## Wired zones — the Konnected retrofit of the old VISTA plant

The house came with a wired Honeywell/Ademco VISTA alarm (6150 keypad; zone
card: **01 front door · 02 side door · 03 motion**) — dead backup battery,
no monitoring, unknown codes. The *wires* are the asset: battery-free,
jam-proof, instant sensors plus a bell circuit. Plan (docs/09 §7c):

1. Replace the VISTA board with a **Konnected Alarm Panel Pro** in the same
   can, landing the existing zone loops and the bell —
   `configs/esphome/konnected-alarm.example.yaml` (verify pins per the
   board's printed map; prefer its Ethernet over Wi-Fi).
2. Entities arrive as `binary_sensor.front_door_contact`,
   `binary_sensor.side_door_contact`, `binary_sensor.foyer_motion`,
   `switch.dobby_siren_out` — names the rest of the repo already targets.
   Assign the contacts + PIR in Alarmo (perimeter instant at night, motion
   away-only).
3. **Hub-down fallback:** `alarm.yaml` mirrors Alarmo's armed state into the
   board's `switch.alarm_fallback_armed`; if the ESPHome API is disconnected
   while armed, the board sirens locally on a perimeter opening (3-min cap,
   no entry delay — a hub crash must not silence the alarm). Motion never
   triggers fallback (pet/draft false-siren risk).
4. The freed keypad wire pair (12 V from the can) powers the entry wall
   tablet through a 12V→5V buck — the tablet replaces the keypad UX with the
   panel PWA in kiosk mode.
5. The old 6150/VISTA parts retire; keep the can locked (docs/15 §physical).

## The bell (local, works with WAN down)

Both push channels die with the internet; the siren does not. The retrofit
reuses the **wired VISTA bell** via `switch.dobby_siren_out`; a Zigbee siren
(e.g. Heiman HS2WD-E, named `siren.dobby_siren`) can complement it in
another part of the house. `alarm.yaml` drives whichever exists (both are
entity-guarded, so nothing breaks before hardware lands). Triggered = bells
(3-min cap) + porch/driveway lights + `tier: critical` push; disarm silences
everything.

## Alert tiers (the cry-wolf defense)

`notify.dobby_push` carries `data: {tier: ...}` end-to-end (BFF maps it to Web
Push urgency; the service worker renders critical as sticky, info as silent):

- **critical** — alarm triggered, alarm/HVAC controller dark, health-check
  failures. Later: smoke/CO/leak.
- **normal** (default) — unlock events, door-left-open, anomalies.
- **info** — routine state worth a glance, never a buzz.

iOS: Web Push respects Focus/DND. For DND-piercing delivery, additionally
install the HA **Companion app** and add its notify service next to
`notify.dobby_push` for critical automations (`push: sound: critical: 1`).

## Test drill (monthly, with the docs/08 checklist)

Arm `armed_night`, open a perimeter contact → expect: instant `triggered`,
siren (if installed), critical push on every subscribed phone, an
`admin_changes` intrusion row from the correlator, and the clip re-tagged
`incident`. Disarm with a code → siren stops, house_mode returns to `home`.
