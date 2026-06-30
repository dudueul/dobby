# 09 — Bill of materials (current 2026 models)

A concrete shopping list for the dobby hub, sized for a typical **2-door /
~4-camera / ~3-audio-room** house. Quantities scale per door / camera / room.
Prices are approximate USD and drift — treat as ballpark.

## 1. Hub, storage, power

| Item | Current pick | Qty | ~$ | Notes |
|---|---|---|---|---|
| Hub mini PC | **ASUS NUC 14 Pro Tall** (Ultra 5 125H) — keeps a 2.5″ SATA bay | 1 | 380–450 | Arc QuickSync + NPU; no Coral. Cheaper $/port: a CWWK/Topton N305 6-bay NAS board (~$200) |
| RAM | 32 GB DDR5 SO-DIMM | 1 | 70–90 | |
| OS SSD | 1 TB NVMe (M.2) | 1 | 70–90 | OS + Postgres + Docker |
| Surveillance storage | **WD Purple / Seagate SkyHawk** HDD (or 8 TB TLC NVMe) | 4–8 TB | 150–180 | LUKS-encrypted; HDD = cheap $/TB |
| UPS | CyberPower **CP1500PFCLCD** | 1 | 180–220 | USB monitoring |

## 2. Network

| Item | Current pick | Qty | ~$ |
|---|---|---|---|
| VLAN-managed switch | UniFi / TP-Link Omada / MikroTik | 1 | 60–150 |
| PoE+ switch (cameras) | TP-Link **TL-SG1008MP** (8-port) | 1 | 70–90 |
| Router w/ VLAN + firewall | UniFi / OPNsense box | 1 | — (existing) |

## 3. Radios (into the hub, on USB-2 ports)

| Item | Current pick | Qty | ~$ |
|---|---|---|---|
| Zigbee coordinator | **HA Connect ZBT-2** | 1 | 35–40 |
| Z-Wave coordinator | **HA Connect ZWA-2** (Z-Wave 800/LR) | 1 | 69 |
| (alt. combined) | **Aeotec Z-Stick 10 Pro** (Zigbee+Z-Wave) | 1 | 70 |
| USB-2 extension cable | short, shielded | 1–2 | 8 |

## 4. Doors / locks

| Item | Current pick | Qty | ~$ |
|---|---|---|---|
| Smart lock | **Nuki Smart Lock Pro (5th Gen)** (Wi-Fi built-in) or **Ultra** | 2 | 199–279 ea |
| Keypad | **Nuki Keypad 2 NFC** (Apple Home Key / Aliro) | 2 | 179 ea |
| Physical cylinder + keys | match the door | 2 | — |
| Apple home hub | **Apple TV 4K** or **HomePod mini** | 1 | 99–149 |

## 5. Cameras (VLAN30, no internet)

| Item | Current pick | Qty | ~$ |
|---|---|---|---|
| Door / perimeter | **Reolink RLC-820A** (4K, on-device AI) | 3–4 | 60–90 ea |
| Wide coverage | **Reolink Duo 3 PoE** (16 MP, 180°) | 0–1 | 180 |
| Night (color) | **Reolink ColorX** | 0–1 | 90 |

Start with the front door, validate clips, then expand.

## 6. Sensors

| Item | Current pick | Qty | ~$ |
|---|---|---|---|
| Door/window contact | **Aqara Door & Window Sensor P2** (Matter/Thread) | 1 per door | 30 |
| Outdoor motion | **Zooz ZSE70 800LR** (Z-Wave) or Hue Outdoor | 1 per zone | 30–45 |
| Room presence (audio) | **Apollo R PRO-1** (PoE/ESPHome) or **Aqara FP300** | 1 per audio room | 40–60 |

mmWave (not PIR) for presence — it keeps reporting a still person, so music
doesn't cut out when you sit down.

## 7. Lighting control

| Item | Current pick | Qty | ~$ |
|---|---|---|---|
| In-wall relay + metering | **Shelly 1PM Gen4** (Wi-Fi+Zigbee+Matter) | 1 per fixture | 18–25 |
| (alt.) switches + hub | **Lutron Caséta** + Smart Bridge | as needed | 60 + 60 |

*Use a licensed electrician for mains relays.*

## 8. Whole-house audio (per room)

| Item | Current pick | Qty | ~$ |
|---|---|---|---|
| Room player | **WiiM Pro Plus** (AirPlay 2) or Pi Zero 2 W + amp (`snapclient`) | 1 per room | 25–219 |
| Speakers | passive (with amp) or powered | 1 per room | varies |

Server (Music Assistant + Snapserver) already runs on the hub. Start with
kitchen + living, validate follow-me, then expand.

## 9. Archive security key

| Item | Current pick | Qty | ~$ |
|---|---|---|---|
| Hardware key | **Nitrokey HSM 2** (DKEK clone across devices) or 2× **YubiKey 5** + paper backup | 2 | 50–59 ea |

## Phased build

1. **Phase 1 — prove the loop:** hub + UPS + PoE switch + Zigbee/Z-Wave sticks +
   1 Nuki Pro + 1 Keypad 2 + 1 Reolink + Apple TV. Validate clips, lock events,
   one automation.
2. **Phase 2 — expand security:** second door, remaining cameras, contact +
   outdoor motion sensors, porch/garage lighting (Shelly Gen4).
3. **Phase 3 — comfort:** mmWave room presence + WiiM players; enable
   presence-driven audio.
4. **Phase 4 — durability:** Backblaze B2 archive + hardware key + restore-test.

## Rough budget (2-door / 4-camera / 3-room)

- Hub + storage + power + network: **~$900–1,100**
- Locks + keypads + Apple hub: **~$850–1,050**
- Cameras: **~$280–450**
- Sensors + lighting: **~$250–400**
- Audio (3 rooms): **~$150–700** (Pi vs WiiM)
- Security keys: **~$100–120**

**Total: roughly $2,500–3,800** depending on lock tier and audio choices —
spread across the four phases.
