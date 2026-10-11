status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: feat/projection-intended-removals@6b8e2c49efb09567aa19704f33c145c2a2c581c4
lens: guard-correctness-and-bypass

## Reasoning

Target: `origin/main...6b8e2c49efb09567aa19704f33c145c2a2c581c4`. HEAD is the requested commit; the locally available `origin/main` and merge base are both `baf66f4488fe062b65484b4ed173d8e495fd0fd4`. No git fetch, cluster/bucket call or GitHub API request was made. I read `AGENTS.md`, `rules/MASTER.md`, workflow/testing rules, the harness review/test instructions, spec §17 and the branch plan. The code and executed tests determine this verdict.

1. **R1 — declarations must exist in the plan.** `prepareCityProjection` (`graph-store.ts:862`) parses, collapses duplicate IDs and materializes severed sources before the transaction sees the candidate. `checkDeclaredChanges` (`graph-store.ts:959`) derives removals from all city current rows, not the filtered guard baseline, and derives losses only from kept rows using the same business-property predicate as gate1. Its rejection at `graph-store.ts:1232` precedes exemptions and all graph writes. Declaring a kept or unknown node removed, a surviving key lost, an unknown/removed node's key lost, or an already uninformative classified key lost produces `declaredNotInPlan`. Informative `instrument` degraded to `inconnu` is a planned loss, consistently with gate1. Existing tests and my normalized duplicate/degradation test exercise these distinctions. No R1 bypass was demonstrated.

2. **R2 — only declared removals/losses may pass.** With the projection CLI's options, gate1 skips exactly declared removal IDs and declared keys. Undeclared bare-node removals are checked separately at `graph-store.ts:1250`; an empty property/ref map cannot evade this check. Declaration validation also prevents using a declared kept-node removal as a whole-node exemption. However, the exported transaction writer accepts `declared` together with `baselineExcludeIds`: an excluded kept node's undeclared property loss commits. This is SOL-853-01. R2 is partial at the service API boundary.

3. **R3 — gate2 and gate3.** Gate3 receives the intended removal set, but never the accepted-property-loss map (`graph-store.ts:918`). The earlier plan check makes its declared exemption removal-only. The DB test for a kept node with an accepted property loss and missing docSha returns a provenance refusal. This supports the author's deleted-node-only gate3 exemption: keeping that same ID invalidates a removal declaration before any exemption applies. The gate2 SQL/count/comparison/abort body is unchanged by the diff (`graph-store.ts:1355`); the before count still includes declared removed signals. Existing and throwaway tests observe gate2 rollback. Nevertheless, the same `baselineExcludeIds` combination removes a kept node from gate3 and the gate2 before count: actual completeness 1 → 0 commits. R3 is partial at that boundary.

4. **R4 — calls without declarations.** The added optional parameters default to empty maps/options. `upsertGraphAtomic` passes the same existing fourth-argument removal set into the same city transaction when no declarations exist (`graph-store.ts:1434`); preview rollback is inactive. The gate2 abort catch returns the original result in this case. Refresh still calls the three-argument form (`refresh-run.ts:314`); the repair still calls the transaction writer with only its existing foreign baseline exclusions (`city-key-repair.ts:371`); purge still uses its fourth-argument intended removal set (`purge-avis-bylaws.ts:407`). These callers are absent from the diff. The script retains its three-argument projection call (`project-graph-from-s3.ts:152`), final fields and termination serialization; its extra exit predicate is false without declarations. My script-port tests assert the exact termination JSON and exit 0 for both a plain successful projection and the existing GET-skip case. Existing city-key/repair/purge tests ran. Production execution and an entire refresh/purge operational run remain unverified.

5. **Transactions and preview.** The lock and baseline read precede checks; the first graph write is at `graph-store.ts:1283`. Plan/gate1/gate3/undeclared-removal refusals return before graph mutations. `upsertGraphAtomic` throws the preview sentinel even after such a refusal (`graph-store.ts:1438`). Gate2 throws inside the DB transaction and is caught after rollback. My DB snapshot comparisons include both nodes and edges for gate1 refusal, gate2 refusal after writes, and successful preview after insert/update/delete. All three retain the original snapshot. Unexpected DB exceptions propagate out of the transaction; the outer script counts an error. That exception rollback path is established by code, not separately fault-injected.

6. **Before rows and edges.** The new node query selects `id,type,label,props,sourceRef` (`graph-store.ts:1266`); the edge query selects `srcId,dstId,kind,props` (`graph-store.ts:1273`). Neither asks for `created_at`. The returned baseline contains all declared affected nodes and existing city edges absent from the candidate or incident to declared removals. It is read before writes. The script logs that payload at `project-graph-from-s3.ts:159`; my script-port test asserts the exact logging call. The existing declared-mode DB test checks the June properties and deleted edge in the returned baseline. The actual production schema and persistence of the emitted pod log are unverified. Edges have no gate1/gate3 contract in this change: existing stale/dangling-edge reconciliation remains active and deleted edge rows are logged.

7. **Workflow surface.** Offline tests exercise bounded lists, duplicates, invalid clauses/characters, one-city validation, preview/apply and both manifest placeholders. Direct counting returns ten dispatch inputs. Empty declarations produce empty flags and ignore the recovery mode, preserving the plain projection command. No workflow dispatch, cluster, bucket or GitHub API was contacted; live operation is unverified.

The first temporary-test configuration used a wildcard and discovered an unrelated test in the shared `.review-tmp` directory. I discarded that run as review evidence and reran with only my two explicitly named files. No unrelated test results or other leg artefacts are used in this review.

## Commands run

All shell commands used the repository's `rtk` prefix after loading its instruction; outputs below are relevant excerpts. JavaScript/TypeScript execution was containerized through Make. Shell validator tests ran directly through Bash as requested. All stacks used `ENV=review-sol-853`, never `dev`.

**Target and inspection**

```text
rtk git branch --show-current
feat/projection-intended-removals

rtk git rev-parse HEAD
6b8e2c49efb09567aa19704f33c145c2a2c581c4

rtk proxy git rev-parse origin/main
baf66f4488fe062b65484b4ed173d8e495fd0fd4

rtk proxy git merge-base origin/main 6b8e2c49efb09567aa19704f33c145c2a2c581c4
baf66f4488fe062b65484b4ed173d8e495fd0fd4

rtk proxy git diff --stat origin/main...6b8e2c49efb09567aa19704f33c145c2a2c581c4
13 files changed, 1066 insertions(+), 22 deletions(-)

rtk proxy git diff --check origin/main...6b8e2c49efb09567aa19704f33c145c2a2c581c4
[no output; exit 0]
```

Read-only `cat`, `sed`, `rg` and `nl` commands inspected every target code/test/manifest/workflow file, the before/after diff, the plan/spec, Make/Compose/Vitest configuration, and the refresh/repair/purge call sites. Their relevant file/line outputs are cited above. `make ps-all` showed no existing `radar-review-sol-853` stack; the test Compose configuration publishes no host ports.

**Shell validation**

```text
rtk bash deploy/ci/projection-declared-args.test.sh
projection-declared-args: 36 passed, 0 failed
[exit 0]

rtk proxy bash -n deploy/ci/projection-declared-args.sh deploy/ci/projection-declared-args.test.sh
[no output; exit 0]

rtk proxy bash -c 'sed -n "/^    inputs:/,/^concurrency:/p" .github/workflows/run-job.yaml | grep -Ec "^      [a-z_]+:$"'
10
[exit 0]
```

**Dependency installation**

The initial install disabled lockfile writes to preserve the restriction on tracked files:

```text
rtk make install COMPOSE_RUN_API_NODEPS='$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) run --rm --no-deps -T -e npm_config_package_lock=false api' ENV=review-sol-853
npm error Cannot destructure property 'package' of 'node.target' as it is null.
make: *** [Makefile:305: install] Error 1
[exit 2]
```

I retried the same Make target with its container command set to install the existing lockfile, without rewriting it:

```text
rtk make install COMPOSE_RUN_API_NODEPS='$(DOCKER_COMPOSE) $(COMPOSE_FILES_DEV) run --rm --no-deps -T api sh -c "npm ci" --' ENV=review-sol-853
added 958 packages, and audited 965 packages in 50s
[exit 0]
```

**Requested API tests plus existing caller tests**

```text
rtk make test-api SCOPE='src/services/graph/graph-store.test.ts src/scripts/projection-args.test.ts src/services/graph/city-key-repair.test.ts src/scripts/purge-avis-bylaws.test.ts tests/integration/graph-city-key.spec.ts' ENV=review-sol-853
src/services/graph/graph-store.test.ts (157 tests)
tests/integration/graph-city-key.spec.ts (11 tests)
Test Files 5 passed (5)
Tests 224 passed (224)
[exit 0]
```

The output includes the DB-bound declared accept/refusal, bare-node refusal, plan mismatch, no-option refusal, preview rollback and gate2 tests; these were executed in the migrated test Postgres stack, not skipped.

**Workspace typecheck**

```text
rtk make typecheck ENV=review-sol-853
> @radar/api@0.0.0 typecheck
> tsc --noEmit -p tsconfig.json
[no API diagnostics]
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

The workspace gate did not pass. Its causal relationship to this PR is unverified; no claim about an `origin/main` typecheck result is made.

**Throwaway adversarial tests**

Temporary config imports the repository API Vitest configuration and includes only `../.review-tmp/guard-bypass.test.ts` and `../.review-tmp/script-contract.test.ts`. These exercise the real graph-store against test Postgres; the script tests mock DB/S3/logging ports and filesystem writes, so they do not reach an external service.

```text
rtk make test-api SCOPE='--config ../.review-tmp/vitest.config.ts' ENV=review-sol-853
../.review-tmp/script-contract.test.ts (5 tests)
REPRO baselineExcludeIds+declared: aborted=false; undeclared kept:protected and SHA_LOCAL lost; complete signals 1 -> 0
../.review-tmp/guard-bypass.test.ts (7 tests)
Test Files 2 passed (2)
Tests 12 passed (12)
[exit 0]
```

The bypass test passes by asserting the observed unsafe commit, including a subsequent PG read; it is a diagnostic reproducer, not an assertion that R2/R3 hold. Other tests assert original node/edge snapshots after all three preview outcomes, gate3 refusal on an accepted-loss kept node, invalid normalized declarations and post-materialization source checking.

**Cleanup and final scope check**

```text
rtk make clean COMPOSE_FILES_DEV='$(COMPOSE_FILES_BASE) -f docker-compose.dev.yml -f docker-compose.test.yml' ENV=review-sol-853
Container radar-review-sol-853-minio-1 Removed
Container radar-review-sol-853-postgres-1 Removed
Volume radar-review-sol-853_radar-test-api-node-modules Removed
Volume radar-review-sol-853_radar-test-root-node-modules Removed
Volume radar-review-sol-853_radar-root-node-modules Removed
Volume radar-review-sol-853_postgres-data Removed
Network radar-review-sol-853_radar Removed
[exit 0]

rtk make clean ENV=review-sol-853
Volume radar-review-sol-853_radar-api-node-modules Removed
[exit 0]

rtk rm -- .review-tmp/guard-bypass.test.ts .review-tmp/script-contract.test.ts .review-tmp/vitest.config.ts .review-tmp/adversarial.log .review-tmp/independent.log
rtk proxy rmdir .review-tmp
[no output; exit 0]

rtk proxy git diff --name-only
[no output; no tracked-file changes]

rtk make ps ENV=review-sol-853
NAME      IMAGE     COMMAND   SERVICE   CREATED   STATUS    PORTS
[no containers; exit 0]
```

The review leg was supplied as an untracked stub; it is the only retained file written by this leg. No commit, push, dependency-lock change or code change was made. The temporary directory was removed after its other shared entries had disappeared.

## Findings

### SOL-853-01

- **Severity:** blocking.
- **File:line:** `api/src/services/graph/graph-store.ts:1197` (new option exclusivity check; related baseline filter at 1220, row guards at 1243 and gate2 comparison at 1363).
- **Evidence:** `declared` is mutually exclusive with nonempty `intendedRemovals`, but not with `baselineExcludeIds`. The latter removes entire kept rows from both row guards and `completeBefore`. The plan still sees `kept:protected` as a loss, but the subsequent explicit check rejects only undeclared *removals*. Thus the writer can commit an undeclared kept property loss, its docSha disappearance and a complete-signal count reduction in declared mode. The ordinary declared `upsertGraphAtomic` call refuses the same candidate; adding only a kept baseline exclusion to the transaction writer commits it.

Executed reproducer shape (test-only city, no external data):

```ts
const before = {
  nodes: [
    { id: "removed", type: "Lot", label: "Removed", properties: { number: "1" } },
    { id: "kept", type: "Signal", label: "Kept", properties: { protected: "keep" },
      refs: [{ docSha: "SHA_LOCAL", excerpt: "Adopted", rawRef: "raw/cas/SHA_LOCAL.pdf" }] },
  ],
  edges: [{ source: "removed", target: "kept", type: "in" }],
};
const candidate = {
  nodes: [{ id: "kept", type: "Signal", label: "Kept" }, { id: "added", type: "Lot", label: "Added" }],
  edges: [{ source: "kept", target: "added", type: "in" }],
};
const declared = { removals: new Set(["removed"]), propertyLosses: new Map() };
await upsertGraphAtomic(db, city, before);
// Without baseline exclusions: aborted=true, reason includes "kept: protected".
await upsertGraphAtomic(db, city, candidate, undefined, { declared });
// With the additional allowed option: commits.
const result = await db.transaction(tx =>
  projectCityInTransaction(tx, prepareCityProjection(city, candidate), {
    declared, baselineExcludeIds: new Set(["kept"]),
  }),
);
// result.aborted=false; result.declared.plannedLosses=["kept:protected"].
// Re-reading PG returns kept.props={}; actual complete signals: 1 -> 0.
```

**Scope of the finding:** The current projection CLI cannot pass `baselineExcludeIds`; `upsertGraphAtomic` constructs options without it. The repair passes exclusions without declarations. No existing production caller combining these options was found. The demonstrated defect is the newly permitted service API combination and its R2/R3 contract, not a claim that the documented Brigham CLI run bypasses guards.

**Fix:** Reject nonempty `baselineExcludeIds` together with `declared` before acquiring the lock, alongside the existing removal-option exclusivity check, and add a DB regression test requiring rejection/no mutation for this combination. Keep the repair's no-declaration exclusion path unchanged. Acceptance: the same fixture must not commit the kept node's undeclared property/ref loss or lower its actual complete-signal count.

## Verdict

**NO-GO.** SOL-853-01 demonstrates an R2/R3 bypass in the exported declared-mode transaction writer. The ordinary CLI path and the observed preview paths retain their guards/rollback behavior. The full workspace typecheck also did not pass; its cause relative to this diff is unverified.
