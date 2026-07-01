#!/usr/bin/env bash
# Nightly age-encrypted dump of the audit DB — the system of record — to the
# media disk, then offsite to B2 under the same PutObject-only key as the clip
# archive (uploads cannot delete). Restore needs the hardware token (docs/08).
set -euo pipefail

cd /opt/dobby
set -a; source ./.env; set +a

DUMP_DIR="${MEDIA_ROOT:-/srv/dobby/media}/dumps"
mkdir -p "$DUMP_DIR"
OUT="$DUMP_DIR/db_$(date +%F).sql.age"

# Seal the audit hash-chain first so tonight's dump anchors today's heads
# offsite (docs/15 #1) — a later rewrite of history can't match them.
docker compose run --rm archive-job chain-seal

docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | age -R "${ARCHIVE_RECIPIENTS:-/opt/dobby/secrets/recipients.txt}" > "$OUT"

if [[ -n "${B2_BUCKET:-}" && "${B2_BUCKET}" != CHANGE_ME* ]]; then
  RCLONE_CONFIG_B2_TYPE=s3 RCLONE_CONFIG_B2_PROVIDER=Other \
  RCLONE_CONFIG_B2_ACCESS_KEY_ID="$B2_KEY_ID" \
  RCLONE_CONFIG_B2_SECRET_ACCESS_KEY="$B2_APP_KEY" \
  RCLONE_CONFIG_B2_ENDPOINT="$B2_ENDPOINT" \
    rclone copyto "$OUT" "b2:$B2_BUCKET/db/$(basename "$OUT")"
fi

# Keep 30 local dumps; offsite retention is the bucket lifecycle's job.
find "$DUMP_DIR" -name 'db_*.sql.age' -mtime +30 -delete
echo "[dbdump] wrote $OUT"
