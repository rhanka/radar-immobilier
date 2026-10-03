# Feature: Run the documentary-date stock recovery Job in prod via run-job

## Objective
- [x] Make the existing documentary-date recovery Job runnable in `radar-immobilier` (prod), operated by the conductor through `.github/workflows/run-job.yaml`, so the prod rollout of #786/#787/#788 gets its stock recovery right after promote.

## Scope / Guardrails
- [x] No cluster action from this branch (no kubectl apply/create/delete), no workflow dispatch, no merge.
- [x] Node/TS + shell/awk + kubectl only; no Python, no new image, no SealedSecret.
- [x] Prod Job mirrors the preprod Job; storage binding mirrors the prod refresh CronJob (`radar-api` ConfigMap + `radar-scrape-s3-credentials`).
- [x] Inputs reach scripts through env vars only; other run-job jobs keep their 20 min timeout, 3900 s wait and `--tail=80` logs.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/41-document-date-recovery-job.yaml`
  - `deploy/ci/check-object-storage-bindings.sh`, `deploy/ci/check-object-storage-bindings.test.sh`
  - `docs/spec/SPEC_EVOL_DOCUMENT_DATES.md`
  - `plan/DOCDATEPROD-BRANCH_ops-document-date-recovery-prod.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`, `rules/**`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` (BRDDP-EX1)
  - `.github/workflows/run-job.yaml` (BRDDP-EX2)

## Feedback Loop
- [x] BRDDP-EX1 — `Makefile`: extend `document-date-recovery-validate` to render the prod manifest offline and update the section header; no prod Make target. Impact: `make k8s-validate` (CI) also checks the prod manifest. Rollback: revert the two hunks.
- [x] BRDDP-EX2 — `.github/workflows/run-job.yaml`: add the `document-date-recovery` route and its inputs, per-job wait deadline and timeout, recovery log filter + run summary. Impact: run-job only; other jobs unchanged. Rollback: revert the commit.

## Plan / Todo (lot-based)
- [x] Lot 1 — prod manifest `deploy/k8s/41-document-date-recovery-job.yaml` + SCRAPE binding guard entry and two negative tests.
- [ ] Lot 2 — run-job route: inputs `recovery_mode`/`recovery_heal`/`recovery_cities`/`recovery_image`, validation, served-image default, refusal while refresh/backup/recovery Jobs are active, 110 min timeout + 5700 s wait for this job only, fail-fast + Job delete when the pod cannot start, report lines + run summary.
- [ ] Lot 3 — Makefile offline validate (preprod + prod) and header comment.
- [ ] Lot 4 — spec section "Production run (run-job)".
- [ ] Lot gate: `make document-date-recovery-validate ENV=ci`, `make k8s-validate ENV=ci`, `bash deploy/ci/check-object-storage-bindings.test.sh`, `make -f deploy/k8s/refresh-cronjobs/refresh-018.mk verify-renders ENV=ci`, `harness verify --category static`.
- [ ] Post-merge (conductor) — after promote: prod preview via run-job, review the report, then apply.
