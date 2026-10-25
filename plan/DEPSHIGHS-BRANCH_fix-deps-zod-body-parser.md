# Feature: Root Zod and body-parser high advisories

## Objective
- [ ] Remediate compatible high dependency findings; document instances that require a forbidden major upgrade or peer violation.

## Scope / Guardrails
- [x] Isolated worktree: `tmp/deps-highs`, branch `fix/deps-zod-body-parser`, base `e45a714c4012cfcba3f25ae3750998215295e67e`.
- [x] Make-only, containerized Node/npm; no Python or environment-file reads.
- [x] One Docker campaign at a time; one Vitest worker; stop below 10 GiB free; final `down -v --remove-orphans`.
- [x] Shared Git is read-only; local rescue repository uses this workspace as its worktree; no push or merge.
- [x] Owner instruction supersedes the commit trailer default: English Conventional Commits, subject only, at most 150 changed lines each.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**: `package.json`, `package-lock.json`, `.security/findings/2026-10-24-zod-body-parser-highs.md`, this branch file.
- [x] **Forbidden Paths (must not change in this branch)**: `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, other branch plans, `tmp/vite-focus/**`.
- [x] **Conditional Paths**: application/test sources only if a reproduced regression directly requires a fix and a scope exception is recorded first.
- [x] **Exception process**: record `DEPSHIGHS-EXn` with reason, impact, and rollback before expanding scope.
- [x] **DEPSHIGHS-EX1**: owner instruction `consigne-sol-fix-pr912.md` authorizes `Makefile`, `.github/workflows/ci.yml`, `.security/vulnerability-register.yaml`, and `tools/security/**` to enforce the existing Zod acceptance. Impact: HIGH/CRITICAL npm-tree gate and unit tests in Quality gates; rollback: revert this follow-up bundle. No compose, dependency, application, or deployment change.
- [x] Local report, evidence, supplemental Makefiles, sanitized source snapshot, and rescue Git repositories live outside the delivered patch.

## Feedback Loop
- [x] `attention`: Zod 3.25.76 remains vulnerable; the audit requires >=4.6.6, violating five direct workspace ranges and both Ollama peer ranges. Owner decision required for a separate migration; no forced override.
- [x] `attention`: first full test run times out in commit-probe `afterAll` (20 seconds); isolated file and unchanged full rerun pass. Exact cleanup delay cause unresolved; preserve both runs, with no timeout change or flaky acceptance.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: sequential dependency/test campaign; no source transfer between branches.

## UAT Management (in orchestration context)
- [x] Automated verification only; root checkout and UAT services remain untouched.
- [x] `ENV=test-deps-highs`; reserved ports API 8849, UI 5349, Maildev UI 1149; the test stack publishes no host ports.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read project rules, security/testing skills, previous campaign report and findings.
  - [x] Confirm branch/base, scope, available disk, and Make targets.
  - [x] Create local rescue repository and source snapshot excluding all environment files.
- [x] **Lot 1 — Inventory & minimal compatible fix**
  - [x] Record all installed instances, consumers, declared dependency/peer ranges, and registry patches.
  - [x] Update only compatible dependency resolutions through containerized Make targets.
  - [x] Assert the complete lockfile diff: body-parser 2.4.0, required iconv-lite 0.7.3 and qs 6.16.1; 837 entries preserved, no manifest changes.
- [x] **Lot 2 — Verification**
  - [x] Read-only audit and hashes: body-parser removed; 0 critical, 3 Zod-related high entries remain, all other records identical.
  - [x] CI-equivalent lint, workspace typecheck, API/UI build and UI bundle smoke.
  - [x] CI `test` target: final unchanged rerun passes 7,006 tests, 260 skipped, 10 todo; retain the initial cleanup-hook failure.
  - [x] API Zod validation (15 checks) and Express parsing (12 checks); advisory crash reproduced before and absent after.
- [x] **Lot 3 — Documentation & local delivery**
  - [x] Write security finding with explicit compatibility blocker and bounded remediation options.
  - [x] Commit selective changes in subject-only commits of at most 150 lines.
  - [x] Create bundle from the exact base and audit it in a fresh repository; repeat on the final documentation commit.
  - [x] Write French campaign report; final SHA and bundle SHA-256 are recorded after packaging.
  - [x] Remove campaign containers/volumes; observed free space stays above 29 GiB; shared Git remains at the base.
- [x] **Merge & close — outside this local delivery**
  - [x] No push, PR mutation, merge, or risk acceptance authorized by this campaign.
- [ ] **Lot 4 — Astra PR912 corrections**
  - [x] Recover rescue Git at PR head `7eac7167`, preserve earlier delivery, and clean only campaign Docker resources.
  - [x] Deliver the existing Zod acceptance as exact registry rows with a stable root component identity.
  - [x] Deliver exact exception matching, UTC expiration, audit propagation, and closed failure on invalid input.
  - [ ] Deliver unit regressions for matching, expiry, severity thresholds, and the register layout.
  - [ ] Deliver regressions for propagation, component scope, malformed input, and the checked-in register.
  - [ ] Deliver the containerized CLI, CI Make wiring, and clarified acceptance status.
  - [ ] Execute the CI Make step in Docker, synthetic CLI cases, lint, typecheck, and Quality gates tests.
  - [ ] Deliver subject-only commits of at most 150 lines and audit the bundle from `7eac7167` in a fresh repository.
  - [ ] Append evidence and bundle identity to the French report; remove campaign containers and volumes.
