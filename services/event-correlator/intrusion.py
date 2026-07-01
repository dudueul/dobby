"""Pure intrusion verdict — the off-HA mirror of the alarm's triggered rule.

The correlator consumes Frigate person events plus the Alarmo MQTT state topic;
this module decides, with no I/O, whether a person sighting during an armed
mode is an intrusion. Mirrors archive.py::eviction_plan — plain data in, tagged
verdict out — so detection survives HA being down or misconfigured.
"""
from __future__ import annotations

from datetime import datetime, timedelta

ARMED_MODES = frozenset({"armed_away", "armed_night", "armed_vacation"})


def intrusion_verdict(alarm_state: str | None, person_time: datetime,
                      last_unlock_time: datetime | None,
                      grace_before_s: int = 300,
                      entry_window_s: int = 90) -> str | None:
    """Return 'intrusion_while_armed' or None.

    A person seen while the house is armed is an intrusion unless an authorized
    unlock happened within the grace window before the sighting (family still
    leaving) or within the entry window after it (family arriving, about to
    disarm). Everything else while armed is flagged.
    """
    if alarm_state not in ARMED_MODES:
        return None
    if last_unlock_time is not None:
        delta = person_time - last_unlock_time
        if -timedelta(seconds=entry_window_s) <= delta <= timedelta(seconds=grace_before_s):
            return None
    return "intrusion_while_armed"
