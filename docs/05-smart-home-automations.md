# 05 — Smart-home automations

Automations live in Home Assistant **packages** (`configs/homeassistant/packages/`)
so each concern is one self-contained file: `security.yaml`, `lighting.yaml`,
`presence_audio.yaml`. Reference them from `configuration.yaml` via
`homeassistant: packages: !include_dir_named packages`.

## Three automation domains

### 1. Security & correlation (`security.yaml`)

Mirrors the correlation rules the `event-correlator` enforces, but for *live*
notification:

- **Snapshot on every unlock.** When a `lock.*` goes `unlocked`, fire the
  camera snapshot for that door and attach it to a notification.
- **Unlock with no person seen** → warning notification (possible relay/credential
  misuse). Window: a Frigate `person` event for that door within -10s/+30s.
- **Person at night, no known unlock** → warning (prowler).
- **Door left open** (contact open > N minutes) → reminder.
- **Operational incidents**: camera offline, RTSP stale, storage low, lock
  battery critical, missed log sync → `persistent_notification` + push.

### 2. Lighting (`lighting.yaml`)

- **Motion → light**, gated by **lux** (don't switch on in daylight) and a
  per-area `input_boolean` for manual override.
- **Outdoor dusk-to-dawn** scenes via the sun elevation.
- **Away/asleep modes** dim or disable interior automations.
- All transitions are logged (Shelly power + state) for the audit trail.

### 3. Presence-driven audio (`presence_audio.yaml`)

The "turn the volume on when a human enters" behavior, room by room — full
detail in `docs/06`. Summary of the logic:

```
when presence.<room> turns on (mmWave occupancy):
  if house is not in 'night'/'away'/'guest-quiet' mode
  and media is enabled for <room>:
    ensure the room's Music Assistant player is grouped/playing the active source
    set volume to the room's daytime/evening target (ramped, not jumped)
when presence.<room> turns off for > grace_period:
    fade the room player down and (if no other room wants it) pause
```

Guardrails baked in:

- **Quiet hours**: a `binary_sensor`/schedule blocks auto-audio at night.
- **Per-room enable**: `input_boolean.audio_enable_<room>` so a room can opt out.
- **Volume ramp**: `media_player.volume_set` stepped over a few seconds, never a
  jarming jump; capped by `input_number.audio_max_<room>`.
- **Don't fight the human**: if someone manually changed volume/source in the
  last N minutes, the automation backs off (a `input_datetime` records the last
  manual touch).

## House modes

A single `input_select.house_mode` (`home / away / night / guest`) gates almost
everything (audio, lighting aggressiveness, notification verbosity). Set it from
presence, schedule, NFC tag, or a dashboard button.

## Where the rules are enforced twice

Live UX automations live in HA (fast, local). The **forensic** versions
(anomaly flags written to `lock_events`/`device_events`) are computed by
`event-correlator` so they survive even if an HA automation is disabled. This is
deliberate redundancy for the security-critical signals.
