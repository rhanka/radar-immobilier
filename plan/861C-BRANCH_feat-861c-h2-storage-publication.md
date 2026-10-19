# Feature: artifact storage and publication — 861c H2

## Objective
Implement LOT-H2 c1–c15 on H1: durable private bindings, bounded static publication, cookie-only control and isolated verification.

## Scope / Guardrails
- Use the assigned .worktrees/861c-h2 checkout and stacked branch; source library is read-only.
- No dotenv reads, native runtimes, external writes, pushes or PRs.
- Exact @sentropic/artifacts 0.1.2; two byte-identical package migrations are explicitly authorized.
- Make only; ENV=test-861c-h2 last. Test ports: API 18903, UI 15903, Maildev UI 11903, Postgres 15904, S3 19903, Obscura 19904, SMTP 11904. The test compose overlay publishes no host ports.
- Root dev/UAT remains reserved. Commits have English subjects only, at most 150 changed lines.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - api/package.json, package-lock.json, .dockerignore, tools/artifact-host.mk
  - api/drizzle/0014_artifacts_core.sql, api/drizzle/0015_artifacts_lifecycle.sql, api/drizzle/meta/_journal.json
  - api/tests/integration/**, api/src/artifacts/control-route*.ts, api/vitest.config.ts
  - packages/artifacts-host/**, api/Dockerfile, api/src/app.ts, api/src/index.ts
  - plan/861C-BRANCH_feat-861c-h2-storage-publication.md
  - Local ignored reports and logs under tmp/861c-h2-logs/
- **Forbidden Paths (must not change in this branch)**:
  - Makefile, docker-compose*.yml, rules/**, CLAUDE.md, AGENTS.md, GEMINI.md
  - Other branch plans, api/src/config.ts, deploy/**, library checkout
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None.
- **Exception process**:
  - Declare rationale, impact and rollback before any expansion.

## Feedback Loop
- Resolved: inherited lock mismatch prevented npm ci; regenerated in the test container with only artifact/workspace metadata changed.
- Resolved: the 0013 scratch journal must exclude all later migrations. Four test workers bound concurrent database startup on this 32-CPU host; no timeout was increased.
- Review: local source and executable acceptance review completed; complementary peer selection unavailable (no live model catalog; inherited author's exact model unavailable). No consensus claimed.
- Migration numbering may collide with #859; the second merged branch must renumber, preserving byte content and journal order.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (assigned stacked worktree, no history transfer)
- [ ] **Multi-branch**
- Rationale: one storage/publication lot and one isolated stack at a time.

## UAT Management (in orchestration context)
- No UI change or root UAT session is requested. Verification uses the test stack only.

## Plan / Todo (lot-based)
- [ ] **Lot H2-a — package and storage primitives**
  - [ ] Dependency pin and lock (c1).
  - [x] Storage configuration (c7).
  - [x] Configuration regression tests.
  - [x] Account approval reader and tests (c13).
  - [x] Dedicated pool, key/hash derivation and advisory locks (c10).
  - [x] Idempotency regression tests.
  - [x] Preserve all JSON keys in parameter hashing.
  - [x] Publication policy (c11).
  - [x] Publication policy regression tests.
  - [x] Schema/scope bootstrap and connection routing (c8).
  - [x] Postgres/S3, lifecycle and SQL ensure composition (c8, c9).
  - [x] HTTP library facade (c12).
  - [x] Shared package entrypoint and checks (c6).
- [ ] **Lot H2-b — migration and HTTP integration**
  - [x] Test tooling, dotenv exclusion and image wiring (c2, c6).
  - [x] Exclude generated verification snapshots from lint.
  - [x] Migration drift and historical boundary tests (c5).
  - [x] Core migration and journal (c3).
  - [x] Lifecycle migration and journal (c4).
  - [x] Migration provenance tests (c5).
  - [x] Cookie-only control guards (c14).
  - [x] Auth-only application mount and startup wiring (c14).
  - [x] Offline HTTP guard regression tests (c15).
  - [x] Postgres/S3 publication and concurrency tests (c15).
  - [x] HTTP negatives and migration startup tests (c15).
- [ ] **Lot gate**
  - [ ] Targeted suites, complete API with configuration absent and present, MCP.
  - [ ] Typecheck, lint, image-smoke.
  - [ ] Local report, atomic commits, down -v and zero remaining stack resources.
