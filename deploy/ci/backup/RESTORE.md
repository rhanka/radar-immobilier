# Restore a backup of date D

**Into preprod, automated:** `.github/workflows/bascule-preprod.yml` with
`MODE=restore` (`BACKUP_ID=latest` or a date) does §0–§2 below in-cluster (reader
identity, dump sha256 verified before `pg_restore`, docs state at D from the
inventory by server-side copy, recon), then migrate, flip and smoke; `MODE=list`
lists the available backups. See `../bascule-preprod/README.md` "Restore from a
backup". The manual procedure below stays the reference for any other target.

All reads use the **reader** identity `radar-backup-reader` (keys `S3_ENDPOINT`,
`S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_BUCKET`): GetObject (also
with a version id), ListBucket, ListBucketVersions. It cannot write or delete.
Never restore in place over production: restore into an empty database / an
empty bucket or prefix, verify, then switch.

Examples use `s5cmd` (>= 2.2, native binary of the validated stack) on an
operator workstation; the in-cluster restore-test of wave 2 will use the same
Node + aws-sdk stack as the job. Any S3 client works; do not add Python tooling
to jobs.

```sh
export AWS_ACCESS_KEY_ID=<reader S3_ACCESS_KEY> AWS_SECRET_ACCESS_KEY=<reader S3_SECRET_KEY> AWS_REGION=bhs
S5="s5cmd --endpoint-url https://s3.bhs.io.cloud.ovh.net"
B=s3://radar-immobilier-backup
$S5 cat $B/manifests/latest.json      # newest backup: date, status, manifestKey, pgSha256
D=2026-09-26
```

## 0. Pick and check the manifest

```sh
$S5 cp $B/manifests/$D.json manifest.json
```

Use a manifest with `status: "complete"` (`manifests/latest.json` →
`latestComplete` names the newest one). `partial` (docs seed still pending) and
`incomplete` (docs errors) mean the PG part is valid but some docs were not
backed up that day (`docs.pending` / `docs.failed` > 0). The manifest gives the dump key + sha256, the schema version
(`schema.lastMigration`), the PostgreSQL / PostGIS versions and the inventory key.

A date purged by the retention less than 7 days ago is still readable by version
id: `$S5 ls --all-versions "$B/pg/$D/*"` then `$S5 cp --version-id <v> …`.

## 1. PostgreSQL

```sh
$S5 cp $B/pg/$D/radar.dump radar.dump
$S5 cp $B/pg/$D/radar.dump.sha256 radar.dump.sha256
sha256sum -c radar.dump.sha256          # must print: radar.dump: OK (and equal manifest pg.sha256)
pg_restore --list radar.dump | head     # pg_restore >= 16 (dump made by pg_dump 16)
```

Restore into an EMPTY database on a PostgreSQL 16 + PostGIS server (same major
versions as `pg.serverVersion` / `pg.postgisVersion`):

```sh
createdb -h <host> -U <admin> radar_restore
pg_restore -h <host> -U <admin> -d radar_restore --no-owner --no-privileges --exit-on-error radar.dump
```

The dump is taken with `--no-owner --no-privileges`: ownership and grants come
from the platform bootstrap, not from the dump. `pg/$D/globals.sql` (roles,
memberships, tablespaces, **no passwords**) documents the roles that existed at
D; set passwords from the current secrets if roles must be recreated.

Verify: `select count(*), max(id) from drizzle.__drizzle_migrations;` equals
`schema.migrationsApplied` / `schema.lastMigration.id` of the manifest.

## 2. Documents (state at D)

`docs-inventory/$D.json` lists every source object at D: `key`, `size`, source
`etag`, `lastModified`, and for `state: "backed-up"` the `backupEtag` and, when
known, the `versionId` of the backup copy (`docs/<key>`). Objects in state
`pending`, `failed` or `excluded` are not in the backup of D.

For each `backed-up` entry:

1. Version to read: `versionId` when present; otherwise
   `$S5 ls --all-versions --etag "$B/docs/<key>"` and take the newest version
   whose ETag equals `backupEtag` and whose date is not after the inventory
   `createdAt`.
2. `$S5 cp --version-id <v> "$B/docs/<key>" <local>` and write it to the target
   bucket under `<key>` (with the target's own writer identity).
3. Check the size equals `size`.

Restore into an empty bucket (or prefix): objects created after D are then
naturally absent. The previous content of a key rewritten after D is kept only
7 days as a noncurrent version (see `RETENTION.md` "Docs history").

## 3. After a restore

Record the restored date, the manifest sha256 (`manifests/latest.json`
`manifestSha256` when D is the latest) and the verification results in the
incident / track entry.
