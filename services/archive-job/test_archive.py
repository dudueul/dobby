"""Pure-planner tests. One assertion per fact; English-sentence names.

Run:  python -m pytest services/archive-job/test_archive.py
The planner is pure (no I/O), so each case sets up its own fixture inline.
"""
from datetime import datetime, timezone

# Import the module (not the names) so pytest's sentence-style collection pattern
# does not mistake the imported `eviction_plan` for a test function.
import archive

NOW = datetime(2026, 6, 1, tzinfo=timezone.utc)
RETAIN = {"full_video": 365, "event_video": 730, "incident": 36500, "audit": 1095}


def a(key, klass, age_days, state="local"):
    return archive.Artifact(key, klass, NOW.date().replace(day=1), f"/m/{key}", age_days, state)


def evictionPlan_keepsFullVideoYoungerThanOneYear():
    plan = archive.eviction_plan(NOW, [a("c/1", "full_video", 300)], 90, RETAIN, 15)
    assert plan == []


def evictionPlan_evictsFullVideoOlderThanOneYear():
    old = a("c/1", "full_video", 400)
    assert archive.eviction_plan(NOW, [old], 90, RETAIN, 15) == [old]


def evictionPlan_keepsEventVideoUntilTwoYears():
    plan = archive.eviction_plan(NOW, [a("c/2", "event_video", 700)], 90, RETAIN, 15)
    assert plan == []


def evictionPlan_neverEvictsIncidentClipsByAge():
    plan = archive.eviction_plan(NOW, [a("c/3", "incident", 5000)], 90, RETAIN, 15)
    assert plan == []


def evictionPlan_evictsOldestFirst():
    older, newer = a("c/old", "full_video", 800), a("c/new", "full_video", 400)
    assert archive.eviction_plan(NOW, [newer, older], 90, RETAIN, 15) == [older, newer]


def evictionPlan_underDiskPressureAlsoEvictsAlreadyArchived():
    archived = a("c/arch", "event_video", 100, state="both")
    plan = archive.eviction_plan(NOW, [archived], disk_free=5, retain=RETAIN, low_water=15)
    assert plan == [archived]


def evictionPlan_underNormalSpaceLeavesArchivedInPlace():
    archived = a("c/arch", "event_video", 100, state="both")
    assert archive.eviction_plan(NOW, [archived], 90, RETAIN, 15) == []
