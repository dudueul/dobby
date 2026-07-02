"""Tamper-evident audit chain (docs/15 backlog #1).

`seal` folds new audit rows, in id order, into a per-table sha256 hash chain
and records the head in audit_chain; the nightly encrypted DB dump carries the
heads offsite to the immutable bucket. `verify` recomputes every chain from
genesis and compares each sealed head — a hub compromise can therefore delete
or rewrite history only detectably: today's rows must still fold to yesterday's
offsite head.

What is chained (and why only this):
  lock_events    — the columns set at insert and never updated (the correlator
                   later backfills camera_event_id/clip_path/anomaly, so those
                   are excluded; chaining them would make honest updates look
                   like tampering).
  admin_changes  — fully append-only; every column.
  camera_events  — NOT chained: retention re-tagging mutates rows by design.

Pure core: canonical_row + extend_chain (no I/O; unit-tested). Effects at the
edges: cmd_seal / cmd_verify own psycopg lazily, and normalize timestamps and
JSONB to text in SQL under an explicit UTC session so hashes are reproducible.
"""
from __future__ import annotations

import hashlib
import json
import sys

GENESIS = "0" * 64

# table -> (immutable column expressions, normalized to text in SQL)
TABLES = {
    "lock_events": (
        "id, source, coalesce(nuki_smartlock_id,''), door_key, event_time::text, "
        "coalesce(action,''), coalesce(state,''), coalesce(trigger,''), "
        "coalesce(user_name,''), coalesce(auth_id,''), coalesce(access_method,''), "
        "coalesce(dedupe_key,'')"
    ),
    "admin_changes": (
        "id, changed_at::text, actor, change_type, coalesce(target,''), coalesce(raw::text,'')"
    ),
}


# Retention GC needs each table's time column to find expired rows.
TIME_COLS = {"lock_events": "event_time", "admin_changes": "changed_at"}


# ---------- pure core (unit-testable, no I/O) ----------
def gc_boundary(last_sealed_id: int | None, max_expired_id: int | None) -> int | None:
    """Rows may be pruned only when BOTH sealed (offsite head covers them) and
    past retention — never past the seal frontier, never merely old."""
    if not last_sealed_id or not max_expired_id:
        return None
    return min(last_sealed_id, max_expired_id)


def canonical_row(values: tuple) -> str:
    """Deterministic single-line encoding; the unit separator prevents field
    bleed (('ab','c') never collides with ('a','bc'))."""
    return "\x1f".join("" if v is None else str(v) for v in values)


def extend_chain(head: str, rows: list[str]) -> str:
    """Fold rows into the chain: h_i = sha256(h_{i-1} <RS> row_i)."""
    h = head
    for r in rows:
        h = hashlib.sha256((h + "\x1e" + r).encode()).hexdigest()
    return h


# ---------- effects at the edges ----------
def _rows(conn, table: str, after_id: int, up_to: int | None = None) -> list[str]:
    cols = TABLES[table]
    sql = f"SELECT {cols} FROM {table} WHERE id > %s"
    args: list = [after_id]
    if up_to is not None:
        sql += " AND id <= %s"
        args.append(up_to)
    sql += " ORDER BY id"
    return [canonical_row(r) for r in conn.execute(sql, args).fetchall()]


def cmd_seal(db_url: str) -> None:
    import psycopg
    with psycopg.connect(db_url) as conn:
        conn.execute("SET TIME ZONE 'UTC'")
        for table in TABLES:
            last = conn.execute(
                "SELECT last_row_id, head_hash FROM audit_chain "
                "WHERE table_name=%s ORDER BY id DESC LIMIT 1", (table,)
            ).fetchone()
            after_id, head = (last[0], last[1]) if last else (0, GENESIS)
            rows = _rows(conn, table, after_id)
            if not rows:
                continue
            new_last = conn.execute(
                f"SELECT max(id) FROM {table} WHERE id > %s", (after_id,)
            ).fetchone()[0]
            conn.execute(
                "INSERT INTO audit_chain (table_name, last_row_id, rows_sealed, head_hash) "
                "VALUES (%s,%s,%s,%s)",
                (table, new_last, len(rows), extend_chain(head, rows)),
            )
            print(f"[chain] {table}: sealed {len(rows)} rows through id {new_last}")
        conn.commit()


def _latest_checkpoint(conn, table: str) -> tuple[int, str]:
    cp = conn.execute(
        "SELECT last_row_id, head_hash FROM audit_chain "
        "WHERE table_name=%s AND kind='checkpoint' ORDER BY id DESC LIMIT 1", (table,)
    ).fetchone()
    return (cp[0], cp[1]) if cp else (0, GENESIS)


def _verify_conn(conn) -> int:
    """Recompute every chain from its latest checkpoint; count mismatches.
    Seals at or before a checkpoint are subsumed by it (their rows are pruned);
    later seals must fold out of the checkpoint head — extend_chain composes
    in batches, so this equals the original from-genesis computation."""
    bad = 0
    for table in TABLES:
        cp_id, cp_head = _latest_checkpoint(conn, table)
        head, after_id = cp_head, cp_id
        seals = conn.execute(
            "SELECT id, last_row_id, head_hash FROM audit_chain "
            "WHERE table_name=%s AND kind='seal' AND last_row_id > %s ORDER BY id",
            (table, after_id),
        ).fetchall()
        for seal_id, last_row_id, recorded in seals:
            head = extend_chain(head, _rows(conn, table, after_id, last_row_id))
            after_id = last_row_id
            if head != recorded:
                bad += 1
                print(f"[chain] MISMATCH {table} seal {seal_id}: history was altered")
                conn.execute(
                    "INSERT INTO admin_changes (actor, change_type, target, raw) "
                    "VALUES ('audit-chain','incident','tamper', %s::jsonb)",
                    (json.dumps({"table": table, "seal_id": seal_id}),),
                )
        print(f"[chain] {table}: {len(seals)} seals verified from checkpoint id<={cp_id}")
    return bad


def cmd_verify(db_url: str) -> int:
    """Recompute every chain; 0 = all heads match."""
    import psycopg
    with psycopg.connect(db_url) as conn:
        conn.execute("SET TIME ZONE 'UTC'")
        bad = _verify_conn(conn)
        conn.commit()
    return 1 if bad else 0


def cmd_gc(db_url: str, retain_days: int) -> int:
    """Prune audit rows past retention, but only up to the seal frontier, and
    only after a clean verify (GC must never launder tampering into a fresh
    checkpoint). Records a checkpoint head so verify keeps working."""
    import psycopg
    with psycopg.connect(db_url) as conn:
        conn.execute("SET TIME ZONE 'UTC'")
        if _verify_conn(conn):
            conn.commit()
            print("[chain] GC refused: verify found mismatches")
            return 1
        for table, time_col in TIME_COLS.items():
            cp_id, cp_head = _latest_checkpoint(conn, table)
            last_seal = conn.execute(
                "SELECT max(last_row_id) FROM audit_chain WHERE table_name=%s AND kind='seal'",
                (table,),
            ).fetchone()[0]
            max_expired = conn.execute(
                f"SELECT max(id) FROM {table} WHERE {time_col} < now() - make_interval(days => %s)",
                (retain_days,),
            ).fetchone()[0]
            boundary = gc_boundary(last_seal, max_expired)
            if boundary is None or boundary <= cp_id:
                continue
            head = extend_chain(cp_head, _rows(conn, table, cp_id, boundary))
            pruned = conn.execute(
                f"DELETE FROM {table} WHERE id <= %s", (boundary,)
            ).rowcount
            conn.execute(
                "INSERT INTO audit_chain (table_name, kind, last_row_id, rows_sealed, head_hash) "
                "VALUES (%s,'checkpoint',%s,%s,%s)",
                (table, boundary, pruned, head),
            )
            print(f"[chain] {table}: pruned {pruned} rows through id {boundary} (checkpointed)")
        conn.commit()
    return 0


if __name__ == "__main__":
    db = sys.argv[2] if len(sys.argv) > 2 else ""
    sys.exit({"seal": lambda: cmd_seal(db), "verify": lambda: cmd_verify(db)}[sys.argv[1]]() or 0)
