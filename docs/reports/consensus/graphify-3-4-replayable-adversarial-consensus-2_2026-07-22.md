# Graphify 3.4 replayable materializer — independent adversarial consensus #2

**Date:** 2026-07-22
**Review baseline:** `HEAD` `0fd8908`, `feat/graphify-3-4-replayable` `d58eb53`,
`tools/graphify-v23`, S3/projection conventions, and the current immo/GEO boundary.
**Scope:** recommendation only. No production code, living specification, plan, Track, or
other-agent file was changed. Earlier consensus reports were deliberately not read.

## Verdict

**Conditional GO for the 3.4 design; NO-GO for reusing v2.3 as its materializer or
publisher.** The branch plan has the right direction (full InputSet, same materializer,
immutable shadow, pointer CAS, protected-set comparison), but its FL-01 through FL-04
must be frozen with the decisions below before implementation.

The central rule is:

```text
authoritative raw CAS + tombstones + approved patch log
  -> canonical complete InputSet
  -> one deterministic materializer (cache-aware, never baseline-dependent)
  -> immutable candidate + immutable manifest
  -> validate all gates
  -> conditional pointer swap
  -> project exactly the selected immutable snapshot
```

An incremental refresh is only an efficient way to reconstruct the same complete
InputSet. It is never a transformation of `latest.json` and never a second graph path.

## Evidence that rejects the v2.3 path

- The v2.3 worker copies a graph baseline and transforms it before it makes an
  extraction; its raw directories are created empty. The later Graphify ontology output
  is not the value serialized into the candidate. It therefore cannot prove
  `raw -> graph` cumulatively or compare a full run with an incremental run
  (`tools/graphify-v23/worker.sh:32-48,80-124`).
- Its transform infers `etape` from prose/category, substitutes an event date for an
  `etape_date`, creates `generated://` citations, and silently drops incompatible
  edges (`tools/graphify-v23/graphify_to_extraction_v23.js:129-152,186-198,233-240,
  266-275`). Those are unacceptable mutations or losses in a replay proof.
- Its final graph contains a wall-clock `generated_at`
  (`tools/graphify-v23/extraction_to_v23_graph.js:93-100`). A 3.4 comparison may
  exclude only an explicitly declared volatile metadata set; it must never exclude
  business dates, IDs, topology, classifications, citations, or provenance.
- The existing v2.3 gate only protects Signal and DesignationEvent counts, then
  overwrites `graph/<city>/latest.json` after a backup
  (`tools/graphify-v23/gate.sh:68-113,153-179`). It neither compares the protected
  business keys nor conditionally swaps a selection.
- `ObjectStore.put` is unconditional and its `ObjectInfo` exposes no ETag
  (`api/src/storage/object-store.ts:1-27`, `api/src/storage/s3-object-store.ts:25-62`).
  The current abstraction cannot implement a compare-and-set cutover.
- The projector reads `latest.json` as the payload and treats a failed GET, malformed
  JSON, or missing `nodes` as a skip (`api/src/scripts/project-graph-from-s3.ts:91-121`).
  A selected snapshot failure must be visible and blocking, not silently skipped.
- The present per-city PostgreSQL transaction is a useful guard, but it protects only
  a count of complete signal proofs. It does not compare protected keys or remove an
  edge that disappeared while both endpoints survived
  (`api/src/services/graph/graph-store.ts:482-685`). Counts can remain stable while
  a relation or its evidence is lost.
- `filet-auto-link-pv` is another direct writer of the current graph payload and
  writes S3 before reprojecting (`api/src/scripts/filet-auto-link-pv.ts:231-276`).
  It must join the single resolver/selection protocol; otherwise an aborted
  projection can leave S3 and PostgreSQL on different selections.

## Decisions to freeze

### D1 — Cumulative authority and two equal paths

1. Freeze a versioned, canonical per-city **InputSet** as the only authority:
   sorted raw CAS entries, source/run-manifest references, explicit tombstones,
   approved human patch-log hash, and the parser/materializer/ontology versions.
   Parsed and LLM artifacts are versioned caches, never authority.
2. Hash the canonical, uncompressed InputSet bytes as `inputsetHash`. The manifest
   must record every expected item and one terminal status:
   `processed`, `cache-hit`, `excluded` (with approved reason), or `error`.
   Missing, malformed, or unexpectedly omitted input exits non-zero and is not
   converted into an empty result.
3. A **full** run builds the complete InputSet directly from raw CAS. An
   **incremental** run applies the delta/tombstones/patches only to reconstruct that
   same complete InputSet, then calls the same pure materializer. It must not use a
   previously selected graph as a semantic baseline.
4. Keep a second `materializationHash`: SHA-256 of canonical graph bytes after only
   declared volatile fields are removed. `inputsetHash` identifies evidence; the
   materialization hash identifies the exact graph. A changed materialization hash
   is a new shadow candidate even if the InputSet is unchanged.

This extends the S3-first layout, which already distinguishes immutable raw CAS,
manifests, versioned graph artifacts, and a mutable pointer
(`docs/spec/SPEC_PERSISTENCE_S3_FIRST.md:25-61,90-111`). Current run manifests
commit CAS collection correctly, but do not yet define a complete InputSet, a global
hash, tombstones, or parser/prompt/model versions
(`api/src/services/sources/run-manifest.ts:4-75`).

### D2 — Deterministic materializer / LLM boundary

The deterministic side owns InputSet assembly, ordering, document identity,
`docSha/locator/spanHash` candidate identity, business-key-to-node-ID mapping, raw
references, source and zone/lot facts, topology, protected-field fingerprints,
canonical serialization, and all ranking/scoring inputs.

The LLM receives only a stable candidate and its source-grounded segments. Its
structured result is an immutable cache artifact keyed by the candidate ID, prompt
version/hash, exact model/reasoning configuration, and input-segment hash. It may
return a cited classification/prose proposal only. It cannot introduce or alter an
ID, endpoint/relation, raw reference, source hash, zone/lot fact, GEO proof,
old/new bound, score, stage/history, or a favorable densification fact.

The materializer validates that every returned citation is a supplied segment and
that the response is in schema. An unavailable or invalid LLM result is a terminal
`error`/`needs-review` item, not a label fallback or silent retry. A later model or
prompt produces a new candidate; replay of an accepted candidate reuses the pinned
artifact rather than making a new uncontrolled call.

### D3 — Canonical comparison and idempotence

The comparator must sort nodes by stable business key/ID, edges by
`source/type/target` plus canonical ref fingerprint, and object keys recursively.
Its exclusion allowlist is itself versioned and limited to execution metadata such
as `generated_at`, `builtAt`, and run/log timestamps. It must not mask a changed
business date, classification, signal category, zone/lot/bylaw relation, citation,
`rawRef`, source hash, GEO proof, node ID, or edge.

Run the materializer twice from the exact same InputSet and pinned LLM artifacts:
the second run must make no LLM call, create no new immutable object, move no pointer,
and leave the PostgreSQL projection unchanged. The v2.3 `generated_at` difference is
the explicit reason this comparison has to be canonical rather than byte-for-byte.

### D4 — Immutable shadow and conditional selection

Write, before any cutover, the graph and manifest under immutable keys such as:

```text
graph/<city>/3.4/<inputsetHash>/<materializationHash>/graph.json
graph/<city>/3.4/<inputsetHash>/<materializationHash>/manifest.json
```

The manifest binds city, InputSet, graph hash/key, parser/ontology/materializer
versions, LLM artifacts, protected-set hash, GEO-proof hash, exclusions/errors, and
validation report. The candidate is unselectable until all hashes and gates pass.

`graph/<city>/latest.json` becomes a **selection pointer**, not graph payload. It
contains the schema version, city, immutable graph key/hash, immutable manifest
key/hash, InputSet/materialization hashes, and prior selection reference. A shared
resolver validates all of these before returning a graph. There is no payload
fallback.

Extend the object-store boundary with a conditional pointer replacement that reads
and returns ETags and fails on an unexpected current ETag/hash. First prove the exact
S3/MinIO conditional semantics in integration tests. Cutover is idempotent:

- current selection already equals the requested candidate -> `already-selected`;
- current selection equals the supplied expected value -> one conditional swap;
- otherwise -> conflict, with no overwrite.

All current readers and writers of `latest.json` (projection, refresh, filet,
grounding, and approved jobs) must use that resolver before payload semantics change.
This inventory is a prerequisite, not an optional migration detail.

### D5 — Projection and rollback are selections, not deletions

After a successful pointer swap, resolve the selected immutable graph and project
that exact selection hash in the existing per-city DB transaction. Record the graph
and selection hashes applied. The DB may lag S3, but it may not project a payload
that is not a validated selection.

Normal projection gates reject partial/empty snapshots, protected-set drift, and
proof/topology regression. They must also delete absent edges between retained nodes;
the present orphan-node deletion alone leaves ghost evidence.

Rollback conditionally repoints to the recorded prior validated selection, then
projects that exact immutable target. It never deletes raw CAS, parsed/LLM cache,
graph candidates, manifests, or prior selections. Because rolling back can lower a
later proof count, the projection gate needs a narrowly scoped, audited
`previous-validated-selection` rollback mode—not a generic force bypass. If a
post-cutover projection fails, the operation must either restore the pointer under
its expected ETag or report an explicit S3/DB selection lag; it must never claim
success while hiding the divergence.

### D6 — GEO is proof-only

`immo-feature-proof/v1` does not exist at either reviewed revision, so it is a new
contract to freeze, not an implied compatibility layer. GEO's complete contribution
to an immo feature is exactly:

```json
{
  "properties": {
    "proof": {
      "schema": "immo-feature-proof/v1",
      "source": { "...": "immutable geo source/snapshot provenance" },
      "zone": { "...": "observed zone reference only" },
      "gaps": ["explicit missing or unresolved evidence"]
    }
  }
}
```

The proof schema is strict: the only contract keys after `schema` are `source`,
`zone`, and `gaps`. It rejects `old`, `new`, `before`, `after`, `bounds`, `delta`,
unit counts, score, `densification`, and any unknown key. GEO provides neither an
old/new boundary nor a comparative claim; it never derives densification. The immo
materializer transports the proof unchanged, preserves `gaps`, and retains
`effet_densifiant = inconnu` unless its own municipal-document evidence and policy
establish otherwise. A GEO proof or a missing proof can never make a signal favorable.

This boundary is consistent with the existing RACI: GEO supplies generic
georeferenced data, while immo owns temporal mapper semantics, signals, and scoring
(`docs/spec/data-division-immo-geo.md:86-109,113-126`).

### D7 — Anti-regression and false-positive policy

The protected manifest must compare, by stable business key and fingerprint rather
than counts, IDs, node types, endpoint triples, classification/filter/scoring facts,
stage/history, citations, `rawRef`, source hash, and proof. This strengthens the
existing v2.3 protected-set direction
(`radar/ontology/graphify-output-contract.md:834-873`).

Candidate classifications remain three-state. Missing source evidence, absent GEO
history, category `null`, and partial GEO proof do not become a positive opportunity
or `densifie`; they stay explicit unknown/zero-value states. The feature branch's
Vivier contract already models `effet_densifiant: inconnu` as the default
(`feat/graphify-3-4-replayable:packages/radar-domain/src/vivier/vivier-v2.ts:3-12,
59-69`); the 3.4 materializer must preserve that guard.

## Files to authorize for a later implementation

This report changes none of these files. The smallest coherent implementation set is:

| Concern | Recommended files | Scope note |
|---|---|---|
| Strict graph/InputSet/manifest/comparator/resolver | New focused modules under `api/src/services/{graph,sources}/**`; `radar/ontology/{graphify-output-contract.md,regraphify-directive.md,ontology-profile.yaml}` | Allowed by the branch plan once consensus is recorded. |
| Conditional pointer store | `api/src/storage/{object-store,s3-object-store}*` | Add ETag/conditional-write capability and fake-MinIO coverage. |
| Materialization and consumers | `api/src/scripts/{graphify-current,project-graph-from-s3,filet-auto-link-pv}*`; `api/src/services/graph/graph-store.ts` | Inventory all readers/writers before changing `latest.json` semantics. |
| Raw/graph replay coverage | `api/src/services/sources/{run-manifest,rebuild-from-s3,projection-repo}*` | A strict selected-graph replay must not inherit their current malformed-input skips. |
| GEO proof schema | New `api/src/services/geo/feature-proof.ts` and test, or an equivalent domain-owned schema | Requires a recorded scope exception: `api/src/services/geo/**` is not in the branch allowed paths. |
| Golden fixtures and tests | `api/tests/fixtures/graphify/**` plus colocated unit/integration tests | Include full-PV, annex, negative, missing-evidence, legacy-baseline, and partial-GEO cases. |
| Guarded operation targets | `Makefile` | Requires the plan's BR34-EX1 approval for replay/cutover/rollback targets. |
| Deployment readers | Exact job/deploy files only after inventory | Requires BR34-EX3; no broad deployment change. |

`tools/graphify-v23/**` must lose its direct publication role when 3.4 is adopted.
Keeping it as a second writer or a payload fallback would negate the single-selection
protocol.

## Required test gates

| Gate | Required witness | Blocks |
|---|---|---|
| Input coverage | Each declared CAS ends `processed`, `cache-hit`, `excluded` with authorized reason, or reported error; unlisted/tombstoned input is rejected. | Build and cutover. |
| Full/incremental convergence | Golden `full(InputSet)` and `incremental(base + delta + patches)` yield the same materialization hash and protected fingerprint. | Build and cutover. |
| Idempotent replay | Two identical runs make zero new LLM calls/immutable writes and keep pointer plus DB selection hashes unchanged. | Build. |
| Canonical comparison | Reordered input and declared volatile timestamps do not alter the hash; every business/proof/topology mutation does. | Build. |
| LLM grounding | Missing/out-of-span citation, schema escape, an attempted ID/relation/GEO/bound/densification mutation, or provider error produces a non-publishable error. | Build and cutover. |
| Protected non-regression | A count-preserving change that loses a stable key, retained-node edge, classification, stage/history, citation, raw ref, source hash, or proof is rejected. | Cutover and projection. |
| GEO contract | Valid proof round-trips unchanged; `old/new`, bounds, score, densification, unit-count, unknown key, or a favorable mutation of unknown fails schema validation. | Build and cutover. |
| Shadow/CAS race | Invalid shadow is unselectable; two cutovers with the same expected ETag permit exactly one winner; stale ETag does not overwrite. | Cutover. |
| Strict resolver | Absent/malformed pointer, missing manifest/object, hash mismatch, failed GET, or invalid JSON fails explicitly; no payload fallback and no `skipped` success. | Cutover and projection. |
| Projection completeness | Empty/partial snapshot and removal of an edge between retained nodes are rejected; transaction leaves the city unchanged on rejection. | Projection. |
| Rollback | Conditional pointer restore reaches the prior immutable selection and reprojects it; all immutable artifacts remain present; a failure reports the exact selected S3 and DB hashes. | Rollback. |
| False positives | Full-PV negative, annex-only distractor, missing evidence, partial GEO proof, and `category = null` never produce a favorable opportunity or derived densification. | Stage A/B approval. |
| S3 reconstruction | MinIO fixture rebuild resolves selected immutable graphs and reproduces the same projection state from object storage. | CI / release. |

Run unit and integration gates only through the branch-isolated Make environment,
for example the plan's scoped `make test-api ... ENV=test-graphify-34`, followed by
the full isolated suite and the MinIO replay/cutover/rollback integration target once
BR34-EX1 is authorized. No test was run for this read-only consensus.

## Authorization order

1. Record these decisions with FL-01 through FL-04 and approve BR34-EX1; add the
   GEO scope exception only if the proof validator is not placed in an already
   allowed domain package.
2. Freeze golden InputSets and protected manifests before writing the materializer.
3. Implement and prove full/incremental convergence plus strict GEO/LLM gates.
4. Inventory and migrate every `latest.json` consumer; then add immutable shadow,
   CAS selection, projection, and rollback together.
5. Run Stage A only after all gates pass; Stage B and C remain separately authorized
   staged operations, never implicit bulk work.
