status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/graph-city-key@c5d6809929a69b0ec9fb1269704e521903f6cf39
lens: correctness-and-migration

## Reasoning

Reviewed `git diff origin/main...c5d6809929a69b0ec9fb1269704e521903f6cf39`; the worktree HEAD matched that SHA. Read revision 6 of `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md`, including the deviations and dry-run. This leg is independent: no other PR review leg was read. No cluster or bucket was contacted. The database checks below used only the isolated local test stack; the CLI failure check mocked the storage boundary.

The composite-key implementation and migration survived the checks performed. The blocking problems are in the repair classifier and the repair's measurement/success reporting.

- **Migration ordering and atomicity.** `api/drizzle/0013_graph_city_key.sql:17` sets a transaction-local 10-second lock timeout. The block takes both table locks at line 45, deletes edges incident to NULL-city nodes before those nodes, places edges by source then destination at lines 64 and 67 while the old node key still exists, and swaps the node PK only at line 88. The PK name is obtained from `pg_constraint` and quoted with `%I`. The node/edge count checks at lines 99 and 102 subtract disjoint deletion counts. There are no explicit commits or concurrent-index statements outside the Drizzle migration transaction. The existing integration test passed its held-lock failure/rollback, NULL-city incident-edge deletion, dangling-edge deletion, renamed-PK, and replay cases.
- **Production-shaped rehearsal.** A disposable database started with 12 journal rows, 44,735 nodes, no NULL city, 49,148 edges, 26 edges with one endpoint, and 467 cross-city edges. It also had a renamed node PK and no node `created_at` column. Migration through the actual Drizzle migrator preserved all 44,735 nodes and 49,148 edges, populated every edge city, and reached 13 journal rows. Removing the final journal row and rerunning the migrator preserved the counts. The new PK and city-scoped index names were checked. The local migration took 4,402 ms; this is a synthetic rehearsal, not a production timing estimate.
- **Schema and geo key.** The new node PK and edge index names agree with `schema.ts:300` and `schema.ts:331`. `geo_resolutions_city_natural_key_idx` agrees with `schema.ts:654`, and `resolve-refs.ts:115` uses the same four-column conflict target. The integration test accepted two cities resolving the same node id to the same lot and deduplicated a repeat within one city.
- **Read/write inventory.** Searched `graph_nodes`, `graphNodes`, `graph_edges`, `graphEdges`, and `node_id` across the requested API/UI/package/script/deploy trees. The production graph writes found are centralized in `graph-store.ts`; both node writers and the shared edge writer bind city in their conflict targets. Orphan-node, dangling-edge, and stale-edge deletions bind city. The changed data-quality, geo-feature, and opportunity-proof readers bind city when resolving ids. City and MRC subgraphs require both endpoints in the edge's city. MRC UI lookup, hover state, and node keys use `(citySlug, id)`. No remaining executable #820 collision guard, owner lookup, result field, or log consumer was found by a separate case-insensitive search.
- **Projection and concurrency.** `lockCityGraph` at `graph-store.ts:836` is shared by legacy upsert, normal projection, and repair. `projectCityInTransaction` takes it before reading its baseline (`graph-store.ts:1123`); repair classifies under that same lock (`city-key-repair.ts:310`). The business-property and source-ref guard implementations are unchanged; completeness still throws out of the transaction to roll back writes. Besides the existing locking test, an added PostgreSQL probe held a legacy writer transaction, added a business property, then started repair: repair waited, saw the committed new baseline, and refused its removal. This establishes PG writer serialization; it does not make S3 snapshot reads transactional with PG. The documented refresh suspension remains an operational prerequisite.
- **Repair rollback/idempotence.** The existing integration suite passed unknown-node refusal before writes, preview rollback, completeness rollback, foreign-row repair, edge-content repair, and a second preview returning no drift after an ordinary successful repair. The added node-content probe also compared complete rows before/after preview and confirmed rollback. Findings A825-01 and A825-02 expose cases outside those passing fixtures.

Commands and observed results:

```sh
rtk make test-api SCOPE="tests/integration/graph-city-key-migration.spec.ts tests/integration/graph-city-key.spec.ts tests/integration/graph-city-key-repair.spec.ts tests/integration/migrate-idempotence.spec.ts src/services/graph/city-key-repair.test.ts src/services/graph/graph-store.test.ts src/scripts/repair-graph-city-key.test.ts" ENV=review-astra-825
```

Result: exit 0; all seven selected files completed successfully.

```sh
rtk make test-api SCOPE="--config ../.review-tmp/vitest-astra-825.config.ts" ENV=review-astra-825
```

At this run the throwaway config selected `.review-tmp/astra-825.spec.ts`: **2 failed, 1 passed**. The failures assert the required safe behavior and demonstrate A825-01/A825-02; the passing test checks lock/baseline serialization. Output is retained in `.review-tmp/astra-825-probes.log`.

```sh
rtk make test-api SCOPE="--config ../.review-tmp/vitest-astra-825.config.ts astra-825-migration.spec.ts astra-825-cli.spec.ts" ENV=review-astra-825
```

Result: **1 passed, 1 failed**. The production-shaped migration/replay passed. The mocked CLI test failed its nonzero-exit expectation, demonstrating A825-03. Output is retained in `.review-tmp/astra-825-extra.log`, including:

```json
{"shape":{"edges":49148,"one_endpoint":26,"cross_city":467},"after":{"nodes":44735,"edges":49148,"null_edges":0,"journal":13},"elapsedMs":4402,"notices":["graph-city-key: nodes 44735 -> 44735 (deleted NULL-city nodes: 0); edges 49148 -> 49148 (deleted edges incident to a NULL-city node: 0, deleted edges without any existing endpoint: 0)","graph-city-key: graph_nodes primary key is already (city_slug, id); node and edge steps skipped"]}
```

Cleanup completed successfully:

```sh
rtk make clean ENV=review-astra-825
rtk make clean COMPOSE_FILES_DEV="-f docker-compose.yml -f docker-compose.test.yml" ENV=review-astra-825
```

The second cleanup removes the test-only dependency volumes, which the default dev compose file does not declare. Workflow/manifests were inspected but not executed against any environment. No application implementation was modified, committed, or pushed; the reproduction files are confined to `.review-tmp`.

## Findings

### A825-01 — Generic cross-city equality can remove a city's own guarded value

- **Severity:** blocking
- **File:line:** `api/src/services/graph/city-key-repair.ts:212` (the `sameRow` test and foreign result); guard exclusion at `api/src/services/graph/city-key-repair.ts:366`.
- **Evidence:** With no foreign docSha anchor, the classifier accepts matching projected fields as proof of foreign ownership. The reverse comparison at line 215 ignores every candidate ref, so a PG row with no refs can match a different city's row carrying its own evidence. More fundamentally, identical generic fields do not distinguish two legitimate local rows.

  The PostgreSQL reproduction first writes city A's own `zone-h-1`, label `Zone H-1`, type `Zone`, `properties: { nb_unites_max: 4 }` through `upsertGraph`. A's candidate S3 graph drops that property. City B independently has the same id/label/type/property, plus B's own evidence ref. A normal projection correctly refuses the loss. Repair instead classifies A's row as `foreign`, excludes it from the baseline, commits, and leaves `props: {}`:

  ```json
  {"plainAborted":true,"classes":{"clean":0,"foreign":1,"unknown":0},"verdict":"pass","applied":true,"afterProps":{}}
  ```

  The test fails with `A's own nb_unites_max=4 must stay protected: expected true to be false`. No cross-city overwrite was performed when seeding A: the local value is lost solely because B provides a coincidental match. This is not a complaint about ordinary S3 replacement; repair specifically bypasses a guard that refuses the same replacement.
- **Fix:** Do not exempt a row from local-loss guards based solely on matching another city's generic fields. Require independently city-specific provenance for the exemption, or retain ambiguous/ref-less matches under the ordinary guards (or refuse them for review). Merely making ref comparison symmetric would still leave identical ref-less rows ambiguous. Add the demonstrated local-property case as a regression test.

### A825-02 — Node-content drift can be reported as `noop`, excluding contamination from repair selection

- **Severity:** blocking
- **File:line:** `api/src/services/graph/city-key-repair.ts:356`; selection consumer at `api/src/scripts/repair-graph-city-key.ts:100`.
- **Evidence:** `noop` checks node-id sets, edge keys/content, and foreign/unknown classifications, but never compares the projected node content. `clean` is not equality: `classifyNode` returns it for nonempty lost content when no anchor/whole-row candidate matches (`city-key-repair.ts:220`). Consequently, `summarize().needsRepair` can omit a city whose real projection changes evidence-bearing fields.

  The PostgreSQL reproduction seeds A's bylaw label/properties with a foreign B CAS pointer in `source_ref` and `props.source_file`. A's own S3 node has neither pointer; B's same-id candidate carries the pointer but has a different label. Preview classifies the mixed row `clean`, reports `noop: true`, and leaves the pointer present after rollback. `needsRepair` is empty. Running apply on the identical inputs then removes the pointer:

  ```json
  {"classes":{"clean":1,"foreign":0,"unknown":0},"noop":true,"needsRepair":[],"sourceAfterPreview":"raw/proces-verbaux-review-astra-825-b/cas/B1.pdf","applied":true,"sourceAfterApply":null}
  ```

  The test fails with `preview is not a no-op: apply changes the foreign source pointer: expected true to be false`. The preview is the measurement used to build the repair list; applying only that list leaves this row unchanged and subsequent previews still report zero foreign nodes. The source-pointer example demonstrates contamination being missed, but an ordinary label/property content change also disproves the `noop` claim.
- **Fix:** Measure node-content differences independently of provenance classification, comparing all projected fields in both directions. Include those differences in `noop`/`needsRepair` and the report. Keep conservative classification and the existing guards for deciding whether application is allowed; a `clean` class must not establish projection equality. Add a preview → selected repair → zero-content-drift regression case.

### A825-03 — An unreadable requested city yields a successful apply with no work performed

- **Severity:** blocking
- **File:line:** `api/src/scripts/repair-graph-city-key.ts:88`, `api/src/scripts/repair-graph-city-key.ts:177`, `api/src/scripts/repair-graph-city-key.ts:199`.
- **Evidence:** `readProjection` converts every object-store read failure to `null`. Phase 1 records the city in `missing`, phase 3 skips it without creating a city error report, and the exit calculation ignores `missing`. This includes access/transport failures, not just an absent object. The termination summary at line 194 omits `missingLatestJson` as well.

  The CLI reproduction runs the real `main` dispatch with arguments `--apply gore`, a valid composite-key precondition, a listing containing `graph/gore/latest.json`, and a mocked `get` that throws `simulated S3 read failure`. It makes no network call. Observed result:

  ```json
  {"exitCode":0,"summary":{"mode":"apply","missingLatestJson":["gore"],"cities":0,"needsRepair":[],"committed":[],"pass":0,"refusedUnknown":[],"refusedGuard":[],"errors":[]}}
  ```

  The displayed JSON omits unrelated metadata from the full logged summary. The test fails with `an unreadable requested city must not complete successfully: expected +0 not to be +0`. Thus an explicitly requested repair can produce a successful Job with no city repaired, and its failure is absent from both `errors` and the bounded termination summary.
- **Fix:** Give every requested city a terminal outcome. Record missing/unreadable target snapshots as errors, include them in the termination summary, and return nonzero if any requested city was skipped. Preserve the distinction between not-found and storage-read failure so retries and diagnosis have the actual cause. Keep the existing per-city transaction isolation for other targets.

## Verdict

**NO-GO.** The migration and city-scoped storage paths passed the exercised checks, but the repair can bypass protection of a local value, omit node contamination from its repair list, and report success after skipping an unreadable requested city. Resolve A825-01 through A825-03 before using this repair as the production measurement/application path.
