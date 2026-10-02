# Feature: Executable documentary-date stock recovery + stage-date fallback

## Objective
- [x] Make bounded periods work on already-published graphs: project raw-sidecar `fetchedAt` and known documentary dates onto served refs, without model calls.
- [x] Document basis falls back to the signal stage date for undated refs, in the shared domain rule (aggregate = detail). Scrape basis reads only `fetchedAt`. Never `createdAt`.
- [x] Keep shared `filter.*` restrictions when a bare `/geo?…` link is canonicalized to `/geo/region/quebec`.

## Scope / Guardrails
- [x] Node/TS only; no Python, no new image, no LLM call.
- [x] No production action; preprod Job only (namespace hardcoded, cluster checked, preview by default, apply needs `RECOVERY_CONFIRM=1`).
- [x] Recovery never overwrites a value present on a ref; conflicts are reported; idempotent.
- [x] Tests on `ENV=test-ddr`; `make clean ENV=test-ddr` after the stack.

## Allowed Paths
- `packages/radar-domain/src/signals/document-date-filter.ts` + test
- `api/src/services/sources/document-date-recovery.ts` + test, `api/src/scripts/recover-document-dates.ts`
- `api/src/services/graph/graph-store.test.ts`, `api/tests/integration/graph-signals-date-parity.spec.ts`
- `ui/src/lib/router/router.ts` + test
- `deploy/k8s/document-date-recovery/job.yaml`, `Makefile` (recovery targets + `k8s-validate` hook)
- `docs/spec/SPEC_EVOL_DOCUMENT_DATES.md`, this plan

## Lots
- [x] Lot 1 — domain stage-date fallback + unit/aggregate/integration parity tests.
- [x] Lot 2 — recovery planner (pure) + CLI script + unit tests.
- [x] Lot 3 — preprod Job manifest + Make targets (validate offline, preview/apply).
- [x] Lot 4 — `/geo` redirect keeps the query string + router test.
- [x] Lot 5 — spec update; `make typecheck`, `make lint`, `make test` green on `ENV=test-ddr`.
- [ ] Post-merge (conductor) — preprod preview, review the report, then apply.
