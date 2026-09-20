# `deploy/ci/` — CD orchestration & mise-en-prod runbook

The CI-side helpers that `.github/workflows/build-push-images.yml` calls into
during a release, plus the **release sequence** each voie runs. The workflow is
the source of truth; this file documents the contract so a reader does not have
to reverse-engineer the YAML.

## Release sequence (per voie)

Every armed release path runs the same ordered, **fail-closed** sequence:

```
backup → migrate → set-image → assert
```

- **backup** — pre-migration snapshot (`run-db-backup.sh`, fail-closed). This is
  the rollback point. It runs **before** migrate on purpose: a snapshot taken
  after a migration is not a valid rollback target. This ordering is load-bearing
  for any future **destructive** migration — do not reorder.
- **migrate** — drizzle migrations (`node dist/db/migrate.js`, base manifest
  `deploy/k8s/36-db-migrate-job.yaml`), run as a Job pinned to the exact image
  the voie is about to deploy. Fail-closed: a failed or timed-out migration
  **aborts the release before set-image**, so no code ever rolls onto an
  un-migrated DB. Idempotent: the drizzle journal replays already-applied
  migrations as a no-op, so re-running a release re-runs migrate harmlessly.
- **set-image** — roll the Deployments to the released image (preprod: `<sha7>`
  tag; prod: immutable digest).
- **assert** — post-roll rollout/health checks already present in each job.

### Arming — the sequence runs **only WHEN ARMED**

Backup **and** migrate are gated on the **same** enable var per voie
(`BACKUP_BEFORE_RELEASE_ENABLED` for preprod, `BACKUP_BEFORE_RELEASE_PROD_ENABLED`
for prod). Two consequences:

- Migrate can never run without a fresh pre-migration backup preceding it — the
  shared gate is what guarantees the rollback point.
- When the var is **not** `'true'`, the sequence above does **not** run: both
  backup and migrate are **skipped** and the deploy proceeds through the rest of
  its steps (reconcile / apply-mcp, then set-image) with no backup and no
  migration. For a release carrying a pending schema change (e.g. drizzle `0011`)
  that rolls new code onto an **un-migrated** DB. This staged arming is by design
  — prod ships **disarmed until the cutover**, so merging never arms prod as a
  side effect — but the skip is **never silent**: a disarmed run emits a loud
  `::warning::` (the `Warn if DB backup+migrate DISARMED …` step).

**Runbook — arm before a schema-change release:** set
`BACKUP_BEFORE_RELEASE_PROD_ENABLED = 'true'` (prod) or
`BACKUP_BEFORE_RELEASE_ENABLED = 'true'` (preprod) before promoting/deploying any
release that carries a pending migration, so backup+migrate actually run.

## Voies (jobs in `build-push-images.yml`)

| Job | Trigger | Namespace | Image pin | Migrate | Enable var (backup + migrate) |
|---|---|---|---|---|---|
| `deploy-preprod` | push `main` | `radar-immobilier-preprod` | `<sha7>` tag | ✅ *(when armed)* | `BACKUP_BEFORE_RELEASE_ENABLED` |
| `promote-prod` | tag `v*` | `radar-immobilier` | immutable **digest** | ✅ *(when armed)* | `BACKUP_BEFORE_RELEASE_PROD_ENABLED` |
| `deploy` *(legacy)* | push `main` | `radar-immobilier` | `<sha7>` tag | ❌ **by design** | — |

- **Preprod (`deploy-preprod`)** — gated by **two** switches: `PREPROD_CD_ENABLED
  == 'true'` arms the preprod voie itself, and `BACKUP_BEFORE_RELEASE_ENABLED ==
  'true'` arms backup+migrate within it. **When both are armed**, every push to
  `main` replays the migrations against preprod — the test-before-prod check: a
  migration that would break prod fails here first. (Voie armed but backup+migrate
  disarmed → a push deploys preprod without running migrate; see the Arming
  section above.)
- **Prod (`promote-prod`)** — a `v*` tag promotes the already-built,
  already-preprod-tested artifact to prod **by immutable digest** (the `<sha7>`
  tag may have aged out of the registry). The migrate Job is pinned to that same
  digest, so the migration and the deployed code are byte-identical. The
  `radar-immo-mcp` drift-heal apply (which pins `radar-api:latest` with a
  `Recreate` strategy, so it rolls MCP pods onto new code) runs **after** migrate
  and before set-image, so MCP is not rolled onto new code before this release's
  migrations are applied.
- **Legacy `deploy` (main→prod)** — the pre-cutover direct path. Superseded by
  `deploy-preprod` + `promote-prod` once `PREPROD_CD_ENABLED` is set. It carries
  **no migrate step by design**: it is a void path that must not be the one that
  migrates prod. Its gate is the inverse of the new path: if `PREPROD_CD_ENABLED`
  is ever unset/flipped off, legacy `deploy` **re-arms** and would roll `main→prod`
  with **no backup and no migrate** — so **removing the job is the durable fix**.
  **Follow-up (separate PR, at cutover): delete the legacy `deploy` job.** Until
  then it stays gated OFF by `PREPROD_CD_ENABLED`.

### Migrate Job mechanics

The migrate step overlays `deploy/k8s/36-db-migrate-job.yaml` with `kubectl
kustomize` at release time (the base is **copied into a tmpdir** so no
`--load-restrictor` flag is needed), overriding:

- `namespace` → the voie's namespace;
- `nameSuffix: -<sha7>` → a **per-sha Job name** (`radar-db-migrate-<sha7>`), so a
  re-deploy within the Job's `ttlSecondsAfterFinished` window does not collide
  with a lingering completed Job (a `delete --ignore-not-found` precedes the apply
  as a belt-and-braces);
- `images` → the exact release image (preprod: `newTag: <sha7>`; prod: `digest:
  <resolved digest>`).

The step then polls the Job: `Complete` → proceed; `Failed` or 600 s timeout →
`exit 1` (release aborts before set-image). The abort decision reads only `get
job` conditions — it does **not** depend on pod logs, so it is robust in both
voies.

A migration that *hangs* (a blocked `ALTER`/`CREATE INDEX`) is stopped for real,
not just abandoned by the poller, through two layers:

- the base Job carries `activeDeadlineSeconds: 540` (kept **below** the 600 s CI
  poll) so the cluster self-terminates the pod with `DeadlineExceeded` → `Failed`
  *before* the CI times out, giving the poll a clean condition to abort on;
- on either abort path the step also runs `kubectl delete job <name>
  --ignore-not-found` before `exit 1`, which requests deletion of the Job and its
  pod so the in-cluster work is torn down even if self-termination lags (subject
  to the pod's normal termination grace).

On failure the step also tries `kubectl logs job/<name> --tail=80` for inline
debugging, but this is **best-effort and voie-dependent**:

- **prod** (`promote-prod`) — there is no scoped prod deployer ServiceAccount;
  the job authenticates with an owner kubeconfig from an environment secret, a
  broad credential that can typically read pod logs, so the last 80 lines are
  usually dumped inline in the CI output.
- **preprod** (`deploy-preprod`) — `11-ci-deployer-preprod-rbac` **deliberately
  withholds `pods/log`** (least-priv: the runner cannot read Job pod logs), so the
  `logs` call is a guarded `|| true` no-op (HTTP 403). A failed preprod migration
  therefore dumps **no inline logs** in CI — the abort still fires correctly;
  debug from the owner-side cluster logs. This is by design; do not grant the
  preprod runner `pods/log` to get the inline dump, as that would weaken the
  least-priv posture `11-ci-deployer-preprod-rbac` deliberately took.

## Helpers in this directory

| File | Role |
|---|---|
| `run-db-backup.sh` | Renders + applies the backup Job, polls fail-closed, then prunes retention **chronologically** (by S3 date, never lexically by key) and **never** deletes the just-created backup. |
| `db-backup-job.tmpl.yaml` | Backup Job template consumed by `run-db-backup.sh`. |
| `rollback-release.sh` | Roll a Deployment back to a prior image. |
| `reconcile-preprod.sh` | Targeted server-side apply of preprod manifests. |
| `kfilter.py` | Manifest filter used by the reconcile step. |
| `*.test.sh` | Shell tests for the runners above. |

## Resumable whole-bucket inventory

Long MinIO inventories use a durable checkpoint while every attempt writes a
fresh report directory:

```text
migrate-object-storage.sh inventory <coordinates and classifications> \
  --report-dir report-01 --checkpoint-dir checkpoint \
  --page-size 100 --time-budget-seconds 300
migrate-object-storage.sh inventory <same arguments> \
  --report-dir report-02 --checkpoint-dir checkpoint \
  --page-size 100 --time-budget-seconds 300 --resume
```

Receipts cover the bucket root; prefixes classify keys but never limit listing.
Pages and body-evidence shards are hash-bound, atomically committed, and resumed
with exclusive `StartAfter` boundaries. Coordinates, identity fingerprints,
classification and limits are bound by `configDigest`. No credential or opaque
continuation token is persisted. Object keys are persisted, so checkpoint
custody is an operator responsibility.

After the provisional chain completes, repeat the same resumable inventory with
the validated writer-fence file. This builds a separate `fenced/` chain and
emits `final-inventory.json` only if both complete bucket observations are
stable. `toolComplete:true` never means the fence was validated:
`fenceValidated:false` remains explicit.

Every executed copy requires that final artifact and the same fence:

```text
migrate-object-storage.sh copy <same coordinates and classifications> \
  --report-dir copy-report --execute-copy \
  --fence-record writer-fence.txt \
  --inventory-proof checkpoint/final-inventory.json \
  --conditional-write-proof conditional-write-proof.json
```

The copy consumes the frozen manifests instead of relisting either bucket and
re-hashes each source body immediately before its conditional PUT. Source
versions and delete markers outside the current `ListObjectsV2` view remain out
of scope. The final inventory proof has no tool-enforced maximum age. Its
freshness therefore remains under conductor custody: retain the exact matching
fence evidence, independently confirm that the fence is still continuously
valid, and regenerate both inventory phases if custody or fence continuity is
uncertain. A structurally valid old proof is not fresh evidence by itself.

## Object-storage conditional-write gate

`migrate-object-storage.sh copy --execute-copy` requires
`--conditional-write-proof FILE`. The operator creates this JSON evidence from
a disposable-key probe against the exact destination, using the same migration
identity. The probe must prove both that a duplicate `If-None-Match: *` create
is rejected and that an update with a stale `If-Match` ETag is rejected:

```json
{
  "schemaVersion": 1,
  "provider": "provider implementation",
  "providerVersion": "observed version or release",
  "destination": {
    "endpoint": "https://s3.example.net",
    "region": "region",
    "bucket": "destination-bucket",
    "pathStyle": false
  },
  "identityFingerprint": "sha256-of-access-key-id",
  "observedAt": "2026-09-13T12:00:00Z",
  "expiresAt": "2026-09-14T12:00:00Z",
  "transcriptSha256": "64-lowercase-hex-characters",
  "capabilities": {"ifNoneMatchCreate": true, "ifMatchUpdate": true}
}
```

The tool validates the schema, exact destination tuple, identity fingerprint,
and a validity window of at most 48 hours before any destination write. It
records the proof digest and
`providerEnforcementValidated:false`: custody and validation of the probe
transcript remain conductor responsibilities. Missing, expired or mismatched
evidence is a `missingProof` and prevents every PUT.

The inventory covers current objects returned by `ListObjectsV2`. It does not
migrate source version history or delete markers; that boundary requires owner
acceptance before a real copy.

## Rollback

`rollback-release.sh` rolls the **image** back. A migration that must also be
undone is restored from the pre-migration **backup** taken by the `backup` stage
of that release (see the sequence above) — which is exactly why backup precedes
migrate. Retention prune orders candidates by **S3 object date** (chronological),
not by key name (a name sort of `<env>-<sha>-<ts>` is dominated by the random
`<sha>`, so it is not time-ordered), and it excludes the current key — so the
freshly-created pre-migration backup can never be pruned in the same run that
made it.

**Count contract:** `BACKUP_RETAIN_COUNT` is the number of **prior** backups
kept; the current (pre-migration) backup is **always** kept in addition, so the
store holds up to **N+1** objects per env at the peak (default `14` → up to `15`).
The current backup is categorically the rollback point of the release being cut,
so it is never counted against the retention budget — a deliberate one-object
safety bias.
# PV refresh precision cascade

The prepared CronJob uses `openai / gpt-6-astra / medium`, with two quality attempts
under contract v9 and `gemini / gemini-3.8-flash / low` fallback. Transport, quota,
timeout, or empty output switches immediately to fallback; persistent quality
refusal also falls back. After three consecutive quota-failed documents, the
circuit routes subsequent documents directly to Gemini.

With `REFRESH_VERIFY_ENABLED=1`, every accepted primary chunk receives one
`REFRESH_VERIFY_PROVIDER=gemini`, `REFRESH_VERIFY_MODEL=gemini-3.8-flash`,
`REFRESH_VERIFY_REASONING_EFFORT=low` verification pass. The frozen v101b instruction
judges existing acts; code only removes eligible node groups explicitly marked
unsupported with a non-empty reason, plus edges incident to the removed nodes.
Other nodes and surviving edges remain unchanged.
Invalid JSON or a failed verifier preserves the accepted extraction. Fallback
outputs skip verification, recorded as `skipped-fallback`.

Before releasing this image, apply migration `0012_refresh_document_outcomes` through
the existing DB migrator. The dedicated append-only table in `radar` stores one final
metadata result per document submission, including refusals and parsed page counts,
with indexes on `created_at` and `status`. No S3 credentials are needed to query it.

Set `REFRESH_VERIFY_ENABLED=0` on the runtime workload to disable verification
without rebuilding the image. This changes the durable policy identity; no purge
is required. `REFRESH_FORCE_FALLBACK=1` remains an acceptance-test override.
Both transports use the existing runtime owner scope and writable keyring PVC.
Account enrollment/import procedures remain in the [Astra acceptance guide](../../docs/reviews/refresh-astra/production-acceptance.md).
The [cascade acceptance guide](../../docs/reviews/refresh-cascade/production-acceptance.md)
defines release checks. These prepared changes are not evidence of deployment;
production remains gated by `REFRESH_CRONJOB_PROD_ENABLED=true`.

# Armer le rafraîchissement de production

Le CronJob `radar-refresh-pv` **n'existe pas** dans `radar-immobilier` : rien
n'y rafraîchit les procès-verbaux aujourd'hui. Le chemin CD est prêt et vérifié
en CI ; il ne s'exécute que lorsque la variable GitHub
`REFRESH_CRONJOB_PROD_ENABLED` vaut `'true'`. **Définir cette variable est le
seul geste d'armement, et c'est un acte owner** — une fusion ne peut pas armer
la production par effet de bord. Tant qu'elle n'est pas définie, chaque
promotion émet un `::warning::` « Refresh CronJob DISARMED (prod) » : désarmé
n'est pas une faute, mais ce n'est jamais invisible.

## Ce que fait l'étape, une fois armée

`promote-prod` → « Deploy refresh CronJobs (prod) », **après** la promotion des
images, de sorte que le CronJob porte exactement l'empreinte que les
Deployments viennent de recevoir. Le rendu passe par
`make -f deploy/k8s/refresh-cronjobs/refresh-018.mk render-prod`, la **même**
cible que la CI exécute sur chaque PR dans `verify-renders` : ce qui est
appliqué est ce qui a été vérifié. La cible refuse un `IMAGE_REF` qui n'est pas
une empreinte `@sha256:`, et refuse un rendu portant encore le placeholder
fail-loud ou `:latest`. Après l'apply, l'étape RELIT le CronJob dans le cluster
et rougit si `suspend` n'est pas `false` ou si l'image n'est pas l'empreinte
promue.

Le régime appliqué est celui de la base `deploy/k8s/34-refresh-cronjob.yaml`,
inchangé entre les deux environnements depuis #736 : `--all` sur les ~528
villes, **quatre passages par jour** (`17 5,11,17,23` UTC), échéance de Job
`19800 s` (5 h 30) et arrêt propre du balayage à `18900000 ms` (5 h 15).
`verify-renders` refuse toute divergence entre le rendu préprod et le rendu
prod en dehors de trois différences voulues : namespace, enveloppe mémoire,
liaison S3.

## À vérifier AVANT de définir la variable

1. **Secrets du namespace `radar-immobilier`.** Le pod monte
   `radar-refresh-keyring-bootstrap` (volume) et lit `radar-refresh-runtime`
   (`REFRESH_PRINCIPAL_REF`, `REFRESH_OWNER_SCOPE_REF`). Sans eux, le pod ne
   démarre pas. `refresh-018.mk` n'a **que** `seed-preprod` : le semis prod est
   un acte owner, hors CI, avec un `REFRESH_PRINCIPAL_REF` distinct de celui de
   la préproduction. Enrôlement des comptes : voir le guide Astra cité plus
   haut.
2. **PVC `radar-refresh-keyring`.** Il est dans le rendu, donc l'apply le crée.
   Cela suppose que le Role `radar-ci-deployer-refresh-cronjobs`
   (`deploy/k8s/10-rbac.yaml`, verbes `batch/cronjobs` **et**
   `persistentvolumeclaims`) soit **réellement appliqué sur le cluster** : c'est
   un acte cluster-admin (poc-k8s), la CI ne se l'accorde jamais. C'est la même
   omission qui avait cassé six déploiements préprod d'affilée en septembre.
3. **Marge de quota mémoire.** `radar-immobilier` plafonne `limits.memory` à
   3 072 Mi et en consomme 2 304 Mi : la marge est de **768 Mi**, soit
   exactement ce pod — et exactement ce que consommerait aussi un surge HPA de
   `radar-api` à deux pods. Les deux sont **mutuellement exclusifs**, et le
   perdant échoue en `FailedCreate`, sans alerte. Relire le quota réel sur le
   cluster OVH de production avant d'armer, et non un inventaire historique.
4. **Occupation du créneau.** Quatre passages de 5 h 30 au pire occupent le pod
   presque en continu, là où le régime précédent était nocturne. Décider si le
   surge `radar-api` doit rester possible, et sinon quand.
5. **Pic RSS du balayage.** Aucun pic de `refresh-pv --all` n'a jamais été
   mesuré ; les chiffres disponibles (OOM à 512 Mi, pic 815 Mi, plateau
   305-426 Mi à 3 Gi) viennent de `worker-live`, un proxy de ce chemin de code.
   La consigne « validate peak RSS » de l'overlay prod n'est pas encore levée.
   Une mesure sur un balayage réel en préproduction est la pièce manquante.

## Désarmer

Remettre `REFRESH_CRONJOB_PROD_ENABLED` à autre chose que `'true'` empêche les
promotions suivantes de redéployer le CronJob, mais **ne suspend pas** celui qui
tourne déjà : suspendre est un acte explicite
(`kubectl -n radar-immobilier patch cronjob radar-refresh-pv --type=merge -p '{"spec":{"suspend":true}}'`).
