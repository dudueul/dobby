# 08 — Operations

## Install the timers

```bash
sudo cp provisioning/systemd/dobby-*.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dobby-maintenance.timer    # health + disk pressure, /15min
sudo systemctl enable --now dobby-archive.timer        # monthly age-out to B2
sudo systemctl enable --now dobby-restore-test.timer   # monthly recoverability proof
systemctl list-timers 'dobby-*'
```

Run any job by hand:

```bash
docker compose run --rm archive-job scan         # refresh catalog
docker compose run --rm archive-job run          # monthly age-out now
docker compose run --rm archive-job restore <artifact_key>
./provisioning/healthcheck.sh                     # one-shot health
```

## One-time B2 setup

1. Create a bucket with **Object Lock enabled** and a **default retention**
   (governance) matching `services/archive-job/lifecycle.json`.
2. Apply the lifecycle rules from that file.
3. Create an **application key scoped to that bucket with PutObject only** (no
   delete, no list-all). Put its id/secret in `.env` (`B2_KEY_ID`/`B2_APP_KEY`).
4. Generate the `age` identity on your hardware token(s) + a paper backup, and
   put the **public** recipients in `/opt/dobby/secrets/recipients.txt`.

## Weekly checklist

- Nuki battery + last-seen OK.
- Review `lock_events.anomaly` (unlock_no_person / night_person_no_unlock) and
  `admin_changes` (correlator alerts) in Grafana.
- Frigate writing clips; `/srv/dobby/media` not filling unexpectedly.
- Cameras not blocked (glare/webs/misalignment).

## Monthly checklist

- Revoke stale Nuki PINs / app authorizations; mirror notes for Apple Home Key.
- Confirm `dobby-archive` ran (`journalctl -u dobby-archive`) and `archive_runs`
  shows `uploaded > 0`, `failed = 0`.
- Confirm `dobby-restore-test` passed.
- Test **physical keys** and interior thumbturns on both doors.
- Test UPS runtime for router, PoE switch, hub.
- Patch OS + `docker compose pull && docker compose up -d` after reading notes.

## Backup of the system-of-record

The audit DB is the source of truth. In addition to the monthly Parquet age-out,
take a nightly dump:

```bash
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | age -R /opt/dobby/secrets/recipients.txt > /srv/dobby/media/dumps/db_$(date +%F).sql.age
```

(The same recipients/keys as the clip archive; restore needs the hardware token.)

## Recovery drills

- **Hub dies:** reinstall Ubuntu, `bootstrap.sh`, restore `.env` +
  `secrets/`, `docker compose up -d`, restore the latest DB dump. Local recent
  video is lost only if the disk died — the long-retention tiers are in B2.
- **Disk dies:** replace, `setup-storage.sh`, pull needed clips from B2 with
  `archive-job restore`. Doors keep working throughout (physical keys + local
  Nuki).
