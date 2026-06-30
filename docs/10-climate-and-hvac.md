# 10 — Climate / HVAC

## Assumption (verify on site)

The system was installed ~2011 near **Durham, NC** (Piedmont, IECC climate zone
~4A, mixed-humid). The dominant residential configuration there — then and now —
is a **24 V central split-system air-source heat pump with electric
auxiliary/emergency heat strips** (forced air). This guide is drafted for that
case; the other three possibilities are covered below so you can confirm by
pulling the old Honeywell off the wall.

> **The app → hub → controller pattern you asked about is correct** and is the
> same boundary as the locks: the native app (or the HA Companion app / Apple
> Home) is a **thin client** that sends setpoint/mode to **one `climate.hvac`
> entity** over Home Assistant's local API; HA owns the device protocol and
> hides it. The app never talks to the thermostat directly and never via a
> vendor cloud. You likely don't need a custom app — the HA Companion app
> already gives you a local, fail-safe thermostat client.

## STEP ZERO — confirm the type before buying

Kill power at the air-handler/furnace switch, pull the stat, photograph the
terminals + wires:

| Type | How to tell | Path |
|---|---|---|
| **(a) 24 V heat pump** ⭐ *(most likely here)* | thin wires to **R/Rc, C, Y, G, O/B, W2/Aux, E**; outdoor condenser runs in winter too; air handler has heat strips | Z-Wave **heat-pump** thermostat |
| (a′) 24 V conventional furnace + AC | thin wires R/W/Y/G/C; **no O/B**; a gas furnace heats | same thermostat, conventional mode |
| (b) Line-voltage baseboard | **thick** 120/240 V wires, 2–4 conductors | Sinopé Zigbee line-voltage stat |
| (c) Millivolt | 2 thin wires, **no transformer**, <0.75 V | keep mechanical stat + parallel relay |
| (d) Mini-split | IR remote / proprietary puck | ESP32 + ESPHome CN105 |

The **O/B** terminal is the tell for a heat pump (reversing valve). If you see
**O/B** and **AUX/E**, you're on path (a).

## Recommended path (heat pump) — replace with a Z-Wave thermostat

**Honeywell T6 Pro Z-Wave (TH6320ZW, `-2007` SKU for 700-series/S2).** Include it
in the hub's **Z-Wave JS UI** → it appears as a native `climate.hvac` entity. No
cloud, no account. ~$80–120.

Wiring + settings (do these **on the thermostat**, not in HA):

- Wire **R/Rc, C, Y1, G, O/B, W2 (Aux), E** to match the air handler.
- **O/B convention:** set **O = energize-on-cool** (the common US/Honeywell
  default). Wrong setting = it heats when you call cool.
- **Backup heat → AUX/E, never W** (W runs the heat strips continuously).
- **Keep the built-in compressor minimum-off timer enabled** (anti-short-cycle).
- **C-wire:** a 2011 system usually has one run to the stat; if not, run a new C,
  use an add-a-wire / furnace-board C-wire adapter, or run the T6 on 3 AA
  batteries (battery mode sleeps → laggy state, no Z-Wave mesh repeat; C-wire
  strongly preferred).

**Dual-fuel caveat:** if it turns out to be a heat pump **+ gas furnace**
(hybrid), outdoor-temperature changeover needs a **wired outdoor sensor
(C7089U)** on the T6's S terminals — the app-based lockout is cloud-only and
violates local-first. Add the sensor or you lose fail-safe changeover.

**Avoid as the control path:** Nest, ecobee cloud mode, Honeywell Home/Resideo
WiFi (T6 WiFi, T9) — they route control through a vendor cloud.

## Fail-safe rule (mirror the locks)

The control loop runs **on the thermostat**, not in HA. The T6 keeps its
setpoint, schedule, O/B, AUX/E, and compressor protection in-device and
**regulates standalone if the hub, the Z-Wave network, or the app is down**. HA
only writes setpoints and reads state.

⚠️ **Anti-pattern:** a bare relay + HA Generic Thermostat is **not** fail-safe —
on a hub crash the relay freezes stuck ON (overheat) or OFF (frozen coil/pipes).
Use a real thermostat (path a/a′/b), or for the millivolt/mini-split branches keep
the mechanical stat / IR remote as the standalone fallback.

## How it lands in the dobby stack

- **One entity:** `climate.hvac` (Z-Wave JS auto-creates it). The app and all
  automations target only this — the deep-module boundary.
- **Automations:** `configs/homeassistant/packages/climate.yaml` — `house_mode`
  away/home setback, a **freeze-protection floor** safety net, a manual-touch
  backoff (don't fight the human), and an operational-incident trigger
  (unavailable / battery / stuck `hvac_action`), structured like
  `presence_audio.yaml` + `security.yaml`.
- **Audit:** setpoint/mode/`hvac_action` changes log to the existing
  `device_events` table (`device_key='hvac'`) — no schema change.
- **Remote:** VPN-only (WireGuard/Tailscale); Companion app or a custom app both
  reach `climate.hvac` over the LAN/tunnel.

## Multi-zone note

If the home has zone dampers (a zone panel) or per-room mini-split heads, you'll
have **multiple `climate.*` entities**, not one. Write any custom app to read
capabilities (`hvac_modes`, `target_temp_high/low`) dynamically rather than
hardcoding a single heat-only setpoint.
