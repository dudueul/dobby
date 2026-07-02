"""Pure device-event planner tests. One assertion per fact; sentence names.

Run:  python -m pytest services/event-correlator/test_device_events.py
"""
import device_events

# Minute-aligned so the dedupe case stays inside one bucket.
T = 1_780_000_020.0


def planDeviceEvent_buildsAStateChangeRow():
    row = device_events.plan_device_event(
        "dobby/events/climate/hvac", '{"event_type":"state_change","old_state":"heat","new_state":"off"}', T)
    assert row["device_key"] == "hvac"


def planDeviceEvent_capturesANumericSetpoint():
    row = device_events.plan_device_event(
        "dobby/events/climate/hvac", '{"event_type":"setpoint_change","value":72}', T)
    assert row["value_numeric"] == 72


def planDeviceEvent_ignoresForeignTopics():
    assert device_events.plan_device_event("frigate/events", '{"event_type":"x"}', T) is None


def planDeviceEvent_ignoresMalformedJson():
    assert device_events.plan_device_event("dobby/events/light/porch", "not json", T) is None


def planDeviceEvent_ignoresPayloadsWithoutAnEventType():
    assert device_events.plan_device_event("dobby/events/light/porch", '{"new_state":"on"}', T) is None


def planDeviceEvent_dedupesARetransmitWithinTheSameMinute():
    a = device_events.plan_device_event("dobby/events/light/porch", '{"event_type":"state_change"}', T)
    b = device_events.plan_device_event("dobby/events/light/porch", '{"event_type":"state_change"}', T + 30)
    assert a["dedupe_key"] == b["dedupe_key"]
