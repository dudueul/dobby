"""Pure normalizer tests. One assertion per fact; English-sentence names.

Run:  python -m pytest services/nuki-ingestor/test_normalize.py
"""
import normalize

KEYS = {"ABC123": "front_door"}
NOW = "2026-07-01T03:00:00+00:00"


def normalizeNukiMqtt_mapsLockActionOne_toAnUnlockAction():
    e = normalize.normalize_nuki_mqtt("nuki/ABC123/lockActionEvent", "1,172,0,0", KEYS, NOW)
    assert e["action"] == "unlock"


def normalizeNukiMqtt_resolvesDoorKey_fromTheLocksMap():
    e = normalize.normalize_nuki_mqtt("nuki/ABC123/lockActionEvent", "2,1,0,0", KEYS, NOW)
    assert e["door_key"] == "front_door"


def normalizeNukiMqtt_fallsBackToDeviceId_forAnUnknownLock():
    e = normalize.normalize_nuki_mqtt("nuki/ZZZ/lockActionEvent", "1,0,0,0", KEYS, NOW)
    assert e["door_key"] == "nuki_ZZZ"


def normalizeNukiMqtt_infersKeypadPin_fromANonZeroCodeId():
    e = normalize.normalize_nuki_mqtt("nuki/ABC123/lockActionEvent", "1,2,0,42", KEYS, NOW)
    assert e["access_method"] == "keypad_pin"


def normalizeNukiMqtt_recordsStateTransitions_asAuditNotActions():
    e = normalize.normalize_nuki_mqtt("nuki/ABC123/state", "3", KEYS, NOW)
    assert e["action"] == "state_unlocked"


def normalizeNukiMqtt_ignoresTelemetryTopics():
    assert normalize.normalize_nuki_mqtt("nuki/ABC123/batteryCritical", "false", KEYS, NOW) is None


def normalizeNukiMqtt_ignoresAMalformedActionPayload():
    assert normalize.normalize_nuki_mqtt("nuki/ABC123/lockActionEvent", "garbage", KEYS, NOW) is None
