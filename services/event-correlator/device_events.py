"""Pure planner for dobby/events/# MQTT messages -> device_events rows.

HA republishes auditable transitions (packages/audit_mqtt.yaml); this module
decides, with no I/O, whether a message becomes an audit row and builds its
dedupe key (a minute bucket absorbs flaps/retransmits). Mirrors intrusion.py:
plain data in, row dict or None out.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

PREFIX = "dobby/events/"


def plan_device_event(topic: str, payload: str, now_epoch: float) -> dict[str, Any] | None:
    """Return a device_events row (sans event_time, added at the edge) or None."""
    if not topic.startswith(PREFIX):
        return None
    parts = topic[len(PREFIX):].split("/")
    if len(parts) != 2 or not all(parts):
        return None
    try:
        body = json.loads(payload)
    except ValueError:
        return None
    event_type = body.get("event_type")
    if not isinstance(event_type, str) or not event_type:
        return None
    value = body.get("value")
    bucket = int(now_epoch // 60)
    return {
        "source": "ha_mqtt",
        "area_key": None,
        "device_key": parts[1],
        "event_type": event_type,
        "old_state": None if body.get("old_state") is None else str(body["old_state"]),
        "new_state": None if body.get("new_state") is None else str(body["new_state"]),
        "value_numeric": value if isinstance(value, (int, float)) else None,
        "raw": {"topic": topic, **body},
        "dedupe_key": hashlib.sha256(f"{topic}|{payload}|{bucket}".encode()).hexdigest(),
    }
