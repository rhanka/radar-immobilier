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
- [x] **Lot 1 — Correction**
  - [x] Browser regression red on baseline, green on correction.
  - [x] Refresh max before opening; keep it stable during selection.
  - [x] Typecheck, lint, full UI tests and scoped browser regression.
  - [x] Cause: `SignauxRail.svelte` refreshed `timeRangeMax` on every picker pointerdown/keydown; DS `resolvedPresets` invalidation re-registered rows before click. `SelectableList.activate` then saw only `all` in its registry.
  - [x] Served preprod: all six centers hit their own content spans; no disabled options, no inert ancestors, pointer events auto, popover z-index 80, no premature dismissal. Native CDP mouse press/release on `6mo` kept the week label and menu open.
  - [x] Baseline `e8f4c7f6d`: Playwright `option.click()` fails, expected `6mo`, received `7d` (1800 ms).
  - [x] Corrected code: the same regression passes all six presets (1.8 s), including opening and closing between selections.
  - [x] `make -f tmp/check.mk typecheck ENV=test-period-options`: pass, zero errors (8 Svelte warnings).
  - [x] `make -f tmp/check.mk lint ENV=test-period-options`: pass, zero errors (one unrelated unused-disable warning).
  - [x] `make -f tmp/check.mk test-ui ENV=test-period-options`: 145 files / 1890 tests pass; one skipped file, 10 todos.
  - [x] `make -f tmp/check.mk e2e ENV=test-period-options`: pass; fresh CDP 9333 tab closed in finally.
  - [x] First isolated UI run lacked documentation fixtures; restore the source copy and rerun the full suite successfully. No test assertions changed.
  - [x] Evidence retained in this worktree's ignored `tmp/evidence/`; standalone Make runner avoids all environment-file includes.
- [ ] **Lot 2 — Delivery**
  - [x] Record root cause and results.
  - [ ] Push and open PR against main; preserve branch without merging.
  - [ ] Close tabs and destroy isolated runtime with volumes.
