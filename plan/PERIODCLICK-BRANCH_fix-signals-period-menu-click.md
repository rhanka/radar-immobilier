# Feature: Clickable signal period options

## Objective
Restore real mouse selection in the signal period picker after PR #1084.

## Scope / Guardrails
- Make-only execution. No environment files, Python, or Kubernetes access.
- Dedicated worktree `tmp/period-click`, based on `origin/main`.
- CDP only at `127.0.0.1:9333`; fresh tabs closed after each run.
- Isolated `ENV=test-period-click`, UI port 15938, API 18938, Maildev 11938.
- Synthetic UI harness; no backend or data mutation. Always tear down with `down -v`.
- No merge. No generated commit or PR trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/SignauxRail.svelte`
  - `ui/e2e-qa/signals-period-click.harness.spec.ts`
  - `ui/e2e-qa/harness/RailFilterHarness.svelte`
  - `plan/PERIODCLICK-BRANCH_fix-signals-period-menu-click.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - Other branch plans
- **Conditional Paths**:
  - None

## Feedback Loop
- [x] Owner authorizes the correction, real mouse regression test and PR.

## Orchestration Mode (AI-selected)
- [x] Single dedicated branch; no delegated implementation.

## UAT Management (in orchestration context)
- [x] Served preprod reproduced in a fresh CDP tab with real mouse events.
- [x] Local reproduction uses the real rail and DS in an isolated UI harness.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and evidence**
  - [x] Read project rules and harness debug/test skills.
  - [x] Verify branch equals `origin/main` before implementation.
  - [x] Capture hit targets, pointer events, inert, stacking and event sequence.
- [ ] **Lot 1 — Regression and correction**
  - [ ] Prove browser regression red before correction, green after correction.
  - [ ] Keep picker bounds stable during interaction.
  - [ ] Run typecheck, lint, test-ui and targeted browser regression.
- [ ] **Lot 2 — Review and delivery**
  - [ ] Record root cause and validation evidence.
  - [ ] Push and open PR against main.
  - [ ] Check CI and preserve branch without merging.
  - [ ] Remove isolated stack and volumes.
