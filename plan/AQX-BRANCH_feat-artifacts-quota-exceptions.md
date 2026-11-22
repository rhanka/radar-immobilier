# Feature: Admin-managed artifact quota exceptions and external heavy media

## Objective
Let an IMMO admin (account_users.is_admin, approved) grant a per-actor page-text
budget exception up to a hard 10 MiB system maximum, raise or reset durable
artifact quotas with an audit trail, unblock leaked upload sessions, and let
pages reference heavy media hosted outside the release (YouTube nocookie
embeds, configured Sentropic bucket origins).

## Scope / Guardrails
- Scope limited to the artifacts host package, the MCP artifact provider and
  authoring guide, the API admin surface, the release CSP and their docs.
- One migration max in `api/drizzle/*.sql`: `0049_artifacts_quota_exceptions.sql`
  (additive, replayable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in `./tmp/artifacts-quota-exceptions`. No system `/tmp`.
- Automated tests run on `ENV=test-aqx` only, always followed by `down -v`.
- In every `make` command, `ENV=<env>` is the last argument.
- No deploy, no kubectl, no prod/preprod database access, no merge.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts-host/src/**`
  - `packages/immo-mcp/src/registry/**`
  - `packages/immo-mcp/src/artifact-binding.ts`
  - `api/src/routes/admin.ts`
  - `api/src/routes/admin-artifact-quotas.ts`
  - `api/src/routes/admin-artifact-quotas.test.ts`
  - `api/src/app.ts`
  - `api/src/artifacts/release-files.ts`
  - `api/src/artifacts/release-files.test.ts`
  - `api/src/artifacts/release-isolation.test.ts`
  - `api/src/db/service-role-grants.ts`
  - `api/tests/integration/artifacts-quota-exceptions.spec.ts`
  - `api/tests/integration/service-role-grants.spec.ts`
  - `api/drizzle/0049_artifacts_quota_exceptions.sql`
  - `api/drizzle/meta/_journal.json`
  - `docs/operator/artefacts-mcp.md`
  - `plan/AQX-BRANCH_feat-artifacts-quota-exceptions.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `deploy/**`, `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `../sentropic/packages/artifacts/**` (cross-repo, exception AQX-EX1)
- **Exception process**:
  - AQX-EX1 — the release CSP is a constant of `@sentropic/artifacts`
    (`content/headers.ts`). Reason: owner request for external media sources.
    Impact: separate sentropic branch/PR adds an opt-in `externalSources`
    option; this branch composes the same directives host-side until a
    qualified provider release carries it. Rollback: close the sentropic PR;
    the host composition is removed with this branch.

## Feedback Loop
- `attention`: consensus review incomplete, both Codex legs failed at launch
  (`h2a_run` central_unavailable, dossier `tmp/reviews/aqx/dossier.md`, untracked); re-dispatch before merge.
- `attention`: the reported `limit_exceeded` on `artifacts_create_upload` is
  the provider open-upload-session bound (8 open sessions per principal, 24 h
  session TTL), not the durable `host_quotas` / `host_actor_quotas` counters
  (exhaustion there answers `conflict`, variant `quota_exhausted`).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one coherent host change; the provider PR is independent.

## UAT Management (in orchestration context)
- No UI surface changed; admin operations are API calls from an admin session.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` and pointers (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`).
  - [x] Create isolated worktree `./tmp/artifacts-quota-exceptions` from `origin/main`.
  - [x] Root cause of `limit_exceeded` traced in provider and host code.
  - [x] Environment mapping: `ENV=test-aqx` (no host ports).
  - [x] Declare exception AQX-EX1.

- [ ] **Lot 1 — Data model and effective budget**
  - [x] Migration 0049: page-text exceptions and quota admin audit events.
  - [x] `readPageTextBudget` (exception if active, else 5 MiB default, 10 MiB cap).
  - [x] MCP writer role keeps read-only access to the admin tables.

- [ ] **Lot 2 — Enforcement**
  - [x] Upload create/commit, bundle totals and browser page channel read the effective budget.
  - [x] MCP pre-validation checks the caller's budget (default 5 MiB when unknown).
  - [x] Authoring guide carries the caller's effective `pageTextBudget`.

- [ ] **Lot 3 — Admin surface**
  - [x] `GET/POST /api/v1/admin/artifacts/quotas/:actorId` (admin session only).
  - [x] Actor quota raise/reset, scope limit raise, page-text exception, upload-session expiry, audit rows.

- [ ] **Lot 4 — External heavy media**
  - [x] Release CSP: `frame-src https://www.youtube-nocookie.com`, configured bucket origins on `media-src`/`img-src`.
  - [x] Guide: YouTube and bucket paths, 10 GB bucket policy.
  - [x] Sentropic PR: opt-in `externalSources` on `contentHeaders` (AQX-EX1, rhanka/sentropic#1064).

- [ ] **Lot 5 — Verification and PR**
  - [x] `make typecheck` + `make lint` (`ENV=test-aqx-tc`).
  - [x] Scoped host, MCP and API tests on `ENV=test-aqx` through the existing standalone
    runners (`tools/mcp-p0b.mk integration|test-api`, `tools/immo-mcp-test.mk test-immo-mcp`),
    each tearing down with `down -v`.
  - [ ] Push branch, open draft PR with migration notes and post-deploy admin command.
