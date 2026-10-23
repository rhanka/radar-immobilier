# Feature: provider acceptance for Sentropic artifact deliveries

## Objective
Qualify the six requested H4 v3 provider behaviors against real PostgreSQL/S3.
Keep the r2 host API target and its remaining construction bindings explicit.

## Scope / Guardrails
- [x] Assigned worktree `.worktrees/861c-provider-acceptance`, branch
  `test/861c-provider-acceptance`, base `71f41b72`; root UAT stays untouched.
- [x] Make only, Docker execution, no Python, no `.env` reads or real data.
- [x] Test mapping: `ENV=test-861c-provider-acceptance`, API 18986, UI 15986,
  Maildev 11986; no published ports in the test compose files.
- [x] Check disk before campaigns; stop below 10 GiB available.
- [x] Every test stack ends with `down -v --remove-orphans`; ENV is last.
- [x] No provider/runtime changes, added dependencies or lockfile changes.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths**: this plan;
  `api/tests/integration/artifacts-provider-acceptance.spec.ts`;
  `api/tests/integration/artifacts-finalization-authorization.spec.ts`;
  `api/tests/integration/artifacts-provider-failures.spec.ts`;
  `api/tests/integration/artifacts-provider-contract.helpers.ts`;
  `tools/artifact-host.mk`; `RAPPORT-MUSE-PROVIDER-ACCEPTANCE.md`;
  `RAPPORT-SOL-PROVIDER-ACCEPTANCE.md`;
  uncommitted `RAPPORT-SOL-FIX1-908.md`;
  uncommitted `RAPPORT-SOL-Q1-Q2.md`; ignored evidence and local Git metadata
  under `tmp/861c-provider-acceptance/` and `tmp/861c-q1-q2/`.
- [x] **Forbidden Paths**: root Makefile, compose files, rules, agent entrypoints,
  other plans, runtime sources, manifests, lockfiles, upstream repositories.
- [x] **Conditional Paths**: no additional paths required.
- [x] Exception process: record reason, impact and rollback before expansion.

## Feedback Loop
- [x] BR861C-EX1: execution brief authorizes runner changes and commits without
  body/trailer, superseding Muse's earlier scope. Rollback: remove new targets.
- [x] BR861C-EX2: user authorizes a single adaptation module for provisional
  extension names. Rollback: remove that test-only helper.
- [x] Assemble commits and bundle using ignored local Git metadata; synchronize
  only the assigned branch after verifying the bundle and expected old head.
- [x] Cases 4/5 must qualify the selected provider profile, not just Radar's
  existing replay/hash compensation; they require selection before dispatch.

## Orchestration Mode (AI-selected)
- [x] Single assigned branch; no runtime implementation or merge requested.

## UAT Management (in orchestration context)
- [x] No UI change; automated isolated API qualification only.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Read baseline, scope, six-case packet and H4 v3 contracts.**
- [x] **Lot 1 — Typed, callable contract adapter; gated suite and cleanup.**
- [x] **Lot 2 — Refusal after lock wait; below-HTTP S3/connection failures.**
- [x] **Lot 3 — Bidirectional replay, ordered conflict, selected profile.**
- [x] **Lot 4 — Reproducible runner and tests included in static checking.**
- [x] **Lot 5 — Full CI-equivalent API suite with acceptance disabled.**
- [x] **Lot 6 — Enabled suite: archive each expected contract failure.**
- [x] **Lot 7 — Typecheck, lint and API build with declarations.**
- [x] **Lot 8 — Direct review, French report, atomic commits and verified bundle.**

## Upstream contract (spec r2, exact names)

- `ArtifactInvocationContext.authorizeCommit` from
  `@sentropic/artifacts/server/commit-contract`: compile-time binding plus a
  behavioral assertion that the callback receives the leased finalization
  transaction AFTER the barrier. Retired: `host.setFinalizeAuthorization`.
- `host.execute(request, invocation)` (equivalently `host.app.execute`) with
  `ArtifactOutcome` from `@sentropic/artifacts/server/outcome-contract`:
  assert `outcome.ok === false`, `outcome.failure.cause`, category and
  invocation ID BEFORE projection. Retired: `host.app.takeTypedCause`.
- `host.selectedCapabilities`: frozen four-name value
  (`artifacts_ensure`, `artifacts_get`, `artifacts_list`,
  `artifacts_publish`) plus the compiled profile digest. Retired: truthy
  property check.
- Test-only `createArtifactCommitBarrier()` from
  `@sentropic/artifacts/testing`, bound once as the coordinator
  `testObserver`; points `before_connection_acquire`, `before_key_lock`,
  `before_blob_put`, `after_blob_put_before_verify`,
  `before_blob_readback`, `before_finalization_row_lock`,
  `after_finalization_locks_before_guard`,
  `after_replay_lookup_before_guard`, `before_commit`.
- All three upstream entries are loaded dynamically in
  `artifacts-provider-contract.helpers.ts`; each missing entry fails as
  `[missing-contract] <entry>` against 0.1.2. The two retired slots never
  raise that diagnostic. New suites: Q1
  `api/tests/integration/artifacts-finalization-authorization.spec.ts`, Q2
  `api/tests/integration/artifacts-provider-failures.spec.ts` (same gate,
  quota/admission `not covered` via the helper where H3 units 5-6 are
  missing).

## Baseline verification commands
- [x] `rtk make -f tools/artifact-host.mk test-api API_PORT=18986 UI_PORT=15986 MAILDEV_UI_PORT=11986 ENV=test-861c-provider-acceptance`
- [x] `rtk make -f tools/artifact-host.mk test-provider-acceptance ARTIFACTS_PROVIDER_ACCEPTANCE=1 API_PORT=18986 UI_PORT=15986 MAILDEV_UI_PORT=11986 ENV=test-861c-provider-acceptance`
- [x] `rtk make -f tools/artifact-host.mk verify-provider-acceptance API_PORT=18986 UI_PORT=15986 MAILDEV_UI_PORT=11986 ENV=test-861c-provider-acceptance`
- [x] `rtk make -f tools/artifact-host.mk down API_PORT=18986 UI_PORT=15986 MAILDEV_UI_PORT=11986 ENV=test-861c-provider-acceptance`

## Baseline evidence at original head 3fc55b4f
- [x] Full API: 218 files / 2830 tests passed, 23 files / 80 tests skipped.
- [x] Enabled acceptance: six missing-contract failures only (two clean runs).
- [x] Final static gates and declaration emit passed; isolated stack removed.
- [x] Independent review selection failed on missing exact author metadata;
  no consensus claimed and no merge requested; dossier in ignored evidence.

## Q1/Q2 r2 qualification
- [x] Preserve Muse's uncommitted input in ignored evidence; rebase the local
  delivery branch on `9a81508704b8ee247e3d402f9cbf15d458edfe2a`.
- [x] Correct syntax, void barrier arrivals, private-cause redaction, leased
  query faults, COMMIT acknowledgment injection and process separation.
- [x] Bind `ArtifactInvocationContext.authorizeCommit` by a type-only import;
  isolated typechecking uses clearly labeled baseline declarations only when
  installed exports are absent. Candidate declarations replace those shims.
- [x] Never synthesize an allowed authorization fence. Transaction participant
  construction remains an explicit upstream binding prerequisite.
- [x] Recheck full API suite after rebase: 224 files / 3010 tests pass;
  56 files / 256 cases skipped, including all 65 gated acceptance cases.
- [x] Archive 63 missing-contract and two explicit not-covered failures, with
  zero skipped or passing cases on the installed provider 0.1.2.
- [x] Reject both disabled-reminder and zero-executed-case mutations on copies;
  gate 1 observed inside test-api and test-host containers.
- [x] Typecheck tests/workspaces, lint and API declaration build pass.
- [x] Confirm default gate 0 and installed provider 0.1.2 inside test-host;
  all 153 host tests plus the isolated forwarding probe pass.
- [x] Record per-case results and the bounded upstream handoff. Selectively
  stage declaration/case snapshots with the plan; every commit is <=150 lines.
- [x] Verify a bundle requiring only `9a815087`, English subjects <=72 chars,
  empty commit bodies/trailers, and unchanged existing suites/runtime/lock.
- [ ] Candidate qualification: replace provisional construction with the real
  compiled profile/coordinator/transaction participant and cleanup bindings;
  prove preparation accounting/cleanup/shared blobs and both race orders.

## Review 1 corrections
- [x] Name both unimplemented construction joints before partial composition.
- [x] Distinguish replay guards and permit the public MCP error field.
- [x] Use transaction-bound policy reads and both serialization orders.
- [x] Specify observable preparation deadlines, shared cleanup and purge claims.
- [x] Target E3 phases and the finalization COMMIT with one-shot faults.
- [x] Assert read 503, same-host correlation, reverse replay and direct selection.
- [x] Reject zero/skipped required API and host suites, including option scopes.
- [x] Pin final mutation, API, static and baseline-contract receipts.

## Q1/Q2 delivery slices
- [x] Slice 001: harden artifact acceptance qualification.
- [x] Slice 002: bind r2 provider contracts.
- [x] Slice 003: bind r2 provider contracts.
- [x] Slice 004: bind r2 provider contracts.
- [x] Slice 005: bind r2 provider contracts.
- [x] Slice 006: retire superseded provider assertion.
- [x] Slice 007: migrate provider acceptance case.
- [x] Slice 008: migrate provider acceptance case.
- [x] Slice 009: migrate provider acceptance case.
- [x] Slice 010: migrate provider acceptance case.
- [x] Slice 011: migrate provider acceptance case.
- [x] Slice 012: add finalization authorization case.
- [x] Slice 013: add finalization authorization case.
- [x] Slice 014: add finalization authorization case.
- [x] Slice 015: add finalization authorization case.
- [x] Slice 016: add finalization authorization case.
- [x] Slice 017: add finalization authorization case.
- [x] Slice 018: add finalization authorization case.
- [x] Slice 019: add finalization authorization case.
- [x] Slice 020: add provider failure case.
- [x] Slice 021: add provider failure case.
- [x] Slice 022: add provider failure case.
- [x] Slice 023: add provider failure case.
- [x] Slice 024: add provider failure case.
- [x] Slice 025: add provider failure case.
- [x] Slice 026: add provider failure case.

## Review 1 delivery slices
- [x] reject empty required suites and forward scope options.
- [x] name missing r2 construction and migration bindings.
- [x] serialize lifecycle writers and observe purge deletion claims.
- [x] drain commit barriers while preserving the targeted wait.
- [x] bind private invocation and provider outcome contracts.
- [x] bind acceptance fixtures to the compiled provider host.
- [x] exercise provider command conflicts without facade hashing.
- [x] refuse unselected provider operations before storage.
- [x] bind authorization fixtures to transaction participants.
- [x] bind authorization fixtures to transaction participants.
- [x] bind authorization fixtures to transaction participants.
- [x] bind authorization fixtures to transaction participants.
- [x] bind authorization fixtures to transaction participants.
- [x] inspect both process preparations and the losing attempt.
- [x] inspect both process preparations and the losing attempt.
- [x] serialize lifecycle writers and observe purge deletion claims.
- [x] retain typed provider failure causes before wire projection.
- [x] target SQL fault phases and reject internal retries.
- [x] retain typed provider failure causes before wire projection.
- [x] require retriable read failures to project as 503.
- [x] docs: record review fixes and qualification prerequisites.

## Review 2 delivery slices
- [x] bind full Radar profile and reject constant digests.
- [x] reconcile S3 inventory with invocation cleanup intents.
- [x] reject private identifiers in every MCP representation.
- [x] name E3 phase seams without requiring optional SQL.
- [x] attribute refused preparation to its captured invocation.
- [x] reject forged scopes and invalid keys on direct execute.
- [x] reconcile S3 inventory with invocation cleanup intents.
- [x] reconcile preparation inventory after denied finalization.
