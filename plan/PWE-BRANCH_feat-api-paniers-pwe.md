# Feature: PW-E combined write qualification

## Objective
- [ ] Qualify the combined PW-A/B/C/D candidate against conception v7:
  PWE-01 through PWE-12, HW-01 through HW-15, C01 through C12, M01 through M16.
- [ ] Require executed functional assertions, exact source/image identities,
  and zero required skipped cases before closing any qualification tranche.

## Scope / Guardrails
- [x] Base: delivered PW-C 37f21d3d82dffed1b51bec3f06632983cba0bd09.
- [x] Isolated local worktree: tmp/api-paniers-pwc/tmp/pwe.
- [x] Dedicated test/e2e ENV: test-api-paniers-pwe / e2e-api-paniers-pwe.
- [x] Ports: API 18935, UI 15935, Maildev 11935; ENV always last.
- [x] Make-only and container runtimes; no Python or environment-file reads.
- [x] Shared radar-docker-campaign.lock; wait for all foreign stacks.
- [x] Only owned resources removed; down -v --remove-orphans and release lock.
- [x] English Conventional subjects <=72 characters; no body or trailer.
- [x] At most 150 added/deleted lines per commit, selective staging and plan.
- [x] No push, production activation, migration renumbering or root UAT change.
- [x] Existing login/session only; exact identity domains; P never confirms.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: api/tests/integration/pwe-*.ts and e2e/tests/pwe/**.
- [x] Allowed: api/src/services/facets/pwe-*.ts and api/src/artifacts/pwe-*.ts.
- [x] Allowed: tools/make/base-api-pwe*, this plan and companion report.
- [x] Conditional: existing write-intent/facets primitives for a demonstrated
  blocking defect, with a recorded PWE-EXn and scoped regression evidence.
- [x] Conditional: API image/runtime bindings after a demonstrated gap and
  explicit CT-1 attribution; preserve API/MCP/content-reader/deny entrypoints.
- [x] Forbidden: Makefile, docker-compose*.yml, rules/**, agent instructions,
  other branch plans, api/drizzle/**, write-intent-transaction.ts.
- [x] Temporary container-only mutations restore original bytes before exit.

## Feedback Loop
- [x] Owner requested final PW-A integration before PW-E; intermediate bundle
  and report delivered, with 65 unit, 9 PG, 4396 API passes and 25 mutant kills.
- [x] Read conception sections 7.4-7.9, CT-1-CT-9 and the full PW-E matrices.
- [ ] Map every requirement to its exact assertion and observed evidence.
- [ ] Recheck approved PW-A migration numbering before final image campaign.

## Orchestration Mode (AI-selected)
- [x] Dedicated PW-E branch; preserve the delivered PW-C ref and bundle.
- [x] Serial Docker campaigns under the shared lock; no foreign cleanup.

## UAT Management (in orchestration context)
- [x] Automated browser qualification on test images; root dev remains stable.

## Plan / Todo (lot-based)
- [ ] PWE-01: published page, six operations, readback and executor counts.
- [ ] PWE-02: two HTTPS hosts, normal login, cookies and P-to-A navigation.
- [ ] PWE-03a: verified same-sub/different-issuer/tier credentials and bearers.
- [ ] PWE-03b: independent Origin, CSRF, remint and summary guards.
- [ ] PWE-04: concurrent confirms, rollback winner and prepare idempotence.
- [ ] PWE-05: both revision orders, private reader, fresh snapshot and sources.
- [ ] PWE-06: both revocation/authority orders and management after rights loss.
- [ ] PWE-07: independent expiry waits and complete transactional rollback.
- [ ] PWE-08: lost response, status contention, P expiry and immutable receipt.
- [ ] PWE-09: shared admission/audit/outbox/quotas and bounded browser polling.
- [ ] PWE-10: independently killed/restored authority mutants M01-M05/M09.
- [ ] PWE-11: independently killed/restored transaction mutants M06-M13.
- [ ] PWE-12: browser/error mutants M14-M16 and exact-image CT-9 gates.
- [ ] Gate: typecheck, targeted lint, scoped tests and complete API CI.
- [ ] Gate: HW-01-HW-15, C01-C12 both orders and all individual M01-M16 legs.
- [ ] Gate: fresh/upgrade/rerun migrations and unchanged applied prefix.
- [ ] Delivery: incremental bundle, prerequisite-only audit and French report.
