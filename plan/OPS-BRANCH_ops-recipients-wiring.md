# Chore: Ops recipients preprod wiring (L4 follow-up to #1051)

## Objective
Wire the merged `GET /api/v1/ops/recipients` endpoint (PR #1051) in the
preprod manifests so it stops answering 503
`ops_recipients_unconfigured`: per-environment `OPS_TARGET` /
`OPS_REFERENCE_WORKSPACE_SLUG` in the `radar-api` ConfigMap and
`OPS_RECIPIENTS_AUDIENCE` sourced from the operator-held Secret
`radar-ops-recipients`. Prod stays inert (no `OPS_*` ConfigMap keys, no
Secret) until an explicit activation decision.

## Scope / Guardrails
- No api code change: the endpoint, its fail-closed 503 and the
  audience-overlap guard already shipped in #1051.
- The audience value is fixed by the Sentropic L1 contract and is
  provisioned out-of-band; it never lands in git.
- No Python. Never read `.env`. Never touch `~/.kube/config` or prod.
- Commits carry no `Co-Authored-By`, `Claude-Session` or
  `Generated with` trailer.
- Branch development in
  `/home/antoinefa/src/radar-immobilier-l4/tmp/ops-recipients-wiring`
  on `chore/ops-recipients-wiring`. Not merged by this lane.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/30-api.yaml`
  - `deploy/k8s/secrets.example.yaml`
  - `deploy/overlays/preprod/**`
  - `deploy/ci/check-ops-recipients-render.sh`
  - `deploy/ci/check-ops-recipients-render.test.sh`
  - `.github/workflows/ci.yml`
  - `docs/operator/ops-recipients.md`
  - `plan/OPS-BRANCH_ops-recipients-wiring.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `api/**`, `packages/**`, `ui/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (other branches)
  - `deploy/k8s/refresh-cronjobs/**`
- **Conditional Paths**: none.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Manifest wiring**
  - [x] Base Deployment: optional `radar-ops-recipients` Secret ref.
  - [x] Preprod overlay: `OPS_TARGET` + reference workspace slug.
  - [x] `secrets.example.yaml` entry for `radar-ops-recipients`.
  - Lot gate: offline renders of the preprod overlay and the prod base
    both succeed; the preprod render carries `OPS_TARGET=immo-preprod`,
    the reference slug and the Secret-sourced audience (no literal);
    the prod render carries no `OPS_*` ConfigMap key (inert);
    `check-preprod-auth-isolation.sh` still passes. No TS in scope, so
    typecheck/lint are not applicable to this lot.
- [x] **Lot 2 — Rendering check**
  - [x] `check-ops-recipients-render.sh` + hermetic test, CI step.
  - Lot gate: `check-ops-recipients-render.sh` passes on the branch;
    hermetic test 7 passed / 0 failed (wrong target, missing slug,
    literal audience, wrong Secret, prod leak all rejected).
- [x] **Lot 3 — Runbook + close-out**
  - [x] `docs/operator/ops-recipients.md` (Secret, rotation, verify).
  - [x] Push, PR to `main` (#1072). Not merged by this lane; CI result
    recorded in the lane wiring report.
