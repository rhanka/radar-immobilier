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

## Orchestration Mode (AI-selected)
- [x] Single branch, developer/tester/integrator in one session, per task.

## UAT Management (in orchestration context)
- [x] Tests only; no UI change or UAT deployment.

## Plan / Todo (lot-based)
- [x] Lot 0: baseline, complete call inventory, isolated recovery Git directory.
- [ ] Lot 1: scoped queries, exhaustive bucket inventories, resilient cleanup.
- [ ] Lot 2: static guard and real S3 regression/mutation coverage.
- [ ] Lot 3: scoped suites, full CI-equivalent API suite, lint, typecheck.
- [ ] Lot 4: bundle audit in a fresh repository, report and teardown.

## Merge & Close
- [x] Deliver a bundle only; no push or merge is authorized by this task.
