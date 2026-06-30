# dobby — local-first home security & smart-home hub

A single mini-PC hub that runs the whole house locally: Nuki locks, PoE cameras
(Frigate NVR + HomeKit Secure Video), Zigbee/Z-Wave/Matter sensors, indoor &
outdoor lighting, whole-house presence-driven audio, a PostgreSQL audit trail,
and an encrypted tiered backup to Backblaze B2.

Design stance (non-negotiable):

- **Local-first.** Locks, cameras, sensors and automations keep working with the
  internet down. The only outbound internet traffic is NUC-originated: the
  encrypted cold archive, notifications, and the optional Nuki Web API poll.
  **Zero inbound.** Remote admin is VPN-only (WireGuard/Tailscale).
- **Physical keys remain the final fallback.** The hub is observe/correlate +
  automation; it is never in the door-authorization datapath.
- **Encrypt before it leaves the box.** Video and audit archives are
  client-side encrypted; the cloud holds ciphertext only.

## Layout

```
docs/                 provisioning + operations guides (start at docs/01-…)
provisioning/         host bootstrap scripts (Docker, storage, firewall, health)
docker-compose.yml    the full service stack
configs/              per-service configuration (HA, Frigate, Zigbee2MQTT, …)
services/             our own containers (nuki-ingestor, correlator, archive-job)
sql/                  PostgreSQL schema + archive catalog
```

## Quick start

1. Flash **Ubuntu Server 24.04 LTS** to the mini PC (see `docs/01-os-and-provisioning.md`).
2. `git clone` this repo to `/opt/dobby` on the hub.
3. `cp .env.example .env` and fill in every `CHANGE_ME`.
4. `sudo ./provisioning/bootstrap.sh` (Docker, dirs, firewall, sysctl).
5. `sudo ./provisioning/setup-storage.sh` (LUKS-encrypt + mount the surveillance disk).
6. `docker compose up -d`.
7. Bring up **one** camera and **one** lock first, validate logs and event clips,
   then expand (per `docs/04-device-integration.md`).

## Hardware

See `docs/01-os-and-provisioning.md` for the recommended mini-PC (Intel Core
Ultra / N305 class — QuickSync + NPU, no Coral needed), surveillance disk, UPS,
PoE switch, Zigbee/Z-Wave coordinators, and the hardware security key for the
archive. The full current (2026) shopping list with quantities, phasing, and
budget — locks, cameras, sensors, lighting, audio, keys — is in
`docs/09-bill-of-materials.md`.
