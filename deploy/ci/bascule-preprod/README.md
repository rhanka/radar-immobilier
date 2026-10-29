docs objects, served code; `*` = latest complete), printed in the log and the step
summary, and uploaded as artefact `backup-list-immo-<CYCLE_ID|run_id>`
(`backup-list.json`, format `radar-backup-list/v1`).

### How the runner learns D without touching S3

The runner stays kubectl-only (0 S3 credential). Each backup Job writes its
verdict JSON (≤ 4 KiB: dates, statuses, sizes, sha256, counts — never a doc key,
a row or a credential) to its container **termination message**; the runner reads
it from the pod `.status` (`kubectl get pods -l job-name=<job> -o json`), never
`kubectl logs`, and **only from the pods of the Job instance it just created**
(uid read after the apply; a pod is kept when its controller ownerReference or its
`controller-uid` label carries that uid — a pod of a deleted previous instance of
the same Job name is never read; no uid ⇒ no verdict). A refusal reason (e.g. stale
backup) is printed from there.

`MODE=list` limit: the list travels in that termination message (≤ 4 KiB), so it
holds the **newest ~15 dated backups** (`truncated: true` beyond; the retention
keeps at most 16 visible, `../backup/RETENTION.md`). A date older than the listed
window cannot be confirmed from the list: the e2e orchestrator refuses it cleanly
(it asks for a date inside the window); a standalone `MODE=restore BACKUP_ID=<date>`
still resolves any date directly from `manifests/<date>.json`.

### Identities, Secrets, RBAC, network (what k8s provides)

Dedicated preprod identities (created and tested by the k8s lane 2026-09-26).
**OVH:** `s3:GetObjectVersion` is refused in OVH policies — a versioned read is a
`GetObject` / `CopyObject` with `versionId`, covered by `GetObject`; nothing here
relies on a distinct version permission.

| Item | Where | Content | Used by |
| --- | --- | --- | --- |
| Secret **`radar-backup-reader-preprod`** (OVH user 809853) | ns `radar-immobilier-preprod`, pre-created Opaque | keys `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_BUCKET` (= `radar-immobilier-backup`); `GetObject` on `pg/*`, `manifests/*`, `docs-inventory/*` + `ListBucket` (`docs/` → 403) | R0, list, S2 fetch, S3'/S3b' manifest + inventory |
| Secret **`radar-backup-restore-docs`** (OVH user `radar-backup-restore-preprod`, 809849) | ns `radar-immobilier-preprod`, pre-created Opaque | same keys; `GetObject` on `radar-immobilier-backup/docs/*` (+ version listing when granted), `ListBucket` + `GetBucketLocation` + `PutObject` + `PutObjectAcl` on the preprod docs bucket, no delete (k8s check 2026-09-26: effective policy + real LIST 200) — the versioned `CopyObject` with `GrantFullControl` answers 200 | S3' (signer of the copies), S3b' (preprod listing) |
| their material | GitHub environment **`radar-bascule`** (main-only): `RADAR_BACKUP_READER_PREPROD_ACCESS_KEY`/`_SECRET_KEY`, `RADAR_BACKUP_RESTORE_DOCS_ACCESS_KEY`/`_SECRET_KEY` (+ `.env` recovery copy; rotation 90 days, `CRED_CYCLE.md`) | **rewritten by the bascule** before first use (step "Write backup Secrets", `ci-secrets.mjs`): `kubectl replace --dry-run=server` then `kubectl replace` on the pre-created Secrets — never `create`/`apply` (RBAC by resourceNames), never a SealedSecret; keys guarded `^[0-9a-f]{32,64}$`, `BACKUP_BUCKET` = fixed var value | bascule job |
| RBAC `radar-ci-bascule-preprod` | `rbac-ci-bascule-preprod-docs-secret.yaml` | secrets get/update on `radar-docs-src-preprod`, `radar-backup-reader-preprod`, `radar-backup-restore-docs`; configmaps get on `immo-served-refs-0..3` | Secret writes, e2e O1 |
| RBAC `radar-ci-bascule-preprod` | `rbac-ci-bascule-preprod-pods-read.yaml` | `pods` get/list (read the termination messages) — no `pods/log` | R0, list, failure reasons |
| SA `radar-bascule-refs-writer` + 4 ConfigMaps | `rbac-ci-bascule-preprod-docs-secret.yaml`, `served-refs-configmaps.yaml` | configmaps get/update on `immo-served-refs-0..3` (pre-created, create is not name-scopable) | e2e O1 served-refs Job |
| NetworkPolicy | ns `radar-immobilier-preprod` | the restore Jobs carry `sentropic.io/bascule` → `radar-postgres:5432` already open by `allow-bascule-to-postgres`; **egress**: no egress policy today; if one is added, the pods labelled `sentropic.io/bascule` need TCP 443 to the S3 endpoint (`s3.bhs.io.cloud.ovh.net`) + DNS, and the served-refs pod the API server | all backup Jobs |

Repo variables (optional): `BASCULE_BACKUP_BUCKET` (`radar-immobilier-backup`),
`BASCULE_BACKUP_READER_SECRET` (`radar-backup-reader-preprod`),
`BASCULE_BACKUP_DOCS_COPY_SECRET` (`radar-backup-restore-docs`, no fallback on the
reader), `BASCULE_BACKUP_MAX_AGE_HOURS` (24).

### e2e contract (`CYCLE_ID` set)

- **O1 — zone references immo holds (decision: no HTTP endpoint).** After S7,
  step `served-refs` dispatches the Job `radar-bascule-served-refs`: `extract`
  (psql, `default_transaction_read_only=on`) reads the RESTORED preprod database —
  canonical zone ids referenced by `geo_resolutions` (`target_type = 'Zone'`),
  `opportunity_dossiers.zone_canonical_id`, `constraint_hits` (`target_kind =
  'zone'`) and the current `zone_versions` referential — and outputs the distinct
  `(city_slug, zone_code)`: `zone_versions.city_slug` + `code_affiche` when the
  canonical id is known there, else parsed from `ogc:zones:<city>:<code>`. **Fact:
  immo does not persist the raw OGC zone code** (`code_affiche` holds
  `normalizeZoneCode(raw)`), so the geo builder re-canonicalises immo's normalised
  code; a residual divergence of that lossy step shows up as `divergent-code`.
  `publish` (served-refs.cjs) gzips the TSV (a few hundred KiB expected) and
  rewrites the pre-created ConfigMaps `immo-served-refs-0..3` (≤ 900 KiB each) with
  the SA `radar-bascule-refs-writer`; the runner reads them (configmaps get),
  checks CYCLE_ID + sha256 + row count and uploads `immo-served-refs-<CYCLE_ID>`.
- `MODE=restore|chain`: job `served-ids` (no cluster credential) builds
  `immo-served-canonical-ids-<CYCLE_ID>` (`served-ids.txt` + `.sha256` + meta, zone
  ids through the published `@sentropic/geo@0.6.2`, same pin as the geo leg) from
  that artefact; job `cycle-leg` (always) publishes `cycle-leg-immo-<CYCLE_ID>`
  (`legs.immo`: run, sha, MODE, backup id/date/manifest+dump sha256, `t1` = backup
  dump start, verdict pg/s3).
- `MODE=list`: artefact `backup-list-immo-<CYCLE_ID>`.
- The run name is `bascule-preprod <MODE> <CYCLE_ID>` (orchestrator correlation).

## Lancer une sous-commande à la main (hors workflow)

```bash
# mêmes variables d'env que le workflow (voir matrice) — 0 cred S3/DB runner
node deploy/ci/bascule-preprod/bascule.mjs preflight
node deploy/ci/bascule-preprod/bascule.mjs precheck-runs --prod   # Job advisory (PROD_DOCS)
node deploy/ci/bascule-preprod/bascule.mjs precheck-runs          # Job gate (PREPROD_DOCS)
node deploy/ci/bascule-preprod/bascule.selftest.mjs               # self-test classifyJobStatus (0 appel réel)
node deploy/ci/bascule-preprod/restore-mode.selftest.mjs          # MODE=restore|list + docs-sync Secret + e2e (offline)
```
