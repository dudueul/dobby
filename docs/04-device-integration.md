# 04 — Device integration

How each class of device reaches the hub. Bring up **one of each** first,
validate, then scale.

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
