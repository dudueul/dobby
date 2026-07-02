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

## The bell (local, works with WAN down)

Both push channels die with the internet; the siren does not. Any Zigbee siren
zigbee2mqtt supports works (e.g. Heiman HS2WD-E) — name it `siren.dobby_siren`
and `alarm.yaml` picks it up automatically (the automations guard on the
entity existing, so nothing breaks before the hardware lands). Triggered =
siren (3-min cap) + porch/driveway lights + `tier: critical` push; disarm
silences it.

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
