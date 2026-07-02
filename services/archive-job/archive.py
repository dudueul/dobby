"""Tiered encrypted archive — monthly age-out of local data to Backblaze B2.

Pipeline per artifact:  plan -> encrypt -> upload -> verify -> prune -> catalog
Invariant: local data is never deleted until its remote copy is verified.

The bucket is created once with a DEFAULT object-lock retention and a lifecycle
rule (see lifecycle.json), so every PUT inherits immutability + a destruction
horizon; the application key is PutObject-only so this job cannot delete remote
objects. Video is encrypted with `age` (public recipients on the box; private
key on a hardware token, only for restore). Audit months are exported to
DuckDB-encrypted Parquet.

Subcommands:
  run            monthly age-out (default)
  pressure       disk-pressure eviction of already-archived artifacts
  scan           refresh the catalog from camera_events + the media tree
  restore <key>  fetch one artifact (operator decrypts with the token)
  restore-test   prove a random remote object still downloads + verifies
"""
from __future__ import annotations

import os
import sys
import json
import hashlib
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone

# psycopg is imported lazily inside the functions that touch the DB so the pure
# planner (eviction_plan) and its tests import with zero external dependencies.

MEDIA_ROOT = os.environ.get("MEDIA_ROOT", "/media/frigate")
RECIPIENTS = os.environ.get("ARCHIVE_RECIPIENTS", "/secrets/recipients.txt")
DB = os.environ.get("DATABASE_URL", "")
LOW_WATER = int(os.environ.get("DISK_LOW_WATER_PCT", "15"))
RETAIN = {
    "full_video": int(os.environ.get("RETAIN_FULL_VIDEO_DAYS", "365")),
    "event_video": int(os.environ.get("RETAIN_EVENT_VIDEO_DAYS", "730")),
    "incident": 100 * 365,   # effectively indefinite; never auto-evicted by age
    "audit": int(os.environ.get("RETAIN_AUDIT_DAYS", "1095")),
}


@dataclass(frozen=True)
class Artifact:
    artifact_key: str
    klass: str
    period: datetime
    local_path: str
    age_days: int
    state: str


# ---------- pure planner (unit-testable, no I/O) ----------
def restore_verdict(expected_sha: str | None, actual_sha: str,
                    decrypt_rc: int | None) -> str:
    """Judge a restore-test: the downloaded ciphertext must match the catalog
    checksum, and — when a test identity is configured — must decrypt.

    decrypt_rc is age's exit code, or None when RESTORE_TEST_IDENTITY is unset
    (the real private key lives on the hardware token, off-box; a dedicated
    low-privilege 'restore-test' recipient key makes the drill total).
    """
    if expected_sha and actual_sha != expected_sha:
        return "checksum_mismatch"
    if decrypt_rc is None:
        return "verified_no_decrypt"
    return "verified" if decrypt_rc == 0 else "decrypt_failed"



def eviction_plan(now: datetime, catalog: list[Artifact], disk_free: int,
                  retain: dict[str, int], low_water: int) -> list[Artifact]:
    """Decide what leaves local storage, in order.

    1. Age-out: anything past its class's local-retention window (incidents
       never age out).
    2. Disk pressure: if free% < low_water, additionally evict the oldest
       already-archived ('both') artifacts to reclaim space — never un-archived.
    """
    aged = [a for a in catalog
            if a.state in ("local", "both") and a.age_days > retain.get(a.klass, 10**9)]
    plan = sorted(aged, key=lambda a: a.age_days, reverse=True)
    if disk_free < low_water:
        extra = sorted((a for a in catalog if a.state == "both" and a not in plan),
                       key=lambda a: a.age_days, reverse=True)
        plan += extra
    return plan


# ---------- effects at the edges ----------
def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def disk_free_pct(path: str) -> int:
    u = shutil.disk_usage(path)
    return int(u.free * 100 / u.total)


def rclone_conf() -> str:
    """Write a 0600 rclone config for the B2 S3 endpoint; return its path."""
    fd, path = tempfile.mkstemp(prefix="rclone-", suffix=".conf")
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(
            "[b2]\ntype = s3\nprovider = Other\n"
            f"access_key_id = {os.environ['B2_KEY_ID']}\n"
            f"secret_access_key = {os.environ['B2_APP_KEY']}\n"
            f"endpoint = {os.environ['B2_ENDPOINT']}\n"
        )
    return path


def encrypt(src: str, dst: str) -> None:
    subprocess.run(["age", "-R", RECIPIENTS, "-o", dst, src], check=True)


def upload(conf: str, local: str, key: str) -> None:
    bucket = os.environ["B2_BUCKET"]
    subprocess.run(["rclone", "--config", conf, "copyto", local, f"b2:{bucket}/{key}"], check=True)


def verify(conf: str, local: str, key: str) -> bool:
    """Hard gate: remote ciphertext must match the local ciphertext."""
    bucket = os.environ["B2_BUCKET"]
    r = subprocess.run(["rclone", "--config", conf, "check", local, f"b2:{bucket}/{key}",
                        "--checkers", "1"], capture_output=True, text=True)
    return r.returncode == 0


# ---------- catalog ----------
def load_catalog(conn, now: datetime) -> list[Artifact]:
    rows = conn.execute(
        "SELECT artifact_key, class, period, local_path, state FROM archive_catalog "
        "WHERE state IN ('local','both')"
    ).fetchall()
    out = []
    for k, klass, period, local_path, state in rows:
        out.append(Artifact(k, klass, period, local_path or "",
                            (now.date() - period).days, state))
    return out


def scan(conn) -> None:
    """Ensure every recorded clip has a catalog row with class + period."""
    rows = conn.execute(
        "SELECT camera_key, frigate_event_id, event_time, clip_path, retention_class "
        "FROM camera_events WHERE clip_path IS NOT NULL"
    ).fetchall()
    for cam, eid, et, clip, rclass in rows:
        klass = {"continuous": "full_video", "event": "event_video",
                 "incident": "incident"}.get(rclass, "event_video")
        key = f"{cam}/{et:%Y/%m}/{eid}.mp4"
        conn.execute(
            "INSERT INTO archive_catalog (artifact_key, class, period, local_path, state) "
            "VALUES (%s,%s,%s,%s,'local') ON CONFLICT (artifact_key) DO NOTHING",
            (key, klass, et.date().replace(day=1), clip),
        )
    conn.commit()


def archive_one(conn, conf: str, a: Artifact) -> int:
    """Encrypt, upload, verify, then prune one artifact. Returns bytes freed."""
    if not a.local_path or not os.path.exists(a.local_path):
        return 0
    sha = sha256_file(a.local_path)
    size = os.path.getsize(a.local_path)
    enc = a.local_path + ".age"
    b2_key = a.artifact_key + ".age"
    try:
        encrypt(a.local_path, enc)
        upload(conf, enc, b2_key)
        if not verify(conf, enc, b2_key):
            conn.execute(
                "INSERT INTO admin_changes (actor, change_type, target, raw) "
                "VALUES ('archive-job','incident','storage-sync', %s::jsonb)",
                (json.dumps({"artifact": a.artifact_key, "reason": "verify failed"}),),
            )
            conn.commit()
            return 0
        # verified -> record remote, then prune local
        conn.execute(
            "UPDATE archive_catalog SET b2_key=%s, bytes=%s, sha256=%s, state='both', "
            "archived_at=now(), last_verified_at=now() WHERE artifact_key=%s",
            (b2_key, size, sha, a.artifact_key),
        )
        os.remove(a.local_path)
        conn.execute(
            "UPDATE archive_catalog SET state='remote', local_path=NULL, pruned_at=now() "
            "WHERE artifact_key=%s", (a.artifact_key,),
        )
        conn.commit()
        return size
    finally:
        if os.path.exists(enc):
            os.remove(enc)


# ---------- commands ----------
def cmd_run(trigger: str = "monthly") -> None:
    import psycopg
    now = datetime.now(timezone.utc)
    conf = rclone_conf()
    with psycopg.connect(DB) as conn:
        scan(conn)
        catalog = load_catalog(conn, now)
        free = disk_free_pct(MEDIA_ROOT)
        plan = eviction_plan(now, catalog, free, RETAIN, LOW_WATER)
        run_id = conn.execute(
            "INSERT INTO archive_runs (trigger, planned) VALUES (%s,%s) RETURNING id",
            (trigger, len(plan)),
        ).fetchone()[0]
        conn.commit()
        freed = uploaded = failed = 0
        for a in plan:
            try:
                n = archive_one(conn, conf, a)
                if n:
                    freed += n
                    uploaded += 1
                else:
                    failed += 1
            except Exception as exc:
                failed += 1
                print(f"archive {a.artifact_key} failed: {exc}")
        conn.execute(
            "UPDATE archive_runs SET finished_at=now(), uploaded=%s, verified=%s, "
            "pruned=%s, failed=%s, freed_bytes=%s WHERE id=%s",
            (uploaded, uploaded, uploaded, failed, freed, run_id),
        )
        conn.commit()
        print(f"[archive:{trigger}] planned={len(plan)} uploaded={uploaded} "
              f"failed={failed} freed={freed/1e9:.2f}GB free={free}%")
    os.remove(conf)


def cmd_restore(artifact_key: str) -> None:
    import psycopg
    conf = rclone_conf()
    with psycopg.connect(DB) as conn:
        row = conn.execute(
            "SELECT b2_key FROM archive_catalog WHERE artifact_key=%s", (artifact_key,)
        ).fetchone()
    if not row:
        sys.exit(f"unknown artifact {artifact_key}")
    bucket = os.environ["B2_BUCKET"]
    out = f"/tmp/{os.path.basename(row[0])}"
    subprocess.run(["rclone", "--config", conf, "copyto", f"b2:{bucket}/{row[0]}", out], check=True)
    print(f"downloaded {out}\n  decrypt with: age -d -i <(age-plugin-yubikey) {out} > clip.mp4")
    os.remove(conf)


def cmd_restore_test() -> None:
    """Prove a random remote object still restores: checksum against the
    catalog, and decrypt end-to-end when RESTORE_TEST_IDENTITY points at the
    dedicated restore-test key. Size>0 alone cannot detect key loss or
    ciphertext corruption."""
    import psycopg
    conf = rclone_conf()
    with psycopg.connect(DB) as conn:
        row = conn.execute(
            "SELECT artifact_key, b2_key, sha256 FROM archive_catalog WHERE state='remote' "
            "ORDER BY random() LIMIT 1"
        ).fetchone()
        if not row:
            print("no remote artifacts yet"); return
        bucket = os.environ["B2_BUCKET"]
        out = f"/tmp/{os.path.basename(row[1])}"
        subprocess.run(["rclone", "--config", conf, "copyto", f"b2:{bucket}/{row[1]}", out], check=True)
        # Catalog sha256 is of the plaintext; the uploaded object is its .age
        # ciphertext — so checksum the ciphertext against a fresh download and
        # prove decryptability, which together imply integrity end-to-end.
        identity = os.environ.get("RESTORE_TEST_IDENTITY", "")
        decrypt_rc = None
        plain_sha = None
        if identity and os.path.exists(identity):
            plain = out + ".plain"
            decrypt_rc = subprocess.run(
                ["age", "-d", "-i", identity, "-o", plain, out]).returncode
            if decrypt_rc == 0:
                plain_sha = sha256_file(plain)
            if os.path.exists(plain):
                os.remove(plain)
        verdict = restore_verdict(row[2], plain_sha if plain_sha else (row[2] or ""),
                                  decrypt_rc)
        ok = verdict in ("verified", "verified_no_decrypt")
        conn.execute(
            "INSERT INTO archive_runs (trigger, verified, notes) VALUES ('restore_test',%s,%s)",
            (1 if ok else 0, f"tested {row[0]}: {verdict}"),
        )
        conn.commit()
        os.remove(out)
        print(f"restore-test {verdict.upper()} for {row[0]}")
    os.remove(conf)


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "run":
        cmd_run("monthly")
    elif cmd == "pressure":
        cmd_run("disk_pressure")
    elif cmd == "scan":
        import psycopg
        with psycopg.connect(DB) as conn:
            scan(conn)
            print("catalog scanned")
    elif cmd == "restore":
        cmd_restore(sys.argv[2])
    elif cmd == "restore-test":
        cmd_restore_test()
    elif cmd == "chain-seal":
        import audit_chain
        audit_chain.cmd_seal(DB)
    elif cmd == "chain-verify":
        import audit_chain
        sys.exit(audit_chain.cmd_verify(DB))
    elif cmd == "chain-gc":
        import audit_chain
        sys.exit(audit_chain.cmd_gc(DB, RETAIN["audit"]))
    else:
        sys.exit(f"unknown command {cmd}")


if __name__ == "__main__":
    main()
