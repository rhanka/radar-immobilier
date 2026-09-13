# Chore: Final Immo MinIO and SCW eradication pass

## Objective
- [ ] Close T2 with OVH-backed storage and no active Immo SCW dependency except the explicitly retained TEM service.

## Scope / Guardrails
- [x] Worktree `tmp/scw-final-sweep`, branch `chore/scw-final-sweep`, base `097036783006226afea53a6b49383bf70890774f`.
- [x] Prepare in parallel; deploy only after T1 acceptance and conductor handoff.
- [x] Make-only, Docker-first; test environment `test-scw-final`; API_PORT=8882 UI_PORT=5382 MAILDEV_UI_PORT=1182. Verify ports before starting any service.
- [x] Read-only runtime audit, no Secret values, deletion, migration, provisioning, push or deploy by the audit delegate.
- [x] TEM retained; preserve historical evidence and protective URL-rejection tests. Shared MatchID dependencies require reconciled scope before any mutation.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed audit outputs: `docs/architecture/scw-final-sweep.md`, `docs/reviews/scw-final/**`, this plan.
- [x] Read main, recent retirement branches and the Geo/poc-k8s handoffs; do not change other worktrees or repositories.
- [x] Forbidden: root `Makefile`, `docker-compose*.yml`, `rules/**`, entrypoints, `.track/**`, other plans, application/infra/workflow edits during the audit phase.
- [x] Conditional: exact remediation paths released only after Astra design and Gemini review.

## Feedback Loop
- [x] Owner requests a FINAL eradication sweep: endpoints/buckets, images/rollback, suspended Jobs/CronJobs, CI/manual workflows, backup/restore, bootstrap, secret references and executable instructions. A registry migration is not closure.
- [x] Report to `codex:radar-immobilier:98cef8dfc274`, loop `loop:immo-transitions-2026-09-13`; no overall loop completion.

## Orchestration Mode (AI-selected)
- [x] Independent audit in a separate worktree; no overlap with refresh writer.

## UAT Management
- [x] Preserve root and production; no user-facing environment mutation by audit delegate.

## Plan / Todo (lot-based)
- [x] Lot 0: inventory every active residue on fresh main and classify active, local-only, historical, defensive, TEM or shared.
- [x] Lot 1: map clients to DB/S3 physical resources in preprod and production, recording unknowns and RBAC limits.
- [x] Lot 2: reuse existing #670 work; produce minimal remediation file map and repeatable final SCW acceptance checks.
- [ ] Lot 3: Astra design and Gemini review, then Sol implementation and Gemini post-build review.
- [ ] Lot 4: after T1, conductor verifies copy/parity/fencing/recovery and preprod then production cutovers.
- [ ] Lot 5: final active-dependency sweep and architecture/monthly evidence update.

Audit checkpoint: inventory, file map, and acceptance gates are recorded in
`docs/architecture/scw-final-sweep.md`; production runtime remains unproved
because the fixed OVH read-only identity is RBAC-denied.

## Merge / Close
- [ ] Conductor accepts code, CI, runtime and recovery proof; no closure based only on text search.
