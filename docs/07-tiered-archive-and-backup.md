# 07 — Tiered archive and encrypted backup

Local is the system of record for the recent window; Backblaze B2 is an
encrypted cold tier that data **ages into** monthly. Nothing local is deleted
until its remote copy is uploaded **and** checksum-verified.

## Lifecycle

| Class | Local window | Monthly age-out → B2 | B2 retention |
|---|---|---|---|
| Full / continuous video | `RETAIN_FULL_VIDEO_DAYS` (365) | encrypted blob | per lifecycle (destroy or keep cold) |
| Event video | `RETAIN_EVENT_VIDEO_DAYS` (730) | encrypted blob | lifecycle-expire at horizon |
| Tamper / incident clips | flagged, kept | **immediate** + monthly | indefinite (manual) |
| Audit logs | `RETAIN_AUDIT_DAYS` (1095) | encrypted Parquet partition | long / indefinite |

## The monthly job (`services/archive-job`)

```
for each artifact older than its local window (or under disk pressure):
  1. PLAN     pure: eviction_plan(now, catalog, disk) → oldest-archivable first
  2. ENCRYPT  video:  age -R recipients.txt
              audit:  DuckDB COPY … (ENCRYPTION_KEY '<key>')  → encrypted Parquet
  3. UPLOAD   rclone copy → B2, Object-Lock retention = destroy horizon
  4. VERIFY   re-read remote object, compare sha256        ← hard gate
  5. PRUNE    delete local copy ONLY IF verify passed
  6. CATALOG  mark artifact state=remote (b2_key, sha256, key_id, expires_at)
```

**Invariant:** local data is never deleted until its B2 copy is verified. A
failed verify keeps the local copy and raises a `storage-sync` incident.

## Disk-pressure safety valve

`provisioning/healthcheck.sh` (and the job on each run) checks free space. Below
`DISK_LOW_WATER_PCT` it evicts the **oldest already-archived-and-verified** slice
first — never un-archived data. If it still can't free space it raises a
`storage-full` incident instead of dropping un-backed-up footage.

## Encryption & keys

- **Video / blobs:** `age` asymmetric. The **public** recipients live on the box
  (`secrets/recipients.txt`); the **private** key never does — it lives on a
  Nitrokey HSM 2 / YubiKey and is only needed to restore. Encrypt to **multiple
  recipients** (2 hardware tokens + 1 paper key in a safe) so losing one token
  never loses the archive.
- **Audit Parquet:** DuckDB native Parquet encryption (AES-256). B2 holds
  ciphertext; a cold query loads the key (unwrapped via the token) with
  `PRAGMA add_parquet_key` and reads `s3://…` directly — encrypted at rest **and**
  queryable.
- **Immutability:** B2 **Object Lock (governance)** with retention = destroy
  horizon; a lifecycle rule expires objects when the lock lapses. The archive
  application key is **PutObject-only** (no delete/list) so a compromised hub
  cannot wipe the archive.

### Generate the archive identity (one time)

```bash
# On a YubiKey/Nitrokey (age-plugin-yubikey) or a paper key:
age-keygen -o secrets/archive-paper.key          # paper backup, store offline
age-keygen -y secrets/archive-paper.key          # → public key line
# Put all recipient PUBLIC keys (token1, token2, paper) in:
secrets/recipients.txt
```

(For the Nitrokey HSM 2, you can instead duplicate one key across devices with
the DKEK backup mechanism — see `docs/07-keys-nitrokey.md` once added.)

## Restore

```bash
docker compose run --rm archive-job restore <artifact_id>
# → looks up b2_key in the catalog, downloads, decrypts with the token, serves.
```

A monthly **restore-test** decrypts one random object end-to-end to prove the
keys and pipeline still work — silent backups that don't restore are not
backups.

## What lives where, always

The `archive_catalog` table (`sql/002_catalog.sql`) is the source of truth: one
row per artifact with `state ∈ {local, remote, both}`, `sha256`, `b2_key`,
`enc_key_id`, `locked_until`, `expires_at`. Pruning and restore are driven by it,
never by directory guesswork.
