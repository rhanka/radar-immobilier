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
- [x] SCWF-EX2: authorize only the MinIO cutover design now; after conductor release, the exact second-slice paths are those frozen in `docs/reviews/scw-final/minio-cutover-design.md`, with refresh-overlay scope conditional on avoiding duplicate T1 work; rollback is per atomic source commit, never a live reverse-copy.
- [x] SCWF-EX3: release the bounded tool/checker/test paths plus one quality-gate step in `.github/workflows/ci.yml` per `minio-cutover-reconciliation.md`; CI currently does not run the checker, impact is offline validation only, rollback is the individual source commit; runtime manifests remain gated.
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
- [x] Lot 3f2: guard retained local-development, diagnostic, and TEM bindings.
- [x] Lot 3g1: record the first-slice checkpoint and explicit remaining-client list.
- [ ] Lot 3g2: run final offline gates and complete independent post-build review.
- [x] Lot 3g2a: dispatch the owner-authorized independent Fable review of first-slice commit `332af1e8` and second-slice design `671380f4`; no consensus or acceptance claim until its readable findings are reconciled.
- [x] Lot 3h1: freeze the implementation-ready RAW/DOCS/GRAPH client matrix, migration-tool contract, and second-slice paths.
- [x] Lot 3h1a: preserve independent Fable cutover findings B1-B5 separately; conflict convergence, multi-source identity and declared exclusions require reconciliation before tool release.
- [x] Lot 3h2: conductor reconciles independent findings A1-A3/B1-B5 and releases only the tool, tests and CI gate; runtime bindings remain gated separately.
- [ ] Lot 3h3: build and hermetically test the dry-run-default, non-destructive migration/proof tool.
  - [x] Freeze the fail-closed CLI, coordinate, credential, prefix and resource-limit guards.
  - [x] Inventory every page/body and emit complete classified manifests.
    - [x] Isolate path-style clients and exhaust paginated bucket listings with bounded retries.
    - [x] Stream each body hash and capture preserved headers, metadata, tags and diagnostic ETags.
    - [x] Wire classified receipts and failure evidence into the operation result.
  - [x] Compare single-source or approved-union parity and proof inputs.
  - [x] Copy missing objects and reconcile only exact migration-owned versions.
    - [x] Add bounded conditional copy workers preserving all contracted object attributes.
    - [x] Re-inventory copied keys and write the immutable ownership ledger.
    - [x] Gate reconciliation on an exact ledger, fence, versioning and prior VersionId.
      - [x] Reuse bounded workers with atomic missing-versus-owned write preconditions.
  - [ ] Enforce hermetic failure paths, binding checks and the CI gate.
    - [x] Build a filesystem-backed AWS CLI shim with version and metadata semantics.
    - [x] Cover dry-run, validation, pagination, copy, metadata, ETag, conflicts and exclusions.
    - [x] Cover retries, the failure cap and complete multi-source union provenance.
    - [x] Cover exact owned reconciliation, versioning refusal, foreign change and fenced delta.
    - [x] Extend the binding gate and retain the explicit pending-client ledger.
    - [x] Invoke the combined offline object-storage gate once from CI quality.
- [ ] Lot 3h4: inventory/provision/copy/fence and bind preprod RAW/DOCS; preserve the separate GRAPH plane.
- [ ] Lot 3h5: after preprod acceptance, repeat inventory/provision/copy/fence and bindings for production.
- [ ] Lot 4: conductor verifies copy/parity/fencing/recovery and preprod then production cutovers; T1 gates only legacy grounding retirement.
- [ ] Lot 5: final active-dependency sweep and architecture/monthly evidence update.

Audit checkpoint: inventory, file map, and acceptance gates are recorded in
`docs/architecture/scw-final-sweep.md`; production runtime remains unproved
because the fixed OVH read-only identity is RBAC-denied.

## Merge / Close
- [ ] Conductor accepts code, CI, runtime and recovery proof; no closure based only on text search.
