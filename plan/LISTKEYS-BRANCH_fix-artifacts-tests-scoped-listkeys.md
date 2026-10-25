# Feature: Scoped artifact test inventories

## Objective
- [ ] Remove invalid S3 blob prefix calls and preserve exhaustive test isolation checks.

## Scope / Guardrails
- [x] Read repository rules and harness debug/test skills.
- [x] Work in `tmp/listkeys-prefix` from `f3436944`.
- [x] Use Make, containers, one worker, no Python, no environment-file inspection.
- [x] Use `ENV=test-listkeys`, API 18917, UI 15917, Maildev 11917; expose no test ports.
- [x] Finish code review before Docker; wait for other `radar-test-*` containers.
- [x] Stop below 10 GiB free memory or disk; remove this campaign's volumes afterward.
- [x] Use a local recovery Git directory; never write shared Git metadata or push.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: `api/tests/**`, `packages/artifacts-host/src/s3-timeout.spec.ts`, this plan, `RAPPORT-SOL-LISTKEYS.md`.
- [x] Forbidden Paths: production code, `Makefile`, `docker-compose*.yml`, `rules/**`, bootstrap files, other plans.
- [x] Conditional Paths: none.
- [x] Ignored campaign tooling and evidence live in `tmp/listkeys/`.

## Feedback Loop
- [x] LISTKEYS-EX1: explicit task requests single-line commits without trailers; the existing Make commit target matches this.
- [x] LISTKEYS-EX2: the requested French delivery report overrides the English Markdown policy for that file.
- [x] Provider qualification: enabled Q1/Q2 reports 69 failures on missing 0.1.2 contracts and explicitly uncovered cases; no provider upgrade or weakened assertion.
- [x] Record the intermittent MinIO commit-probe 503 in the delivery report; final scoped and complete API campaigns pass with its code and deadlines unchanged.

## Orchestration Mode (AI-selected)
- [x] Single branch, developer/tester/integrator in one session, per task.

## UAT Management (in orchestration context)
- [x] Tests only; no UI change or UAT deployment.

## Plan / Todo (lot-based)
- [x] Lot 0: baseline, complete call inventory, isolated recovery Git directory.
- [x] Lot 1: scoped queries, exhaustive bucket inventories, resilient cleanup.
- [x] Lot 2: static guard and real S3 regression/mutation coverage.
- [x] Lot 3: 20 scoped MinIO tests, 153 host tests, 3109 CI-equivalent API tests, lint and typecheck pass; gated provider limitation recorded above.
- [x] Lot 4: deliver the audited bundle, standalone report and teardown receipts in `tmp/listkeys/`.

## Merge & Close
- [x] Deliver a bundle only; no push or merge is authorized by this task.
