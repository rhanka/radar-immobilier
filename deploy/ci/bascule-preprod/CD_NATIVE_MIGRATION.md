# Bascule iso-prod — CD-native v2 (fully automated)

Owner directive: **every production action is driven by code; the owner validates
nothing per-act.** v2 removes the ephemeral setup token, the manual bootstrap, the
owner-in-the-loop `CONFIRM`, and the GitHub-secret materialization of the two app
creds. The **only** human step is a one-time cluster install by the k8s lane.

Constraints kept: **0 Python**, secrets **never committed in plaintext** (they are
committed as **SealedSecrets**, encrypted, safe in git), all fail-closed gates
(VAP anti-RCE, recon G4, quiesce G2, EXPECTED_DATABASE positive control), runner
stays **kubectl-only + STATUS-ONLY** (no `kubectl logs`, no S3/DB creds, no PII).

## What changed vs v1

| v1 (removed) | v2 (this) |
| --- | --- |
| `bascule-apply-bundle.yml` — `workflow_dispatch` + `CONFIRM` (owner-in-the-loop) | `bascule-bundle-cd.yml` — applies the bundle **on merge to `main`** (path-scoped), idempotent |
| **ephemeral** privileged token `KUBE_CONFIG_DATA_PROD_SETUP` | **permanent** `KUBE_CONFIG_DATA_PROD` = SA `radar-ci-bascule-prod`, minted **once** at cluster install |
| 2 app Secrets materialized from GH secrets (`RADAR_DB_RO_PROD_PASSWORD`, `RADAR_PRA_ADMIN_PROD_*`) | 2 **SealedSecrets committed** → the in-cluster sealed-secrets controller materializes the core Secrets |
| bootstrap SA `radar-ci-setup-prod` (`rbac-ci-setup-prod.yaml`) | permanent SA `radar-ci-bascule-prod` (`rbac-ci-bascule-prod.yaml`), **0 `secrets:create`** |
| run only via `workflow_dispatch` | run on a **weekly schedule** (Sunday 03:17 UTC, `17 3 * * 0`) + `workflow_dispatch` kept |

## Flow — one-time install, then everything automated

```
  ┌── ONE-TIME, k8s lane at cluster install (the ONLY human step) ──────────────┐
  │ 1. kubectl apply -f deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml      │
  │      (cluster-admin) → SA radar-ci-bascule-prod (VAP cluster + ns bundle     │
  │      + impersonate name-scoped, 0 secrets:create).                           │
  │ 2. kubectl -n radar-immobilier create token radar-ci-bascule-prod            │
  │      → kubeconfig → base64 → GH secret KUBE_CONFIG_DATA_PROD (PERMANENT).     │
  │ 3. gh variable set BASCULE_BUNDLE_CD_ENABLED --body true   (arm the apply)    │
  │ (later, after the first apply created the trigger SA)                         │
  │ 4. kubectl -n radar-immobilier create token radar-ci-trigger-prod            │
  │      → base64 → GH secret KUBE_CONFIG_DATA_PROD_TRIGGER (name-scoped run cred)│
  │ 5. gh variable set BASCULE_SCHEDULE_ENABLED --body true    (arm the run)      │
  └─────────────────────────────────────────────────────────────────────────────┘
                                   │
   ── then, forever, 0 owner action ──
                                   ▼
  ┌── on every merge to main touching the bundle ──────────────────────────────┐
  │ bascule-bundle-cd.yml (auth = KUBE_CONFIG_DATA_PROD, idempotent)            │
  │   1. pre-flight assert PROD cluster                                         │
  │   2. apply 2 SealedSecrets → controller materializes radar-db-ro-prod +     │
  │        radar-pra-admin-prod (runner never sees plaintext)                   │
  │   3. Job db-ro-role-provision (wait Complete, fail-closed)                  │
  │   4. apply dormant CronJob radar-db-backup-prod (suspend:true)              │
  │   5. apply VAP + RBAC T1 + wait propagation                                 │
  │   6. ANTI-RCE GATE (impersonation --dry-run=server):                        │
  │        (A) jobTemplate mutation → DENIED   (B) suspend flip → ALLOWED       │
  │        fail ⇒ NEUTRALIZE T1 (Role rules emptied) + abort                    │
  └────────────────────────────────────────────────────────────────────────────┘
  ┌── weekly (Sunday 03:17 UTC), armed by BASCULE_SCHEDULE_ENABLED ─────────────┐
  │ bascule-preprod.yml (the run, auto-CONFIRM = the schedule IS the GO)        │
  │   job bascule  MODE=restore from the LATEST complete backup (24 h guard):   │
  │                R0→restore→migrate→docs at D→recon G4→flip→smoke. NO refresh │
  └────────────────────────────────────────────────────────────────────────────┘
   bascule-refresh.yml — decoupled on-demand force-refresh (the ONLY refresh path from CI;
   the bascule never refreshes)
```

## The credential rename (important)

`KUBE_CONFIG_DATA_PROD` now names the **permanent bundle-apply SA**
(`radar-ci-bascule-prod`). The run's **name-scoped 0-foothold dump trigger**
(SA `radar-ci-trigger-prod`, patch `radar-db-backup-prod` + VAP suspend-only) moved
to **`KUBE_CONFIG_DATA_PROD_TRIGGER`**. Keeping them separate is deliberate: the
trigger token stays VAP-enforced and least-privilege; the broad apply SA (not
VAP-constrained) must never be the run runner's cred.

## GitHub Actions secrets — v2

| GH secret | Identity | Used by | Notes |
| --- | --- | --- | --- |
| `KUBE_CONFIG_DATA_PROD` **(PERMANENT)** | SA `radar-ci-bascule-prod` | `bascule-bundle-cd.yml` | applies the bundle on merge; **0 `secrets:create`**. Minted once at install. |
| `KUBE_CONFIG_DATA_PROD_TRIGGER` **(renamed)** | name-scoped SA `radar-ci-trigger-prod` | `bascule-preprod.yml` S1 dump trigger | patch `radar-db-backup-prod` suspend, VAP-enforced. Was `KUBE_CONFIG_DATA_PROD`. |
| `KUBE_CONFIG_DATA_BASCULE_PREPROD` (existing) | SA `radar-ci-bascule-preprod` | `bascule-preprod.yml` bascule job | preprod control-plane (quiesce/dispatch/flip). |
| `KUBE_CONFIG_DATA_PREPROD` (existing) | SA `radar-ci-deployer-preprod` | force-refresh (`bascule-refresh.yml` only; no longer wired into the bascule) | already has `batch/jobs:create` + `batch/cronjobs:get` — **no RBAC change**. |

### No more app-cred GH secrets

The two app creds are **no longer GH secrets** — they are committed SealedSecrets
(`radar-db-ro-prod-sealed.yaml`, `radar-pra-admin-prod-sealed.yaml`) that the
in-cluster sealed-secrets controller materializes. See `CRED_CYCLE.md`.

## Repo **variables** (non-secret; safe fallbacks built in)

- `BASCULE_BUNDLE_CD_ENABLED` — arms `bascule-bundle-cd.yml` (off by default; set
  `true` at install once the SA + `KUBE_CONFIG_DATA_PROD` exist).
- `BASCULE_SCHEDULE_ENABLED` — arms the weekly run (off by default; set `true`
  once `KUBE_CONFIG_DATA_PROD_TRIGGER` + preprod creds exist). The cron **cadence**
  (`17 3 * * 0`, Sunday 03:17 UTC, owner decision 2026-09-26) is fixed in code — GitHub does not allow a variable in the cron
  literal, so tuning the time is a one-line code change; arming is the variable.
- `EXPECTED_KUBE_APISERVER_HOST_PROD` (falls back to `EXPECTED_KUBE_APISERVER_HOST`,
  then the OVH host) — PROD cluster identity for the apply.
- `BASCULE_VAP_PROPAGATION_SEC` (default `20`) — VAP propagation wait.
- `BASCULE_PREPROD_NAMESPACE` (default `radar-immobilier-preprod`),
  `BASCULE_REFRESH_CRONJOB` (default `radar-refresh-pv`) — force-refresh target
  (`bascule-refresh.yml`).

## What is now ELIMINATED

1. **Ephemeral setup token** `KUBE_CONFIG_DATA_PROD_SETUP` — gone; replaced by the
   permanent `KUBE_CONFIG_DATA_PROD` (minted once at install).
2. **Manual bootstrap workflow** `bascule-apply-bundle.yml` + its owner `CONFIRM`
   dispatch — gone; the bundle applies on merge (`bascule-bundle-cd.yml`).
3. **Owner-in-the-loop** per-act GO on the apply — gone (arming is a one-time
   install variable, not a per-act validation).
4. **GH-secret materialization of the 2 app creds** (`kubectl create secret … from
   GH secrets`) — gone; SealedSecrets committed + controller-materialized.
5. **Manual `kubectl apply`** of VAP / RBAC T1 / RO-role / dump CronJob — all in
   the on-merge apply.
6. **Manual dispatch of the run** as the only entry — the run is scheduled weekly
   (`workflow_dispatch` kept for the first run / on-demand).
7. **`.env` fragility for the app creds** — the material now lives encrypted in git
   (SealedSecrets). `.env` remains a recovery convenience per `CRED_CYCLE.md`, not
   a pipeline dependency.

## GH secrets the owner can now DELETE

Once this PR is merged and the install is done, these are unused by the pipeline:

- `KUBE_CONFIG_DATA_PROD_SETUP` (ephemeral bootstrap token — gone)
- `RADAR_DB_RO_PROD_PASSWORD` (now the RO SealedSecret)
- `RADAR_PRA_ADMIN_PROD_ACCESS_KEY` / `RADAR_PRA_ADMIN_PROD_SECRET_KEY` (now the
  pra-admin SealedSecret)

## Idempotency / re-runnability

- SealedSecrets: `kubectl apply` = create-or-update; the controller reconciles the
  core Secret. The apply waits for `Synced` (tolerant) before the RO-role Job.
- RO-role Job: immutable → delete `--ignore-not-found` then apply, wait Complete.
- VAP / RBAC / CronJob: `kubectl apply` is idempotent; the CronJob stays
  `suspend: true` (dormant) until the bascule's S1 trigger un-suspends it.
- Anti-RCE gate: non-destructive (`--dry-run=server`); on failure it **empties the
  T1 Role rules** to close the RCE window (the permanent SA has no `delete` verb —
  a deliberate least-privilege trade-off, and a stronger closure than a delete).
- Run: scheduled = `MODE=restore` from the latest complete backup, auto-CONFIRM of
  the day (G3 anti-replay kept), no refresh; force-refresh (`bascule-refresh.yml`)
  per-run Job name, delete-then-create.

## Still 0 Python, still runner kubectl-only

`bascule-bundle-cd.yml` runs `kubectl` only (apply committed manifests + an
impersonation dry-run) — control-plane, no PII, no dump bytes, and the S3 keys
never reach the runner (they arrive as a SealedSecret, decrypted only in-cluster).
The run and force-refresh stay kubectl + STATUS-ONLY (`bascule.mjs`). Data-plane
(pg_dump/pg_restore/aws-cli) lives in in-cluster Jobs on already-validated native
images. No new container image, no Python anywhere.
