-- Audit system-of-record. Raw payloads kept as JSONB so parsing can improve
-- later without losing source data.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nuki_smartlock_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  door_key TEXT UNIQUE NOT NULL,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nuki_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nuki_auth_id TEXT UNIQUE,
  nuki_smartlock_id TEXT NOT NULL,
  display_name TEXT,
  auth_type TEXT,
  status TEXT,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  raw JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lock_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,                  -- nuki_web_api | nuki_mqtt | home_assistant
  nuki_smartlock_id TEXT,
  door_key TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  action TEXT,                           -- lock | unlock | unlatch | manual | unknown
  state TEXT,
  trigger TEXT,
  user_name TEXT,
  auth_id TEXT,
  access_method TEXT,                    -- apple_home_key_or_smart_home_tap | fingerprint | keypad_pin | nuki_app | manual_key_or_thumbturn | unknown
  battery_critical BOOLEAN,
  camera_event_id TEXT,                  -- correlated Frigate event id
  clip_path TEXT,
  snapshot_path TEXT,
  anomaly TEXT,                          -- unlock_no_person | night_person_no_unlock | NULL
  raw JSONB NOT NULL,
  dedupe_key TEXT UNIQUE,
  inserted_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS camera_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'frigate',
  frigate_event_id TEXT UNIQUE,
  camera_key TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  label TEXT,                            -- person | car | package
  zone TEXT,
  score NUMERIC,
  is_night BOOLEAN,
  clip_path TEXT,
  snapshot_path TEXT,
  retention_class TEXT DEFAULT 'event',  -- continuous | event | incident
  raw JSONB NOT NULL,
  dedupe_key TEXT UNIQUE,
  inserted_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  area_key TEXT,
  device_key TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL,              -- state_change | power_update | motion | door_open | door_closed | presence
  old_state TEXT,
  new_state TEXT,
  value_numeric NUMERIC,
  related_lock_event_id BIGINT,
  related_camera_event_id BIGINT,
  raw JSONB NOT NULL,
  dedupe_key TEXT UNIQUE,
  inserted_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_changes (
  id BIGSERIAL PRIMARY KEY,
  changed_at TIMESTAMPTZ DEFAULT now(),
  actor TEXT NOT NULL,
  change_type TEXT NOT NULL,
  target TEXT,
  raw JSONB
);

CREATE INDEX IF NOT EXISTS idx_lock_events_time ON lock_events(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_lock_events_anomaly ON lock_events(anomaly) WHERE anomaly IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_camera_events_time ON camera_events(event_time DESC);
CREATE INDEX IF NOT EXISTS idx_camera_events_class ON camera_events(retention_class);
CREATE INDEX IF NOT EXISTS idx_device_events_time ON device_events(event_time DESC);
