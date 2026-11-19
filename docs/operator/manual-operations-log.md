# Production manual operations log

Append-only register of break-glass or out-of-band operator mutations in
production (`radar-immobilier` namespace, production PostgreSQL database, or
production S3 buckets).

## Mandatory entry fields

Every manual production mutation MUST be logged on the same day with:

1. **Who**: operator role / execution session (never personal names or credentials).
2. **When (UTC)**: ISO-8601 UTC timestamp (or window if executed across steps).
3. **What**: target environment, namespace, and exact resources touched.
4. **Command**: normalized command(s) run (with all Secret values, tokens, and URIs redacted).
5. **Diff summary**: non-secret summary of fields added/changed (verified via read-only `kubectl diff` / post-check).
6. **Owner GO (reference)**: Product Owner authorization reference (directive / PR / session sign-off).
7. **Planned CD return**: exact workflow and arming variable restoring automated CD reconciliation (plus status).

See also [docs/runbooks/prod-promotion.md](../runbooks/prod-promotion.md) and
[docs/operator/mcp-signal-write-runbook.md](./mcp-signal-write-runbook.md).

---

## Entries

### 2026-11-18 — Daily backup script ConfigMap and CronJob

- **Who**: Cluster operator (`i-cond` session, tenant-admin kubeconfig).
- **When (UTC)**: 2026-11-18 (prior to snapshot `2026-11-19T01:03Z`; manual backup verification job `radar-backup-manual-202611181620` ran `2026-11-18T16:20:41Z`–`16:31:22Z`).
- **What**: `ConfigMap/radar-backup-daily-script` and `CronJob/radar-backup-daily` in namespace `radar-immobilier` (`deploy/ci/backup/`).
- **Command**:
  ```bash
  kubectl -n radar-immobilier create configmap radar-backup-daily-script \
    --from-file=backup-daily.cjs=deploy/ci/backup/backup-daily.cjs --dry-run=client -o yaml \
    | kubectl label --local -f - app.kubernetes.io/name=radar-immobilier app.kubernetes.io/part-of=sentropic app.kubernetes.io/component=db-backup -o yaml \
    | kubectl -n radar-immobilier apply -f -
  kubectl -n radar-immobilier apply -f deploy/ci/backup/cronjob-backup-daily.yaml
  ```
- **Diff summary**: Updated live script payload in `radar-backup-daily-script` (labels `name/part-of/component` preserved) and reconciled `CronJob/radar-backup-daily` (generation `19`; `23 2 * * *` `Etc/UTC`, `suspend: false`, `concurrencyPolicy: Forbid`, `automountServiceAccountToken: false`, image `radar-api@sha256:cb2ab4ec...`). Verified pre-apply `kubectl diff`; `bascule-bundle-cd.yml` job `apply-backup` had been blocked while `BASCULE_BUNDLE_CD_ENABLED=false` (despite `BACKUP_DAILY_CD_ENABLED=true`).
- **Owner GO (reference)**: Product Owner GO (`i-cond` prod unblock, 2026-11-18; codified in 2026-11-19 directive).
- **Planned CD return**: Dedicated workflow `.github/workflows/backup-cd.yml` (`feat/backup-cd-path`) guarded independently by `vars.BACKUP_CD_ENABLED == 'true'` while `BASCULE_BUNDLE_CD_ENABLED` remains `false`.

### 2026-11-18 — Dormant dump CronJob `radar-db-backup-prod` (`#1130` hardening)

- **Who**: Cluster operator (`i-cond` session, tenant-admin kubeconfig).
- **When (UTC)**: 2026-11-18 (prior to snapshot `2026-11-19T01:03Z`).
- **What**: `CronJob/radar-db-backup-prod` in namespace `radar-immobilier` (`deploy/ci/bascule-preprod/cronjob-db-backup-prod.yaml`, PR `#1130`).
- **Command**:
  ```bash
  kubectl -n radar-immobilier apply -f deploy/ci/bascule-preprod/cronjob-db-backup-prod.yaml
  ```
- **Diff summary**: Applied dormant dump CronJob carrying `automountServiceAccountToken: false` (PR `#1130`) while keeping `spec.schedule: "*/5 * * * *"`, `spec.suspend: true`, `concurrencyPolicy: Forbid`, generation `22`, and pinned digest `radar-api@sha256:cb2ab4ec...`. Normal CD owner (`bascule-bundle-cd.yml` job `apply-bundle`) remained disarmed (`BASCULE_BUNDLE_CD_ENABLED=false`).
- **Owner GO (reference)**: Product Owner GO (`i-cond` prod unblock, 2026-11-18).
- **Planned CD return**: Reconciled via `.github/workflows/backup-cd.yml` (`feat/backup-cd-path`, `BACKUP_CD_ENABLED=true`) without re-arming `BASCULE_BUNDLE_CD_ENABLED`.

### 2026-11-18 — Refresh production overlay (`refresh-cronjobs-prod`)

- **Who**: Cluster operator (`i-cond` session, tenant-admin kubeconfig).
- **When (UTC)**: 2026-11-18 (prior to / alongside PR `#1134` promotion at `2026-11-18T17:59:30Z`).
- **What**: `CronJob/radar-refresh-pv`, `CronJob/radar-refresh-pending-watchdog`, and `PersistentVolumeClaim/radar-refresh-keyring` rendered from `deploy/k8s/refresh-cronjobs-prod` in namespace `radar-immobilier`.
- **Command**:
  ```bash
  make -f deploy/k8s/refresh-cronjobs/refresh-018.mk render-prod \
    IMAGE_REF=ghcr.io/rhanka/radar-api@sha256:<served-digest> RENDER_OUT=<tmp>/prod.yaml ENV=prod
  kubectl -n radar-immobilier apply -f <tmp>/prod.yaml
  ```
- **Diff summary**: Reconciled `radar-refresh-pv` (`0 5,11,17,23 * * *` `Etc/UTC`, `suspend: false`, `fsGroupChangePolicy: OnRootMismatch`) and `radar-refresh-pending-watchdog` (`*/5 * * * *` `Etc/UTC`, `suspend: false`) with pinned release digest matching live `deploy/radar-api` (`sha256:b7011b04...`), plus `PVC/radar-refresh-keyring` (`1Gi`, `ReadWriteOnce`).
- **Owner GO (reference)**: Product Owner GO (`i-cond` prod unblock, 2026-11-18).
- **Planned CD return**: **Completed** via PR `#1134`: `.github/workflows/build-push-images.yml` job `promote-prod` now applies `refresh-cronjobs-prod` at the release digest (`PROMOTE_PROD_ENABLED=true`, `REFRESH_CRONJOB_PROD_ENABLED=true`). Verified continuously by `prod-drift-check.yml`.

### 2026-11-18 — PostgreSQL role `immo_mcp_signal_writer`, grants, and Secret (prerequisites only)

- **Who**: Cluster / DB operator (`i-cond` session, tenant-admin kubeconfig).
- **When (UTC)**: 2026-11-18 (prior to snapshot `2026-11-19T01:03Z`).
- **What**: PostgreSQL login role `immo_mcp_signal_writer`, schema grants per migration `0048_signal_mcp_write` / `api/src/db/service-role-grants.ts`, and `Secret/immo-mcp-signal-writer` (key `IMMO_MCP_SIGNAL_DATABASE_URL`) in namespace `radar-immobilier` (`docs/operator/mcp-signal-write-runbook.md` steps 1–3).
- **Command**:
  ```bash
  kubectl -n radar-immobilier exec -i <postgres-pod> -- psql -U <admin> -d radar   # CREATE ROLE immo_mcp_signal_writer + grants check
  kubectl -n radar-immobilier create secret generic immo-mcp-signal-writer --from-literal=IMMO_MCP_SIGNAL_DATABASE_URL=<redacted>
  ```
- **Diff summary**: Created login role `immo_mcp_signal_writer` and materialized `Secret/immo-mcp-signal-writer` (`Opaque`) in `radar-immobilier`. Production remains inert (`IMMO_MCP_SIGNALS_WRITE_ENABLED` not enabled live; IdP scope step 4 and `deploy/overlays/prod-signal-write` step 5 not yet executed). Zero secrets committed to git.
- **Owner GO (reference)**: Product Owner GO (`mcp-signal-write-runbook.md` steps 1–3 prerequisite provisioning, 2026-11-18).
- **Planned CD return**: Credentials stay outside git per `docs/operator/mcp-signal-write-runbook.md` (`SECRET_EXCLUSION` — CI `radar-ci-deployer` holds zero `secrets:get`). Secret presence may be checked by name only (`kubectl get secret ... -o name`) when an account permits `secrets:get`. ConfigMap activation state remains audited via `prod-drift-check`.
