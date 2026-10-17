status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: feat/projection-intended-removals@2815df82da0f4172578b46d5e130dcf1829da78c
round: 2

## Reasoning

Reviewed both `6b8e2c49efb09567aa19704f33c145c2a2c581c4..2815df82da0f4172578b46d5e130dcf1829da78c`
and `origin/main...2815df82da0f4172578b46d5e130dcf1829da78c`. HEAD remained the requested
commit; the local `origin/main` and merge base were both
`baf66f4488fe062b65484b4ed173d8e495fd0fd4`. This is the independent
operational-path/input-validation/runbook leg. I read both permitted round-1
reports, but no other round-2 report or results. Repository rules, the harness
review/testing guidance, spec §17 and the branch plan were read. No cluster,
bucket or GitHub API was contacted, and no fetch, commit or push was made.

**Round-2 delta.** The new exclusivity check at
`api/src/services/graph/graph-store.ts:1203` rejects nonempty
`baselineExcludeIds` together with `declared`, before `lockCityGraph` at line
1218. Empty exclusions cannot remove a baseline row. The existing nonempty
`intendedRemovals` exclusivity check remains at line 1200. The new DB test (j)
executed, and my replay of the round-1 fixture also retained the entire node/edge
snapshot, protected property, source SHA and complete-signal count. A transaction
stub separately observed zero `execute` calls on both rejected combinations.
Without declarations, baseline exclusions still work, both in my DB check and
the existing repair tests. No regression from the exclusivity fix was demonstrated.

**R1/R2 and transaction ordering.** `prepareCityProjection` at
`graph-store.ts:862` normalizes the candidate before the writer receives it.
`checkDeclaredChanges` at line 959 derives the actual removals and kept-node
property losses from the current/candidate rows. The writer rejects declarations
absent from that plan at line 1238, before exemptions or writes. Gate1 then exempts
only declared removed IDs and declared keys on their specific nodes; the
additional check at line 1256 refuses undeclared removals even when a node has no
business properties or refs. The tests exercised acceptance, absent declarations,
undeclared business-bearing and bare-node removals, unchanged no-option refusal,
and preview rollback. No undeclared write bypass was demonstrated.

**R3 and the gate3 judgement.** I accept the deleted-node-only exemption. A node
declared removed must first be proven absent from the candidate; declaring a
kept node removed fails R1. `evaluateRowGuards` passes removals to gate3 at
`graph-store.ts:918`, but not the accepted-property-loss map. My DB test accepts
the declaration for a kept node's property loss and still observes a gate3
refusal when its `SHA_LOCAL` disappears. Gate2 still counts the full baseline
in declared mode at line 1228 and checks the projected count at line 1380; its
existing DB regression test observes rollback on a declared complete-signal
removal. Removing the foreign bylaw is therefore a narrowly checked deletion,
not permission to lose provenance on a kept node.

**R4/R5 and workflow execution.** No-declaration calls retain their default
exemptions and existing three-argument script call at
`api/src/scripts/project-graph-from-s3.ts:152`. Refresh, repair and purge call
sites are unchanged; repair/purge/city-isolation tests passed. Script-port tests
also observe the old no-option summary keys, three-argument call and exit 0 for
the existing missing-object skip case. In declared mode, missing or invalid
input graphs, upsert errors and guard refusals exit 1.

The workflow still has ten dispatch inputs. The two reused inputs reach the
helper through environment variables at `.github/workflows/run-job.yaml:384`;
validation precedes Job deletion/application at line 476. The helper now exports
`LC_ALL=C` and rejects CR/LF in a declared city's value. Its ASCII character set,
length/count limits, duplicate checks and removal/loss exclusivity constrain the
sed and shell arguments. I executed the actual baseline and target Apply blocks
with an exported local `kubectl` stub: all 14 selected manifests have identical
non-comment content without declarations, allowing only the projection command's
extra space. The literal Brigham preview/apply declarations produce the expected
argument vectors in both environments. Seven invalid declarations caused no
stubbed delete/apply call. The helper's locale change is confined to its child
process; it does not change validation of other jobs in the workflow shell.

**Operational report and runbook.** The literal §17.4 declaration matches the
stored `contam2.json` evidence: exactly 21 absent IDs, the kept `muni-brigham:flag`
loss, and `bylaw-2025-05` with a missing SHA from Danville. Stored `rows.json` and
`sim.json` also match 36 S3 / 22 PG / 35 new / 21 removed and completeness 0 → 9.
These are historical local proofs; current remote state is **unverified**.
Mocked entry-point tests retain all Brigham declaration entries in 780/781-byte
preview/apply termination summaries and observe the before-row logging call.
The full-PR review found one reporting limit defect for a different, refused
plan containing Unicode business keys (ASTRA-853-R2-01 below).

The revised runbook accurately distinguishes diagnostic S3 writes from PG/graph
preview behavior, states the expected failed measurement run, and requires
retrieving the preview preimages and identifying the daily backup before apply.
It now describes deleting all projected city nodes/edges, including the 35 new
nodes, when restoring the June graph. The implementation reads preimages before
mutation and logs them after the transaction returns, matching the corrected
ordering. An actual restore, deployed image, remote CI and owner-side log/backup
retrieval remain **unverified**; a rehearsed restore is explicitly **not covered**
by §17.4. No additional runbook defect was demonstrated.

**Workspace typecheck.** The final standard `make install` followed by standard
`make typecheck`, both with `ENV=review2-astra-853`, passed. The round-1
`@radar/immo-mcp` missing-`@sentropic/mcp-auth`/`oauth-verify` failure was not
reproduced. Two earlier typecheck attempts in this review failed in the UI on
`pdfjs-dist` declaration resolution; those failures and the subsequent successful
sequence are recorded below. Their precise cause is **unverified**, and no claim
about an `origin/main` typecheck run is made.

## Previous findings

Evidence in every row is from commit
`2815df82da0f4172578b46d5e130dcf1829da78c` and the commands executed in this leg.

| Finding | Status | Evidence |
|---|---|---|
| SOL-853-01 — declarations combined with baseline exclusions bypass guards | **fixed** | `graph-store.ts:1203` throws before the lock at `:1218`; test (j), `graph-store.test.ts:2166`, ran. My original-fixture replay rejected the combination, retained identical full node/edge rows, `protected`, `SHA_LOCAL` and completeness 1. The stub observed zero transaction `execute` calls. The no-declaration exclusion path still committed its intended repair in the separate DB check; existing repair tests passed. |
| ASTRA-853-01 — locale-dependent non-ASCII acceptance and multiline city | **fixed** | `projection-declared-args.sh:20` exports `LC_ALL=C`; `:40` rejects LF/CR before `read`. New tests at `projection-declared-args.test.sh:59`–`:66` ran in the 46-case shell suite. Independent probes required exit 1, the expected diagnostic and empty stdout for `remove=é` / `lose=a:é` under four requested locales, plus LF/CR city variants. TypeScript tests rejected the same non-ASCII and line-break examples. |
| ASTRA-853-02 — repair preview called read-only; expected red step 2 omitted | **fixed** | Spec `:752` and `:757` state that the diagnostic S3 report is written; step 2 explicitly says the run is red by design. This matches `repair-graph-city-key.ts:234` (`store.put`) and `:244`–`:245` (refusals make exit 1). |
| ASTRA-853-03 — incorrect logging order; missing pre-apply capture; incomplete restore | **fixed** | Spec `:712`–`:719` says preimages are read before writes and logged after the transaction. This matches `graph-store.ts:1271` and `:1442`, then `project-graph-from-s3.ts:157`. Step 3b at spec `:754` requires saving the 22 node preimages/deleted edges and backup identifier, stopping if not retrievable. Spec `:761`–`:766` includes removing all projected nodes/edges, the 35 new nodes, and restoring the June set/common edges or the identified city backup. Rehearsal remains explicitly not covered. |

## Commands run (with outputs)

Commands used RTK after reading its bootstrap; TypeScript ran only through Make
in containers. Every Make invocation used `ENV=review2-astra-853` last. Shell
tests ran through Bash. Relevant output excerpts follow; source reads also used
`git`, `rg`, `cat`, `sed` and Bash. The test Compose configuration publishes no
host ports; `make ps-all` showed no existing stack with this review's name.

1. Target and diff checks:

   ```text
   rtk git branch --show-current
   feat/projection-intended-removals
   rtk git rev-parse HEAD
   2815df82da0f4172578b46d5e130dcf1829da78c
   rtk git rev-parse origin/main
   baf66f4488fe062b65484b4ed173d8e495fd0fd4
   rtk git merge-base origin/main 2815df82da0f4172578b46d5e130dcf1829da78c
   baf66f4488fe062b65484b4ed173d8e495fd0fd4
   git diff --stat 6b8e2c49efb09567aa19704f33c145c2a2c581c4..2815df82da0f4172578b46d5e130dcf1829da78c
   10 files changed, 653 insertions(+), 10 deletions(-)
   git diff --stat origin/main...2815df82da0f4172578b46d5e130dcf1829da78c
   18 files changed, 1709 insertions(+), 22 deletions(-)
   rtk git diff --check origin/main...2815df82da0f4172578b46d5e130dcf1829da78c
   [no output; exit 0]
   ```

2. Shell suite and syntax checks — exit 0:

   ```text
   rtk bash deploy/ci/projection-declared-args.test.sh
   projection-declared-args: 46 passed, 0 failed
   rtk bash -n deploy/ci/projection-declared-args.sh deploy/ci/projection-declared-args.test.sh
   [no output]
   ```

3. `rtk bash .review-tmp/astra-r2/operational.sh` — exit 0. The throwaway
   harness extracted the actual baseline/target Apply blocks, used only a local
   exported `kubectl` function, rendered the selected manifests, and tested the
   real validator. Output:

   ```text
   workflow baseline render comparisons=14 identical (projection whitespace normalized)
   workflow_dispatch inputs=10
   declared render target=prod mode=preview tokens=6 city=brigham
   declared render target=prod mode=apply tokens=5 city=brigham
   declared render target=preprod mode=preview tokens=6 city=brigham
   declared render target=preprod mode=apply tokens=5 city=brigham
   workflow invalid declarations=7 refused before any delete/apply
   standalone helper: 3 CR/LF city probes and 8 non-ASCII locale probes refused with expected diagnostic, no stdout
   declaration bytes=4096 rc=0
   declaration bytes=4097 rc=1
   ```

4. `rtk make k8s-validate K8S_VALIDATE_WITH_CLUSTER=0 ENV=review2-astra-853` — exit 0:

   ```text
   [k8s-validate] rendering deploy/k8s with kustomize…
   [k8s-validate] structural check (every doc has apiVersion + kind)…
   [document-date-recovery] offline render ok (preprod + prod)
   image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))
   [k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
   ```

5. Standard dependency install and workspace typecheck:

   ```text
   rtk make install ENV=review2-astra-853
   added 951 packages, and audited 965 packages in 35s
   [exit 0]

   rtk make typecheck ENV=review2-astra-853
   /workspace/ui/src/lib/components/maps/SignalPdfOverlay.svelte:7:36
   Error: Could not find a declaration file for module 'pdfjs-dist'.
   '/workspace/node_modules/pdfjs-dist/index.js' implicitly has an 'any' type.
   [same missing declaration at lines 8, 19, 445, 452, 646; implicit-any item at 637]
   svelte-check found 7 errors and 7 warnings in 2 files
   > @radar/immo-mcp@0.0.1 typecheck
   > tsc --noEmit -p tsconfig.json
   [no immo-mcp diagnostic]
   make: *** [Makefile:119: typecheck] Error 1
   [exit 2]
   ```

   A second standard typecheck after the test installs returned the same UI
   diagnostics (exit 2). I then repeated the standard install and typecheck
   serially, with no tracked-file changes or command overrides:

   ```text
   rtk make install ENV=review2-astra-853
   changed 1 package, and audited 965 packages in 5s
   [exit 0]
   rtk make typecheck ENV=review2-astra-853
   > @radar/api@0.0.0 typecheck
   > tsc --noEmit -p tsconfig.json
   svelte-check found 0 errors and 7 warnings in 1 file
   > @radar/immo-mcp@0.0.1 typecheck
   > tsc --noEmit -p tsconfig.json
   [domain, scoring and sources tsc commands also completed]
   [exit 0]
   ```

   The seven warnings concern unused exports/selectors in
   `SignauxSelPanel.svelte`. The final workspace gate passes. The earlier UI
   resolution failures are retained as observations, not attributed to this diff.

6. Repository API tests — exit 0:

   ```sh
   rtk make test-api SCOPE='src/scripts/projection-args.test.ts src/services/graph/graph-store.test.ts src/services/graph/city-key-repair.test.ts src/scripts/purge-avis-bylaws.test.ts tests/integration/graph-city-key.spec.ts' ENV=review2-astra-853
   ```

   ```text
   src/services/graph/graph-store.test.ts (158 tests)
   tests/integration/graph-city-key.spec.ts (11 tests)
   Test Files  5 passed (5)
   Tests       225 passed (225)
   Duration    2.28s
   ```

   The output includes DB-bound test (j), preview rollback and gate2 rollback;
   these tests executed against the migrated isolated Postgres, with no skipped
   tests reported.

7. Throwaway adversarial/script tests — exit 0:

   ```sh
   rtk make test-api SCOPE='--config ../.review-tmp/astra-r2/vitest.config.ts' ENV=review2-astra-853
   ```

   The config imported the repository API config and selected only this leg's
   `guards.test.ts` and `script.test.ts`. DB tests used local Postgres; entry-point
   tests mocked S3, DB/upsert, logging, termination-file writes and process exit.
   The Unicode report was derived by the real `checkDeclaredChanges` function.

   ```text
   historical proof matches: 21 removals, muni-brigham:flag, 36/22/35/21, complete 0->9
   SCRIPT preview exit=0 termination bytes=780 removals=21 losses=muni-brigham:flag
   SCRIPT apply exit=0 termination bytes=781 removals=21 losses=muni-brigham:flag
   SCRIPT missing exit=1
   SCRIPT invalid-json exit=1
   SCRIPT no-nodes exit=1
   SCRIPT error exit=1
   SCRIPT refused exit=1
   UNICODE termination chars=3899 bytes=6299
   PRELOCK exclusions rejected: tx.execute calls=0
   SOL-853-01 reproducer: rejected, nodes+edges identical, protected and SHA_LOCAL retained, completeness=1
   declared kept property accepted: gate3 still refuses SHA_LOCAL loss, snapshot unchanged
   no declarations: baselineExcludeIds repair path remains accepted
   Test Files  2 passed (2)
   Tests       20 passed (20)
   Duration    7.22s
   ```

   The Unicode case is a diagnostic test measuring current behavior, not an
   assertion that the 4 KiB contract holds. Invalid argv also produced no DB/S3
   call, and plain successful/missing-object paths retained their old contracts.

8. Cleanup — both commands exited 0:

   ```sh
   rtk make clean ENV=review2-astra-853
   rtk make clean COMPOSE_FILES_DEV='-f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml' ENV=review2-astra-853
   ```

   The first removed this review's Postgres/MinIO containers, network and dev
   dependency/data volumes. The second removed
   `radar-review2-astra-853_radar-test-root-node-modules` and
   `radar-review2-astra-853_radar-test-api-node-modules`, which the default clean
   does not declare. This leg's temporary harness, tests, rendered manifests and
   logs were deleted. The only retained authored file is this review leg; no
   tracked implementation or dependency-lock file was changed.

   ```text
   rtk make ps ENV=review2-astra-853
   NAME      IMAGE     COMMAND   SERVICE   CREATED   STATUS    PORTS
   [no containers; exit 0]
   rtk git diff --name-only
   [no output; review leg is the supplied untracked file]
   rtk git rev-parse HEAD
   2815df82da0f4172578b46d5e130dcf1829da78c
   ```

   `.review-tmp` was removed after deleting this leg's files. Other round-2
   review artefacts were preserved without reading their contents.

## Findings

### ASTRA-853-R2-01 — Declared termination summaries count characters instead of bytes

- **Severity:** non-blocking.
- **File:line:** `api/src/scripts/project-graph-from-s3.ts:251`; report source:
  `api/src/services/graph/graph-store.ts:968`; preprod consumer:
  `.github/workflows/run-job.yaml:550`.
- **Evidence:** `declaredTermination` returns a body when `body.length <= 4000`,
  but the termination-message budget is 4 KiB. The declaration parser's ASCII
  restriction does not constrain the existing database's property keys:
  `graph-store.ts:44` accepts arbitrary record keys, and `checkDeclaredChanges`
  includes every planned kept-node loss, including undeclared losses, in the
  report. My throwaway test used the valid ASCII Brigham declaration, its 21
  removal rows, and a retained municipality with `flag` plus 40 business keys
  generated as `Array.from({length: 40}, (_, i) => 'é'.repeat(60) + i)`. The
  candidate omitted those properties. The real plan function reports the losses;
  the actual script, with a refused upsert result supplied through its mocked
  port, exits 1 and writes **3,899 characters / 6,299 UTF-8 bytes** to
  `/dev/termination-log`. This exceeds the promised bound and leaves the
  preprod termination-only report subject to truncation. Actual Kubernetes
  delivery of this fixture is **not covered**. The ordinary Brigham summaries
  fit, and no guard bypass or committed data loss is demonstrated.
- **Fix:** use `Buffer.byteLength(body, 'utf8')` for the serialized summary budget
  while shrinking lists; ensure the final fallback is also bounded valid JSON.
  Add a regression case whose plan contains Unicode keys and assert both valid
  JSON and a UTF-8 byte length no greater than the selected termination budget.

## Verdict

**GO-with-nits.** All four previous findings are fixed. The final standard
install/typecheck sequence, 225 repository tests, 20 adversarial/script tests,
46 shell cases and offline Kubernetes validation passed. One new non-blocking
report-size defect remains (ASTRA-853-R2-01); no R1–R5 guard or workflow bypass
was demonstrated. Remote CI, deployed execution and a rehearsed restore remain
**unverified**. This verdict covers this independent leg only.
