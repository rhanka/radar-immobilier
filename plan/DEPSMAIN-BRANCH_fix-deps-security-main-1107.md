# Fix: Align main's dependency locks with the v1.2.18 security hotfix

## Objective
- [x] Confirm that `main` carries non-vulnerable versions of every package bumped by the v1.2.18 prod hotfix.
- [x] Fix review finding M4: `raw-body/node_modules/iconv-lite` 0.7.2 had no `resolved`/`integrity` in the root lock.
- [x] Fix any other production-dependency advisory that is fixable with a minimal, verified change.

## Scope / Guardrails
- [x] Base: `origin/main` at `7780bdcbc`; worktree `tmp/deps-sec-main-1107`.
- [x] Lock-only edits for the root lock; no global `npm audit fix` or `npm dedupe`.
- [x] No `.github/**`, Makefile, compose, rules or agent entry-point change.
- [x] Make-only gates on `ENV=test-depsmain1107` (ENV last), cleaned with `make clean` afterwards.
- [x] No push of deployment artefacts; PR opened on `main`, not merged.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `package-lock.json`
  - `docs/architecture/focus/package.json`, `docs/architecture/focus/package-lock.json`
  - `plan/DEPSMAIN-BRANCH_fix-deps-security-main-1107.md`
- **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/**`, other branch plans, every other manifest.
- **Conditional Paths**: none.

## Feedback Loop
- [x] attention: the hotfix packages are already patched on `main` (dompurify 3.4.17, body-parser 2.4.0 with nested iconv-lite 0.7.3, fast-uri 3.1.9, ip-address 10.7.5, qs 6.16.1, hono 4.13.17, @hono/node-server 2.1.6); the root production audit is clean before any change.
- [x] DEPSMAIN-EX1: `docs/architecture/focus/package.json` pins `vite` exactly (`6.4.4`), so GHSA-8g5g-mxqh-grgj (Dependabot alert 179) cannot be fixed lock-only. Reason: the exact pin is the only way to move the version. Impact: patch bump 6.4.4 -> 6.4.5 of the independent Focus tool, same as the root bump of `ca65fa669`. Rollback: revert the commit.
- [x] attention: 608 of 816 installed entries of the root lock have no `resolved`/`integrity` on `main` (pre-existing, not introduced here). Only the M4 entry is fixed; a full lock re-resolution is a separate decision.
- [x] deferred (out of scope, dev-only or no fix): minimatch GHSA-g3hv-75wg-m249 (alert 182) needs minimatch 11.x outside `@typescript-eslint/typescript-estree`'s `^10.2.2`; deepmerge GHSA-gcqx-w48m-w2h4 (alerts 176, 177) has no patched version.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; two atomic lock commits plus this plan.

## UAT Management (in orchestration context)
- [x] No UI or API source change; automated gates qualify the lock changes.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**
  - [x] `npm audit --package-lock-only --omit=dev` and full audit on the root and Focus locks.
  - [x] Verify the versions of the hotfix packages on `main`.
  - [x] `npm install --package-lock-only` is stable on the base lock.
- [x] **Lot 1 — M4**
  - [x] Add `resolved` and `integrity` to `raw-body/node_modules/iconv-lite` 0.7.2.
  - [x] Integrity equals `npm view iconv-lite@0.7.2 dist.integrity` and the sha512 of the downloaded tarball.
  - [x] `npm install --package-lock-only` keeps the entry; scratch `npm ci --ignore-scripts --strict-peer-deps --workspaces --include-workspace-root` passes.
- [x] **Lot 2 — Focus vite (DEPSMAIN-EX1)**
  - [x] Pin `vite` 6.4.5 (published 2026-10-21) and regenerate the Focus lock (`--before 2026-10-26`).
  - [x] Scratch `npm ci`, map generation, vite build and the 15 Focus tests pass.
- [x] **Lot 3 — Qualification**
  - [x] `make install`, `make typecheck`, `make lint`, `make test-ui`, `make build`, `make smoke-ui-bundle`, `make test-api`, `make test-immo-mcp` on `ENV=test-depsmain1107`.
  - [x] Results: typecheck, lint, build and smoke pass; UI 1823 passed / 10 todo; MCP 592 passed / 9 skipped; API 4343 passed / 985 skipped.
  - [x] attention: the full API run reported one failed suite, `tests/integration/artifacts-reader-exchange.spec.ts`, on an `afterAll` teardown timeout (20 s, `h.close()`) with no failing test; the scoped rerun passes 5/5. Lock metadata cannot change installed bytes, so this is load-related teardown, not a regression.
  - [x] `make audit-security`: 0 blocking high/critical, 10 tolerated moderate/low.
  - [x] Audits after: root production 0, Focus production vite finding gone.
  - [x] `make clean` on the test project.
- [ ] **Merge & close**: owner-controlled; PR not merged.
