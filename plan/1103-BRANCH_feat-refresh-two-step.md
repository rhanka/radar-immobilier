# Feature: Detection B followed by per-act P0 v2 classification

## Objective
- [x] Apply the owner's decision: preserve detection B; classify only new or changed acts in the current two-step run.

## Scope / Guardrails
- [x] Branch feat/refresh-two-step; base feat/refresh-single-pass-v2 (#1102, stacked on #1099); no merge or rebase of other lanes.
- [x] Worktree tmp/refresh-two-step; no .env reads, Python, default kubeconfig or commit trailers.
- [x] All make calls use SKIP_DOTENV=1 and ENV last; Compose uses --env-file /dev/null; remove stack volumes afterwards.
- [x] Test project test-refresh-two-step; API 18896, UI 15396, Maildev 11996, PostgreSQL 15596, S3 19196, Obscura 19296, SMTP 11096.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: api/src/services/graph/{refresh-*,reannotate-*}, api/src/scripts/{refresh-pv,reannotate-signals}.ts, api/src/scripts/refresh-pv.test.ts, deploy/k8s/34-refresh-cronjob.yaml, deploy/k8s/refresh-cronjobs/{refresh-018.mk,verify-renders.test.sh}, docs/spec/SPEC_EVOL_REFRESH_TWO_STEP.md, this plan.
- [x] Forbidden Paths: Makefile, docker-compose*.yml, rules/**, AGENTS.md, CLAUDE.md, GEMINI.md, other branch plans.
- [x] Conditional Paths: migrations and workflows require an exception; BR1103-EX2 covers the replay correction for unmerged migration 0046. No workflow change.
- [x] BR1103-EX2: failing required validation authorizes api/src/services/graph/purge-ai-annotations-db.test.ts and api/drizzle/0046_signal_class_ambiguity.sql. Evidence: rollback tests expected implicit activation/manual provenance synthesis; CI run 43530288804 fails migration replay on duplicate ambiguous column. Impact: align tests with explicit mode and inherited API contract; make the unmerged v2 migration replayable. Rollback: revert these scoped fixes. No deployed migration or workflow is changed.
- [x] BR1103-EX1: owner-requested API-off parity authorizes api/src/routes/{graph-signals*,signal-facets-headers.test,legacy-filter-a-transport-golden.test}.ts, api/src/services/facets/{scoped-signal-cards,scoped-by-city,scoped-transition}.ts, api/src/services/graph/class-annotations* and api/tests/integration/facets-refresh.spec.ts. Impact: API readers and inactive-selection no-ops ignore stored overlays at off; operational history remains readable. Rollback: revert the mode-aware changes and test boundary mocks.

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
- [x] Lot 5: typecheck, lint, targeted test-api including PostgreSQL, test-refresh-renders; down -v completed on test-refresh-two-step only.
  - [x] Targeted test-api: 138 tests across 11 files passed with LOT_MIGRATION_DB_TEST=1 and --maxWorkers=1, including 12 real PostgreSQL tests; render mutation suite: 62 passed plus 4 purge guards.
  - [x] Workspace typecheck and lint passed; existing Svelte/ESLint warnings only. Commands use test volumes and skip ownership bootstrap after initial test-api dependency installation.
- [x] Lot 6: final diff inspected; branch pushed; PR #1106 opened against feat/refresh-single-pass-v2 with design, validation, activation and rollback. No deployment or merge. CI remains pending; final review belongs to i-cond.
- [x] Review correction: integrate #1099 head 8e4b8e2ba into v2, then merge updated v2 locally; no PR merge.
- [x] Review correction: bound classification SQL sessions with statement/lock timeouts and destroy their dedicated connection on cancellation; bound each act and run.
- [x] Review correction: reserve calls and conservative token allowances before every model send, across detection/verification/classification; share the sweep deadline and halt extraction cleanly at exhaustion.
- [x] Earlier review correction (superseded below): unchanged v2 inputs skipped regardless of model/prompt changes; missing v2 annotations remained eligible. Manual preflight retained independently of API overlays.
- [x] Review correction: API cards and counts ignore persisted AI overlays at off, including after prior activation; retain inherited #1099 manual payload parity tests.
- [x] Review correction: propagate the sweep stop signal to detection too; test successful document coverage with classification stopped at the shared call cap.
- [x] Review correction: keep inactive selections as main no-ops at off, even with stored AI history; align route test doubles with the visible-annotation reader; install transaction-local writer timeouts for every caller.
- [x] Validation correction: enable AI explicitly in rollback fixtures, include ambiguity, assert manual history without synthesizing removed overlays; make migration 0046 replay-safe after missing journal entries.
- [x] Final correction gate: typecheck and lint passed (8 Svelte warnings, 1 ESLint warning); targeted test-api passed 218 tests in 23 files, including 50 PostgreSQL/storage integration tests and migration replays; test-refresh-renders passed 62 checks plus 4 purge guards. Logs: tmp/review-{static-final,api-final,renders}.log.
- [x] Final correction isolation: PostgreSQL backend exit 2 and slow fsync recovery were observed on the initial disk-backed test stack. Final campaign used a fresh tmpfs PGDATA under the same isolated project, unchanged assertions/timeouts and --maxWorkers=1. Clean completed with down -v; no root/dev data touched.
- [x] Final correction inspection: #1099 head 8e4b8e2ba is an ancestor; remote v2 is ac0641632 and was merged by 45f40c893. Main comparison is b7724bdd9. Off tests preserve manual API bytes and restore cards/counts/inactive-selection no-ops despite existing AI rows. No detection prompt/schema edits; no PR merge or deployment.
- [x] Final owner decision: compare classification input SHA against the immutable pre-publication archive, including projection resumes. Existing unchanged acts are excluded with missing/v1/v2 annotations. Catch-up is exclusively the 30-day reannotation, dry-run then apply on owner GO.
