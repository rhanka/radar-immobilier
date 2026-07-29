# Feature: Graphify 3.4 Phase A safety guards

## Objective

Correct the measured Phase A destructive-write defects before any production
application, while retaining the existing dry-run default.

## Scope / Guardrails

- No `--apply`, production S3 operation, credential read, Docker stack, or Kubernetes action.
- Vitest is run directly and only on the focused API test files at the owner's instruction.
- The batch must archive every selected `graph/<city>/` prefix before it writes any canonical snapshot.
- Instrument values already present are authoritative; no canonicalization is performed in this pass.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `api/src/services/graph/graphify-34-enrichment.ts`
  - `api/src/services/graph/graphify-34-enrichment.test.ts`
  - `api/src/services/graph/graphify-34-enrichment.integration.test.ts`
  - `api/src/services/graph/graphify-34-snapshot.ts`
  - `api/src/services/graph/graphify-34-snapshot.test.ts`
  - `api/src/services/graph/graph-store.ts`
  - `api/src/services/graph/graph-store.test.ts`
  - `api/src/scripts/graphify-34-enrich.ts`
  - `plan/G34GUARD-BRANCH_fix-graphify-34-phase-a-guards.md`
  - **G34GUARD-EX1** (review round 2 — the guard must be carried by the write
    path, not by one caller; see Lot 4):
    - `api/src/services/graph/canonical-graph-writer.ts` (new)
    - `api/src/services/graph/canonical-graph-writer.test.ts` (new)
    - `api/src/services/graph/canonical-graph-store.fixture.ts` (new)
    - `api/src/storage/object-store.ts`, `api/src/storage/s3-object-store.ts`,
      `api/src/storage/s3-object-store.test.ts` (new)
    - `api/src/scripts/filet-auto-link-pv.ts` (second writer of the same key)
    - `tools/graphify-v23/gate.sh`, `tools/grounding/publish-citation-grounding.sh`
      (fail-closed backup probe only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `.track/**`
  - `.github/**`
  - `ui/**`
  - `api/src/services/graph/vivier-v2.ts`
  - `packages/immo-mcp/src/raw-data.ts`

## Orchestration Mode (AI-selected)

- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: the three guards change one sequential enrichment command and its narrow unit tests.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline & constraints**
  - [x] Created `fix/graphify-34-phase-a-guards` from `origin/main` in the existing worktree.
  - [x] Read the project rules, workflow, test rules, and Phase A writer/configuration.
  - [x] Confirmed that no S3 or production operation will be run.

- [x] **Lot 1 — Preserve existing business values**
  - [x] Guard `instrument` on absence only and remove the `effet_densifiant` placeholder write.
  - [x] Reject an informative business value degraded to `autre` or an empty string.
  - [x] Add focused regression tests and prove their pre-fix failure.

- [x] **Lot 2 — Archive before apply**
  - [x] Archive selected city prefixes and require a completion marker before canonical writes.
  - [x] Wire the archive-before-write sequence into `--apply` without running it.
  - [x] Add a focused failure-path test and prove its pre-fix failure.

- [x] **Lot 3 — Deliver**
  - [x] Run focused Vitest directly, inspect the scope, commit, push, and open the PR.

## Review round 2 — five defects found by adversarial review

- [x] **Lot 4 — Move the guard onto the write path (TOCTOU + other writers)**
  - [x] `S3ObjectStore.put()` REFUSES `graph/<city>/latest.json`; the only door is
        `canonical-graph-writer.ts`, which archives the pre-image, re-checks the
        ETag and sends a conditional PUT. A guard held by one caller protected
        nothing: `filet-auto-link-pv` wrote the same key with no archive at all.
  - [x] `filet-auto-link-pv` routed through the guarded writer.
  - [x] **Declared limit**: the shell publishers (`tools/graphify-v23/gate.sh`,
        `tools/grounding/publish-citation-grounding.sh`) use `s5cmd` and are NOT
        covered by the guard. Only their fail-open backup probe was fixed
        (`s5cmd ls` returns non-zero for "absent" AND for a network/authorization
        error; the second case now aborts instead of publishing unarchived).
        They still carry no expected version and can still overwrite a version
        this module archived. Concurrent shell publication remains unprotected.
  - [x] **Declared limit**: `If-Match` on PUT is honoured by AWS S3 and MinIO;
        Scaleway support was NOT verified here. The HEAD re-check narrows the
        race when the header is ignored — it does not close it. Not atomic.

- [x] **Lot 5 — Un-break the hardened gate (false positive)**
  - [x] The degradation rule (`""`/`autre` = absent) applied to EVERY key of
        EVERY node, but `autre` is a valid domain value: `ZoneKind` includes it
        and `zoneKindOf()` returns it on purpose for `REC-137`. A zone moving
        `H` → `autre` refused the projection of the whole city.
  - [x] Restricted to the three keys phase A writes (`effet_densifiant`,
        `etape`, `instrument`). Every other key keeps presence-only protection.
  - [x] Counter-examples are tests: `REC-137` H→autre and `notes` → `""` pass;
        both FAIL against the pre-fix branch head `3e8d3d7`.

- [x] **Lot 6 — Green CI, resumability, verifiable archives**
  - [x] The integration test asserted 48 `effet_densifiant` present after
        projection while the branch deliberately stopped writing them. Realigned
        to the decision (48 missing / 0 present) and strengthened with an
        explicit "key absent from every node" assertion; the `etape` /
        `instrument` round-trip and idempotence assertions are unchanged.
  - [x] Apply is RESUMABLE, not atomic: an apply plan and one `_applied/<city>`
        marker per completed city; `--backup-id=<id> --resume` skips what
        completed, and an interruption reports the applied cities, the single
        city that may be half-written, the archive prefix to restore it from,
        and the exact resume command.
  - [x] Archives are verifiable and non-overwritable: the marker inventories
        every key with its sha256 plus a digest over the inventory, a resume
        re-reads and re-hashes each archived object, and reusing a backup id
        aborts instead of overwriting an archive.
