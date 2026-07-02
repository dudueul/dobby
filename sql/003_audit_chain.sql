-- Tamper-evident audit chain (docs/15 backlog #1): one sealed head per table
-- per run, appended by `archive-job chain-seal`. The nightly encrypted dump
-- carries these heads offsite to the immutable bucket, so rewriting history
-- on the hub cannot go undetected by `chain-verify`.
CREATE TABLE IF NOT EXISTS audit_chain (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'seal',   -- seal | checkpoint (GC prune frontier)
  last_row_id BIGINT NOT NULL,
  rows_sealed BIGINT NOT NULL,
  head_hash CHAR(64) NOT NULL,
  sealed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_chain_table ON audit_chain(table_name, id DESC);
