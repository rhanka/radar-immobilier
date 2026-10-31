# PostgreSQL 16 -> 18 upgrade (logical replication)

Method A of the upgrade plan: a second StatefulSet `radar-pg18` (PG18.6, PostGIS
3.6.4, XFS volume with reflink) subscribes to `radar-postgres` (PG16.4), then the
`radar-postgres` Service moves from pod `radar-postgres-0` to `radar-pg18-0`.
Applications keep the host name `radar-postgres`, so no application setting and no
Secret changes. After the switch, PG16 subscribes to PG18 (reverse replication):
switching back loses no write.

Images (pinned by digest, same publisher as before):

| Use | Image |
|---|---|
| PG18 server, dump/restore client while PG18 serves (`dumpImages.pg18`) | `postgis/postgis:18-3.6@sha256:4a43e3c3e5d55b9208240fc71db543b79c638766280c625a425bd0a2390989c4` |
| PG16 server (the digest already running), dump/restore client while PG16 serves (`dumpImages.pg16`) | `postgis/postgis:16-3.4@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5` |

Dump and restore clients follow the serving server, not the environment: the
cutover Jobs (`cutover-render.sh`) and the CD backup (`deploy/ci/run-db-backup.sh`)
read `data.active` of ConfigMap `radar-pg-upgrade` (written by `pg-switch`; absent
means pg16) and take `dumpImages[active]` from `config.json`. Measured in `test-pg`:
pg_restore 18 into a PG16 server fails on every archive, pg_dump 16 or 18, direct or
streamed (`unrecognized configuration parameter "transaction_timeout"`), and
pg_dump 16 refuses a PG18 server. So a fixed per-environment image would break the
preprod daily restore before the switch or the backup after it. Consequence for
rollback: once PG18 serves, a backup taken from it cannot be restored into PG16;
the rollback path is reverse replication (`pg-switch TARGET=pg16`), not a backup.

The 18 image stores data under `/var/lib/postgresql/18/docker` and refuses to start
when anything is mounted at `/var/lib/postgresql/data`: every PG18 volume or tmpfs is
mounted at `/var/lib/postgresql`.

## Operator verbs

All verbs run from the repository root, need `kubectl`, `jq`, `bash`, and the tenant
kubeconfig named explicitly (`~/.kube/config` is refused). They are enabled per
environment by `pgUpgrade: true` in `config.json` (preprod only today; production
needs its own approval and a PR that sets the flag).

```sh
K=/home/<operator>/.kube/radar-preprod-tenant.kubeconfig
make -f deploy/cutover/operator.mk pg-switch TARGET=pg16 KUBECONFIG=$K ENV=preprod  # first use: pin the Service
make -f deploy/cutover/operator.mk pg-replicate KUBECONFIG=$K ENV=preprod
make -f deploy/cutover/operator.mk pg-verify KUBECONFIG=$K ENV=preprod
make -f deploy/cutover/operator.mk pg-switch TARGET=pg18 KUBECONFIG=$K ENV=preprod
make -f deploy/cutover/operator.mk pg-reverse KUBECONFIG=$K ENV=preprod
```

| Verb | Effect |
|---|---|
| `pg-replicate` | Preflight (PG16 `wal_level=logical`, every application table has a primary key or replica identity, 0 materialized view / large object / partitioned / unlogged table, PG18 with `file_copy_method=clone`), copies roles with their SCRAM hashes (`pg_dumpall --roles-only`), creates the live database on PG18 from `template0` and its schema with `pg_dump --schema-only` 18 (without `postgis_topology`, `postgis_tiger_geocoder`, `fuzzystrmatch`: unused), publishes every application table (extension tables such as `spatial_ref_sys` excluded), subscribes PG18 with `copy_data=true`, then waits until every table is in state `r` and the lag is 0. Re-running it resumes the wait. |
| `pg-replicate ABORT=1` | Drops every `pgup_*` subscription, publication, slot and the `radar_pgup` role on both sides. Databases, data and the freeze state stay. |
| `pg-verify` | Waits for lag 0, then compares every application table on both sides: row count plus md5 of the sorted row md5s; three rounds for tables still being written. Then compares privileges (tables, sequences, views, schemas, default ACLs), roles and memberships. Sequence differences are printed only: sequences are not replicated and the switch copies them. |
| `pg-switch TARGET=pg18\|pg16` | Under `radar-change-lock`: freezes the serving database (`default_transaction_read_only=on` at database level, client sessions ended), waits until the standby confirmed the last LSN (<= 45 s), copies sequence positions, compares row counts, drops the forward subscription, creates the reverse one (`copy_data=false, origin=none`; `REVERSE=0` skips it), unfreezes the target, applies the Service from `20-postgres-postgis.yaml` with the selector pinned to the target pod, waits for the Endpoints, then ends the sessions left on the old side. Any failure before the Service moved restores the previous state (no write is lost: everything happens while frozen). Receipt: ConfigMap `radar-pg-upgrade` (`freezeSeconds`, `from`, `active`). |
| `pg-reverse` | Status gate of the replication that keeps the standby current: subscription enabled, all tables `r`, lag (bytes, <= 64 MiB), serving side not frozen. Non-zero exit otherwise. |

The replication role `radar_pgup` (LOGIN REPLICATION SUPERUSER) gets a new random
password each time a subscription is created; the password exists only in
`pg_subscription` of the subscriber (superuser-readable). It is never frozen
(`ALTER ROLE radar_pgup IN DATABASE <live> SET default_transaction_read_only=off`),
which is what lets the reverse subscription apply on the frozen old side. It is
dropped by `pg-replicate ABORT=1` (L6).

## Manifests

- `deploy/k8s/20-postgres-postgis.yaml`: the `radar-postgres` Service selector names
  one pod (`statefulset.kubernetes.io/pod-name: radar-postgres-0`); PG16 gets
  `wal_level=logical` and `max_slot_wal_keep_size=2GB`. `pg-switch` is the only
  writer of the selector in a live namespace; while PG18 serves, never re-apply this
  file by hand (it would move traffic back to the frozen PG16). L6 makes PG18
  canonical in the file.
- `deploy/k8s/pg18/` (operator-applied, not in the base kustomization): StatefulSet
  `radar-pg18` (StorageClass `block-standard-xfs`, 10 Gi, `wal_level=logical`,
  `file_copy_method=clone`, requests 50m/256Mi, limits 600m/768Mi), direct Services
  `radar-pg16` / `radar-pg18` used by the replication connections, NetworkPolicy
  `allow-postgres-to-postgres` (5432 between the two pods). The `fs-probe`
  initContainer logs the filesystem type, free bytes and a reflink copy, and fails
  the pod when reflink is missing (`REQUIRE_REFLINK=1`).
- `deploy/overlays/preprod-pg18/`: the same objects in `radar-immobilier-preprod`.
- Neither CD applies Services, StatefulSets or NetworkPolicies
  (`deploy/ci/reconcile-preprod.sh`, prod `deploy` job), so no deploy reverts the
  selector.

## Preprod procedure (L2 setup, L3 switch)

Every `kubectl` below passes `--kubeconfig $K` and `-n radar-immobilier-preprod`.

Coexistence rules, from step 1 until L6 or an abort:
- no DDL on the live database: no merge of a PR that adds `api/drizzle/*` (the
  preprod CD runs the migrator on every deploy), no daily restore
  (`gh workflow disable bascule-preprod.yml`, re-enable at the end), no release
  cutover (`make -f deploy/cutover/operator.mk run`), which would also change the
  live database name;
- never set `PREPROD_CD_ENABLED` to false: it re-arms the legacy main->prod path.

L2:
1. Pin the Service (no restart, no traffic change):
   `make -f deploy/cutover/operator.mk pg-switch TARGET=pg16 KUBECONFIG=$K ENV=preprod`.
   Check: `kubectl get endpoints radar-postgres` lists only `radar-postgres-0`.
2. Restart PG16 with logical decoding (about 30-60 s of database unavailability;
   only the args and the identical image digest change; the live requests drift of
   the StatefulSet is left as is):
   ```sh
   kubectl --kubeconfig $K -n radar-immobilier-preprod patch statefulset radar-postgres --type json -p '[
     {"op":"replace","path":"/spec/template/spec/containers/0/image","value":"postgis/postgis:16-3.4@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5"},
     {"op":"add","path":"/spec/template/spec/containers/0/args","value":["-c","wal_level=logical","-c","max_slot_wal_keep_size=2GB"]}]'
   kubectl --kubeconfig $K -n radar-immobilier-preprod rollout status statefulset radar-postgres --timeout=180s
   kubectl --kubeconfig $K -n radar-immobilier-preprod exec radar-postgres-0 -- psql -U radar -d postgres -Atc 'SHOW wal_level'   # logical
   ```
3. Create PG18 (PVC `pgdata-radar-pg18-0`, 4th PVC of the quota):
   ```sh
   kubectl --kubeconfig $K kustomize deploy/overlays/preprod-pg18 \
     | kubectl --kubeconfig $K -n radar-immobilier-preprod apply -f -
   kubectl --kubeconfig $K -n radar-immobilier-preprod rollout status statefulset radar-pg18 --timeout=300s
   kubectl --kubeconfig $K -n radar-immobilier-preprod logs radar-pg18-0 -c fs-probe   # type=xfs, reflink=yes
   kubectl --kubeconfig $K -n radar-immobilier-preprod get endpoints radar-postgres    # still radar-postgres-0 only
   ```
4. `make -f deploy/cutover/operator.mk pg-replicate KUBECONFIG=$K ENV=preprod`
   (initial copy of about 707 MB; re-run to keep waiting if it times out).
5. `make -f deploy/cutover/operator.mk pg-verify KUBECONFIG=$K ENV=preprod`: 100% of
   tables equal, privileges equal.

L2 rollback: `pg-replicate ABORT=1`, then
`kubectl delete statefulset radar-pg18`, `kubectl delete pvc pgdata-radar-pg18-0`,
`kubectl delete service radar-pg16 radar-pg18`,
`kubectl delete networkpolicy allow-postgres-to-postgres`. `wal_level` stays.

L3:
1. `pg-switch TARGET=pg18`; read `freezeSeconds` in ConfigMap `radar-pg-upgrade`
   (acceptance <= 60 s). Smoke the UI and MCP; `pg-reverse` exits 0; `pg-verify`.
2. Rollback rehearsal: `pg-switch TARGET=pg16`, smoke, `pg-verify`; then
   `pg-switch TARGET=pg18` again.
3. Measure the clone on PG18 (`CREATE DATABASE ... TEMPLATE radar_tpl STRATEGY
   FILE_COPY` once a template exists, with `df -B1` before/after) during the soak.

Failure handling: a subscription disabled by an apply error (for example a
migration applied to one side only) shows in `pg-reverse` / `pg-verify`. Apply the
same migration on the other side (the API migrator against that pod), then
`ALTER SUBSCRIPTION pgup_from_<side> ENABLE` on the subscriber. A failed `pg-switch`
prints its stage and restores the serving side; if it reports that the Service
already selects the target, re-run `pg-switch` with that target.

## Later lots (not in this change)

- L4: before the prod switch, move the remaining fixed `postgis/postgis:16-3.4` dump
  users (both prod backup CronJobs, `db-ro-role-provision`, served-refs) to the
  serving-major rule or to the 18 digest at the switch: pg_dump 16 refuses a PG18
  server, and pg_restore 18 cannot restore into PG16.
- L5: production, same verbs after a PR sets `prod.pgUpgrade: true`.
- L6: `pg-replicate ABORT=1`, scale `radar-postgres` to 0, keep its PVC 7 days,
  make PG18 canonical in the manifests (Service selector, single StatefulSet).

## Local stacks

`docker-compose.yml` (dev, test, e2e) now runs PG18 on a new volume
`postgres18-data`; the PG16 dev volume `postgres-data` is left untouched. To carry
the root UAT data over, the owner dumps it with the PG16 image before switching the
root checkout (`make db-backup ENV=dev`), then restores it on the new stack
(`make db-restore SQL=backups/dev-<timestamp>.sql ENV=dev`; the PG18 init script
already created the PostGIS extensions in the new database, so the plain dump
reports "already exists" for them and loads the rest).

Tests: `make -f deploy/cutover/operator.mk test-pg ENV=test-cutover` runs the
verbs on a real PG16 and PG18 (real migrations, live writes, switch, reverse
replication, rollback, second switch, abort cleanup; pg_dump 16 archives restored by
pg_restore 18 into PG18, direct and streamed; the PG16 restore failures above are
printed as `observed`).
