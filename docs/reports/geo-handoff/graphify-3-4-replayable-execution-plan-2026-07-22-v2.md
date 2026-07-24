# Graphify 3.4 replayable materializer — execution handoff

Date: 2026-07-22  
Scope: design handoff only. This document changes no production code, live
specification, GEO data, object-store object, pointer, projection, or deployment.

## Evidence and decisions

### Evidence inspected

- Current HEAD is 0fd8908db0dd4e883d1860bef3ebcd0cbbf8b2e2f.
- feat/graphify-3-4-replayable is d58eb53053324105970616bed2a37bde337b6b78,
  42 commits ahead of HEAD. Its last commit adds
  plan/EVOLV2-L2-BRANCH_feat-graphify-3-4-replayable.md; FL-01 through FL-04
  remain blocked. Its Vivier and graph-store changes are adjacent work, not a
  replayable 3.4 materializer.
- tools/graphify-v23 is unchanged between HEAD and that branch. It is historical
  evidence, not the 3.4 contract.
- Two independent read-only reviews were reconciled before this handoff.

### Decisions

1. One city run begins with one immutable, canonical InputSet resolved only to
   raw CAS objects and their sidecars. A selected graph or mutable baseline is
   never an input to materialization.
2. Every stage consumes immutable outputs from earlier stages. Each input is
   processed, reused from a version-compatible cache, tombstoned, or excluded
   with an explicit reason; none is silently skipped.
3. Raw resolution, parsing, identifiers, normalization, topology, hashes,
   comparisons, gates, GEO transfer, and publication are deterministic. An LLM
   may return a cited, validated proposal only.
4. Full and incremental modes each build the same complete InputSet and call
   one deterministic materializer. Incremental is not a patch over latest.json.
5. A complete immutable shadow graph and manifest are read back and validated
   before the sole mutable pointer is conditionally selected.
6. PostgreSQL remains a reconstructible projection. graph-store.ts
   upsertGraphAtomic stays the final city transaction/completeness defense, but
   never chooses the current graph.
7. GEO only exposes properties.proof with schema immo-feature-proof/v1 and
   source, zone, and gaps. It has no old/new/before/after/delta/bound field.
   During this scope, effet_densifiant is always "inconnu".
8. Missing input, invalid cache, failed LLM validation, pointer collision, or
   projection failure is an explicit failed state with a retained report. There
   is no label fallback, stale payload fallback, or silent skip.

The pending FL-01 through FL-04 decisions stay prerequisites. This handoff does
not ratify an ontology rename, an ETag implementation, or a deployment change.

## Target data flow

~~~
raw CAS + source run manifests + explicit patch log
                    |
             canonical InputSet (hash)
                    |
   deterministic parse / segments / GEO-proof transfer
                    |
       optional cited LLM proposal CAS, then validation
                    |
         one deterministic complete materializer
                    |
       canonical graph + manifest + comparison report
                    |
       immutable shadow, readback, and all gates
                    |
conditional latest pointer (expected ETag/hash) -> selected resolver
                    |
             atomic PostgreSQL projection
~~~

No arrow reads a graph selected by an earlier run to complete its output.
Caches are reusable only when every input and implementation-version hash
matches the current dependency tuple.

## Immutable artifacts and hashes

All content identities are sha256:<hex> over canonical UTF-8 JSON: recursive
object-key sorting, schema-declared array ordering, and no clock or transport
metadata. Operational timestamps belong in an explicitly volatile envelope, not
in the hashed graph.

| Artifact | Immutable key | Required content |
| --- | --- | --- |
| InputSet | graph-inputsets/{city}/{inputsetHash}.json | sorted raw CAS entries, source manifests, explicit tombstones/exclusions, patchLogHash, contract/extractor versions |
| Raw index | graph-runs/{runId}/raw-index.json | resolved CAS key, raw SHA recheck, sidecar, and disposition of every InputSet entry |
| Deterministic extraction | parsed/{city}/graphify/3.4/{inputsetHash}/deterministic.json | parser/config hashes, stable segments/candidates, citations, source hashes, proof references |
| LLM proposal CAS | parsed/{city}/graphify/3.4/{inputsetHash}/llm/{proposalHash}.json | candidate hash, model/prompt/parameters, cited input ids, structured result, validation outcome |
| Canonical graph | graph/{city}/immutable/{graphHash}.json | complete canonical graph; graphHash rehashes to exact content |
| Candidate manifest | graph/{city}/immutable/{graphHash}.manifest.json | upstream/version hashes, counts, exclusions, protected diff, GEO counters, gate outcomes |
| Comparison report | graph/{city}/runs/{runId}/comparison-{graphHash}.json | full/incremental and replay hashes plus classified diff |
| Selected pointer | graph/{city}/latest.json | schema, city, graphHash, graphKey, manifestKey, inputsetHash, previousGraphHash |
| Rollback receipt | graph/{city}/rollbacks/{eventHash}.json | expected/current pointer identities, prior/target hashes, cause, projection result |

The manifest is the publication receipt. A candidate is ineligible if a
referenced artifact is absent, fails rehashing, belongs to another city, or is
not listed in its manifest.

## Producer boundary and protected set

| Stage | Producer | Allowed output | Never allowed |
| --- | --- | --- | --- |
| InputSet/raw index | Deterministic | exact CAS membership and dispositions | discovery from latest.json or implicit drop |
| Parsing/extraction | Deterministic | segments, citations, source facts | fabricated zone, lot, or regulatory fact |
| GEO proof transfer | Deterministic | schema validation and preservation | effect/delta interpretation |
| LLM proposal | LLM, then deterministic validation | cited prose/classification proposal | mutation of source facts or protected fields |
| Materialization/gates | Deterministic | complete graph, manifest, diff | baseline merge or publication |
| Shadow/select/project | Deterministic operation | immutable write, CAS pointer, transaction | overwrite without expected identity |

Protected fields are node ID/type, edge endpoints/type, business keys,
classification, stage/history, structured facts, citations, rawRef, source
hashes, and the complete GEO proof. The comparator excludes only named
volatile-envelope fields. The current generated_at from
tools/graphify-v23/extraction_to_v23_graph.js must therefore leave the
canonical graph; it does not authorize ignoring any business field.

## GEO boundary

The future GEO extension is restricted to this proof shape:

~~~ts
properties.proof = {
  schema: "immo-feature-proof/v1",
  source: {
    geometry: { status, artifact_uri, upstream_uri },
    regulation: { status, artifact_uri, upstream_uri }
  },
  zone: {
    collection, zone_code, feature_ref, assignment_method
  } | null,
  gaps: string[]
}
~~~

source is provenance/coverage; zone is a sourced assignment only; gaps records
what is missing. There is no old, new, before, after, delta, threshold, grid
bound, score, or calculated effect. A missing zone remains null. The 3.4
materializer emits or retains effet_densifiant: "inconnu" only. This is a
hard gate because api/src/services/graph/vivier-v2.ts on the branch can
otherwise consume an existing effect value for classification.

HEAD has no immo-feature-proof/v1 or properties.proof producer. The future
cross-team modules are:

- packages/radar-domain/src/schemas/ontology/geo.ts — schema/type definition;
- api/src/services/geo/geo-features.ts — controlled public-feature construction;
- api/src/routes/geo-features.ts and tests — API boundary;
- api/src/routes/geo-collections.ts and
  api/src/services/geo/lot-zone-enrichment.ts — preserve proof when serving or
  enriching, without synthesizing it;
- api/src/services/geo/normes-keys.ts — key recognition only, never an effect
  calculator.

They are named for future work only. This handoff edits none of them.

## Cumulative implementation plan

### Lot 0 — Freeze contracts, fixtures, and the direct-writer inventory

1. Record FL-01 to FL-04 through the approved branch process: ontology lineage,
   immutable-pointer semantics, canonical equality/protected set, and
   candidate-not-direct-signal rule.
2. Freeze the InputSet, extraction, LLM proposal, graph manifest, latest pointer,
   rollback receipt, and GEO-proof schemas.
3. Inventory every latest.json reader/writer: tools/graphify-v23/gate.sh,
   api/src/scripts/filet-auto-link-pv.ts,
   api/src/scripts/project-graph-from-s3.ts, and tools/grounding. Give each a
   migration owner/order; no direct writer survives cutover.
4. Add golden fixtures: full positive PV, annex, false positive, missing raw
   evidence, tombstone, GEO complete, GEO partial, zone null, and no-delta case.

Future modules: new api/src/services/graph/replay/{input-set,canonical-json,
business-keys,protected-fields,graph-run-manifest}.ts and tests; new
api/tests/fixtures/graphify. Reuse api/src/services/sources/run-manifest.ts as
collection evidence; do not confuse it with a Graphify manifest.

Gate: schema ordering/protected fields and reader/writer inventory are complete.
No production object is written.

### Lot 1 — Construct the unique raw InputSet

1. Resolve source-run manifest entries through
   api/src/services/sources/document-resolver.ts and raw CAS sidecars.
2. Rehash raw bytes; verify CAS key, sidecar, source city/kind, and manifest
   entry agree.
3. Sort by declared business key; apply only explicit add/remove/tombstone
   operations and the hashed patch log from
   api/src/services/exploitation/{patches,decisions}.ts.
4. Persist InputSet and raw index. Reuse a cache only when InputSet and all
   dependency hashes match.

Future modules: replay/input-set.ts, replay/raw-index.ts, and tests; existing
api/src/storage/{object-store,s3-object-store}.ts for read/head/put.

Gate: each document has exactly one disposition: processed, reused, tombstoned,
or excluded-with-reason. Missing/mismatched CAS or sidecar blocks the run.

### Lot 2 — Deterministic extraction and evidence transfer

1. Parse the complete InputSet from raw CAS, versioning parser/OCR/configuration.
2. Give each segment/candidate stable identity
   docSha + locator + spanHash; keep page, section/offset, excerpt, rawRef, and
   source hash.
3. Reconcile sourced facts only through pv-mentions.ts, semantic-extract.ts,
   reconcile.ts, and validators.ts.
4. Validate and transfer proof unchanged. A missing zone stays null; a gap stays
   a gap; effect remains inconnu.

Future modules: api/src/services/geo/feature-proof.ts plus tests and a
deterministic adapter in services/graph/replay; authorized evolution only of
packages/radar-sources/src/sources/proces-verbaux-{generic,parser}.ts and
fixtures.

Gate: every retained fact has a raw citation. No unsourced identifier/source
reference, invented GEO completion, old/new/delta field, or effect other than
inconnu exists.

### Lot 3 — Bounded LLM proposal and reusable cache

1. Submit one stable candidate and its approved cited excerpts only. Pin provider,
   model, prompt template/version, and parameters.
2. Require structured decision, proposed prose/classification, cited input IDs,
   and explanation. Address it by the complete proposal hash.
3. Validate citations, ontology, protected fields, and GEO boundary
   deterministically before materialization.
4. Retain a failed proposal as error. Never fall back to its label. This replaces
   the direct mutation/fallback in worker-llm-descriptions.sh.

Future modules: replay/{llm-proposal-cache,llm-grounding}.ts and tests, with a
typed adapter at services/exploitation/semantic-extract.ts.

Gate: every accepted proposal is grounded and recorded; protected-set drift is
zero.

### Lot 4 — Materialize one complete canonical graph

1. Consume only InputSet, deterministic extraction, accepted LLM proposal hashes,
   and patchLogHash.
2. Normalize, sort, deduplicate, and derive stable business IDs. Preserve every
   protected field and create a complete city snapshot without selected-graph
   input.
3. Emit canonical graph, graph hash, manifest, counts, exclusions, GEO counters,
   and effect=inconnu. Put timestamps in a non-hashed run envelope.
4. Retain project-state-to-graph.ts only where it obeys the frozen canonical
   mapping; it is not an LLM or publication path.

Future modules: replay/{materialize-current,canonical-graph,graph-diff,
replay-gates}.ts and golden tests. The two graphify-v23 JavaScript transformers
are historical references only, not 3.4 producers.

Gate: all artifacts rehash; IDs are unique/stable; every effect is inconnu; the
candidate is complete, not a baseline fragment.

### Lot 5 — Prove full/incremental convergence and idempotence

1. Full mode builds InputSet_n from complete raw membership and materializes
   graphHash_full.
2. Incremental mode applies an explicit immutable patch/tombstone set to
   InputSet_(n-1), builds complete InputSet_n, and invokes the exact same
   materializer to produce graphHash_incremental.
3. Canonical InputSets and graphs must be byte-identical after excluding only
   named volatile-envelope fields.
4. Replay each mode twice. Graph hash, content-manifest portion, IDs, topology,
   citations, GEO proof, and protected set must not vary.

Gate: graphHash_full equals graphHash_incremental and each first replay equals
its second replay. Any classified diff blocks shadow publication.

### Lot 6 — Validate shadow, select conditionally, then project

1. Write graph and manifest at immutable keys, read both back, rehash, then run
   all gates.
2. After explicit authorization, add ObjectStore/S3ObjectStore metadata and a
   conditional pointer write using ETag/If-Match, or an equivalently proven
   primitive on both MinIO and production S3. If it cannot be proven, cutover
   remains blocked.
3. Add one resolver that validates selected pointer, city, graph key, manifest,
   and every hash. It fails closed; it never lists an alternative or turns
   invalid JSON into a skip.
4. Require expected current ETag/hash before setting latest.json with
   previousGraphHash. Collision is a failed cutover.
5. Project only the selected snapshot through upsertGraphAtomic. Adapt
   project-graph-from-s3.ts so current GET/JSON skipped behavior cannot mask an
   invalid selected graph.

Future modules: replay/{shadow-publisher,latest-pointer,
selected-graph-resolver,cutover,rollback}.ts; conditional ObjectStore changes;
approved migration of project-graph-from-s3.ts and all direct writers.

Gate: isolated MinIO integration proves
raw -> InputSet -> shadow -> readback validation -> conditional selection ->
atomic projection, with no direct latest.json payload writer.

### Lot 7 — Replay, rollback, and staged operation

1. Replay from inputsetHash or graphHash: load manifest, rehash every artifact,
   rematerialize, and compare final canonical graph hash.
2. Roll back by checking expected pointer identity, validating the immutable
   previous graph/manifest, conditionally restoring its pointer, and explicitly
   reprojecting it. Never delete evidence.
3. On post-selection projection failure, retain the report and conditionally
   restore the prior pointer before declaring rollback complete.
4. Use separate owner-approved manifests for existing-signal reclassification,
   focus cohort, then remaining corpus. Each requires a report of coverage,
   exclusions, LLM use/cost, grounding, convergence, protected diff, GEO
   counters, and rollback witness.

Gate: an isolated end-to-end witness restores the prior selected graph and
PostgreSQL projection without deleting raw, parsed, proposal, manifest, or graph
objects.

## Required promotion gates

1. Input integrity: every CAS byte/sidecar rehashes and membership is explicit.
2. Schema/ontology: valid graph, unique stable IDs, valid endpoints/citations,
   and no generated evidence.
3. Coverage: no unseen document/candidate silently disappears.
4. LLM grounding: proposal key, model/prompt tuple, cited inputs, and validation
   match.
5. Protected fields: zero unexplained drift in IDs, topology, source facts,
   citations, raw references, or GEO proof.
6. GEO non-invention: proof v1 source/zone/gaps only; no bound/delta; every
   effect equals inconnu.
7. Convergence: full equals incremental and both are idempotent.
8. Publication: immutable readback, expected-current conditional pointer,
   selected resolver, and atomic projection all pass.
9. Rollback: conditional restoration plus prior projection is demonstrated.

## Explicit non-goals and v2.3 gaps

This handoff does not authorize a live replay, bulk LLM call, S3 probe,
production write, pointer update, database projection, Makefile change, or
live-spec update. The v2.3 dry-run is not a safe 3.4 preflight: preflight.sh
writes and deletes an S3 probe, so the future read-only dry-run must mutate
nothing.

runner.sh and worker.sh derive candidates from mutable baselines and hard-coded
run paths; gate.sh backs up then overwrites graph/{city}/latest.json; the LLM
worker mutates a candidate and falls back to a label; and
extraction_to_v23_graph.js emits a variable timestamp. None meet this protocol.
They can be retired or made unreachable only in the authorized implementation
branch, after the replacement and its gates are proven.

