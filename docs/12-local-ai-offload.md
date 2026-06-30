# 12 — Hub spec + local-AI offload (two-box design)

Two planes, two boxes. The **always-on hub** runs the security/management stack
on low-power Intel; an **optional local-AI box** does LLM/vision work and is
called over the LAN as an inference port. The hub never depends on the AI box —
losing it only loses GenAI niceties, not locks/cameras/automations (fail-safe,
same stance as the rest of the system).

## The main hub box — recommended 2026 spec

Frigate needs **Intel** (QuickSync decode + OpenVINO detection); AMD detection
via ROCm is markedly worse, so the hub stays Intel. Balanced for perf/watt
(see `docs/01` → *Compute vs electricity efficiency*) since it runs 24/7 mostly
idle.

| Part | Recommended (2026) | Notes |
|---|---|---|
| **CPU** | **Intel N305** (8-core Alder-Lake-N) or its successor **Core 3 N355** (Twin Lake) — balanced; step up to **Core Ultra 5 125H / 225H** for 6+ cameras or heavy services | QuickSync + OpenVINO, **no Coral**; ~10–15 W idle |
| **RAM** | **32 GB DDR5** (16 GB floor) | Frigate + Postgres + HA + control-panel headroom |
| **OS/DB disk** | **1 TB NVMe** (M.2 2280) | OS + Postgres + Docker; tmpfs for Frigate cache |
| **Surveillance disk** | **WD Purple / Seagate SkyHawk 4–8 TB** (CMR), or 8 TB TLC NVMe — **LUKS-encrypted** | 24/7 write endurance; never the OS drive |
| **NIC** | **2.5 GbE Intel i226** (dual if a NAS board) | clean `igc` Linux driver; camera ingest |
| **I/O** | ≥3–4 USB-A incl. a **USB-2** for the Zigbee/Z-Wave radios; 2× M.2 | USB-2 avoids RF noise to the radios |
| **Power** | ~10–30 W typical, on a **UPS** (CyberPower CP1500PFCLCD) | clean shutdown via NUT (planned) |
| **Form** | **fanless N305 mini PC** for simplicity, **or** a CWWK/Topton N305 NAS board if you want internal SATA bays | |
| **OS** | **Ubuntu Server 24.04 LTS** (HWE kernel on newest silicon) | per `docs/01` |

This is ~$300–500 for the box; it carries the whole stack with room to spare and
costs ≈$33–39/yr to run.

## The local-AI offload box (optional, add later)

For local LLM, **unified-memory capacity beats a small dGPU's VRAM** — a 128 GB
unified box runs far larger models than a 16 GB gaming GPU (which is why a
ROG-NUC-class RTX box is the wrong AI buy: too little memory, too much power).

| Option | ~$ (128 GB) | Strengths | Trade-off |
|---|---|---|---|
| **Framework Desktop — Ryzen AI Max+ 395 "Strix Halo"** ⭐ | ~$2,350 | best value; 128 GB unified runs 70B-class; general-purpose Linux/Win | slower prompt processing (~340 tok/s) |
| **Mac Studio M4 Max** | ~$1,999 | highest bandwidth (546 GB/s) → fastest big-model tokens; low power/quiet | macOS (pure AI box, not the hub) |
| **NVIDIA DGX Spark** | ~$4,699 | fastest prompt processing; CUDA | priciest; locked-down DGX OS |

**Pick:** Framework Desktop (Strix Halo, 128 GB) for the best capacity-per-dollar;
Mac Studio M4 Max if you prioritize efficiency; DGX Spark only if you need CUDA.

## How they connect (inference port)

- Run **Ollama** (or vLLM) on the AI box; the hub calls its HTTP API as a narrow
  **port** — the same "effects at the edges" rule as every other device.
- Offload to it: **Frigate 0.17 GenAI** event descriptions, **semantic search**
  (CLIP), and **HA Assist** local voice. Detection/transcode stay on the Intel
  hub.
- The AI box **sleeps when idle** (wake-on-LAN); only the ~12 W hub is always-on.
- If the AI box is off/unreachable, the hub degrades gracefully — no GenAI text,
  but all security/automation is unaffected.
- **Do not move Frigate to the AMD/Mac box** — keep the NVR on Intel.
