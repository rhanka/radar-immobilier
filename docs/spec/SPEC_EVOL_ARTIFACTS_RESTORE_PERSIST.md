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
  state restore, row counts, then byte fingerprints. No `--map` means
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

## 3. Restore-path integration (`deploy/cutover/atomic-restore.sh`)

Opt-in via `CATALOGUE_DIR` (+ `CATALOGUE_SCRIPT`, optional `CATALOGUE_MAP`).
Unset keeps the historical behavior byte-for-byte.

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

- Lot 3 — Durable BHS copy: upload the sealed export to the preprod
  recovery bucket (existing `s5cmd` `UPLOAD_IMAGE`, no new image) before
  any reset, with read-back verification; retention pins vs GC.
- Lot 4 — Blue/green (#956) and PG18 reuse: prepared-database import path
  qualification, candidate reader-only preview composition,
  generation-bound grants.
- Lot 5 — Supervised manual restore + campaign: conductor runbook with
  witness artifact; green campaign (restore, rotation, rollback-after-
  writes, storage failures).
