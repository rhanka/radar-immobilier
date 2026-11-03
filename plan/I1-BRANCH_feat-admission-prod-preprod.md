# Feature: Admission prod -> preprod (lot I1, R1)

## Objective
Every user approved in prod opens preprod artifacts with no prior step, no DB restore, and no per-environment declaration. Implements converged-R2 §2.6 (lot I1): signed Ed25519 admission snapshots prod -> preprod, read-only ingestion, JIT sub reconciliation by verified email.

## Scope / Guardrails
- Scope limited to admission sync: `api/src/admission/**`, OIDC/session claim plumbing, reader-opening JIT hook, admin mutation emission, one migration, three Make targets, runbook, tests.
- One migration max in `api/drizzle/*.sql`: `0030_admission_sync.sql`.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in the `admission-i1` worktree. Do not use system `/tmp`.
- Automated test campaigns run on `ENV=test-i1`, never on root `dev`.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English. Discussions with the user may be in French.
- No Python anywhere. No kubectl/cluster action, no deploy, no merge, no secret creation in this lot.
- Commits carry no trailer (standing user rule, overrides the harness default).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/admission/**`
  - `api/src/db/schema.ts`
  - `api/src/config.ts`
  - `api/src/services/auth/**`
  - `api/src/routes/auth.ts`
  - `api/src/routes/admin.ts`
  - `api/src/artifacts/reader-opening.ts`
  - `api/src/app.ts`
  - `api/src/index.ts`
  - `api/package.json` (scripts only)
  - `api/tests/integration/admission-i1.spec.ts`
  - `.env.example`
  - `docs/runbook-admission-sync.md`
  - `plan/I1-BRANCH_feat-admission-prod-preprod.md` (this file)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` — see I1-EX1
  - `api/drizzle/*.sql` + `api/drizzle/meta/_journal.json` — see I1-EX2 (1 file)
- **Exception process**:
  - `I1-EX1` (Makefile, additive only): three targets `admission-snapshot`, `admission-ingest`, `admission-verify`. Reason: the lot contract requires Make targets for emission/ingestion/manual check. Impact: new `.PHONY` block, no existing target touched. Rollback: delete the block.
  - `I1-EX2` (migration): `0030_admission_sync.sql` + journal entry (additive, `IF NOT EXISTS`). Reason: `admission_source` column + staging + replay guard. Rollback: fresh DBs re-migrate; deployed DBs keep dormant tables (no code reads them when disabled).

## Feedback Loop
- No subagent delegation in this lot (direct execution only).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single coherent lot, single test cycle)
- [ ] **Multi-branch**
- Rationale: I1 is one bounded lot (≤ 5 j) with one migration and one test stack.

## UAT Management
- No UI surface in this lot: no UAT. Verification is API/integration on `ENV=test-i1`.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, converged-R2 §2.6/§4/C5/C7, owner answers.
  - [x] Confirm branch `feat/admission-prod-preprod` in the `admission-i1` worktree.
  - [x] Test env `ENV=test-i1` (test compose exposes no host ports; volumes namespaced per project).
- [x] **Lot 1 — Prod snapshot (sign) + preprod ingest (verify/apply)**
  - [x] Migration `0030_admission_sync.sql` + journal + drizzle schema.
  - [x] `api/src/admission/snapshot.ts` (Ed25519 build/sign/verify) + unit tests.
  - [x] `api/src/admission/ingest.ts` (staging, prod_sync propagation, replay guard, full-snapshot absent marking).
  - [x] `api/src/admission/route.ts` webhook + `sync-job.ts` cron/manual CLI.
  - [x] Config/env plumbing + `.env.example`.
- [x] **Lot 2 — JIT reconciliation + wiring**
  - [x] `api/src/admission/jit.ts` (verified-email linking, never-relink, local protection, concurrency-safe).
  - [x] Session/OIDC claim plumbing (`email_verified`, `iss`).
  - [x] JIT at app login (callback), MCP bearer (opportunistic), reader opening before `getRights`.
  - [x] Prod mutation emission hook (admin routes, best-effort + honest flag).
- [x] **Lot 3 — Gates & delivery**
  - [x] `make typecheck ENV=test-i1` (green)
  - [x] `make lint ENV=test-i1` (green)
  - [x] `make test-api SCOPE=src/admission/snapshot.test.ts ENV=test-i1` (9 pass)
  - [x] `make test-api SCOPE=src/admission/admission-config.test.ts ENV=test-i1` (6 pass)
  - [x] `make test-api SCOPE=tests/integration/admission-i1.spec.ts ENV=test-i1` (11 pass, 3 consecutive runs)
  - [x] Regression: session (12) / oidc (24) / auth (106) / admin (22) / config (24) suites green
  - [x] Full `make test-api ENV=test-i1`: 3934 pass, 0 fail, 978 skipped (pre-existing skips)
  - [x] `make build ENV=test-i1` green; e2e skipped (no UI/browser surface in this lot)
  - [x] Smoke Make targets on `ENV=test-i1` (keygen/snapshot/verify/ingest chain green), then `down -v` + volume cleanup
  - [x] Commit (no trailer), push, `gh pr create` (English, no AI line) — PR #987
  - [x] French report `/.lanes/conductor/tmp/reviews/i1-admission-report.md`
