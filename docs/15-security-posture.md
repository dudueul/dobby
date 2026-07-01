# 15 — Security posture: beyond commercial systems

Standing design goal: dobby targets a **stronger** security posture than
commercial systems (Ring/ADT/SimpliSafe/Vivint/Abode), not parity. Every
slice is reviewed against this table — a change that trades one of the
"exceeds" rows for convenience gets refused (same spirit as the deep-module
rule).

## Where dobby already exceeds commercial

| Property | dobby | Commercial |
|---|---|---|
| Cloud kill-switch | none — fully local; vendor outages/policy changes can't disable the alarm | control + often detection ride the vendor cloud |
| Video custody | never leaves the house except age-encrypted (key on a hardware token, off-box) | vendor cloud; employee-access incidents on record |
| Offsite tamper-resistance | B2 Object-Lock + PutObject-only key: ransomware/compromised hub cannot erase evidence | mutable per vendor policy/subscription |
| Remote access | zero public listeners; end-to-end WireGuard; two independent gates (tailnet key, then session auth) | vendor account = whole-house (credential-stuffing exposure) |
| Detection independence | correlator mirrors intrusion rules outside HA; survives the "brain" being disabled | single panel firmware |
| Auditability | full owned Postgres trail, allow-list BFF seam, open config | opaque |
| Camera supply chain | NDAA-compliant only | varies |
| Recurring cost | ~$1–2/mo (B2) | $10–60/mo |

## Where commercial is still ahead — the honest gaps (= the backlog)

| Gap | Commercial has | dobby plan |
|---|---|---|
| Alert path with WAN down | cellular radio in the panel | local siren (docs/13) covers deterrence **today**; add a USB LTE modem as dual-WAN for pushes — backlog #4 |
| 24/7 monitoring + dispatch | central station | self-monitored by design (tiered critical alerts, multiple household phones). A dispatch API integration would reintroduce a cloud dependency — only as an explicit opt-in slice |
| Battery-backed, UL-listed siren/panel | yes | UPS (NUT) for the hub + a battery-backed Zigbee siren — backlog #4 |
| Duress code | standard | Alarmo lacks native duress; automation keyed to a dedicated disarm code (silent critical alert) — backlog #5, documented limitation until then |

## Hardening backlog (ranked; each lands as its own slice)

1. **Tamper-evident audit chain** — hash-chain `lock_events`/`admin_changes`
   rows (prev-hash column, nightly head anchored into the B2 dump) so a hub
   compromise can't silently rewrite history; plus retention GC.
2. **WebAuthn passkeys + per-user roles** — phishing-resistant step-up bound
   to the frozen ts.net RP ID; guest role that physically cannot call
   `lock.unlock`; actor attribution into `admin_changes`.
3. **Life-safety package** — smoke/CO/leak sensors, unconditional siren +
   critical push regardless of arm state (safety outranks security).
4. **Power + connectivity resilience** — NUT-driven clean shutdown (protects
   the LUKS/Postgres evidence store), USB-LTE dual-WAN for critical pushes.
5. **Duress automation** — dedicated Alarmo user code whose disarm fires a
   silent critical alert to the other adults' phones.
6. **Bus hardening** — per-service Mosquitto credentials + ACLs (today one
   shared user can publish `alarmo/state`), S2-only Z-Wave joins, Zigbee
   install codes where supported.
7. **Secrets hygiene** — move `.env` secrets to sops-age or systemd
   credentials; pin container images by digest; review `privileged:` flags.
8. **Physical** — locked enclosure for the hub, BIOS password + boot-order
   lock, disabled unused USB (LUKS already covers the media disk).

## Review rule

New capability slices must state which row above they touch. Anything that
adds a cloud dependency, a public listener, or an auto-disarm path needs an
explicit exception in this file — silence is a refusal.
