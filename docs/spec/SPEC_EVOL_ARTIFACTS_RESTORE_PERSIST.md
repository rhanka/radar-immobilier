# SPEC_EVOL — Preprod Artifact Catalogue Preservation Across Restores (D2 = C)

Status: evolving (L0+L1 implemented, Lots 3-5 pending). Owner decision 2026-11-02:
D2 = C — before the prod→preprod restore drops/replaces the database, take a
consistent export of the preprod-only artifact catalogue, then re-import it
integrated into the restore engine after the restore and before reopening.
Same mechanism reusable by the blue/green cutover (#956) and the PG18 upgrade.
Authenticated preview on the candidate.

Retained design: `design-transition-astra-full.md` (lots L0-L6, early gate,
pre-mortem). Dissent incorporated from `design-transition-muse.md`: the
export doubles as the safety net, and the restore path refuses to proceed
when the catalogue cannot be preserved.

## 1. What survives

Every durable table under `artifacts.*` (discovered from the PostgreSQL
catalogue at export time, minus the ephemeral list below), with:

- artifact and release UUIDs byte-identical (stable and pinned URLs keep
  resolving: `https://<artifact-uuid>.preprod.immo-pages.sent-tech.ca/`,
  `https://<release-uuid>.pinned.preprod.immo-pages.sent-tech.ca/`);
- release manifests byte-identical (content-addressed blobs in S3 OVH BHS
  stay reachable via the manifest → digest mapping);
- `artifact_current` pointers, ACL (`artifact_access`), sources, blob
  registry and pins, idempotency receipts, quotas and policies, delete
  confirmations.

Ephemeral state is deliberately NOT transferred (recorded in the manifest
with row counts as justification): `reader_tickets`, `uploads`,
`object_intents`, `host_failures`, `host_actor_rate`. Reader sessions and
capabilities from the old generation are never valid in the new one;
readers re-authenticate after promotion.

## 2. Tool contract (`deploy/cutover/artifacts-catalogue.sh`)

Stack: shell + `pg_dump` / `pg_restore` / `psql` / `sha256sum` only.
No other runtime, no cluster access, no environment files.

- `gate --target-db NAME [--max-bytes N] [--max-rows N] [--map FILE]` →
  JSON verdict `GO` / `NO-GO` (exit 0/1). Refuses prod-like names, same
  source/target, missing `artifacts` schema, in-flight `pending` intents,
  over-budget catalogues, and subjects without explicit mapping.
- `export --out-dir DIR [--scope SCOPE]` → sealed directory: `data/*.copy`
  (deterministic `COPY ... ORDER BY` dumps, `UTC`/`ISO`), `journal.tsv`
  (migration hash set), `subjects.tsv` (referenced subjects + preprod
  approval), `digests.txt`, `fingerprints.tsv`, `manifest.json`,
  `manifest.sha256`. Refuses on pending intents, out-of-schema FKs,
  sequences in `artifacts.*`, or non-catalogue data in the archive.
- `import --in-dir DIR [--map FILE] [--report FILE] [--allow-same-db]` →
  single-transaction load (coprocess-driven; any mismatch rolls back):
  checksum chain, journal equality, per-table column equality, trigger
  state restore, then the union accounting of §2b. No `--map` means
  unattended: missing subjects are created `pending`, never `approved`.
- `verify --in-dir DIR` → byte-level proof the live catalogue matches the
  manifest (row counts + fingerprints + journal).
- `manifest-check`, `map-check` → file-only gates (no database).

Schema-version awareness: the target must carry exactly the export's
migration hash set and column shapes. A newer export on an older target
(or the reverse) refuses instead of dropping or inventing columns.
Timestamps of migration application are ignored (prod and preprod apply
the same release at different times).

Identity reconciliation: artifact UUIDs and TEXT subject references are
kept verbatim. Referenced subjects resolve to target accounts by `sub`;
missing ones are created with a FRESH uuid (never by reassigning a uuid
the restored data references). A subject `rejected` in the target while
`approved` in the export refuses the whole import. Memberships are never
copied; they are reported for the operator. Explicit `--map` restores
approvals under supervision; without it no approval is ever minted.

## 2b. Union with the prod catalogue (owner rule 2026-11-15)

The prod-to-preprod restore must not overwrite preprod artifacts and must
import the prod ones: the result is the UNION of the replayed prod catalogue
and the sealed preprod export. The import is a union, not a replacement:

- A preprod row identical to a live row (same values, identity columns
  ignored) is already there: counted `same`. Prod rows carried by an earlier
  restore therefore never duplicate; repeated restores are idempotent.
- A preprod-only row is inserted. Identity columns (event logs) take a fresh
  value after the prod sequence, never a prod id.
- Collision = the preprod row hits ANY unique key of a different live row:
  same artifact or release UUID, same `(storage_scope_id, owner_id,
  binding_name)` (the artifact slug), same staged path, etc. PROD WINS: the
  live row stays, the preprod row is not loaded and is journaled in
  `conflicts.tsv` (`table`, `collision:prod-wins`, full row as JSON). No rename:
  a renamed artifact would need a cascaded remap of every child; the journal
  plus the sealed export keep the preprod version recoverable.
- Orphan = a preprod row whose catalogue parent is absent from the live
  database (the parent lost a slug collision, or lives in an ephemeral
  table). It is journaled as `orphan:<parent>`, never loaded dangling:
  foreign keys stay enforced during the load (`DISABLE TRIGGER USER` only).
  A preprod child of a parent that lost an id collision attaches to the prod
  parent (same id), so it is kept.
- Invariant per table before COMMIT: exported = same + inserted + collisions
  + orphans (`union.tsv`). Post-commit `verify --union` proves every exported
  row is live or journaled. Byte-for-byte `verify` still holds when the prod
  catalogue is empty.

S3 blobs: keys are `artifacts/<scope>/blobs/sha256/<digest>` (content
addressed). They do NOT live in the docs bucket: source-declared config gives
prod `ARTIFACTS_S3_BUCKET=radar-immobilier-artifacts`, scope `radar-immobilier`
(`deploy/k8s/30-api.yaml`) and preprod `radar-immobilier-artifacts-preprod`,
scope `radar-immobilier-preprod` (`deploy/overlays/preprod/patch-artifacts-control.yaml`).
Consequences:

- Preprod blobs: no restore step writes or deletes in the preprod artifacts
  bucket, so preprod-own rows keep their blobs.
- Owner decision 2026-11-15: copy the files and move to the preprod scope.
  The `catalogue` Job first runs the `blobs` init container
  (`deploy/cutover/artifacts-blobs.sh`, s5cmd): it lists
  `artifacts/radar-immobilier/blobs/sha256/` of the prod bucket and
  `artifacts/radar-immobilier-preprod/blobs/sha256/` of the preprod bucket and
  copies only the missing names (`cp -n`, content addressed: same name = same
  bytes). No delete; the prod bucket is only listed and read. Guards: the
  destination differs from the source, ends in `-preprod` and is not in
  `FORBIDDEN_DST_BUCKETS` (prod artifacts, prod documents, prod recovery,
  backup buckets); the render refuses outside preprod.
- Then `import-stash --rewrite-from radar-immobilier --rewrite-to
  radar-immobilier-preprod`: every `artifacts.*` row of the prod scope moves to
  the preprod scope in one transaction (foreign keys on `storage_scope_id`
  dropped and re-created, validated), BEFORE the union. Blob keys follow the
  scope. Content URLs derive from the artifact or release UUID and the
  environment content base, so they need no rewrite. JSON values embedding the
  scope (receipts, signed bodies) are left unchanged. Scope configuration stays
  the preprod one: the preprod `storage_scopes` row comes from the export,
  prod `host_policy` and `host_quotas` rows are dropped and the preprod ones
  return with the union.
- After the rewrite, a slug collision `(storage_scope_id, owner_id,
  binding_name)` between a prod row and a preprod-own row is possible: prod
  wins and the preprod row is journaled, like a UUID collision.
- Blob check (`blob-check`), before the union and again after it: every
  `sha256:` digest of the releases of visible artifacts (lifecycle not
  deleted/purged, release not purged) of the preprod scope must be in the
  preprod bucket listing taken by the init container, else the Job refuses.
- The docs restore Job (#1113) mirrors only `graph/` and `refresh/018/` of the
  docs bucket; a hermetic test pins `artifacts/` outside its mirror prefixes.

Coherence gate (#1113): the import only adds rows under `artifacts.*`; it
writes nothing in S3 and nothing the gate reads (pinned dump, docs, recon of
`graph/` and `refresh/018/`), so it is compatible with the gate.

## 3. Restore-path integration (`deploy/cutover/atomic-restore.sh`)

Opt-in via `CATALOGUE_DIR` (+ `CATALOGUE_SCRIPT`, optional `CATALOGUE_MAP`).
Unset keeps the historical behavior byte-for-byte.
Wiring (2026-11-15, preprod only): the `restore` Job embeds the catalogue
script and sets `CATALOGUE_DIR`, `CATALOGUE_STASH=1`; the export is stashed in
schema `catalogue_stash` of the restored database; the `catalogue` Job
(`deploy/cutover/catalogue-import-job.tmpl.yaml`) imports it in union after the
coherence gate and the migrations (`ddl`, `data`), in `MODE=restore` and in
`prepare`. A target newer than the export (journal superset) is accepted:
export columns must exist, new columns take defaults. Conflicts persist in
`catalogue_journal`. Operator guide: `deploy/cutover/README.md`.

- Live restore: fresh export before the schema reset, import after the
  replay, before any reopening.
- Prepared-database restore (`TARGET_DB`, blue/green candidate): a fresh
  export is REFUSED — the candidate is never the export source. The engine
  must pre-seal an export from live and the hook reuses the sealed
  generation (`already sealed, reusing ...`).
- A sealed export whose `manifest-check` fails is discarded and re-taken
  (live path) or refused (prepared path). Import failures roll back the
  catalogue load; the replayed prod data stays in place for diagnosis.

Ordering note: when the replayed prod dump predates the export's schema
version, run the engine `ddl` step first, then import the sealed export
against the migrated target. The import's exact-match column gate makes
silent drift impossible.

## 4. Verification

- Hermetic (`operator.mk test`): registry completeness over every
  schema/database drop in executable sources, forbidden-dependency scan,
  manifest tamper refusal, map validation, URL derivation anchors.
- Real PostgreSQL (`operator.mk test-api`,
  `deploy/cutover/artifacts-catalogue-persist.test.sh`): prod-like dump
  replayed through `atomic-restore.sh` + hook; witness artifact (releases,
  current pointer, ACL, sources, receipts, quotas, delete confirmation,
  blob registry + pin, stable/pinned URLs) verified byte-for-byte;
  unattended import lands subjects `pending` with a reconciliation report;
  supervised `--map` restores approvals; revoked-identity divergence
  refuses with prod replay intact; 0028/0029 drift refused both
  directions; in-flight intents block export; prod-named databases are
  never touched; source and prod origins unmutated. Prepared-database
  rehearsal included (refusal without pre-seal, witness survival with
  pre-sealed export from live).

## 5. Remaining lots

- Lot 3 — Durable BHS copy: `archive` subcommand uploads the sealed export
  to the preprod recovery bucket (existing `s5cmd`, no new image) and
  proves the read-back (object count + generation id); only sealed exports
  upload, prod-looking buckets refuse. Engine Job wiring (archive step
  before any reset, seven-day retention, GC pins) follows with a scope
  exception for the new Job template; the live-bucket campaign in Lot 5
  qualifies the real round-trip.
- Lot 4 — Blue/green (#956) and PG18 reuse: prepared-database import path
  qualification, candidate reader-only preview composition,
  generation-bound grants.
- Lot 5 — Supervised manual restore + campaign: conductor runbook with
  witness artifact; green campaign (restore, rotation, rollback-after-
  writes, storage failures).
