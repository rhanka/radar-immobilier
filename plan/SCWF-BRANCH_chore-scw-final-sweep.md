# Chore: Final Immo MinIO and SCW eradication pass

## Objective
- [ ] Close T2 with OVH-backed storage and no active Immo SCW dependency except the explicitly retained TEM service.

## Scope / Guardrails
- [x] Worktree `tmp/scw-final-sweep`, branch `chore/scw-final-sweep`, base `097036783006226afea53a6b49383bf70890774f`.
- [x] September 13 owner amendment: START T2 implementation immediately in parallel with T1; environment cutover remains conductor-controlled, preprod before prod.
- [x] Make-only, Docker-first; test environment `test-scw-final`; API_PORT=8882 UI_PORT=5382 MAILDEV_UI_PORT=1182. Verify ports before starting any service.
- [x] Read-only runtime audit, no Secret values, deletion, migration, provisioning, push or deploy by the audit delegate.
- [x] TEM retained; preserve historical evidence and protective URL-rejection tests. Shared MatchID dependencies require reconciled scope before any mutation.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed audit outputs: `docs/architecture/scw-final-sweep.md`, `docs/reviews/scw-final/**`, this plan.
- [x] Read main, recent retirement branches and the Geo/poc-k8s handoffs; do not change other worktrees or repositories.
- [x] Forbidden: root `Makefile`, `docker-compose*.yml`, `rules/**`, entrypoints, `.track/**`, other plans, application/infra/workflow edits during the audit phase.
- [x] SCWF-EX1: extend this audit branch to the exact implementation paths in `docs/reviews/scw-final/build-design.md`, after independent review reconciliation; impact is branch-local manifests/scripts/tests, rollback by reverting the relevant atomic commits, no runtime changes by builders.
- [x] Conditional: legacy grounding retirement requires T1 canonical writer acceptance; resource/data deletion requires parity, recovery and zero-consumer proof. These do not block independent T2 code preparation.

## Feedback Loop
- [x] Owner requests a FINAL eradication sweep: endpoints/buckets, images/rollback, suspended Jobs/CronJobs, CI/manual workflows, backup/restore, bootstrap, secret references and executable instructions. A registry migration is not closure.
- [x] Report to `codex:radar-immobilier:98cef8dfc274`, loop `loop:immo-transitions-2026-09-13`; no overall loop completion.
- [x] Owner-selected routing: Astra design, authorized Fable 5 independent review fallback, Sol xhigh build, independent post-build review; no two-peer consensus claim.

## Orchestration Mode (AI-selected)
- [x] Independent audit in a separate worktree; no overlap with refresh writer.

## UAT Management
- [x] Preserve root and production; no user-facing environment mutation by audit delegate.

## Plan / Todo (lot-based)
- [x] Lot 0: inventory every active residue on fresh main and classify active, local-only, historical, defensive, TEM or shared.
- [x] Lot 1: map clients to DB/S3 physical resources in preprod and production, recording unknowns and RBAC limits.
- [x] Lot 2: reuse existing #670 work; produce minimal remediation file map and repeatable final SCW acceptance checks.
- [ ] Lot 3: Astra design and Gemini review, then Sol implementation and Gemini post-build review.
- [x] Lot 3a: conductor defines the bounded parallel implementation and cutover dependencies in `docs/reviews/scw-final/build-design.md`.
- [x] Lot 3b: Fable GO_WITH_CHANGES reconciled (F1 required complete bindings; F2 defer armed refresh-diag; F3/F4 remaining-client visibility); amended first slice released to Sol.
- [x] Lot 3c: remove unused object-storage credentials from PostgreSQL migration containers.
- [x] Lot 3d1: require complete graph bindings in projection Jobs.
- [x] Lot 3d2: require complete graph bindings in graphify and export Jobs.
- [x] Lot 3d3: require complete scrape bindings in manual Jobs.
- [x] Lot 3e1: retire uncalled SCW mount executables.
- [x] Lot 3e2: correct active object-storage deployment guidance.
- [x] Lot 3f: add and pass scoped offline storage-binding regression checks.
- [x] Lot 3g1: record the first-slice checkpoint and explicit remaining-client list.
- [ ] Lot 3g2: run final offline gates and complete independent post-build review.
- [ ] Lot 4: after T1, conductor verifies copy/parity/fencing/recovery and preprod then production cutovers.
- [ ] Lot 5: final active-dependency sweep and architecture/monthly evidence update.

Audit checkpoint: inventory, file map, and acceptance gates are recorded in
`docs/architecture/scw-final-sweep.md`; production runtime remains unproved
because the fixed OVH read-only identity is RBAC-denied.

## Merge / Close
- [ ] Conductor accepts code, CI, runtime and recovery proof; no closure based only on text search.
