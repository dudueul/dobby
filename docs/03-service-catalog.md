# 03 — Service catalog

Everything runs as a container from `docker-compose.yml`. Ports are LAN-only.

| Service | Image | Port | Role |
|---|---|---|---|
| **postgres** | `postgres:16` | 5432 | Audit system-of-record (lock/camera/device events + archive catalog) |
| **mosquitto** | `eclipse-mosquitto:2` | 1883 | Local MQTT event bus |
| **homeassistant** | `ghcr.io/home-assistant/home-assistant:stable` | 8123 | Automation brain, dashboards, device integrations |
| **zigbee2mqtt** | `koenkk/zigbee2mqtt` | 8080 | Zigbee coordinator → MQTT (sensors, lights, contacts) |
| **zwave-js-ui** | `zwavejs/zwave-js-ui` | 8091 | Z-Wave coordinator → MQTT (outdoor motion, locks, relays) |
| **esphome** | `ghcr.io/esphome/esphome` | 6052 | Build/flash ESP32 presence/relay/sensor nodes |
| **frigate** | `ghcr.io/blakeblackshear/frigate:stable` | 5000 | Local AI NVR; event clips; OpenVINO/NPU detection |
| **go2rtc** | (bundled in Frigate) | 8554 | Low-latency restream / WebRTC |
| **scrypted** | `ghcr.io/koush/scrypted` | 10443 | Bridge cameras to Apple HomeKit Secure Video |
| **music-assistant** | `ghcr.io/music-assistant/server` | 8095 | Multi-room media library + player control |
| **snapserver** | `ghcr.io/sweisgerber-dev/snapcast` | 1780 | Synchronized whole-house audio fan-out |
| **nuki-ingestor** | local build | – | Poll Nuki Web API + subscribe MQTT → normalize → Postgres |
| **event-correlator** | local build | – | Correlate unlock ↔ person/clip; raise anomalies |
| **archive-job** | local build | – | Monthly encrypted age-out to Backblaze B2 (`docs/07`) |
| **grafana** | `grafana/grafana` | 3000 | Dashboards: doors, cameras, batteries, storage, incidents |

## Data flow (steady state)

```
cameras ──RTSP──▶ Frigate ──events/clips──▶ Postgres + local disk
                    │                          ▲
                    └── snapshots ─────────────┘
locks/sensors ─MQTT─▶ Mosquitto ─▶ Home Assistant ─▶ Postgres
                          │                │
                          ├─▶ nuki-ingestor ┘ (normalize)
                          └─▶ event-correlator ─▶ anomalies ─▶ HA notify
presence ─▶ Home Assistant ─▶ Music Assistant ─▶ Snapserver ─▶ room players
aged-out data ─▶ archive-job ─▶ (encrypt) ─▶ Backblaze B2 (cold)
```

## Bring-up order

`postgres` + `mosquitto` first (everything depends on them), then coordinators
(`zigbee2mqtt`, `zwave-js-ui`), then `homeassistant`, then `frigate`/`scrypted`,
then audio (`music-assistant`, `snapserver`), then our services.
