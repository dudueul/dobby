# 04 — Device integration

How each class of device reaches the hub. Bring up **one of each** first,
validate, then scale.

## Recommended current models (2026)

The full shopping list with quantities, phasing, and budget is in
`docs/09-bill-of-materials.md`. These are the current picks per category:

| Category | Current pick (2026) | Path |
|---|---|---|
| Lock | **Nuki Smart Lock Pro (5th Gen)** or **Ultra** + **Keypad 2 NFC** | Apple Home Key (Aliro) + MQTT/Web API |
| Apple hub | **Apple TV 4K** or **HomePod mini** | Home Key + HomeKit Secure Video + Thread border router |
| Cameras (NDAA-compliant) | **Hanwha Wisenet** (A/Q-series) · **Vivotek** (value) · **Axis** (premium, Lightfinder night) · **UniFi Protect G5** (ecosystem) | PoE RTSP/ONVIF dual-substream → Frigate |
| Zigbee | **Home Assistant Connect ZBT-2** | Zigbee2MQTT (also a Thread border router via OTBR) |
| Z-Wave | **Home Assistant Connect ZWA-2** (Z-Wave 800/LR); or **Aeotec Z-Stick 10 Pro** (Zigbee+Z-Wave in one) | Z-Wave JS UI |
| Room presence | **Apollo R PRO-1** (PoE, ESPHome) wired; **Aqara FP300** battery; **Aqara FP2** for zones | ESPHome / Zigbee-Thread → HA |
| Contact | **Aqara Door & Window Sensor P2** (Matter/Thread) | Thread border router → HA |
| Lighting | **Shelly 1PM Gen4** (Wi-Fi+Zigbee+Matter+metering); Lutron Caséta for reliability | local MQTT → Mosquitto |
| Audio player | **WiiM Pro Plus** (keeps AirPlay 2) / **WiiM Amp Pro** | Music Assistant / Snapcast |
| Archive key | **Nitrokey HSM 2** (DKEK clone) or 2× **YubiKey 5** + paper | age / PKCS#11 envelope |

**Cameras — NDAA note:** limited to NDAA §889-compliant brands. **Excluded:**
Dahua and its OEMs (Amcrest, EmpireTech, Loryta) and Hikvision and its OEMs
(Annke, LaView). **Reolink / Lorex** are verify-per-SKU (Chinese-made / formerly
Dahua-owned) and are not used here. The compliant picks above are PoE + ONVIF/RTSP
with dual substreams (confirm H.264 + substream per model). Budget ~$150–350/camera
(≈30–80% more than the banned equivalents); for color-at-night use Axis Lightfinder
or Hanwha low-light rather than Hikvision ColorVu.

Notes:

- **Thread border router**: the Aqara P2 contact sensor and Thread presence
  sensors need one. The Apple TV/HomePod provides it for the Apple side; run
  OpenThread Border Router (or use the ZBT-2) for the Home Assistant side.
- **Shelly Gen4 local MQTT**: in the Shelly web UI enable *Networks → MQTT* →
  point at `mosquitto:1883` with the `MQTT_USER`/`MQTT_PASSWORD` from `.env`,
  enable *RPC over MQTT*, and disable Shelly Cloud to keep it local-only.
- **Apollo R PRO-1** ships ESPHome firmware; adopt it in the ESPHome add-on and
  it publishes `binary_sensor.presence_<room>` used by the audio package. A
  DIY ESP32 + LD2410 equivalent is in `configs/esphome/presence-room.example.yaml`.

## Locks — Nuki

Three event paths, used together for resilience:

1. **Local (authoritative for control):** Nuki Smart Lock + Keypad 2 NFC operate
   over BLE/NFC and a **physical key cylinder**. The hub never sits in the
   unlock datapath — entry works with the hub off.
2. **MQTT:** enable Nuki's native MQTT (via the Nuki Bridge or the lock's MQTT
   support) pointing at `mosquitto:1883`. Home Assistant's Nuki integration and
   `nuki-ingestor` subscribe.
3. **Web API (optional, outbound):** set `NUKI_API_TOKEN` to let `nuki-ingestor`
   poll `api.nuki.io` for the authoritative log. Leave unset to stay fully local.

Apple Home Key issuance/revocation lives in **Apple Home**, not here. The hub
records and correlates the resulting lock events; it does not revoke Home Key.

## Cameras — PoE RTSP/ONVIF

- Put cameras on **VLAN30** (no internet). Give each a static lease.
- Configure two streams per camera: a low-res **substream** for detection and a
  high-res **main** stream for recording (`configs/frigate/config.yml`).
- Frigate does detection on the iGPU/NPU (OpenVINO) — no Coral.
- **Scrypted** bridges chosen cameras into Apple HomeKit Secure Video.

## Sensors & lighting — Zigbee / Z-Wave / Shelly / ESP

| Device | Path | Notes |
|---|---|---|
| Indoor lights, contact & lux sensors, buttons | **Zigbee2MQTT** | cheapest, dense mesh |
| Outdoor motion, door/window, sirens | **Z-Wave JS UI** | better range/penetration, S2 security |
| In-wall relays / power metering (porch, garage) | **Shelly** (local MQTT) | logs power + state; keep cloud off |
| mmWave room presence, custom relays | **ESPHome** (ESP32) | per-room presence for audio (see `docs/05`/`06`) |
| High-end lighting | **Lutron Caséta** (local bridge) | very reliable; state via HA |

All of them surface in Home Assistant and are logged to Postgres via the HA →
MQTT → ingestor path. Prefer **separate** sensors over all-in-one floodlights so
each state change is independently logged and correlatable.

## Naming convention

Areas: `front_door back_door driveway side_gate garage living kitchen …`

```
lock.front_door_nuki
camera.front_door
light.front_porch          binary_sensor.front_porch_motion
binary_sensor.front_door_contact   sensor.front_porch_lux
media_player.kitchen       presence.kitchen (mmWave)
```

Clip/snapshot files: `front_door_YYYYMMDD_HHMMSS_unlock.jpg`,
`front_door_YYYYMMDD_HHMMSS_person.mp4`.

## Validation checklist (per device)

1. Device pairs and appears in its coordinator UI.
2. It shows up in Home Assistant with the expected entity id.
3. A state change publishes to MQTT and lands in `device_events` (check Grafana
   or `psql`).
4. For cameras: an event clip is written to `/srv/dobby/media/frigate` and a row
   appears in `camera_events`.
