# Feature: artifact storage and publication — 861c H2

## Objective
Implement LOT-H2 c1–c15 on H1: durable private bindings, bounded static publication, cookie-only control and isolated verification.

## Scope / Guardrails
- Use the assigned .worktrees/861c-h2 checkout and stacked branch; source library is read-only.
- No dotenv reads, native runtimes, external writes, pushes or PRs.
- Exact @sentropic/artifacts 0.1.2; two byte-identical package migrations are explicitly authorized.
- The atomic storage group contains ARTIFACTS_STORAGE_SCOPE, ARTIFACTS_ORG_ID, ARTIFACTS_S3_BUCKET, ARTIFACTS_S3_ENDPOINT, ARTIFACTS_S3_REGION, ARTIFACTS_S3_ACCESS_KEY and ARTIFACTS_S3_SECRET_KEY; ARTIFACTS_CONTENT_BASE is separate.
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
- Resolved: the 0013 scratch journal must exclude all later migrations. Opus corrections remove the global worker cap; local verification uses --no-file-parallelism after concurrent scratch-database checkpoints (13.907 s observed). No timeout was increased.
- Review: local source and executable acceptance review completed; complementary peer selection unavailable (no live model catalog; inherited author's exact model unavailable). No consensus claimed.
- Migration numbering may collide with #859; the second merged branch must renumber, preserving byte content and journal order.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (assigned stacked worktree, no history transfer)
- [ ] **Multi-branch**
- Rationale: one storage/publication lot and one isolated stack at a time.

## UAT Management (in orchestration context)
- No UI change or root UAT session is requested. Verification uses the test stack only.

## Plan / Todo (lot-based)
- [x] **Lot H2-a — package and storage primitives**
  - [x] Dependency pin and lock (c1).
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
- [x] **Lot H2-b — migration and HTTP integration**
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
- [x] **Lot gate**
  - [x] Targeted suites, complete API with configuration absent and present, MCP.
  - [x] Typecheck, lint, image-smoke.
  - [x] Local report, atomic commits, down -v and zero remaining stack resources.
- [x] **Opus review corrections**
  - [x] D1: isolate configuration failure from unavailable storage startup; log schema/hash, organization and DB causes precisely; never query a failed backend for approval.
  - [x] D1-a: extract and test the startup resolver (invalid config, open mode, storage failure).
  - [x] D1-b/D2: keep the startup test inside rootDir; real empty-schema/offline-Postgres integrations pass; read guards also accept absent fetch metadata.
  - [x] D2/D9c/D9e: allow same-origin reads without Origin; retain POST guards.
  - [x] D3: require and use ARTIFACTS_S3_REGION (seventh storage variable); synthetic configuration includes all seven values.
  - [x] D4: exclude nested .env* except .env.example; four nested refusal probes pass; smoke image cleanup runs on every exit.
  - [x] D5: bound lock wait to 3 s with local timeout reset, explicit 409 conflict; S3 request/connection deadlines 5 s/3 s with throwOnRequestTimeout; handle idle pool errors.
  - [x] D5-b: log only the idle error message, excluding the attached pg client; package tests, API/package typechecks and targeted lint pass.
  - [x] D6: validate stable content links before publication (three invalid-origin cases, zero backend calls).
  - [x] D7/D9b: assert the 0015 tag and lifecycle object before/after drift and replay; reject mismatched journal hashes without a scope write.
  - [x] D8: remove generic install/run/commit targets; inspect is read-only; retain the alias and remove global maxWorkers.
  - [x] D9d: use three independent literal SHA-256 vectors calculated with sha256sum, including UTF-8.
  - [x] D10: delete unreachable config checks and leading blank lines; fix indentation; name all six skipped tests; remove smoke image, stack resources, snapshots and node_modules.
  - [x] Final gates: 40 shared tests; 69 targeted API tests; full API twice (2345 passed, 6 skipped); 96 MCP tests; typecheck, lint and image-smoke passed. Latest diagnostic change passes its own checks and the final snapshot.
- [x] **Every-commit-green constraint**: all 12 correction snapshots pass API/package typechecks and targeted tests after the authorized local rebase; startup test fixed in 2327fb8a and 67ec4bde, remaining integrations in ae069ca1. 74810538 also passes without 57P01. The 26 protected SHAs and final code tree are unchanged; test stack resources are removed.
