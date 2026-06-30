# 01 — OS choice and host provisioning

## Which OS

**Install Ubuntu Server 24.04 LTS (x86-64).** Reasons specific to this hub:

- **Mature Intel graphics stack.** Frigate's hardware acceleration uses VAAPI
  (QuickSync, video decode/transcode) and OpenVINO (iGPU/NPU object detection).
  Ubuntu LTS ships recent-enough kernels/Mesa/`intel-opencl-icd` and the Intel
  NPU driver, and is the most-trodden path in the Frigate/Home Assistant
  community — the fastest place to get help.
- **Plain Docker host.** Everything here is containers; we want a boring,
  stable, long-support base, not a desktop.
- **LTS = 5 years of security updates.** This box runs unattended for years.

Notes:

- **Panther Lake / very new Intel silicon** (e.g. Core Ultra 356H): use the
  latest 24.04.x point release and consider the HWE kernel
  (`linux-generic-hwe-24.04`) so the brand-new iGPU/NPU drivers are present.
  Verify acceleration before going live (see "Verify hardware acceleration").
- **Proxmox** is a fine alternative *if* you want VM snapshots / to run other
  VMs. It adds operational surface; for a dedicated hub, bare Ubuntu Server is
  simpler and is what these docs assume.
- **Do not use macOS / a Mac mini for this hub.** Docker on macOS runs in a VM
  with no access to VideoToolbox/Neural Engine and unreliable USB passthrough
  for the Zigbee/Z-Wave/HSM sticks — the wrong tool for this job.

## Recommended hardware

Full current-2026 shopping list with quantities/budget: `docs/09-bill-of-materials.md`.

> **Deployed hub (interim): Intel NUC8i7HVK "Hades Canyon"** (owned). Runs the full
> stack for **~3–4 cameras**: QuickSync + OpenVINO detection on the **UHD 630 iGPU**
> (no Coral, no NPU; the AMD Vega M dGPU is unused). Caveats: **dual 1 GbE** (not
> 2.5 GbE), **no SATA bay** (bulk video → external/NAS), **~60–100 W under load**
> (the unused Vega M runs hot/inefficient), **DDR4** (not DDR5), and **EOL/2018**
> (no warranty). Treat it as the **Phase-1 / prove-the-loop** box; the table below
> is the planned 24/7 upgrade (an N305 cuts power ~3–4× and adds 2.5 GbE + an NPU).
> On this box: 16–32 GB DDR4 + an NVMe (+ external/NAS bulk), Ubuntu 24.04, confirm
> `vainfo` shows QuickSync, and pin Frigate to the **Intel** render node.

| Part | Recommendation | Why |
|---|---|---|
| Hub | Intel **N305** mini PC (balanced perf/watt), 32 GB RAM, 1–2 TB NVMe — step up to **Core Ultra (125H/255H)** only for 6+ cams / heavy HKSV | QuickSync + OpenVINO detection, **no Coral**; see perf/watt below |
| Surveillance disk | **WD Purple / Seagate SkyHawk** 4–8 TB (CMR), external USB-SATA or internal | 24/7 write endurance; never record to the OS NVMe |
| UPS | CyberPower CP1500PFCLCD (or similar, USB monitoring) | Rides through outages; clean shutdown |
| Network | VLAN-managed switch + **PoE+** switch sized for cameras | VLAN isolation (see `docs/02`) |
| Zigbee | **HA Connect ZBT-2** (on a short USB-2 extension) | Keep away from USB-3/NVMe RF noise |
| Z-Wave | **HA Connect ZWA-2** (Z-Wave 800/LR), or Aeotec **Z-Stick 10 Pro** (Zigbee+Z-Wave in one) | 800-series, S2 security |
| Archive key | **Nitrokey HSM 2** or **YubiKey 5** (×2 + paper backup) | Hardware-held key for the B2 archive |

### Compute vs electricity efficiency (perf/watt)

The hub runs 24/7 and is **mostly idle with Frigate bursts**, so *idle* watts
dominate the running cost, not peak. Measured 2026 figures:

| Chip | Idle | Frigate load (4–6 cams) | Compute | Note |
|---|---|---|---|---|
| N100 / N150 | **6–8 W** | ~17 W | baseline | most efficient; tight for 6 cams + HKSV |
| **N305 (8-core)** | **~10–13 W** | ~30–34 W (peak ~50) | ~2× N100 | **best balance for this hub** |
| Core Ultra 5 125H | **12–17 W** | 25–35 W | ~3× N100, Arc iGPU | idles *higher* than N305 (Meteor Lake) |
| Core Ultra 7 255H | ~13–18 W | higher | most; more efficient than 125H | Arrow Lake; headroom, pricier |
| Panther Lake 356H | low–mid | 45 W TDP | highest | built for peak, not idle frugality |

**Balanced pick: Intel N305.** It doubles the N100's compute for only ~+5 W
idle, and its QuickSync + OpenVINO comfortably run 4–6 cameras with Scrypted
HKSV — no Coral. Note the **Core Ultra 125H idles *higher* than the N305**
despite more peak power, so it is the *worse* perf/watt choice for a mostly-idle
hub; pick a Core Ultra only if you genuinely need the Arc iGPU for 6+ cameras or
multiple simultaneous HKSV transcodes. For 2–4 cameras, the **N150** is even
more efficient. Board design matters — an ODROID-H4-class N305 idles <3 W.

Running cost (NY rates — NYC/ConEd ~$0.33/kWh all-in, ~$0.24 upstate; figures
below at ~$0.30/kWh): N305 ~15 W avg ≈ **$33–39/yr**; N100 ~12 W ≈ ~$30/yr;
Core Ultra ~20–25 W ≈ $44–66/yr; the legacy NUC8i7HNK ~50 W ≈ ~$110–130/yr.

## Step 0 — Flash and first boot

1. Download Ubuntu Server 24.04 LTS, write to USB (Raspberry Pi Imager / balena
   Etcher / `dd`).
2. Install with: OpenSSH server enabled, your SSH public key imported, the OS on
   the NVMe, **no** auto-LVM over the surveillance disk (we encrypt it
   separately in step 3). Static hostname `dobby`.
3. First login over SSH, then:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo timedatectl set-timezone America/New_York
sudo apt install -y git unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # enable security auto-updates
```

## Step 1 — Get the repo

```bash
sudo mkdir -p /opt/dobby && sudo chown "$USER" /opt/dobby
git clone <your-fork-url> /opt/dobby
cd /opt/dobby
cp .env.example .env
# edit .env — replace every CHANGE_ME
```

## Step 2 — Bootstrap the host

```bash
sudo ./provisioning/bootstrap.sh
```

This installs Docker Engine + Compose plugin, Intel media/compute runtimes,
`age`/`rclone`, creates the service user, applies the UFW firewall (deny
inbound except SSH + WireGuard), and sets the sysctls Frigate/Mosquitto want.
Log out/in once so your user picks up the `docker` group.

## Step 3 — Encrypt and mount the surveillance disk

```bash
sudo ./provisioning/setup-storage.sh /dev/sdX   # the surveillance HDD
```

LUKS2-encrypts the disk, adds it to `/etc/crypttab` + `/etc/fstab`, and mounts
it at `/srv/dobby/media`. Auto-unlock at boot uses a keyfile on the (already
full-disk-encrypted, if you chose that) NVMe; otherwise you unlock once per boot.

## Step 4 — Coordinators and stable device paths

Plug in the Zigbee and Z-Wave sticks, then capture their stable paths:

```bash
ls -l /dev/serial/by-id/
```

Put those paths into `ZIGBEE_SERIAL` / `ZWAVE_SERIAL` in `.env` (never use
`/dev/ttyUSB0` — it reorders across reboots).

## Step 5 — Bring up the stack

```bash
docker compose up -d postgres mosquitto       # data plane first
docker compose up -d                          # everything else
docker compose ps
docker compose logs -f homeassistant
```

Open `http://dobby.home.arpa:8123` (Home Assistant) on a trusted-VLAN device and
complete onboarding. Then Zigbee2MQTT (`:8080`), Z-Wave JS UI (`:8091`), Frigate
(`:5000`), Grafana (`:3000`).

## Verify hardware acceleration

```bash
# VAAPI / QuickSync present?
sudo apt install -y vainfo
vainfo | grep -i -E 'VAEntrypointVLD|H264|HEVC'

# Intel NPU device node present (Core Ultra)?
ls -l /dev/accel/ 2>/dev/null

# In Frigate UI → System metrics, confirm the GPU shows decode load and the
# detector inference time is on the iGPU/NPU (OpenVINO), not CPU.
```

If `vainfo` is empty, install `intel-media-va-driver-non-free` and reboot; for
the NPU on brand-new silicon, switch to the HWE kernel.

## Remote access (VPN-only)

Do **not** port-forward anything. Install WireGuard (or Tailscale) on the host
and reach dashboards through the tunnel:

```bash
sudo apt install -y wireguard
# generate keys, /etc/wireguard/wg0.conf, then:
sudo systemctl enable --now wg-quick@wg0
```

UFW already blocks inbound except `22/tcp` and `51820/udp`. See `docs/02`.
