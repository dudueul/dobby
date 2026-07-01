"""Pure normalizer for Nuki's local MQTT topics -> the lock_events normal form.

The Web-API poll is optional/cloud; this module makes the LOCAL path produce
the same shape (action='unlock', access_method, auth attribution) so unlock
correlation and anomaly detection work with the internet down. No I/O — the
clock and the smartlock-id -> door_key map are injected by the caller.

Topics (Nuki MQTT API):
  nuki/<id>/lockActionEvent  CSV "lockAction,trigger,authId,codeId,..."  (canonical action row)
  nuki/<id>/state            numeric lock state                          (audit row, not an action)
  everything else            telemetry -> ignored
"""
from __future__ import annotations

from typing import Any

LOCK_ACTIONS = {1: "unlock", 2: "lock", 3: "unlatch", 4: "lock_n_go",
                5: "lock_n_go_unlatch", 6: "full_lock"}
TRIGGERS = {0: "system", 1: "manual", 2: "button", 3: "automatic",
            6: "auto_lock", 171: "homekit", 172: "mqtt"}
STATES = {0: "uncalibrated", 1: "locked", 2: "unlocking", 3: "unlocked",
          4: "locking", 5: "unlatched", 6: "unlocked_lock_n_go",
          7: "unlatching", 254: "motor_blocked", 255: "undefined"}


def _access_method(trigger: str, code_id: str | None) -> str:
    if code_id:
        return "keypad_pin"
    if trigger == "homekit":
        return "apple_home_key_or_smart_home_tap"
    if trigger in ("manual", "button"):
        return "manual_key_or_thumbturn"
    if trigger in ("system", "mqtt"):
        return "nuki_app"
    return "unknown"


def normalize_nuki_mqtt(topic: str, payload: str, door_keys: dict[str, str],
                        now_iso: str) -> dict[str, Any] | None:
    """Return a lock_events row for a meaningful message, else None."""
    parts = topic.split("/")
    if len(parts) != 3 or parts[0] != "nuki":
        return None
    dev, leaf = parts[1], parts[2]
    base = {
        "source": "nuki_mqtt",
        "nuki_smartlock_id": dev,
        "door_key": door_keys.get(dev, f"nuki_{dev}"),
        "event_time": now_iso,
        "user_name": None,
        "battery_critical": None,
        "raw": {"topic": topic, "payload": payload},
    }
    if leaf == "lockActionEvent":
        f = payload.split(",")
        try:
            action = LOCK_ACTIONS.get(int(f[0]), "unknown")
        except (ValueError, IndexError):
            return None
        trigger = TRIGGERS.get(int(f[1]), "unknown") if len(f) > 1 and f[1].isdigit() else "unknown"
        auth_id = f[2] if len(f) > 2 and f[2] not in ("", "0") else None
        code_id = f[3] if len(f) > 3 and f[3] not in ("", "0") else None
        return {**base, "action": action, "state": "action", "trigger": trigger,
                "auth_id": auth_id, "access_method": _access_method(trigger, code_id)}
    if leaf == "state":
        try:
            state = STATES.get(int(payload.strip()), "unknown")
        except ValueError:
            return None
        # Audit row only: lockActionEvent is the canonical action, so state
        # transitions never double-count as unlocks.
        return {**base, "action": f"state_{state}", "state": state,
                "trigger": "state_topic", "auth_id": None, "access_method": "unknown"}
    return None
