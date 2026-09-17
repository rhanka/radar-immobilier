# Feature: Astra low refresh with Gemini fallback

## Objective
- [ ] Deliver the owner-approved Astra low / Gemini low policy for #703 and #697.

## Scope / Guardrails
- [x] Existing branch `feat/refresh-prod-astra-low` and worktree only; no merge or cluster mutations.
- [x] Make-only; no secrets in output; no commit trailers; French PR required by owner.
- [x] Test environment `test-astra-703`: API 8893, UI 5393, Maildev 1193; tests expose no ports.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/scripts/refresh-pv.ts`
  - `api/src/services/graph/refresh-*.ts`
  - `deploy/k8s/34-refresh-cronjob.yaml`
  - `deploy/k8s/refresh-cronjobs*/**`
  - `deploy/k8s/secrets.example.yaml`
  - `deploy/ci/README.md`
  - `docs/reviews/refresh-astra/**`
  - `plan/R703A-BRANCH_feat-refresh-prod-astra-low.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plans
- **Conditional Paths**:
  - `.github/workflows/**`

## Feedback Loop
- [x] Owner decision fixes models/transports; llm-mesh-refresh stays pinned at 0.19.2.
- [x] Independent design reviews requested for transport and durable-state correctness.

## Orchestration Mode (AI-selected)
- [x] Single existing branch; two independent read-only reviewers.

## UAT Management (in orchestration context)
- [x] No UI change; root UAT untouched.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read rules, inspect transport and existing deployment path.
- [x] Lot 1 — Document-scoped fallback, bounded attempts and safe receipts.
- [x] Lot 2 — Durable model trace and script wiring.
- [ ] Lot 3 — Manifest policy and deployment runbook.
- [ ] Lot 4 — Unit/integration, static and harness gates; independent review reconciliation.
- [ ] Lot 5 — Real local acceptance or measured credential gap; remove test volumes.
- [ ] Lot 6 — French PR, green CI, conductor report.
- [ ] Merge and preprod/prod execution reserved to conductor/k8s lane.
