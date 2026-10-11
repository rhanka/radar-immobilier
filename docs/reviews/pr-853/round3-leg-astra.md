status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: feat/projection-intended-removals@4c2e58478b180b1032a0d0d07002ee477da43c43
round: 3

## Reasoning

Reviewed both mandatory targets at `4c2e58478b180b1032a0d0d07002ee477da43c43`:

- Delta: `2815df82da0f4172578b46d5e130dcf1829da78c..4c2e58478b180b1032a0d0d07002ee477da43c43`.
- Whole PR: `origin/main...4c2e58478b180b1032a0d0d07002ee477da43c43`. The local `origin/main` and merge base are both `baf66f4488fe062b65484b4ed173d8e495fd0fd4`.

I read the repository bootstrap/master/workflow/testing rules, harness review/test/debug guidance, spec §17, branch plan, and permitted previous-round material. I did not read the other round-3 leg or prompt or communicate with its reviewer. No cluster, bucket or GitHub API was contacted; no fetch, commit or push was made. Runtime checks used Make-managed containers, with the explicitly requested `ENV=review3-astra-853` last. The test Compose configuration publishes no host ports.

**Delta and termination content.** The extraction introduces one runtime import and replaces only the declared-mode serializer call (`api/src/scripts/project-graph-from-s3.ts:49`, `:222`). The helper at `api/src/scripts/projection-termination.ts:16` retains the same list caps, truncation markers, report fields, `preview` boolean and explicit `declared: null` for a city without a plan. At `:30`, each serialized candidate is accepted by UTF-8 byte length, including the marker's bytes. No serialized string is sliced in declared mode.

The final fallback at `projection-termination.ts:33` removes `abortedCities` and the declaration lists. For the sole production caller's report at `project-graph-from-s3.ts:219`, the remaining fields are a fixed event name, numeric counters and a boolean, so this fallback is bounded. Arbitrary additional report fields are not supplied by that caller. My actual-entry-point test forced this branch with a 5,000-character ASCII city accepted by the parser and an aborted result: exit 1, valid JSON, 188 bytes, `declared: "truncated"`, and the refusal count retained. The repository test named "falls back" at `projection-termination.test.ts:34` exercises the zero-entry list cap; the independent test exercises the final counts-only return.

The round-2 Unicode construction was replayed through the real `checkDeclaredChanges` and the actual script with mocked DB/upsert, S3, logging, termination-write and exit ports. The resulting refused plan contains 41 losses; the termination summary is valid JSON at **2,587 characters / 3,969 UTF-8 bytes**, exits 1, and ends its shortened loss list with a count marker. The full 41-entry plan remains in the logging call. Another test checks 45 combinations of list-size boundaries, two-/three-/four-byte characters, JSON escapes and individual 10,000-byte strings: every output is valid JSON within 4,000 bytes, with exact retained prefixes and omitted-entry counts.

The literal §17.4 Brigham declaration retains all 21 sorted removals and `muni-brigham:flag`, with empty mismatch/undeclared lists, in both preview and apply. Those entry-point tests produce 780/781-byte summaries, retain the before-row logging call and exit 0. Missing objects, invalid JSON, missing `nodes`, upsert errors and guard refusals exit 1 in declared mode with the corresponding counters. Invalid declarations fail before DB/S3 creation or termination writes.

**Whole-PR requirements and regressions.**

| Requirement | Evidence at the reviewed commit |
|---|---|
| R1 — declarations must occur in the plan | `graph-store.ts:959` computes removals from absent candidate IDs and losses from kept-node gate1 differences. `:1233` checks the full current rows, and `:1238` refuses `declaredNotInPlan` before exemptions or writes. Candidate normalization precedes this at `:862`. The pure tests and DB test (f) executed. |
| R2 — undeclared changes stay refused | `graph-store.ts:728` exempts only the accepted key on its specific node; `:1249` evaluates row guards. `:1256` also refuses undeclared removals of nodes without business properties/refs. Nonempty `baselineExcludeIds` and `intendedRemovals` remain exclusive with declarations before the lock (`:1200`, `:1203`, `:1218`). The key-specific gate1 tests and DB tests (e), (e2), (f), (j) passed. |
| R3 — gate2/gate3 remain evaluated | Gate3 receives only the checked removed-node IDs, not the property-loss map (`graph-store.ts:918`). A kept-node source-ref loss still fails its unit test. A declared kept-node removal fails R1, so it cannot exempt that node from gate3. Gate2 compares the full declared-mode baseline at `:1228` with the projected count at `:1369`; DB test (i) observes refusal and rollback on a declared complete-signal removal. The removed-node-only gate3 exemption matches spec §17.2. |
| R4 — no-option behavior | The script still calls `upsertGraphAtomic` with three arguments without declarations (`project-graph-from-s3.ts:152`) and retains `JSON.stringify(report).slice(0, 4000)` (`:222`). Six entry-point tests assert the exact previous serialization and exit contract for success, missing object, malformed JSON, missing `nodes`, upsert error and refusal. The old plain-mode character slicing remains unchanged; this delta does not claim a new plain-mode byte bound. DB test (g), repair/purge tests and city-isolation tests passed. The unchanged refresh, repair and purge callers remain at `refresh-run.ts:314`, `city-key-repair.ts:371`, `purge-avis-bylaws.ts:407`. |
| R5 — bounded, validated workflow declarations | `projection-declared-args.sh:20` fixes ASCII locale; `:26` bounds declaration input to 4,096 bytes under that locale; `:32` and `:40` reject CR/LF; count, ID/key, duplicate and removal/loss exclusivity checks follow. TypeScript parsing independently enforces the one-city/declaration constraints. All 46 shell cases and the parser tests passed. The workflow retains ten dispatch inputs, validates before delete/apply (`run-job.yaml:385`, `:476`), and renders/checks `__PROJECTION_ARGS__` (`:467`, `:473`). Both manifests supply that placeholder to the script. These files are unchanged by the round-3 delta. |

The branch-plan delta adds the two new helper paths to Allowed Paths. The round-2 review files record the previous evidence; they do not alter runtime behavior. Spec §17's preimage capture checkpoint, expected refused measurement run and complete city-restore description remain unchanged. Current remote graph state, deployed execution, termination-message delivery by Kubernetes and remote CI are **unverified**. A rehearsed restore is **not covered**.

The final standard workspace typecheck passes, including `immo-mcp`. Two earlier attempts failed with missing dependency declarations; those results and the intervening successful container resolution probe are retained below. Their precise cause remains **unverified**. No implementation, dependency manifest or lockfile was changed by this leg.

## Previous findings

| Finding | Status | Evidence |
|---|---|---|
| **ASTRA-853-R2-01** — declared summary bounded by characters instead of UTF-8 bytes | **fixed** | `projection-termination.ts:30` checks `Buffer.byteLength(body, "utf8")`; `:33` returns an unsliced counts-only fallback bounded for the actual caller. The new multibyte regression test at `projection-termination.test.ts:25` passed. Independent actual-script replay: 3,969 bytes, valid JSON, exit 1. Independent final-fallback test: 188 bytes, valid JSON, exit 1. The 45 encoding/list-boundary probes also passed. |

## Commands run (with outputs)

Relevant output excerpts follow; ANSI color and package-install progress are omitted. Source inspection also used `cat`, `sed`, `rg` and path-scoped `git diff --no-compact`. TypeScript ran only in Make-managed containers. Throwaway files were confined to `.review-tmp/astra-r3/`.

1. Target and diff checks — exit 0:

   ```text
   rtk git branch --show-current
   feat/projection-intended-removals
   rtk git rev-parse HEAD
   4c2e58478b180b1032a0d0d07002ee477da43c43
   rtk git rev-parse origin/main
   baf66f4488fe062b65484b4ed173d8e495fd0fd4
   rtk git merge-base origin/main HEAD
   baf66f4488fe062b65484b4ed173d8e495fd0fd4
   rtk git diff --stat 2815df82da0f4172578b46d5e130dcf1829da78c..4c2e58478b180b1032a0d0d07002ee477da43c43
   8 files changed, 698 insertions(+), 26 deletions(-)
   rtk git diff --stat origin/main...4c2e58478b180b1032a0d0d07002ee477da43c43
   24 files changed, 2381 insertions(+), 22 deletions(-)
   rtk git diff --check origin/main...HEAD
   rtk git diff --check 2815df82da0f4172578b46d5e130dcf1829da78c..HEAD
   [both: no output]
   ```

   A build-location search also tried nonexistent `api/build.ts` and `api/build.mjs` and exited 2. The subsequent `api/package.json` / `api/tsconfig.json` read identifies the actual build as `tsc -p tsconfig.json`, including `src/**/*.ts`; no missing build file is inferred.

2. Shell validation and dispatch-input count — exit 0:

   ```text
   rtk bash deploy/ci/projection-declared-args.test.sh
   projection-declared-args: 46 passed, 0 failed
   rtk bash -n deploy/ci/projection-declared-args.sh deploy/ci/projection-declared-args.test.sh
   [no output]
   rtk bash -c 'rtk sed -n "/^    inputs:/,/^concurrency:/p" .github/workflows/run-job.yaml | rtk grep -Ec "^      [a-z_]+:$"'
   10
   ```

3. Initial standard install/typecheck:

   ```text
   rtk make ps ENV=review3-astra-853
   NAME      IMAGE     COMMAND   SERVICE   CREATED   STATUS    PORTS
   [no containers; exit 0]
   rtk make install ENV=review3-astra-853
   added 951 packages, and audited 965 packages in 16s
   [exit 0]
   rtk make typecheck ENV=review3-astra-853
   > @radar/api@0.0.0 typecheck
   > tsc --noEmit -p tsconfig.json
   [no API diagnostic]
   svelte-check found 0 errors and 7 warnings in 1 file
   > @radar/immo-mcp@0.0.1 typecheck
   src/server-http.ts(9,31): error TS2307: Cannot find module '@sentropic/mcp-auth' or its corresponding type declarations.
   src/server-http.ts(10,52): error TS2307: Cannot find module '@sentropic/mcp-auth' or its corresponding type declarations.
   src/server-http.ts(11,66): error TS2307: Cannot find module '@sentropic/mcp-auth/hono' or its corresponding type declarations.
   src/server-http.ts(12,32): error TS2307: Cannot find module '@sentropic/oauth-verify' or its corresponding type declarations.
   src/server-http.ts(13,56): error TS2307: Cannot find module '@sentropic/oauth-verify' or its corresponding type declarations.
   make: *** [Makefile:119: typecheck] Error 2
   [exit 2]
   ```

   This typecheck overlapped this leg's test dependency install. A later read found the declared `dist/index.d.ts` and `dist/hono.d.ts` files under the `immo-mcp` dependencies. The precise cause of the initial resolution failure is **unverified**; it is not attributed to this diff or described as a baseline failure.

4. Repository tests — exit 0:

   ```sh
   rtk make test-api SCOPE='src/scripts/projection-termination.test.ts src/scripts/projection-args.test.ts src/services/graph/graph-store.test.ts src/services/graph/city-key-repair.test.ts src/scripts/purge-avis-bylaws.test.ts tests/integration/graph-city-key.spec.ts' ENV=review3-astra-853
   ```

   ```text
   src/services/graph/graph-store.test.ts (158 tests)
   tests/integration/graph-city-key.spec.ts (11 tests)
   Test Files  6 passed (6)
   Tests       229 passed (229)
   Duration    1.93s
   ```

   DB-bound cases ran against the migrated isolated Postgres; no skipped tests were reported.

5. Independent termination/entry-point tests — exit 0:

   ```sh
   rtk make test-api SCOPE='--config ../.review-tmp/astra-r3/vitest.config.ts' ENV=review3-astra-853
   ```

   The temporary config imports the repository API config and selects only this leg's two files. Entry-point ports are mocked; the Unicode plan uses the real planner. The command output was captured under this leg's temporary directory and read through `tail`.

   ```text
   BRIGHAM preview=false exit=0 bytes=781 removals=21 loss=muni-brigham:flag
   BRIGHAM preview=true exit=0 bytes=780 removals=21 loss=muni-brigham:flag
   DECLARED missing exit=1 ok=0 aborted=0 skipped=1 errors=0
   DECLARED json exit=1 ok=0 aborted=0 skipped=1 errors=0
   DECLARED shape exit=1 ok=0 aborted=0 skipped=1 errors=0
   DECLARED upsert exit=1 ok=0 aborted=0 skipped=0 errors=1
   DECLARED refused exit=1 ok=0 aborted=1 skipped=0 errors=0
   UTF8/escape/list-boundary summaries=45 all valid JSON and <=4000 bytes
   UNICODE exit=1 chars=2587 bytes=3969 lossEntries=25
   FALLBACK exit=1 bytes=188 declared=truncated
   PLAIN success exit=0 legacyReportExact=true
   PLAIN missing exit=0 legacyReportExact=true
   PLAIN json exit=0 legacyReportExact=true
   PLAIN shape exit=0 legacyReportExact=true
   PLAIN upsert exit=1 legacyReportExact=true
   PLAIN refused exit=1 legacyReportExact=true
   Test Files  2 passed (2)
   Tests       18 passed (18)
   Duration    1.16s
   ```

6. Serial standard install/typecheck recheck, followed by container resolution diagnosis:

   ```text
   rtk make install ENV=review3-astra-853
   changed 8 packages, and audited 965 packages in 8s
   [exit 0]
   rtk make typecheck ENV=review3-astra-853
   svelte-check found 0 errors and 7 warnings in 1 file
   [the same five immo-mcp TS2307 diagnostics as command 3]
   [exit 2]
   ```

   After this second failure, a temporary Makefile included the repository Makefile and used its `COMPOSE_RUN_API_NODEPS` command to inspect those dependency files and run `npm exec -- tsc --noEmit -p tsconfig.json --traceResolution` inside the `immo-mcp` container working directory. No install or dependency modification was part of that diagnostic target.

   ```text
   rtk make -f .review-tmp/astra-r3/Makefile review-resolution ENV=review3-astra-853
   node_modules/@sentropic/mcp-auth/dist/index.d.ts exists
   node_modules/@sentropic/oauth-verify/dist/index.d.ts exists
   ======== Module name '@sentropic/mcp-auth' was successfully resolved to '/workspace/packages/immo-mcp/node_modules/@sentropic/mcp-auth/dist/index.d.ts' with Package ID '@sentropic/mcp-auth/dist/index.d.ts@0.1.0'. ========
   ======== Module name '@sentropic/mcp-auth/hono' was successfully resolved to '/workspace/packages/immo-mcp/node_modules/@sentropic/mcp-auth/dist/hono.d.ts' with Package ID '@sentropic/mcp-auth/dist/hono.d.ts@0.1.0'. ========
   ======== Module name '@sentropic/oauth-verify' was successfully resolved to '/workspace/packages/immo-mcp/node_modules/@sentropic/oauth-verify/dist/index.d.ts' with Package ID '@sentropic/oauth-verify/dist/index.d.ts@0.1.0'. ========
   [exit 0]
   ```

   The changed observation justified one more standard workspace typecheck. The cause of the two earlier failures remains **unverified**.

7. Final standard workspace typecheck — exit 0:

   ```text
   rtk make typecheck ENV=review3-astra-853
   > @radar/api@0.0.0 typecheck
   > tsc --noEmit -p tsconfig.json
   svelte-check found 0 errors and 7 warnings in 1 file
   > @radar/immo-mcp@0.0.1 typecheck
   > tsc --noEmit -p tsconfig.json
   > @radar/domain@0.0.0 typecheck
   > tsc --noEmit -p tsconfig.json
   > @radar/scoring@0.0.0 typecheck
   > tsc --noEmit -p tsconfig.json
   > @radar/sources@0.0.0 typecheck
   > tsc --noEmit -p tsconfig.json
   [no TypeScript diagnostic; exit 0]
   ```

   The seven Svelte warnings concern unused exports/selectors in `SignauxSelPanel.svelte`.

8. Cleanup and worktree check:

   ```text
   rtk make clean ENV=review3-astra-853
   [removed this review's Postgres/MinIO containers, network, data/dev dependency volumes; exit 0]
   rtk make clean COMPOSE_FILES_DEV='-f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml' ENV=review3-astra-853
   [removed this review's two test dependency volumes; exit 0]
   rtk make ps ENV=review3-astra-853
   NAME      IMAGE     COMMAND   SERVICE   CREATED   STATUS    PORTS
   [no containers; exit 0]
   rtk git diff --name-only
   [no output; the supplied review leg is untracked]
   rtk git rev-parse HEAD
   4c2e58478b180b1032a0d0d07002ee477da43c43
   ```

   Removed `.review-tmp/astra-r3/`, including all tests, the diagnostic Makefile and logs. The shared `.review-tmp` directory was nonempty after this leg's removal and was retained for other work; none of its other files were read or removed. Other review stubs/prompts were preserved. This leg's only retained authored file is this report.

## Findings

No new demonstrated finding in the round-3 delta or the whole PR. No `ASTRA-853-R3-NN` finding is emitted. The earlier typecheck failures are recorded as command results with an **unverified** cause; the final standard workspace typecheck passes.

## Verdict

**GO.** ASTRA-853-R2-01 is fixed. The 229 repository tests, 18 independent tests, 46 shell cases and final standard workspace typecheck pass. No R1–R5 regression was demonstrated. Remote CI and deployed execution remain **unverified**; a rehearsed restore is **not covered**. This verdict covers this independent leg only.
