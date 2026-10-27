# Feature: content-host dispatch, closed by default — 861c H1

## Objective
- [x] Ship lot H1 host dispatch: content origins (`<artifactUuid>.<base>`, `<releaseUuid>.pinned.<base>`) never reach app auth, admin routes or the SPA, while every other host keeps the current chain.
- [x] Apply and verify the eight fixes from the Opus code review of 2026-10-19.

## Scope / Guardrails
- [x] Branch `feat/861c-h1-host-dispatch` from `origin/main` `7a474439`.
- [x] No change to `api/src/config.ts` (owned by #865) or `deploy/**`.
- [x] Preserve the four existing commits; atomic fixes at most 150 changed lines, English Conventional Commits subjects only, no body or trailer.
- [x] Tests via `tools/artifact-host.mk` on `ENV=test-861c-h1` only, then the full API suite, then `down -v`.
- [x] Root checkout and `ENV=dev` stay reserved for the user.
- [x] Use the assigned `.worktrees/861c-h1` only.
- [x] Test ports: API 18895, UI 15895, Maildev UI 11895, Postgres 15896, S3 19895, Obscura 19896, Maildev SMTP 11896; test compose publishes none.
- [x] Reports, review and `LOT-H1.md` remain uncommitted; never read `.env`.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `api/src/artifacts/**`
  - [x] `api/src/app.ts`
  - [x] `api/src/index.ts`
  - [x] `tools/artifact-host.mk`
  - [x] `api/package.json`, `package-lock.json` (exact `@sentropic/artifacts` 0.1.1)
  - [x] `plan/861C-BRANCH_feat-861c-h1-host-dispatch.md` (this file)
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`
  - [x] `docker-compose*.yml`
  - [x] `rules/**`
  - [x] `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - [x] `plan/NN-BRANCH_*.md` (except this branch file)
  - [x] `api/src/config.ts`
  - [x] `deploy/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] None in this branch.
- [x] **Exception process**:
  - [x] No exception declared; none required.

## Feedback Loop
- [x] Supplied review and muse corrections read; replace unexecuted gate claims with measured results.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (sequential validation on this branch, no history transfer)
- [ ] **Multi-branch** (not needed here)
- [x] Rationale: eight review fixes on one lot, no parallel validation needed.

## UAT Management (in orchestration context)
- [x] No UI surface impacted; no UAT session required.

## Plan / Todo (lot-based)
- [x] **Lot H1-1 — lib-owned routing (point 1)**
  - [x] Delegate to `parseContentHost` from `@sentropic/artifacts/content/routing`
  - [x] Contract tests: 8 existing cases plus `<uuid>-<uuid>` and trailing-dot forms
  - [x] Installed 0.1.1 export and isolated ESM import verified; no MCP modules loaded
- [x] **Lot H1-2 — fail-fast config (points 2, 6)**
  - [x] Invalid base throws at startup; unset stays disabled; `localhost` accepted
  - [x] Tested helper covers `index.ts`; a lone root dot must throw
- [x] **Lot H1-3 — gate hardening (points 3, 4, 8)**
  - [x] Probe bypass limited to GET/HEAD with gate-level tests
  - [x] `Accept: text/html` and valid-cookie threat scenarios
  - [x] Stale comments corrected in `app.ts` and `content-app.ts`
- [x] **Lot H1-4 — tooling and plan (points 5, 7)**
  - [x] Host env neutralized in `tools/artifact-host.mk`
  - [x] This branch plan file
- [x] **Lot gate**
  - [x] Scoped `src/artifacts` suite: 34 tests passed
  - [x] Full API without `ARTIFACTS_CONTENT_BASE`: 2311 passed, 6 skipped
  - [x] Full API with `ARTIFACTS_CONTENT_BASE=pages.example.net`: 2311 passed, 6 skipped
  - [x] Six-workspace typecheck and lint passed; 7 UI warnings recorded in the external report
  - [x] `down -v --remove-orphans`: zero project containers, volumes or networks; all seven ports free
