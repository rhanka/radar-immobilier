# Bascule iso-prod — CD-native migration

Owner directive: **every production action must be driven by code through the
CI/CD pipeline** — zero manual `kubectl apply`, zero cross-session manual steps
(`"kubectl apply hors CD ça va pas"`). This document describes how the bascule
prod bundle and the preprod refresh became fully pipeline-driven, the exact
GitHub secrets/vars the owner+infra must provision, and the manual steps that are
now eliminated.

Constraints kept: **0 Python**, secrets **never committed** (materialized from
GitHub Actions secrets), all existing fail-closed gates (VAP anti-RCE, recon G4,
quiesce G2, EXPECTED_DATABASE positive control), runner stays **kubectl-only +
STATUS-ONLY** (no `kubectl logs`, no S3/DB creds, no PII). The bundle-apply +
secret-create are new runner kubectl actions — control-plane only, not PII.

## Flow (setup → gate → run → refresh), all GH-triggered

```
                         ┌───────────────────────────────────────────────┐
  workflow_dispatch  ──▶ │ bascule-apply-bundle.yml   (PROD, one-time /   │
  (CONFIRM=              │                             on bundle change)  │
   apply-bundle-prod)    │  1. pre-flight assert PROD cluster             │
                         │  2. materialize Secrets from GH secrets        │
                         │       radar-db-ro-prod, radar-pra-admin-prod   │
                         │  3. Job db-ro-role-provision (wait Complete)   │
                         │  4. apply dormant CronJob radar-db-backup-prod │
                         │  5. apply VAP + RBAC T1 + wait propagation     │
                         │  6. ANTI-RCE GATE (impersonation --dry-run):   │
                         │       (A) jobTemplate mutation  → DENIED        │
                         │       (B) suspend flip          → ALLOWED       │
                         │       fail ⇒ rollback RBAC T1 + abort          │
                         └───────────────────────────────────────────────┘
                                              │  (bundle in place, T1 enforce-verified)
                                              ▼
                         ┌───────────────────────────────────────────────┐
  workflow_dispatch  ──▶ │ bascule-preprod.yml         (the run)          │
  (CONFIRM=iso-prod-     │  job: bascule    S0→S7 (dump→restore→migrate→  │
   <today>,             │                  docs→recon G4→flip→refresh S6→ │
   DRY_RUN=false,       │                  smoke)                         │
   FORCE_REFRESH=true)   │  job: force-refresh  needs: bascule (success)  │
                         │        precipitate CronJob radar-refresh-pv    │
                         │        (preprod) on the restored data          │
                         └───────────────────────────────────────────────┘
                                              ▲
  workflow_dispatch  ──▶ bascule-refresh.yml  (decoupled, on-demand)
  (RUN=true)             same force-refresh step, run independently
```

**Wired order (owner):** the bascule (prod DB+S3 restore → preprod) runs FIRST;
the refresh runs on the restored data. In `bascule-preprod.yml` the `force-refresh`
job `needs: bascule` and its `if` requires `needs.bascule.result == 'success'` — a
refresh never runs on a failed/absent restore. `bascule-refresh.yml` is the same
step exposed as a standalone on-demand trigger (precipitate beyond the 5/11/17/23h
schedule).

## GitHub Actions **secrets** the owner/infra must create

### Value secrets (materialized into k8s Secrets by `bascule-apply-bundle.yml`)

| GH secret | Holds | k8s Secret / key it populates | How to generate |
| --- | --- | --- | --- |
| `RADAR_DB_RO_PROD_PASSWORD` | password of the strict RO Postgres login `radar_db_ro_prod` | `radar-db-ro-prod` / `POSTGRES_PASSWORD` | `openssl rand -base64 32` — generated ONCE by the owner, stored here. Deterministic re-runs re-assert the same password (idempotent RO-role Job). |
| `RADAR_PRA_ADMIN_PROD_ACCESS_KEY` | S3 access key (RW on the backups bucket `radar-immobilier-backups-preprod`) | `radar-pra-admin-prod` / `S3_ACCESS_KEY` | value of the existing `radar-pra-admin` S3 credential (`.env` `AWS_*`). |
| `RADAR_PRA_ADMIN_PROD_SECRET_KEY` | S3 secret key (same credential) | `radar-pra-admin-prod` / `S3_SECRET_KEY` | same source. |

> **RO password decision (read from a GH secret, not pipeline-generated).** The
> owner sets `RADAR_DB_RO_PROD_PASSWORD` once. This keeps the pipeline
> deterministic and idempotent, avoids leaking a generated plaintext into Actions
> logs, and avoids a cross-session copy-back step (which the directive forbids).
> `POSTGRES_USER=radar_db_ro_prod` and `POSTGRES_DB=radar` are **non-secret
> literals** set in the workflow; the S3 key **structure** (key names
> `S3_ACCESS_KEY`/`S3_SECRET_KEY`) is non-secret — only the two key **values** are
> secrets. Rotation: update `RADAR_DB_RO_PROD_PASSWORD`, re-run
> `bascule-apply-bundle.yml` (the RO-role Job re-asserts the new password); no app
> impact (dump-only role). See `CRED_CYCLE.md`.

### Kubeconfig secrets (cluster access)

| GH secret | Identity | Used by | Required cluster rights |
| --- | --- | --- | --- |
| `KUBE_CONFIG_DATA_PROD_SETUP` **(NEW)** | privileged PROD bootstrap SA (e.g. `radar-ci-bascule-setup-prod`) | `bascule-apply-bundle.yml` **only** | cluster-scoped: create/get/update `validatingadmissionpolicies` + `validatingadmissionpolicybindings` (admissionregistration.k8s.io/v1). ns `radar-immobilier`: create/get/patch/update on `serviceaccounts`, `roles`, `rolebindings` (rbac.authorization.k8s.io), `secrets`, `configmaps`, `jobs` (batch), `cronjobs` (batch); get on `deployments` (pre-flight). **`impersonate` on `serviceaccounts`** (to run the anti-RCE gate as `radar-ci-trigger-prod`). |
| `KUBE_CONFIG_DATA_PROD` (existing) | name-scoped trigger SA `radar-ci-trigger-prod` (patch cronjob `radar-db-backup-prod` + VAP suspend-only) | `bascule-preprod.yml` S1 dump trigger | get/patch on `cronjobs` resourceName `radar-db-backup-prod` only (already in `rbac-ci-trigger-prod.yaml`, enforced by the VAP). |
| `KUBE_CONFIG_DATA_BASCULE_PREPROD` (existing) | dedicated preprod bascule SA `radar-ci-bascule-preprod` | `bascule-preprod.yml` bascule job (quiesce/dispatch Jobs/flip) | preprod control-plane per the run README. |
| `KUBE_CONFIG_DATA_PREPROD` (existing) | preprod deployer SA `radar-ci-deployer-preprod` | force-refresh (both the wired job and `bascule-refresh.yml`) | `batch/jobs: create` + `batch/cronjobs: get` in `radar-immobilier-preprod` — **already granted** by `deploy/k8s/11-ci-deployer-preprod-rbac.yaml`. **No RBAC extension needed** for force-refresh. |

## Optional non-secret repo **variables** (safe fallbacks built in)

- `EXPECTED_KUBE_APISERVER_HOST_PROD` (falls back to `EXPECTED_KUBE_APISERVER_HOST`,
  then the OVH host default) — PROD cluster identity for `bascule-apply-bundle`.
- `BASCULE_EXPECTED_DATABASE` (default `radar`) — the `POSTGRES_DB` value for
  `radar-db-ro-prod`.
- `BASCULE_VAP_PROPAGATION_SEC` (default `20`) — VAP propagation wait.
- `BASCULE_PREPROD_NAMESPACE` (default `radar-immobilier-preprod`),
  `BASCULE_REFRESH_CRONJOB` (default `radar-refresh-pv`) — force-refresh target.

## Manual steps **eliminated**

Previously owner-direct (out of CD), now pipeline-driven:

1. `kubectl apply -f vap-ci-trigger-suspend-only.yaml` (cluster-scoped VAP) →
   `bascule-apply-bundle.yml` step 5.
2. `kubectl apply -f rbac-ci-trigger-prod.yaml` (T1 SA/Role/RoleBinding) → step 5.
3. `kubectl apply -f db-ro-role-provision.yaml` + waiting for the Job → step 3.
4. `kubectl apply -f cronjob-db-backup-prod.yaml` (dormant dump CronJob) → step 4.
5. **Minting `radar-db-ro-prod` and `radar-pra-admin-prod` by hand from `.env`** →
   step 2 materializes them from GitHub Actions secrets (never committed).
6. The manual **impersonation `--dry-run=server` anti-RCE negative test** and its
   timestamped evidence → step 6 (fail-closed, with automatic RBAC rollback on
   failure). `EVIDENCE_CAPTURE_RUN.md` [a][b][e][f][g] reads are still available
   for i-infra certification against the run's `.status` output.
7. **`kubectl create job --from=cronjob/radar-refresh-pv`** to precipitate a
   preprod refresh → `bascule-refresh.yml` (on-demand) and the wired
   `force-refresh` job in `bascule-preprod.yml` (after the bascule).

## Idempotency / re-runnability

- Secrets: `create ... --dry-run=client -o yaml | kubectl apply -f -` = create-or-update.
- RO-role Job: immutable → delete `--ignore-not-found` then apply, wait Complete.
- VAP / RBAC / CronJob: `kubectl apply` is idempotent; the CronJob stays
  `suspend: true` (dormant) until the bascule's S1 trigger un-suspends it.
- Anti-RCE gate: non-destructive (`--dry-run=server`); on failure it deletes the
  T1 RBAC to close the RCE window, so a re-run starts from a safe state.
- force-refresh: per-run Job name (`radar-refresh-pv-forced-<run_id>`, RFC1123),
  delete-then-create; default confirms a clean start then returns green (the
  ~5 h sweep continues in the background), `FORCE_REFRESH_WAIT_COMPLETE=1` waits
  fail-closed.

## Still 0 Python, still runner kubectl-only

`bascule-apply-bundle.yml` runs `kubectl` (apply committed manifests + create
Secrets from GH secrets + an impersonation dry-run) — control-plane, no PII, no
dump bytes, and the S3 keys are written into a k8s Secret, never printed. The run
and force-refresh stay kubectl + STATUS-ONLY (`bascule.mjs`). Data-plane
(pg_dump/pg_restore/aws-cli) lives in in-cluster Jobs on already-validated native
images. No new container image, no Python anywhere.
