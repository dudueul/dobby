"""Pure intrusion-verdict tests. One assertion per fact; English-sentence names.

Run:  python -m pytest services/event-correlator/test_intrusion.py
"""
from datetime import datetime, timedelta, timezone

import intrusion

T = datetime(2026, 7, 1, 3, 0, tzinfo=timezone.utc)


def intrusionVerdict_flagsPersonWhileArmedAway_withNoUnlock():
    assert intrusion.intrusion_verdict("armed_away", T, None) == "intrusion_while_armed"


def intrusionVerdict_staysQuiet_whenDisarmed():
    assert intrusion.intrusion_verdict("disarmed", T, None) is None


def intrusionVerdict_staysQuiet_whenUnlockPrecededPersonWithinGrace():
    assert intrusion.intrusion_verdict("armed_away", T, T - timedelta(seconds=60)) is None


def intrusionVerdict_staysQuiet_whenArrivalUnlockFollowsWithinEntryWindow():
    assert intrusion.intrusion_verdict("armed_night", T, T + timedelta(seconds=45)) is None


def intrusionVerdict_flagsPerson_whenTheLastUnlockIsStale():
    assert intrusion.intrusion_verdict("armed_night", T, T - timedelta(hours=2)) == "intrusion_while_armed"


def intrusionVerdict_staysQuiet_whenAlarmStateIsUnknown():
    assert intrusion.intrusion_verdict(None, T, None) is None
