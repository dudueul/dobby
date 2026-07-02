# 10 — Climate / HVAC

## Confirmed by on-site survey: 24 V heat pump, TWO zones, all-electric

Photo survey of the mechanicals (July 2026) settled everything:

| Equipment | Model | What it tells us |
|---|---|---|
| Zone panel | **Honeywell TrueZONE HZ221** (Zone 1/Zone 2/**Em Heat** LEDs) | **Two zones, two thermostats, dampers**; the panel owns equipment staging + the reversing valve |
| Air handler | **Lennox CBX27UH-030** — "also listed as section of heat pump", R-410A, factory TXV, ~2.5-ton class | The indoor half of a heat-pump split; **ECB29 electric strip kit** marked on the heater matrix → AUX/E backup heat exists |
| Thermostats | Honeywell **FocusPRO 6000** (per zone) | Plain 24 V non-connected stats — drop-in replaceable |
| Water heater | State **ES650DORS** 50-gal **electric** | **All-electric house → no gas furnace → NOT dual-fuel**; no outdoor changeover sensor needed |

**Still to capture:** conductor count per zone wall run (the HZ221 supplies
R/C at its zone terminals; each T6 wants a spare wire for C), which rooms
each zone serves, and the outdoor unit's model plate.

> **The app → hub → controller pattern you asked about is correct** and is the
> same boundary as the locks: the native app (or the HA Companion app / Apple
> Home) is a **thin client** that sends setpoint/mode to **one `climate.hvac`
> entity** over Home Assistant's local API; HA owns the device protocol and
> hides it. The app never talks to the thermostat directly and never via a
> vendor cloud. You likely don't need a custom app — the HA Companion app
> already gives you a local, fail-safe thermostat client.

## Reference — the other system types (not this house)

| Type | How to tell | Path |
|---|---|---|
| **(a) 24 V heat pump** ⭐ *(CONFIRMED here)* | thin wires to **R/Rc, C, Y, G, O/B, W2/Aux, E**; outdoor condenser runs in winter too; air handler has heat strips | Z-Wave **heat-pump** thermostat |
| (a′) 24 V conventional furnace + AC | thin wires R/W/Y/G/C; **no O/B**; a gas furnace heats | same thermostat, conventional mode |
| (b) Line-voltage baseboard | **thick** 120/240 V wires, 2–4 conductors | Sinopé Zigbee line-voltage stat |
| (c) Millivolt | 2 thin wires, **no transformer**, <0.75 V | keep mechanical stat + parallel relay |
| (d) Mini-split | IR remote / proprietary puck | ESP32 + ESPHome CN105 |

The **O/B** terminal is the tell for a heat pump (reversing valve). If you see
**O/B** and **AUX/E**, you're on path (a).

## The plan of record — TWO Z-Wave thermostats behind the existing zone panel

Buy **two Honeywell T6 Pro Z-Wave (TH6320ZW, `-2007` SKU for 700-series/S2)**
— one per zone, each replacing a FocusPRO on its existing wall run. Include
both in **Z-Wave JS UI** → they appear as `climate.zone_1` and
`climate.zone_2` (rename to match the rooms each zone serves). No cloud, no
account. ~$160–240 total.

**Keep the HZ221.** It is the deep module of this subsystem: it owns the
dampers, equipment staging, the **O/B reversing valve**, and Em-Heat routing.
The thermostats stay per-zone call interfaces wired to the panel's zone
terminals exactly as the old stats were — do NOT wire a stat straight to the
air handler, and do NOT replace the panel with hub logic.

Wiring + settings (per zone, at the thermostat):

- Land the same conductors the FocusPRO used (R/C from the panel's zone
  terminals, plus Y/G/O/B/Aux per the HZ221 zone strip); set the T6 to
  **heat-pump** type so its O/B convention matches the panel's
  (O = energize-on-cool, the Honeywell default).
- **C-wire:** the HZ221 provides C at the panel — confirm each wall run has a
  spare conductor for it. Battery mode works but sleeps (laggy state, no
  Z-Wave mesh repeat); C strongly preferred.
- **Keep compressor minimum-off protection enabled** on both stats.
- Dual-fuel is **not applicable** (all-electric house — survey above), so no
  outdoor changeover sensor is needed.

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

- **Two entities:** `climate.zone_1` and `climate.zone_2` (Z-Wave JS
  auto-creates them; rename per the rooms each zone serves). The panel app
  and all automations target only these — the deep-module boundary. The
  HZ221 guarantees the zones can never call opposing modes.
- **Automations:** `configs/homeassistant/packages/climate.yaml` — `house_mode`
  away/home setback across both zones, a per-zone **freeze-protection floor**
  safety net, a manual-touch backoff (any human touch pauses automation for
  both zones — don't fight the household), and per-zone operational-incident
  triggers, structured like `presence_audio.yaml` + `security.yaml`.
- **Audit:** setpoint/mode changes flow through `packages/audit_mqtt.yaml`
  into `device_events` (`device_key='zone_1'|'zone_2'`) — the Grafana HVAC
  panel reads both.
- **Remote:** the control-panel PWA shows one tile per zone
  (capability-driven, so the swap needed no tile changes); Companion app and
  panel both reach the zones over the tailnet (docs/14).
- **Life-safety tie-in:** smoke/CO shuts down BOTH zones' calls
  (`life_safety.yaml`) so the blower doesn't spread smoke.
