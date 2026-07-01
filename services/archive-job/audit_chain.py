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


# ---------- pure core (unit-testable, no I/O) ----------
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


def cmd_verify(db_url: str) -> int:
    """Recompute every chain from genesis; 0 = all heads match."""
    import psycopg
    bad = 0
    with psycopg.connect(db_url) as conn:
        conn.execute("SET TIME ZONE 'UTC'")
        for table in TABLES:
            seals = conn.execute(
                "SELECT id, last_row_id, head_hash FROM audit_chain "
                "WHERE table_name=%s ORDER BY id", (table,)
            ).fetchall()
            head, after_id = GENESIS, 0
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
            print(f"[chain] {table}: {len(seals)} seals {'OK' if not bad else 'CHECKED'}")
        conn.commit()
    return 1 if bad else 0


if __name__ == "__main__":
    db = sys.argv[2] if len(sys.argv) > 2 else ""
    sys.exit({"seal": lambda: cmd_seal(db), "verify": lambda: cmd_verify(db)}[sys.argv[1]]() or 0)
