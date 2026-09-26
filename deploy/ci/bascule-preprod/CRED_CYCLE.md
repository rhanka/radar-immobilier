# Bascule prod — credential cycle (governance record)

The bascule prod bundle references two k8s Secrets by NAME. **CD-native v2:** their
material is committed as **SealedSecrets** (encrypted, safe in git —
`radar-db-ro-prod-sealed.yaml`, `radar-pra-admin-prod-sealed.yaml`) and materialized
in-cluster by the sealed-secrets controller. **No plaintext is ever committed and
no GH secret carries these creds anymore** — the pipeline applies the SealedSecret
manifests (`bascule-bundle-cd.yml`) and the controller decrypts. A `.env` copy stays
the étape-1 recovery convenience per the governed k8s↔immo cred cycle (CLAUDE.md).
i-cond (immo) holds this record so recovery is verifiable at any time — no per-act owner GO.

**Scope of the SealedSecret model: these two bundle Secrets only.** The daily prod
backup identities (last section) follow the owner rule "no SealedSecret committed":
their source of truth is a GitHub Environment + `.env`, and the CD writes them.

## Minted secrets (ns radar-immobilier, materialized at GO by the k8s lane)

| secret (k8s name, hyphen) | keys | consumer | source |
| --- | --- | --- | --- |
| `radar-db-ro-prod` | `POSTGRES_USER=radar_db_ro_prod`, `POSTGRES_PASSWORD=<openssl rand>`, `POSTGRES_DB=radar` | CronJob dump (pg_dump RO) + Job `db-ro-role-provision` (`RO_PASSWORD`) | generated (openssl) |
| `radar-pra-admin-prod` | `S3_ACCESS_KEY`, `S3_SECRET_KEY` | CronJob dump upload (S3 PutObject → backups bucket) | `.env` (radar-pra-admin AWS_*) |

**Naming (do not conflate):** the SECRET object name is hyphenated (`radar-db-ro-prod`,
RFC1123); the PG ROLE name and the `POSTGRES_USER` VALUE are underscored
(`radar_db_ro_prod`). `db-ro-role-provision.yaml` sets the role password from
`radar-db-ro-prod/POSTGRES_PASSWORD` via psql `\getenv` (never in argv/logs;
`log_statement=none` measured in prod → the plaintext `ALTER ROLE` is not logged).

## Rotation
- `radar-db-ro-prod`: regenerate password (openssl) → update secret → re-run the
  idempotent `db-ro-role-provision` Job (its `ALTER ROLE` re-asserts the new password)
  → `.env` backup. No app impact (dump-only role).
- `radar-pra-admin-prod`: rotate the underlying radar-pra-admin S3 key → update secret.

## Verify recovery (any operator/owner/AI, no owner GO)
1. secrets present: `kubectl -n radar-immobilier get secret radar-db-ro-prod radar-pra-admin-prod`.
2. role usable: dump CronJob's last Job `.status` = Complete (or a psql login as
   `radar_db_ro_prod` with the secret password succeeds).
3. `.env` holds the current values (backup) at the documented owner location.

Committing the secrets to git as SealedSecrets = **étape-2, DONE** (v2). The
encrypted SealedSecrets are the committed source; the sealed-secrets controller is
the materializer; `.env` remains a recovery copy (not a pipeline dependency), and
this record documents the rotation cycle.

## Daily prod backup identities (deploy/ci/backup/)

| secret (k8s name) | keys | GitHub source (Environment `radar-backup-prod`) | consumer | rights |
| --- | --- | --- | --- | --- |
| `radar-backup-writer` | `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_BUCKET`, `SOURCE_DOCS_BUCKET` | secrets `RADAR_BACKUP_WRITER_ACCESS_KEY`, `RADAR_BACKUP_WRITER_SECRET_KEY` | CronJob `radar-backup-daily`, step `backup` | read `radar-immobilier-docs`; backup bucket Put/Get/List/multipart; **no delete of any kind** |
| `radar-backup-purger` | `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_BUCKET` | secrets `RADAR_BACKUP_PURGER_ACCESS_KEY`, `RADAR_BACKUP_PURGER_SECRET_KEY` | CronJob `radar-backup-daily`, step `purge` | DeleteObject without VersionId (delete-marker) restricted by ARN to `pg/*`, `manifests/*`, `docs-inventory/*` + ListBucket/GetBucketLocation; no GET, no PUT, nothing on `docs/`; no DeleteObjectVersion, no BypassGovernanceRetention |
| `radar-backup-reader` | `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_BUCKET` | secrets `RADAR_BACKUP_READER_ACCESS_KEY`, `RADAR_BACKUP_READER_SECRET_KEY` | CronJob `radar-backup-freshness`; restores (`deploy/ci/backup/RESTORE.md`) | backup bucket GetObject (incl. versionId), ListBucket, ListBucketVersions |

Shared keys come from the Environment variables `BACKUP_S3_ENDPOINT` (→ `S3_ENDPOINT`,
exactly `https://s3.bhs.io.cloud.ovh.net`),
`BACKUP_S3_REGION` (→ `S3_REGION`, exactly `bhs`), `BACKUP_BUCKET` (→ `BACKUP_BUCKET`,
`radar-immobilier-backup`) and `BACKUP_SOURCE_BUCKET` (→ writer `SOURCE_DOCS_BUCKET`,
`radar-immobilier-docs`).

**Source of truth: GitHub Environment `radar-backup-prod` + `.env`. No SealedSecret,
nothing committed.** The k8s lane creates the Environment (deployment branch policy
`main` only, no required reviewer), sets its 6 secrets and 4 variables, and keeps the
same values in its `.env` recovery copy at the documented owner location. The three
k8s Secrets (ns `radar-immobilier`, type `Opaque`) are pre-created by the k8s lane;
`bascule-bundle-cd.yml` job `apply-backup` rewrites them from GitHub at every run
(`kubectl replace`: exact key set, no `last-applied-configuration` copy of the values).
The SA `radar-ci-bascule-prod` holds get/update on these three names only (server-side dry-run of the three before any write) — no
create, patch, list, watch or delete on Secrets.

**Rotation: every 90 days** (and at once on suspected exposure), one identity at a time:

1. k8s lane: re-POST `s3Credentials` for the OVH user of the identity (new access
   key + secret; the old credential stays valid for now).
2. k8s lane, same moment: set the new values in the GitHub Environment
   (`gh secret set RADAR_BACKUP_<WRITER|PURGER|READER>_ACCESS_KEY --env radar-backup-prod
   --repo rhanka/radar-immobilier`, same for `_SECRET_KEY`; single-line values of the expected charset/length — the CD
   refuses any other) **and** in the `.env` recovery copy.
3. `workflow_dispatch` of `bascule-bundle-cd` (no `backup_run_now` needed): `apply-backup`
   rewrites the Secret; its log shows `secret/radar-backup-<id> replaced from GitHub — keys: …`.
   No PR, no commit.
4. Verify with the NEW credential:
   - writer: one backup run (next night, or `workflow_dispatch` input
     `backup_run_now=true` outside 02:00–05:30 UTC) → step `backup` exits 0,
     `manifests/latest.json` date = today and `status: complete`;
   - purger: the step `purge` of a run whose plan holds at least one key (most
     days: the day leaving the daily window) logs `PURGE OK … delete_markers=N`
     with N > 0;
   - reader: `radar-backup-freshness` logs `FRESHNESS OK`, plus a restore check
     of that backup (`RESTORE.md` §0–1: download `pg/D/radar.dump`,
     `sha256sum -c` OK, `pg_restore --list` lists).
5. Only after the checks of that identity pass (for the writer: backup AND a
   restore check with the reader): k8s lane deletes the old credential of that user.
6. Record the rotation date (next due = +90 days).

Verify recovery at any time (any operator/owner/AI, no owner GO):
- `gh secret list --repo rhanka/radar-immobilier --env radar-backup-prod` lists the 6
  secrets and `gh variable list --repo rhanka/radar-immobilier --env radar-backup-prod`
  the 4 variables; the `.env` copy holds the same values;
- `kubectl -n radar-immobilier get secret radar-backup-writer radar-backup-purger
  radar-backup-reader`; the last `apply-backup` run is green;
- last `radar-backup-daily` and `radar-backup-freshness` Jobs `Complete`;
  `manifests/latest.json` fresh.

## Preprod restore-from-backup identities (bascule `MODE=restore|list`)

Dedicated preprod identities, created and tested by the k8s lane (2026-09-26).
Each k8s Secret is **pre-created** (Opaque, no ownerReference, keys
`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_BUCKET`) in ns `radar-immobilier-preprod`
and **rewritten by the bascule** at every `MODE=restore|list` run from the secrets
of the GitHub environment `radar-bascule` (main-only): `kubectl replace
--dry-run=server` then `kubectl replace` (CI SA `radar-ci-bascule-preprod`:
secrets get/update by resourceNames only; never create/apply; never a
SealedSecret). `BACKUP_BUCKET` is the fixed value `radar-immobilier-backup`.

| secret (k8s name) | OVH user | GitHub secrets (env `radar-bascule`) | scope |
| --- | --- | --- | --- |
| `radar-backup-reader-preprod` | 809853 | `RADAR_BACKUP_READER_PREPROD_ACCESS_KEY`, `RADAR_BACKUP_READER_PREPROD_SECRET_KEY` | backup bucket: GetObject on `pg/*`, `manifests/*`, `docs-inventory/*` + ListBucket; `docs/` → 403; no write, no delete |
| `radar-backup-restore-docs` | `radar-backup-restore-preprod` (809849) | `RADAR_BACKUP_RESTORE_DOCS_ACCESS_KEY`, `RADAR_BACKUP_RESTORE_DOCS_SECRET_KEY` | backup bucket: GetObject on `docs/*`; preprod docs bucket `radar-immobilier-docs-preprod`: ListBucket + GetBucketLocation (preprod listing of S3'/S3b') + PutObject + PutObjectAcl (versioned CopyObject with GrantFullControl), no delete |

OVH: `s3:GetObjectVersion` is refused in policies; a versioned read (GetObject /
CopyObject with `versionId`) is covered by GetObject.

k8s check 2026-09-26 (effective policy + real tests 7/7): `radar-backup-restore-preprod`
has ListBucket + GetBucketLocation on the preprod docs bucket (real LIST 200) and no
delete of any kind. The docs-sync identity held by `radar-docs-src-preprod`
(`radar-docs-sync` in the k8s check; older bascule docs name it `immo-docs-prod`) is
read-only on the prod docs bucket (PUT, DELETE and PUT `?acl` answer 403) and writes
without delete on the preprod docs bucket.

**Rotation: every 90 days** (and at once on suspected exposure), one identity at a time:

1. k8s lane: new `s3Credentials` for the OVH user (the old one stays valid for now).
2. Update locations 1 to 3 by hand (section "Where every bascule key lives" below): the two
   GitHub secrets of that identity in the environment `radar-bascule`, the central `.env`,
   the immo `.env`.
3. Verify with the NEW credential: a `bascule-preprod.yml` run `MODE=list`
   (reader: step "Write backup Secrets" rewrites the k8s Secret and is green, then the
   backup list printed) and a `MODE=restore` `DRY_RUN=true` run (copy signer: the docs plan
   of S3' green).
4. Only then: k8s lane deletes the old credential; record the date (next = +90 days).

Verify recovery at any time: `kubectl -n radar-immobilier-preprod get secret
radar-backup-reader-preprod radar-backup-restore-docs` (present, 3 keys), last
`MODE=list` run green.

## Where every bascule key lives (4 locations) and how to rotate it

Identities serving the bascule (written by the bascule job itself). Each key lives in **four
places**; the `.env` variable names are the GitHub secret names:

1. the GitHub Environment secret (`radar-bascule`; the prod backup identities above belong
   to `radar-backup-prod` once they leave SealedSecrets);
2. the central `.env` `/home/antoinefa/src/sentropic/.env` — source of the mint scripts,
   referenced by the k8s-ops registry;
3. the tenant `.env` `/home/antoinefa/src/radar-immobilier/.env` (recovery copy; perms 600,
   ignored by git);
4. the k8s Secret (ns `radar-immobilier-preprod`), rewritten from (1) by the bascule
   (`ci-secrets.mjs`, `kubectl replace --dry-run=server` then `replace`) — never edited by hand.

| identity (OVH user) | OVH user id | (1) GitHub secrets — Environment | (4) k8s Secret — ns | rewritten by | rotation due |
| --- | --- | --- | --- | --- | --- |
| `radar-backup-reader-preprod` | 809853 | `RADAR_BACKUP_READER_PREPROD_ACCESS_KEY`, `RADAR_BACKUP_READER_PREPROD_SECRET_KEY` — `radar-bascule` | `radar-backup-reader-preprod` — `radar-immobilier-preprod` | bascule `MODE=list|restore` | before 2026-12-25 |
| `radar-backup-restore-preprod` | 809849 | `RADAR_BACKUP_RESTORE_DOCS_ACCESS_KEY`, `RADAR_BACKUP_RESTORE_DOCS_SECRET_KEY` — `radar-bascule` | `radar-backup-restore-docs` — `radar-immobilier-preprod` | bascule `MODE=restore` | before 2026-12-25 |
| `radar-docs-sync` / `immo-docs-prod` (docs-sync of the chain S3; read-only prod docs, write without delete preprod docs) | à compléter (registre k8s) | `RADAR_DOCS_SYNC_ACCESS_KEY`, `RADAR_DOCS_SYNC_SECRET_KEY` — `radar-bascule` | `radar-docs-src-preprod` — `radar-immobilier-preprod` | bascule `MODE=chain` (step S0.s, before the quiesce; DRY: server dry-run only) | à compléter (registre k8s) |

(2) and (3) hold the same variable names for every row.

**Rotation procedure** (every 90 days, and at once on suspected exposure; one identity at a
time; the k8s lane first mints a new `s3Credential` for the OVH user, the old one staying
valid):

- mettre à jour 1 à 3 à la main ;
- le CD ou la bascule propage vers 4 ;
- vérifier le backup ou le restore suivant ;
- seulement alors, supprimer l'ancienne s3Credential OVH.
