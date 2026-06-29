# 02 — Network and VLANs

The hub is never exposed to the internet. Segment the LAN so a compromised
camera or guest device cannot reach the locks, the database, or the admin UIs.

## VLANs

| VLAN | Name | Devices | Rule |
|---|---|---|---|
| 10 | Trusted | phones, laptops, admin | may reach hub dashboards/admin UIs |
| 20 | Smart-home | Home Assistant, Apple TV/HomePod, Shelly, Lutron/Zigbee/Z-Wave bridges, Nuki Bridge, audio players | reach HA/MQTT as needed |
| 30 | Cameras | PoE cameras only | RTSP/ONVIF **to the hub only**, no internet |
| 40 | Guest | guest Wi-Fi | no access to hub, cameras, locks, admin |

## Firewall rules (on the router/switch)

- Cameras (VLAN30): allow → hub RTSP/ONVIF/go2rtc ports only; **deny internet**.
- Smart-home (VLAN20): allow → HA (`8123`) and MQTT (`1883`) as needed.
- Trusted (VLAN10): allow → hub dashboards.
- **Inbound internet → hub: blocked.** No port-forwards, ever.
- Remote admin: WireGuard/Tailscale only.

## Host firewall (UFW, applied by bootstrap.sh)

`bootstrap.sh` sets default-deny inbound and allows only:

- `22/tcp` — SSH (lock to VLAN10 / VPN at the router too)
- `51820/udp` — WireGuard

All service ports (`8123`, `5000`, `3000`, `1883`, `8080`, `8091`, …) are
reachable only from the LAN segments your router permits — they are **not**
opened to the internet. If you prefer, restrict them in UFW to the VLAN10 subnet:

```bash
sudo ufw allow from 10.0.10.0/24 to any port 8123 proto tcp
```

## DNS / naming

Reserve static DHCP leases and publish local names:

```
dobby.home.arpa        hub
ha.home.arpa           Home Assistant
frigate.home.arpa      Frigate
grafana.home.arpa      Grafana
z2m.home.arpa          Zigbee2MQTT
camera-front.home.arpa …
```

## The single allowed egress

The only outbound internet connections the hub makes are NUC-originated:

1. encrypted archive PUTs to Backblaze B2 (`docs/07`),
2. push notifications (HA → ntfy/Pushover/Apple),
3. the optional Nuki Web API poll,
4. OS/container image updates.

Everything else stays on the LAN.
