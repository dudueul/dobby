"""Event correlator — the forensic counterpart of the HA security automations.

Consumes Frigate events from MQTT, writes camera_events, and:
  - attaches the nearest person event within [-10s, +30s] of a Nuki unlock,
  - flags `unlock_no_person` (unlock with no person seen near the door),
  - flags `night_person_no_unlock` and re-tags those clips class=incident
    (which the archive job then keeps for the long retention horizon).

These run independently of Home Assistant so the security signal survives an HA
automation being disabled.
"""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import asyncpg
import paho.mqtt.client as mqtt

from device_events import plan_device_event
from intrusion import intrusion_verdict

DATABASE_URL = os.environ["DATABASE_URL"]
MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto")
MQTT_USER = os.environ.get("MQTT_USER", "")
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD", "")
TZ = ZoneInfo(os.environ.get("TZ", "UTC"))
NIGHT_START = int(os.environ.get("NIGHT_START_HOUR", "22"))
NIGHT_END = int(os.environ.get("NIGHT_END_HOUR", "7"))

QUEUE: asyncio.Queue[dict] = asyncio.Queue()
DEVICE_QUEUE: asyncio.Queue[dict] = asyncio.Queue()
# Last alarm state seen on Alarmo's MQTT topic (None until the first publish).
ALARM = {"state": None}


def is_night(ts: datetime) -> bool:
    # TZ is a zoneinfo zone (e.g. America/New_York), so .astimezone() yields the
    # correct local hour across DST (EST/EDT) — the night window does not drift.
    h = ts.astimezone(TZ).hour
    return h >= NIGHT_START or h < NIGHT_END


def to_dt(epoch: float | None) -> datetime:
    return datetime.fromtimestamp(epoch, tz=timezone.utc) if epoch else datetime.now(timezone.utc)


async def upsert_camera_event(pool, ev: dict) -> None:
    after = ev.get("after") or ev.get("before") or {}
    if not after.get("has_clip") and ev.get("type") != "end":
        return
    et = to_dt(after.get("start_time"))
    night = is_night(et)
    label = after.get("label")
    retention = "incident" if (night and label == "person") else "event"
    async with pool.acquire() as c:
        cam_id = await c.fetchval(
            """
            INSERT INTO camera_events (frigate_event_id, camera_key, event_time, label, zone,
              score, is_night, clip_path, snapshot_path, retention_class, raw, dedupe_key)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$1)
            ON CONFLICT (frigate_event_id) DO UPDATE SET
              retention_class = GREATEST(camera_events.retention_class, EXCLUDED.retention_class),
              clip_path = COALESCE(EXCLUDED.clip_path, camera_events.clip_path)
            RETURNING id
            """,
            after.get("id"), after.get("camera"), et, label,
            (after.get("current_zones") or [None])[0], after.get("top_score"),
            night, f"/media/frigate/clips/{after.get('camera')}-{after.get('id')}.mp4",
            f"/media/frigate/clips/{after.get('camera')}-{after.get('id')}.jpg",
            retention, json.dumps(after, default=str),
        )
        # Correlate this person event to a nearby unlock: unlock within [P-30s, P+10s].
        if label == "person":
            row = await c.fetchrow(
                """
                SELECT id FROM lock_events
                WHERE door_key = $1 AND action = 'unlock'
                  AND event_time BETWEEN $2 AND $3
                ORDER BY abs(extract(epoch from (event_time - $4))) LIMIT 1
                """,
                after.get("camera"), et - timedelta(seconds=30), et + timedelta(seconds=10), et,
            )
            if row:
                await c.execute(
                    "UPDATE lock_events SET camera_event_id=$1, clip_path=$2 WHERE id=$3",
                    str(cam_id), f"/media/frigate/clips/{after.get('camera')}-{after.get('id')}.mp4", row["id"],
                )
            elif night:
                await alert(c, "night_person_no_unlock",
                            f"Night person at {after.get('camera')} with no unlock")
            # Armed-state mirror: flag once per Frigate event (type 'end').
            if ev.get("type") == "end":
                unlock = await c.fetchrow(
                    "SELECT event_time FROM lock_events WHERE action='unlock' "
                    "AND event_time BETWEEN $1 AND $2 ORDER BY event_time DESC LIMIT 1",
                    et - timedelta(seconds=300), et + timedelta(seconds=90),
                )
                verdict = intrusion_verdict(ALARM["state"], et,
                                            unlock["event_time"] if unlock else None)
                if verdict:
                    await c.execute(
                        "UPDATE camera_events SET retention_class='incident' WHERE id=$1", cam_id)
                    await alert(c, verdict,
                                f"Person at {after.get('camera')} while {ALARM['state']}")


async def sweep_unlock_no_person(pool) -> None:
    """Mark unlocks in the last 2 min that never got a correlated person event."""
    async with pool.acquire() as c:
        await c.execute(
            """
            UPDATE lock_events SET anomaly='unlock_no_person'
            WHERE action='unlock' AND anomaly IS NULL AND camera_event_id IS NULL
              AND event_time < now() - interval '40 seconds'
              AND event_time > now() - interval '2 minutes'
            """
        )


async def alert(conn, kind: str, message: str) -> None:
    await conn.execute(
        "INSERT INTO admin_changes (actor, change_type, target, raw) VALUES ($1,$2,$3,$4)",
        "event-correlator", "anomaly", kind, json.dumps({"message": message}),
    )
    print(f"[alert] {kind}: {message}")


def on_message(client, userdata, msg):
    if msg.topic == "alarmo/state":
        ALARM["state"] = msg.payload.decode(errors="replace").strip()
        return
    if msg.topic.startswith("dobby/events/"):
        row = plan_device_event(msg.topic, msg.payload.decode(errors="replace"),
                                datetime.now(timezone.utc).timestamp())
        if row:
            DEVICE_QUEUE.put_nowait(row)
        return
    try:
        QUEUE.put_nowait(json.loads(msg.payload.decode()))
    except Exception as exc:
        print(f"event parse error: {exc}")


def start_mqtt():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    if MQTT_USER:
        client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
    client.on_message = on_message
    client.connect(MQTT_HOST, 1883, 60)
    client.subscribe([("frigate/events", 0), ("alarmo/state", 0), ("dobby/events/#", 0)])
    client.loop_start()
    return client


async def worker(pool):
    while True:
        ev = await QUEUE.get()
        try:
            await upsert_camera_event(pool, ev)
        except Exception as exc:
            print(f"correlate failed: {exc}")


async def device_worker(pool):
    while True:
        row = await DEVICE_QUEUE.get()
        try:
            async with pool.acquire() as c:
                await c.execute(
                    """
                    INSERT INTO device_events (source, area_key, device_key, event_time,
                      event_type, old_state, new_state, value_numeric, raw, dedupe_key)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                    ON CONFLICT (dedupe_key) DO NOTHING
                    """,
                    row["source"], row["area_key"], row["device_key"],
                    datetime.now(timezone.utc), row["event_type"], row["old_state"],
                    row["new_state"], row["value_numeric"],
                    json.dumps(row["raw"], default=str), row["dedupe_key"],
                )
        except Exception as exc:
            print(f"device event insert failed: {exc}")


async def main():
    pool = await asyncpg.create_pool(DATABASE_URL)
    start_mqtt()
    asyncio.create_task(worker(pool))
    asyncio.create_task(device_worker(pool))
    while True:
        try:
            await sweep_unlock_no_person(pool)
        except Exception as exc:
            print(f"sweep failed: {exc}")
        await asyncio.sleep(30)


if __name__ == "__main__":
    asyncio.run(main())
