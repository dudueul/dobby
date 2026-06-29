-- Archive catalog: the single source of truth for where every artifact lives.
-- Drives the monthly age-out, the disk-pressure eviction, and restore.
-- Invariant: an artifact is never deleted locally while state='local'; it moves
-- local -> both (uploaded+verified) -> remote (pruned).

CREATE TYPE artifact_class AS ENUM ('full_video', 'event_video', 'incident', 'audit');
CREATE TYPE artifact_state AS ENUM ('local', 'both', 'remote');

CREATE TABLE IF NOT EXISTS archive_catalog (
  id BIGSERIAL PRIMARY KEY,
  artifact_key TEXT UNIQUE NOT NULL,     -- stable id, e.g. front_door/2026/05/clip-123.mp4
  class artifact_class NOT NULL,
  period DATE NOT NULL,                  -- the month this artifact belongs to
  local_path TEXT,
  b2_key TEXT,
  bytes BIGINT,
  sha256 TEXT,                           -- of the plaintext; manifest for verify
  enc_key_id TEXT,                       -- which recipient set / key wrapped it
  state artifact_state NOT NULL DEFAULT 'local',
  locked_until TIMESTAMPTZ,              -- B2 object-lock retention
  expires_at TIMESTAMPTZ,               -- destruction horizon (lifecycle)
  archived_at TIMESTAMPTZ,
  pruned_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_state ON archive_catalog(state);
CREATE INDEX IF NOT EXISTS idx_catalog_class_period ON archive_catalog(class, period);
CREATE INDEX IF NOT EXISTS idx_catalog_expires ON archive_catalog(expires_at)
  WHERE expires_at IS NOT NULL;

-- Append-only log of what the archive job did, for the audit trail.
CREATE TABLE IF NOT EXISTS archive_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,
  trigger TEXT,                          -- monthly | disk_pressure | manual | restore_test
  planned INT DEFAULT 0,
  uploaded INT DEFAULT 0,
  verified INT DEFAULT 0,
  pruned INT DEFAULT 0,
  failed INT DEFAULT 0,
  freed_bytes BIGINT DEFAULT 0,
  notes TEXT
);
