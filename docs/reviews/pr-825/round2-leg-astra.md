status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/graph-city-key@143555c433153153f073dd3582218fb8224e62f1
lens: correctness-and-migration

## Reasoning

Reviewed `git diff origin/main...143555c433153153f073dd3582218fb8224e62f1` and the API delta from `c5d68099` to that commit. HEAD and branch matched the requested target. Read revision 6 of `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md`, including its deviations and dry-run. This is an independent leg; no other round-2 review was consulted. No cluster or bucket was accessed, and no implementation file was changed or committed.

The migration, city-scoped store and transaction boundaries withstood the checks below. One reproducible gap remains in the repair's content-drift measurement: it treats refs as an unordered set, although their order changes the evidence served by the API. This leaves A825-02 partially fixed.

Migration evidence:

- `api/drizzle/0013_graph_city_key.sql:17` sets a transaction-local 10-second lock timeout. The block reads the actual primary-key constraint name at line 31 and takes `ACCESS EXCLUSIVE` locks on both graph tables at line 45. The backfill at lines 64 and 67 runs before the primary-key swap at line 92, while IDs still uniquely identify endpoints. Source wins over destination for cross-city edges; a sole destination places an otherwise unplaced edge.
- NULL-city incident edges are deleted before NULL-city nodes (`:53`, `:57`); only remaining unplaced edges are deleted at `:72`. The postcheck subtracts the two disjoint edge-deletion counts and the NULL-node count (`:96`). `SET NOT NULL` enforces non-NULL placement. The migration deliberately does not require both endpoints to belong to the assigned city; the readers filter those edges until projection reconciles them.
- New node/edge/geo index names and column orders agree with `api/src/db/schema.ts:300`, `:331`, and `:654`. The geo insert conflict target agrees at `api/src/services/geo/resolve-refs.ts:115`.
- The existing migration integration test passed: held table lock causes timeout and rollback, drifted PK name is handled, NULL/unplaced deletion counts and placements match, city-duplicate nodes/edges/geo resolutions become insertable, and statement replay is safe. `migrate-idempotence.spec.ts` also passed with the last journal row removed.
- A separate local rehearsal used 44,735 synthetic nodes across 1,010 cities and 49,148 edges: 467 cross-city edges, 26 one-endpoint edges, no NULL-city node and no zero-endpoint edge. It also dropped `graph_nodes.created_at`, renamed the old primary key, and removed the 0012 journal row so the real Drizzle migrator applied pending 0012 and 0013 together. Output: `nodes=44735, edges=49148, null_edges=0, journal=13, placementMismatches=0`; migration took 3,289 ms. NOTICE reported zero deletions. After inserting the same ID in another city and removing the 0013 journal row, replay succeeded and the probe asserted that both copies remained. Edge-count preservation on replay was separately asserted by the existing migration integration test. This is a local structural rehearsal, not a production timing claim.

Store, classifier and reader evidence:

- Every graph writer uses `lockCityGraph` (`graph-store.ts:836`): legacy upsert at `:973`, normal projection at `:1123`, repair at `city-key-repair.ts:303`. Projection reads its baseline after acquiring the lock (`graph-store.ts:1126`) and checks the existing property/provenance guards before writes (`:1135`). Completeness remains a post-write check that throws through the transaction and rolls it back (`:1215`, `:1225`). The guard algorithms are unchanged in the target diff.
- Orphan-node, dangling-edge and stale-edge deletion predicates bind `citySlug` (`graph-store.ts:1173`, `:1182`, `:1191`, `:1208`). Both upsert conflict targets include the city (`:988`, `:1045`, `:1155`). Two-city integration tests passed, including shared IDs and triples, orphan/dangling/stale deletion isolation, and the geo key.
- Additional concurrency probes queued each of atomic projection, legacy upsert and repair behind a held city lock while its holder added guarded data. All three waited. The atomic projection then refused the new property loss; the repair saw the newly committed ref and refused it as unknown; legacy upsert preserved that ref via its existing union. The probes also verified the guarded property/ref remained stored. This establishes serialization of the PG writers; the lock does not version the S3 object, and the operational freeze remains relevant.
- `classifyNode` now requires a lost ref with a docSha absent from the city's node/edge refs before returning foreign (`city-key-repair.ts:188`). One other city's same-ID row must explain every lost value (`:193`). Otherwise anchored losses are unknown; unanchored differences remain under the ordinary guards. Unknown refusal precedes `projectCityInTransaction` (`:358`). Preview throws `RollbackPreview` after the real projection (`:377`). Integration tests passed for foreign repair, unexplained mixed data refusal, completeness rollback, preview rollback and a second-run no-op.
- Searched `graph_nodes`, `graphNodes`, `graph_edges`, `graphEdges`, and `node_id` across `api/`, `ui/`, `packages/`, `scripts/`, and `deploy/`, then inspected ID predicates and joins. The relevant runtime readers bind the city: neighbors (`graph-store.ts:1328`, `:1334`, `:1348`), city/MRC graphs (`:1380`, `:1480`), data-quality snapshots (`summary.ts:125`, `:137`), geo node enrichment (`geo-features.ts:182`) and proof-report correlations (`report-opportunity-proof.ts:102`). City/MRC/data-quality subgraphs require both endpoints. The MRC UI uses `(citySlug,id)` for node lookup, rendering and hover (`MrcGraphView.svelte:165`, `:173`, `:357`, `:390`). Aggregate reads remain grouped by city; MCP consumes the city-scoped graph-signals route. No additional unscoped runtime ID lookup was demonstrated.
- The #820 identifiers `SAME_CITY_CONFLICT_GUARD`, `idsSkippedByCityGuard`, `resolveCrossCityCollisions`, `CrossCityIdCollision`, `crossCityCollisions`, and `cross-city-id-collision` have no matches in the searched runtime/test/workflow paths. The workflow removes their old log handling. Repair/mapper manifests, namespace/image selection, completion failure handling and migrate termination-summary collection were reviewed statically; deployment and release-variable values were not tested.

Commands and results:

```text
rtk make test-api SCOPE='src/services/graph/city-key-repair.test.ts src/scripts/repair-graph-city-key.test.ts src/services/graph/graph-store.test.ts tests/integration/graph-city-key-migration.spec.ts tests/integration/graph-city-key-repair.spec.ts tests/integration/graph-city-key.spec.ts tests/integration/geo-mapper-reset.spec.ts tests/integration/migrate-idempotence.spec.ts' ENV=review-astra-825
Test Files  8 passed (8)
Tests       199 passed (199)

rtk make -f Makefile -f .review-tmp/astra.mk review-astra-probes ENV=review-astra-825
exit 0; production-shaped migration/replay, locked baselines and drift probes completed

rtk make -f Makefile -f .review-tmp/astra.mk review-astra-drift ENV=review-astra-825
exit 0; reproduced false no-op and changed API citation/PDF (see finding)

rtk make -f Makefile -f .review-tmp/astra.mk review-astra-remove-test-volumes ENV=review-astra-825
exit 0; isolated containers, network, Postgres and test dependency volumes removed

rtk make clean ENV=review-astra-825
exit 0
```

Temporary probe sources are `.review-tmp/astra-probes.ts` and `.review-tmp/astra-drift.ts`, with their Make targets in `.review-tmp/astra.mk`. No UI/browser campaign or live CI/deployment check was run for this leg.

## Previous findings

| Finding | Status | Evidence |
| --- | --- | --- |
| A825-01 — generic whole-row equality could erase a local guarded value | **fixed** | The whole-row-equality branch is gone. `city-key-repair.ts:188` requires a lost foreign docSha; `:211` returns clean when there is no anchor. The coincident `nb_unites_max=4` regression passed in `city-key-repair.test.ts:141` and `graph-city-key-repair.spec.ts:214`: zero foreign rows, repair refused by the guard, property retained. The normal property guard remains unchanged. |
| A825-02 / SOL-825-04 — clean-row content drift omitted from no-op/needsRepair | **partially fixed** | `city-key-repair.ts:325` now checks losses in both directions; `:355` includes the count in no-op and `repair-graph-city-key.ts:121` derives needsRepair from no-op. The label-drift regression at `graph-city-key-repair.spec.ts:229` passed; my addition-only probe also reported `nodesContentDiff=1`. However, swapping two refs still yields zero drift/no-op while changing the API's citation and PDF. See the blocking finding below. |
| A825-03 / SOL-825-01 — unreadable requested city disappeared with success | **fixed** | `repair-graph-city-key.ts:97` returns a per-city unavailable outcome, using `isMissingObjectError` for not-found versus read-failed and a separate unreadable parse/schema outcome. Both target read phases retain failures (`:190`, `:220`); `:129` and `:150` include them in reports/termination output; `:244` counts them toward exit 1. Tests at `repair-graph-city-key.test.ts:84`, `:93`, and `:101` passed for missing object, access denial and malformed JSON. |
| SOL-825-02 — report-upload failure returned success | **fixed** | `repair-graph-city-key.ts:237` records `reportUploaded=false` and bounded `reportError`; `:242` writes them to the termination summary and `:245` returns 1. `terminationSummary` bounds the city lists (`:144`). Upload-failure and long-city-list tests at `repair-graph-city-key.test.ts:108` and `:125` passed. |
| SOL-825-03 — geo RESET skipped requested cities without geometry | **fixed** | `run-geo-mapper.ts:71` takes RESET's city list from deduplicated `CITIES_FILTER`, independently of geometry. `:50` refuses missing/blank CITIES with exit 2. Both zero-signal cleanup (`:117`) and purge/rebuild (`:146`) scope their transaction to the requested city. `geo-mapper-reset.spec.ts:55` and `:67` passed: no-geometry city purged, other city preserved, missing-CITIES reset refused. |

## Findings

### A825-02 — Ref ordering remains invisible to node-content drift

- **Severity:** blocking.
- **File:line:** `api/src/services/graph/city-key-repair.ts:325` (comparison at `:327`), with `lostElements` at `:145` and `elementsOf` at `:109`.
- **Evidence:** `nodesContentDiff` reuses a loss classifier, asking whether either row contains a ref object absent from the other. `lostElements` uses `.some(jsonEqual)` for each ref, so `[A,B]` and `[B,A]` compare equal for this purpose. Null-versus-absent properties and empty containers are also normalized away by this comparison; the local null-property probe likewise reported a false no-op. This is not a comparison of all projected JSON content.

The decisive fixture uses a single local **Signal**, with two distinct, valid-shaped local refs A and B (different 64-character docShas, PDF keys and citations). PG starts with `[A,B]`; the city's candidate S3 projection contains `[B,A]`. No foreign city or missing ID is involved. Running the real repair and the real graph-signals route against the isolated Postgres produced:

```json
{
  "probe": "ref-order-served-evidence",
  "nodesContentDiff": 0,
  "noop": true,
  "needsRepair": [],
  "before": {
    "citation": "Local citation a",
    "rawRef": "raw/proces-verbaux-review-astra-825/cas/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf"
  },
  "after": {
    "citation": "Local citation b",
    "rawRef": "raw/proces-verbaux-review-astra-825/cas/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.pdf"
  }
}
```

Preview returned `pass` and rolled back; apply returned `pass` and changed the stored refs and served evidence. The consumer makes order material: `api/src/routes/graph-signals.ts:738` selects `refs[0]`, uses its PDF at `:757`, and its citation at `:774`. Therefore the measurement can omit a city from the repair list and certify a no-op even though PG serves a different primary citation/PDF from its S3 projection. The existing label-drift regression does not cover this case. This is a remaining variant of the previous finding, not a claim that this particular drift was measured in production.

- **Fix:** Give `nodesContentDiff` an exact projected-content comparison of `type`, `label`, `sourceRef` and the full `props` JSON (object-key order ignored; array order retained). The module's `jsonEqual` already supplies those JSON semantics. Keep the loss/containment rules for classification separate: they answer whether losses are explained, not whether applying the projection changes the row. Add a regression with reordered refs that asserts `nodesContentDiff=1`, `noop=false`, inclusion in `needsRepair`, unchanged PG after preview, correct first citation/PDF after apply, and a second preview with zero drift. Also cover null/absent property and empty-container differences if the contract remains “any projected field different.”

## Verdict

**NO-GO.** Four previous finding groups are fixed; A825-02 / SOL-825-04 remains partially fixed with a demonstrated effect on served evidence. No additional migration or city-isolation blocker was demonstrated. Correct the content-drift comparison and rerun its focused regression before treating the repair measurement as an acceptance gate.
