# Feature: Clickable signal period options

## Objective
Restore real mouse selection of every signal period preset after PR #1084.

## Scope / Guardrails
- Dedicated worktree from `origin/main` at `4f8ae641c`.
- Make-only, isolated `ENV=test-period-options`; UI 15948, reserved API 18948 and Maildev 11948.
- No environment files, Python, Kubernetes, deployment or merge.
- CDP `127.0.0.1:9333` only; close every fresh tab. Tear down with `down -v`.
- English artifacts; French discussion; no generated commit trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/SignauxRail.svelte`
  - `ui/e2e-qa/period-options.harness.spec.ts`
  - `ui/e2e-qa/harness/RailFilterHarness.svelte`
  - This branch plan
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, other branch plans
- **Conditional Paths**:
  - None
- **Exception process**:
  - Record rationale, impact and rollback before scope changes.

## Feedback Loop
- [x] Owner authorizes correction, browser regression and PR; no merge.
- [x] Isolate from concurrent edits in the original worktree.

## Orchestration Mode (AI-selected)
- [x] Single branch; no delegated implementation.

## UAT Management (in orchestration context)
- [x] Inspect served preprod and reproduce locally with native CDP mouse input.
- [x] Preserve root checkout and foreign stacks.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Evidence**
  - [x] Read project rules and harness debug/test skills.
  - [x] Verify hit targets, disabled state, inert, stacking and dismissal.
  - [x] Prove DS registry retains only `all` after bound invalidation.
- [ ] **Lot 1 — Correction**
  - [ ] Browser regression red on baseline, green on correction.
  - [ ] Refresh max before opening; keep it stable during selection.
  - [ ] Typecheck, lint, full UI tests and scoped browser regression.
- [ ] **Lot 2 — Delivery**
  - [ ] Record root cause and results.
  - [ ] Push and open PR against main; preserve branch without merging.
  - [ ] Close tabs and destroy isolated runtime with volumes.
