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
- [x] SCWF-EX4: prepare only the RAW preprod read-only inventory path in the root `Makefile`, `deploy/ci/`, `deploy/k8s/object-storage-inventory-preprod/`, and their runbook sections; credentials must use the reviewed Secret/ConfigMap key references, durable evidence uses a dedicated bounded PVC, and the MinIO ingress exception is selector-scoped. Applying support or starting a Job remains conductor-controlled and separately confirmed; no copy, PUT, delete, fence, cutover, binding, or existing workload mutation is authorized. Rollback is by reverting these branch-local preparation commits; no live cleanup is implied.
- [x] SCWF-EX5: owner-authorized preprod completion may scale only the proven RAW writer `radar-api`, bind its zero-ready observation into a fence artifact, complete the fenced RAW checkpoint, consume the reviewed proof for conditional non-destructive copy/reconcile/delta, and rebind/re-enable only after exact parity. Suspend projection only during the shared ConfigMap switch. No MinIO/object/PVC/Secret deletion is included; DOCS retirement remains blocked until its distinct live sources and exact OVH destination are complete.
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
  - [x] Builder passes the combined hermetic gate and offline K8s validation.
  - [x] Preserve the failed first Fable launch as explicit non-review evidence.
  - [x] Preserve the completed Fable review at `a8e97286`; its required write-path remediations are implemented through `cb5e1f4c`.
  - [ ] Conductor completes the independent post-build review.
- [x] Lot 3g2a: dispatch the owner-authorized independent Fable review of first-slice commit `332af1e8` and second-slice design `671380f4`; no consensus or acceptance claim until its readable findings are reconciled.
- [x] Lot 3h1: freeze the implementation-ready RAW/DOCS/GRAPH client matrix, migration-tool contract, and second-slice paths.
- [x] Lot 3h1a: preserve independent Fable cutover findings B1-B5 separately; conflict convergence, multi-source identity and declared exclusions require reconciliation before tool release.
- [x] Lot 3h2: conductor reconciles independent findings A1-A3/B1-B5 and releases only the tool, tests and CI gate; runtime bindings remain gated separately.
- [x] Lot 3h3: build and hermetically test the dry-run-default, non-destructive migration/proof tool.
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
      - [x] Re-read the ledger-owned prior VersionId body and metadata before overwrite.
  - [x] Enforce hermetic failure paths, binding checks and the CI gate.
    - [x] Build a filesystem-backed AWS CLI shim with version and metadata semantics.
    - [x] Cover dry-run, validation, pagination, copy, metadata, ETag, conflicts and exclusions.
    - [x] Cover retries, the failure cap and complete multi-source union provenance.
      - [x] Require DOCS unions, complete credentials and exact target access proof.
    - [x] Cover exact owned reconciliation, versioning refusal, foreign change and fenced delta.
      - [x] Emit missing fence proof and repeat expected-manifest digests in reconciliation receipts.
      - [x] Refuse every destination write while any `missingProof` remains.
      - [x] Reset and assert the exact retry counter bound in the hermetic shim.
      - [x] Require conditional-write capability evidence before every executed copy.
      - [x] Reconcile the independent write-path and conditional-PUT findings.
      - [x] Move fence-record validation before every executed copy write path.
      - [x] Bound capability-proof age and validity to 48 hours and cover rejection dimensions.
      - [x] Align the operator runbook and current hermetic test count.
      - [x] Document capability-proof custody and the current-version-only boundary.
      - [x] Regress source-versus-approved-union disagreement before copy.
    - [x] Extend the binding gate and retain the explicit pending-client ledger.
    - [x] Invoke the combined offline object-storage gate once from CI quality.
    - [x] Document the bounded operator contract and explicit non-acceptance limits.
- [ ] Lot 3h4: inventory/provision/copy/fence and bind preprod RAW/DOCS; preserve the separate GRAPH plane.
  - [x] Record the bounded live MinIO inventory and classify `radar-immobilier-docs-preprod` as migrate-and-retain, without claiming completeness or parity.
  - [x] Reconcile resumable-inventory design findings F1-F10 before implementation.
  - [x] Conditional after independent review: build the resumable whole-bucket `StartAfter` inventory design without weakening copy gates.
    - [x] Bind resumable checkpoints to a canonical credential-free configuration digest.
    - [x] Commit provisional root pages and resume with exclusive `StartAfter` boundaries.
    - [x] Commit body shards atomically and resume only missing object evidence.
    - [x] Finalize stable provisional and resumable fenced chains without validation overclaim.
    - [x] Require executed copies to consume the final proof without monolithic relisting.
    - [x] Cover empty truncated pages, uncommitted tails, byte order and oversized blockers.
    - [x] Bound each checkpoint-mode storage call by the declared time budget.
    - [x] Propagate page and phase-summary durable commit failures before live inventory.
    - [x] Document full fenced body re-reads and inventory-proof freshness custody.
    - [x] Prepare a guarded RAW-only preprod Job with durable checkpoints and exact credential references.
- [ ] Lot 3h5: after preprod acceptance, repeat inventory/provision/copy/fence and bindings for production.
- [ ] Lot 4: conductor verifies copy/parity/fencing/recovery and preprod then production cutovers; T1 gates only legacy grounding retirement.
- [ ] Lot 5: final active-dependency sweep and architecture/monthly evidence update.

Audit checkpoint: inventory, file map, and acceptance gates are recorded in
`docs/architecture/scw-final-sweep.md`; production runtime remains unproved
because the fixed OVH read-only identity is RBAC-denied.

## Merge / Close
- [ ] Conductor accepts code, CI, runtime and recovery proof; no closure based only on text search.
