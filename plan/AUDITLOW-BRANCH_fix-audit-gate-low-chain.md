# Feature: Resolve valid npm audit peer dependency cycles

## Objective
- [x] Restore the HIGH/CRITICAL gate for valid npm audit cycles without weakening malformed-input rejection.

## Scope / Guardrails
- [x] Make-only, container-only execution; no secret-file inspection or push.
- [x] Start from audited `origin/main` at `62dd355366574b43a196c5c5d86d0823dd497fe0`.
- [x] Use repository-local `tmp/sol-audit-rescue` because the shared Git directory is read-only.
- [x] Audit commands use `ENV=ci` last; one-off containers expose no ports or service dependencies.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths**: `tools/security/audit-lib.mjs`, `tools/security/audit-cycles.test.mjs`, `tools/security/fixtures/npm-audit-peer-cycle.json`, this plan.
- [x] **Forbidden Paths**: `Makefile`, `docker-compose*.yml`, `rules/**`, agent entry points, other branch plans, dependency manifests and locks.
- [x] **Conditional Paths**: none required.

## Feedback Loop
- [x] The capture shows reciprocal plugin/inspector `via` and `effects`, with a reachable LOW merge advisory and populated `nodes`.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one bounded parser fix.

## UAT Management (in orchestration context)
- [x] No UI surface changes; automated audit checks qualify this fix.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: read project rules, verify base SHA, capture npm 11.19.1 JSON in the CI container.
- [x] **Lot 1 — Regression**: anonymize the captured cycle; observe two new tests fail before the fix.
- [x] **Lot 2 — Parser**: traverse each reachable entry once per root and reject roots without any reachable advisory.
- [x] Preserve malformed entries, broken links, missing nodes and advisory validation.
- [x] Verify LOW tolerance and HIGH/CRITICAL blocking through peer cycles.
- [x] **Lot 3 — Qualification**: 70 audit tests, live audit, scoped lint and diff inspection pass.
- [x] Registry still reports deepmerge 4.3.1; no patched override is available.
- [ ] Write `RAPPORT-SOL-AUDIT-GATE.md` outside the commit.
- [ ] **Merge & close**: owner-controlled; no push requested.
