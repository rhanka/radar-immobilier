# Feature: Ops recipients port v1 + systemic failure emission (L4)

## Objective
Implement the frozen immo side of the job-failure alert contract: a
service-to-service `GET /api/v1/ops/recipients` endpoint resolving live
alert recipients, plus a systemic-failure emission at the end of
`radar-refresh-pv` behind a sink interface (stdout JSON until the
Sentropic L1 `OpsJobFailureV1` contract is published).

## Scope / Guardrails
- Scope limited to `api/src/ops/**`, `api/src/config.ts`,
  `api/src/app.ts`, `api/src/index.ts`,
  `api/src/services/graph/ops-failure*`,
  `api/src/scripts/refresh-pv.ts`, `.env.example`, this plan file.
- No migration. No Python. Never read `.env`. Never touch
  `~/.kube/config` or prod.
- Commits carry no `Co-Authored-By`, `Claude-Session` or
  `Generated with` trailer (owner instruction overrides `make commit`).
- Branch development in the fresh clone
  `/home/antoinefa/src/radar-immobilier-l4` on
  `feat/ops-recipients-v1`.
- Tests on `ENV=test-*`, never `ENV=dev`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/ops/**`
  - `api/src/config.ts`, `api/src/config.test.ts`
  - `api/src/app.ts`, `api/src/index.ts`
  - `api/src/services/graph/ops-failure.ts`,
    `api/src/services/graph/ops-failure.test.ts`
  - `api/src/scripts/refresh-pv.ts`
  - `.env.example`
  - `plan/OPS-BRANCH_feat-ops-recipients.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (other branches)
  - `api/drizzle/*.sql`
- **Conditional Paths**: none.

## Feedback Loop
- Farid `manage_members` grant: documented only, never executed here.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: single lane, single PR to `main`, no merge by this lane.

## UAT Management (in orchestration context)
- No UI surface impacted; no UAT. Unit tests only.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`.
  - [x] Fresh clone from `origin/main`, branch `feat/ops-recipients-v1`.
- [x] **Lot 1 — Ops recipients endpoint**
  - [x] `OPS_TARGET` / `OPS_REFERENCE_WORKSPACE_SLUG` /
    `OPS_RECIPIENTS_AUDIENCE` config (audience configurable for L1).
  - [x] Service: live resolution, dedup by account, pre-A4 fallback.
  - [x] Route: S2S bearer verification reusing IdP JWKS path, target
    validation (404), frozen v1 response shape.
  - [x] Mount before `protect`; wire in `index.ts`.
  - [x] Lot gate: `make typecheck` + targeted tests.
- [x] **Lot 2 — Systemic failure emission**
  - [x] `OpsFailureSink` interface + stdout JSON sink.
  - [x] Emit `systemic-city-failures` / `succeeded` at end of
    `radar-refresh-pv` (`--all` sweep).
  - [x] Lot gate: targeted tests.
- [ ] **Lot 3 — Close-out**
  - [ ] Push, PR to `main`, CI green, `LANE-REPORT.md`.
