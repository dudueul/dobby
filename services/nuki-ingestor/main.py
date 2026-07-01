"""Nuki ingestor — normalize Nuki Web API logs + local MQTT into lock_events.

Two sources, one normal form:
  - outbound poll of api.nuki.io (optional; set NUKI_API_TOKEN)
  - subscribe to the local MQTT bus (authoritative for "works offline")
Dedup is by a stable hash so the two sources never double-count.
"""
import asyncio
import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Any

import asyncpg
import httpx
import paho.mqtt.client as mqtt

from normalize import normalize_nuki_mqtt

DATABASE_URL = os.environ["DATABASE_URL"]
NUKI_API_TOKEN = os.environ.get("NUKI_API_TOKEN", "")
MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto")
MQTT_USER = os.environ.get("MQTT_USER", "")
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD", "")
POLL_SECONDS = int(os.environ.get("NUKI_POLL_SECONDS", "300"))

QUEUE: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
# smartlock_id -> door_key, loaded from the locks table at startup so the
# local MQTT path attributes events to the same doors as the Web-API path.
DOOR_KEYS: dict[str, str] = {}


def stable_hash(data: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()


def infer_access_method(row: dict[str, Any]) -> str:
    text = json.dumps(row, default=str).lower()
    if "finger" in text:
        return "fingerprint"
    if "keypad" in text or "pin" in text or "code" in text:
        return "keypad_pin"
    if any(k in text for k in ("homekit", "home key", "homekey", "smart home", "tap")):
        return "apple_home_key_or_smart_home_tap"
    if "manual" in text:
        return "manual_key_or_thumbturn"
    if "app" in text:
        return "nuki_app"
    return "unknown"


def normalize_nuki_log(row: dict[str, Any], smartlock_id: str, door_key: str) -> dict[str, Any]:
    event_time = row.get("date") or row.get("timestamp") or datetime.now(timezone.utc).isoformat()
    return {
        "source": "nuki_web_api",
        "nuki_smartlock_id": smartlock_id,
        "door_key": door_key,
        "event_time": event_time,
        "action": str(row.get("action", "unknown")),
        "state": str(row.get("state", "unknown")),
        "trigger": str(row.get("trigger", "unknown")),
        "user_name": row.get("name") or row.get("userName"),
        "auth_id": str(row.get("authId")) if row.get("authId") else None,
        "access_method": infer_access_method(row),
        "battery_critical": bool(row.get("batteryCritical")) if row.get("batteryCritical") is not None else None,
        "raw": row,
    }


async def insert_lock_event(pool: asyncpg.Pool, e: dict[str, Any]) -> None:
    dedupe_key = stable_hash({k: e.get(k) for k in
                              ("source", "nuki_smartlock_id", "door_key", "event_time", "action", "auth_id")})
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO lock_events (source, nuki_smartlock_id, door_key, event_time, action,
              state, trigger, user_name, auth_id, access_method, battery_critical, raw, dedupe_key)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT (dedupe_key) DO NOTHING
            """,
            e["source"], e.get("nuki_smartlock_id"), e["door_key"], e["event_time"], e.get("action"),
            e.get("state"), e.get("trigger"), e.get("user_name"), e.get("auth_id"),
            e.get("access_method"), e.get("battery_critical"),
            json.dumps(e["raw"], default=str), dedupe_key,
        )


async def poll_nuki_web_api(pool: asyncpg.Pool) -> None:
    if not NUKI_API_TOKEN or NUKI_API_TOKEN.startswith("CHANGE_ME"):
        return  # web API disabled; stay fully local
    headers = {"Authorization": f"Bearer {NUKI_API_TOKEN}"}
    async with httpx.AsyncClient(timeout=20) as client:
        locks = (await client.get("https://api.nuki.io/smartlock", headers=headers)).json()
        for lock in locks:
            sid = str(lock.get("smartlockId") or lock.get("id"))
            door_key = (lock.get("name") or f"nuki_{sid}").lower().replace(" ", "_")
            r = await client.get(f"https://api.nuki.io/smartlock/{sid}/log", headers=headers)
            if r.status_code == 404:
                continue
            r.raise_for_status()
            for row in r.json():
                await insert_lock_event(pool, normalize_nuki_log(row, sid, door_key))


def on_mqtt_message(client, userdata, msg):
    try:
        e = normalize_nuki_mqtt(msg.topic, msg.payload.decode(errors="replace"),
                                DOOR_KEYS, datetime.now(timezone.utc).isoformat())
        if e:
            QUEUE.put_nowait(e)
    except Exception as exc:
        print(f"MQTT parse error: {exc}")


async def mqtt_worker(pool: asyncpg.Pool):
    while True:
        e = await QUEUE.get()
        try:
            await insert_lock_event(pool, e)
        except Exception as exc:
            print(f"insert MQTT event failed: {exc}")


def start_mqtt():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    if MQTT_USER:
        client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
    client.on_message = on_mqtt_message
    client.connect(MQTT_HOST, 1883, 60)
    client.subscribe("nuki/#")
    client.loop_start()
    return client


async def main():
    pool = await asyncpg.create_pool(DATABASE_URL)
    async with pool.acquire() as conn:
        for r in await conn.fetch("SELECT nuki_smartlock_id, door_key FROM locks"):
            DOOR_KEYS[r["nuki_smartlock_id"]] = r["door_key"]
    start_mqtt()
    asyncio.create_task(mqtt_worker(pool))
    while True:
        try:
            await poll_nuki_web_api(pool)
        except Exception as exc:
            print(f"Nuki polling failed: {exc}")
        await asyncio.sleep(POLL_SECONDS)


if __name__ == "__main__":
    asyncio.run(main())
