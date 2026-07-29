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

## Review round 3 — three defects, demonstrated by execution

- [x] **Lot 7 — Make the module's promise true**
  - [x] **Defect 1 — the archive could record a version it had not read.**
        `archiveCityGraphPrefix` did `get()` then a SEPARATE `head()`; a writer
        publishing in between made the inventory hold V0's bytes under V1's
        ETag, and the write-time check then compared the live ETag to that
        recorded one, found them equal, and published V2 — V1 destroyed, archive
        holding only V0. `ObjectStore.getWithEtag()` (implemented on
        `S3ObjectStore` from `GetObjectCommand`'s own `ETag`) returns bytes and
        version in ONE read; the archive, `canonicalMatchesBody` and the filet
        read all use it. Test: `never records a version it did not read the
        bytes of` — the review probe, a rival publishing on the read itself.
  - [x] **Defect 2 — the protected window started at the archive, not at the
        read.** The guard proved "nothing moved since the archive", never
        "nothing moved since the read that produced this body". `filet` reads
        `latest.json`, then does one S3 HEAD per Signal node — minutes — and
        only then archives; phase A reads Postgres for all 724 cities before the
        archive loop. A rival publishing in that interval was faithfully
        archived, the ETags matched, and a body derived from stale input was
        published over it: a silent lost update. `writeCanonicalCityGraph` now
        REQUIRES a `CanonicalReadAnchor` captured at the source read
        (`captureCanonicalReadAnchor` before `subgraphForCity` in phase A,
        `readCanonicalCityGraph` in filet) and refuses on two counts: the object
        moved since that read, or the archive does not cover the version the
        write would destroy.
  - [x] **Defect 3 — two thirds of the hardened gate guarded nothing.**
        `DEGRADATION_SENSITIVE_KEYS` covers `effet_densifiant`, `etape`,
        `instrument`, but the sentinel listed only `""` and `autre`. Only
        `instrumentFromSignal()` returns `autre`; `deriveEtape()` and
        `effectFromSignal()` return `inconnu`, so `etape: adoption → inconnu`
        passed unnoticed — the original defect replayed on two keys of three.
        The sentinel is now the union `"" | autre | inconnu`. No false positive:
        a regression is only reported when the BEFORE value is informative, so a
        node already unclassified is exempt on both sides, and `inconnu` is not
        a `VivierInstrument` any more than `autre` is a `VivierEtape`. Adding it
        in fact REMOVES a false positive (an already-`inconnu` node losing its
        properties used to be reported as a regression).
  - [x] Each fix has a test that fails BY BEHAVIOUR on the pre-fix code, checked
        by reverting the production change alone and re-running: defect 1
        `expected '"etag-2"' to be '"etag-1"'`, defect 2 `promise resolved
        instead of rejecting` (the phase A apply published over the rival),
        defect 3 `expected [] to deeply equal [{…}]`.
  - [x] Out of scope by owner decision, unchanged and not worsened: no
        restoration path, the two self-referencing resume commands,
        `putCanonicalGraph()` public without archive, no `If-Match` preflight on
        Scaleway, `archiveDigest` over-promising, streaming → batch, unbounded
        archive cost, `graphify-34-snapshot.test.ts:42`'s name exceeding its
        assertions.
