# Feature: Detection B followed by per-act P0 v2 classification

## Objective
- [x] Apply the owner's 2026-11-13 decision: preserve detection B, classify existing acts afterwards.

## Scope / Guardrails
- [x] Branch feat/refresh-two-step; base feat/refresh-single-pass-v2 (#1102, stacked on #1099); no merge or rebase of other lanes.
- [x] Worktree tmp/refresh-two-step; no .env reads, Python, default kubeconfig or commit trailers.
- [x] All make calls use SKIP_DOTENV=1 and ENV last; Compose uses --env-file /dev/null; remove stack volumes afterwards.
- [x] Test project test-refresh-two-step; API 18896, UI 15396, Maildev 11996, PostgreSQL 15596, S3 19196, Obscura 19296, SMTP 11096.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: api/src/services/graph/{refresh-*,reannotate-*}, api/src/scripts/{refresh-pv,reannotate-signals}.ts, deploy/k8s/34-refresh-cronjob.yaml, deploy/k8s/refresh-cronjobs/{refresh-018.mk,verify-renders.test.sh}, docs/spec/SPEC_EVOL_REFRESH_TWO_STEP.md, this plan.
- [x] Forbidden Paths: Makefile, docker-compose*.yml, rules/**, AGENTS.md, CLAUDE.md, GEMINI.md, other branch plans.
- [x] Conditional Paths: migrations and workflows require an exception; none planned.

## Feedback Loop
- [x] Owner explicitly authorizes retaining single-pass and compatibility with REFRESH_SINGLE_PASS despite the general no-legacy rule.
- [x] Design: keep classification out of extraction requests, graph bytes, coverage identity and detection receipts; share the reannotation writer and content hash.
- [x] Design: limit candidates to acts in this document's extraction, query their persisted evidence, skip unchanged input and all manual history.
- [x] Attention: final harness review selection failed (exact author model/effort and h2a_run MCP unavailable); tmp/two-step-review.md records evidence. No consensus claimed; final review belongs to i-cond.
- [x] Attention: grouped 2-worker campaign hit PostgreSQL backend exit 2 at 23:45:51 UTC and recovery until 23:46:49; rerun sequentially without changing assertions or timeouts.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; implementation sequential, two independent read-only design lenses per harness.

## UAT Management (in orchestration context)
- [x] No UI changes or root UAT stack; activation commands delivered for conductor execution.

## Plan / Todo (lot-based)
- [x] Lot 0: read mandatory rules and harness using-harness, brainstorm, test and review; confirm clean branch and scope.
- [x] Lot 1a: explicit mode parser and independent classification configuration.
- [x] Lot 1b: share bounded reannotation execution and changed-input filtering; isolate selection and classification failures.
- [x] Lot 2: wire separate models after durable publication/projection; select acts from completed chunks, including projection resumes; isolate failures.
- [x] Lot 3a: enforce off in CronJob renders and mutation guards; retain detection B settings.
- [x] Lot 3b: document activation, independent classification variables, legacy deprecation and filtered rollback.
- [x] Lot 4: test mode compatibility, byte-identical detection, new/changed acts, provenance, manual precedence, bounded work and failures.
  - [x] Configuration and shared service tests added; PostgreSQL pipeline fixture prepared.
  - [x] Full pipeline PostgreSQL tests added: byte parity, classification failures, manual thumbs-up, changed input, projection resume.
  - [x] Selection, evidence-read and cancellation isolation tested without changing detection state.
- [ ] Lot 5: typecheck, lint, targeted test-api including PostgreSQL, test-refresh-renders; down -v.
  - [x] Targeted test-api: 138 tests across 11 files passed with LOT_MIGRATION_DB_TEST=1 and --maxWorkers=1, including 12 real PostgreSQL tests; render mutation suite: 62 passed plus 4 purge guards.
- [ ] Lot 6: inspect final diff, push, PR against feat/refresh-single-pass-v2; report PR, files, tests and activation commands; no merge.
