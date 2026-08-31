# Feature: Continuous virtualized PDF scrolling

## Objective
Replace the evidence viewer's single-page canvas with continuous multi-page scrolling while keeping rendering memory bounded.

## Scope / Guardrails
- Scope is limited to the UI PDF viewer, its pure windowing helper, and focused tests.
- Lot B search is explicitly excluded; no server or API change is allowed.
- Development uses the repository-local isolated `tmp/worktrees/pdf-scroll` checkout and `ENV=p10lota` as the final make argument.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/src/lib/components/maps/SignalPdfOverlay.svelte`
  - `ui/src/lib/components/maps/SignalPdfOverlay.test.ts`
  - `ui/src/lib/signals/pdf-page-window*.ts`
  - `ui/e2e-qa/pdf-*.harness.spec.ts`
  - `plan/PDFSCROLL-BRANCH_feat-vue-pdf-viewer-scroll.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - API, source adapters, scoring, migrations, and other branch plans
- **Conditional Paths**: none.

## Feedback Loop
- Native worktree creation is sandbox-blocked because the parent git metadata is read-only. A fresh repo-local clone at the required path is pinned to `origin/main` instead.
- Harness consensus review selection failed because the runtime did not expose the author's exact model and effort metadata. No peer-review verdict is claimed; the required i-cond PR gate remains open.

## Orchestration Mode
- [x] Mono-branch implementation with no delegation and no cherry-pick.

## Plan / Todo
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read the viewer and all directly related tests before editing.
  - [x] Confirm viewer-only scope, isolated environment, and make-only verification.
- [x] **Lot A — Continuous virtualized page stack**
  - [x] Add pure page-window and visibility selection tests.
  - [x] Add component tests with a mocked five-page PDF document.
  - [x] Dimension every page slot and render only the visible page window.
  - [x] Preserve citation, navigation, zoom, hover, performance, and document-reset invariants.
- [ ] **Final gate**
  - [x] Run install, typecheck, lint, UI tests, and build with `ENV=p10lota`.
  - [ ] Commit, push, and open a PR without merging.
