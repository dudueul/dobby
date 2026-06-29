# 06 — Whole-house presence-driven audio

Goal: as a person moves through the house, audio "follows" them — the room they
enter comes up to a comfortable volume, the room they leave fades out — without
ever blasting at 2 a.m. and without fighting a human who grabs the volume knob.

## Building blocks

| Layer | Component | Job |
|---|---|---|
| Presence (per room) | **mmWave occupancy** (Aqara FP2 via Zigbee2MQTT, or ESP32 + LD2410 via ESPHome) | reliable, fast `occupancy` per room |
| Media library / control | **Music Assistant** | one library, exposes each room as a `media_player` |
| Synchronized output | **Snapcast** (snapserver + snapclients) | sample-accurate multi-room sync |
| Players | Snapclient per room (mini amp/Pi/old phone), or Sonos/AirPlay/Chromecast via MA | the actual speakers |
| Orchestration | **Home Assistant** `presence_audio.yaml` | maps presence → player volume/group |

mmWave (not PIR) matters here: PIR misses a still person on the couch and would
fade the music while you're sitting there. mmWave reports continuous occupancy.

## Topology

```
Music Assistant ──▶ Snapserver ──┬─▶ snapclient: kitchen  ▶ speaker
   (sources:                     ├─▶ snapclient: living   ▶ speaker
    radio, library,              ├─▶ snapclient: bedroom  ▶ speaker
    Spotify, TTS)                └─▶ snapclient: bath …
Home Assistant ── volume/group/source control ▶ Music Assistant players
presence.<room> (mmWave) ── triggers ─────────▶ Home Assistant
```

Each room is both a Snapcast client (for synchronized whole-house playback) and
a Music Assistant player (for independent per-room control). HA chooses which
mode per automation.

## The follow-me logic (implemented in `presence_audio.yaml`)

For each room there is:

- `binary_sensor.presence_<room>` — mmWave occupancy
- `media_player.<room>` — the Music Assistant/Snapcast player
- `input_boolean.audio_enable_<room>` — opt-out
- `input_number.audio_target_<room>` / `audio_max_<room>` — volume targets
- `input_datetime.audio_manual_<room>` — last manual override timestamp

Trigger graph:

1. **Enter** (`presence_<room>` → on): if `house_mode` ∈ {home} and quiet-hours
   off and `audio_enable_<room>` on and no manual touch in last 15 min →
   `script.audio_follow_room` grabs the active source and **ramps** the room to
   its target volume.
2. **Leave** (`presence_<room>` → off for > 90 s grace): `script.audio_release_room`
   fades the room down and pauses it **unless** it's part of a whole-house group
   someone else is using.
3. **Quiet hours / night mode**: hard block; only explicit user action plays.
4. **Whole-house party button**: a dashboard toggle groups every enabled room to
   one source at a shared volume, suspending follow-me until turned off.

The ramp uses stepped `media_player.volume_set` over ~4 s so volume eases in.
`audio_max_<room>` caps it (e.g. bedrooms lower than the kitchen).

## Why not just one big group

Synchronized whole-house (Snapcast) is great for "play the same thing
everywhere," but presence-follow needs **independent** per-room volume and
start/stop. Music Assistant gives per-room players; Snapcast gives sync when you
want it. We use both and let HA pick the mode.

## Voice / TTS / announcements

Music Assistant (and HA's `tts`) can **duck** music for announcements — e.g.
"front door unlocked" spoken in the occupied room, then music resumes. The
security automations in `security.yaml` can target the player in the currently
occupied room so alerts reach you wherever you are.

## Hardware-cheap path

Old phones/tablets as AirPlay/Chromecast targets, or ~$15 amp boards driven by a
Pi Zero 2 W running `snapclient`, one per room. Start with two rooms (kitchen +
living), validate follow-me, then expand.
