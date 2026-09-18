# Feature: Astra low refresh with Gemini fallback

## Objective
- [x] Deliver the owner-approved Astra low / Gemini low policy for #703 and #697.

## Scope / Guardrails
- [x] Existing branch `feat/refresh-prod-astra-low` and worktree only; no merge or cluster mutations.
- [x] Make-only; no secrets in output; no commit trailers; French PR required by owner.
- [x] Test environment `test-astra-703`: API 8893, UI 5393, Maildev 1193; tests expose no ports.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/scripts/refresh-pv.ts`
  - `api/src/scripts/prove-refresh-signals.ts`
  - `api/src/scripts/prove-refresh-signals.test.ts`
  - `api/src/scripts/fixtures/prove-refresh-signals.ndjson`
  - `api/src/services/graph/refresh-*.ts`
  - `api/tests/integration/refresh-018.spec.ts`
  - `deploy/k8s/34-refresh-cronjob.yaml`
  - `deploy/k8s/refresh-cronjobs*/**`
  - `deploy/k8s/secrets.example.yaml`
  - `deploy/ci/README.md`
  - `deploy/ci/prove-refresh-signals.sh`
  - `deploy/ci/prove-refresh-signals.test.sh`
  - `docs/reviews/refresh-astra/**`
  - `plan/R703A-BRANCH_feat-refresh-prod-astra-low.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plans
- **Conditional Paths**:
  - `.github/workflows/**`

## Scope exception
- [x] BR703-EX2: read-only graph-export proof tooling is required by owner #703; rollback removes the script, fixture and runbook only.

## Feedback Loop
- [x] Owner decision fixes models/transports; llm-mesh-refresh stays pinned at 0.19.2.
- [x] Independent design reviews requested for transport and durable-state correctness.
- [x] Exact-model routes only; mesh equivalent-model substitution is disabled for truthful receipts.
- [x] Initial review launches rejected as private-code export; GitHub proved public and public-diff retries were authorized.
- [x] Runtime review findings fixed with regression tests; deployment scope disagreements reconciled in review-corrected.md.

## Orchestration Mode (AI-selected)
- [x] Single existing branch; two independent read-only reviewers.

## UAT Management (in orchestration context)
- [x] No UI change; root UAT untouched.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read rules, inspect transport and existing deployment path.
- [x] Lot 1 — Document-scoped fallback, bounded attempts and safe receipts.
- [x] Lot 2 — Durable model trace and script wiring.
- [x] Lot 3 — Manifest policy and deployment runbook.
- [x] Lot 4 — Unit/integration, static and harness gates; independent review reconciliation.
- [x] Lot 5 — Real local acceptance: Astra 2/2, forced Gemini 2/2; test stack and volumes removed.
- [x] Lot 6 — French PR #714 open; final CI verdict and conductor report supplied in the lane handoff.
- [ ] Merge and preprod/prod execution reserved to conductor/k8s lane.
