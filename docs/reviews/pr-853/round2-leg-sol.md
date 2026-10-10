status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: feat/projection-intended-removals@2815df82da0f4172578b46d5e130dcf1829da78c
round: 2
lens: guard-correctness-and-bypass

## Reasoning

Reviewed both mandatory targets at `2815df82da0f4172578b46d5e130dcf1829da78c`:

- Round-2 delta: `6b8e2c49efb09567aa19704f33c145c2a2c581c4..2815df82da0f4172578b46d5e130dcf1829da78c`.
- Whole PR: `origin/main...2815df82da0f4172578b46d5e130dcf1829da78c`. The local `origin/main` and merge base are `baf66f4488fe062b65484b4ed173d8e495fd0fd4`.

I read the repository bootstrap and master/workflow/testing rules, the harness review/test instructions, spec §17, branch plan and both authorized round-1 reports. This is one independent review leg; I did not read the other round-2 leg or communicate with its reviewer. No cluster, bucket or GitHub API was contacted, and no commit, push or implementation change was made. Source references below are to the requested commit, which remained HEAD throughout the review.

1. **R1: declarations must exist in the plan.** `prepareCityProjection` performs schema parsing, duplicate collapse and source materialization before the writer sees the candidate (`api/src/services/graph/graph-store.ts:862`). `checkDeclaredChanges` uses every current row of this city and those normalized candidate rows: removals are absent candidate IDs; losses are gate1 losses on retained IDs (`:959`). The transaction checks `declaredNotInPlan` before applying exemptions or writing (`:1232`). Existing tests exercise kept/unknown removal IDs and surviving/removed/unknown loss targets. My duplicate-ID test verifies that a retained `flag` cannot be declared lost and an informative `instrument` degraded to `inconnu` can. No absent-plan declaration passing this path was demonstrated.

2. **R2: other removals and losses remain refused.** Gate1 skips exactly declared removal IDs and the declared keys of their respective retained nodes (`graph-store.ts:725`, `:731`). Every other business-property loss remains in the regression list. The additional `undeclaredRemovals` check covers bare rows that have neither business properties nor source refs (`:1256`). The round-2 rejection of `declared` with nonempty `baselineExcludeIds` is at `:1203`, before the lock at `:1218`; the existing exclusivity with nonempty `intendedRemovals` remains at `:1200`. I reran the original round-1 bypass fixture against Postgres: it throws, preserves the complete node/edge snapshot, and leaves actual complete signals at 1. Empty exclusions provide no bypass and still refuse the undeclared kept property loss. The new repository DB test (j) ran, rather than being skipped.

3. **R3: gate2 and gate3.** Gate3 receives the removal set, never the accepted-property-loss map (`graph-store.ts:918`). A declared removal is first proven absent from the candidate; declaring a kept node removed is refused before it can exempt that node's refs. Thus the deleted-node-only gate3 exemption is consistent with the removal authorization, including `bylaw-2025-05` losing its foreign docSha. The existing declared-success fixture deletes a foreign-ref bylaw, while my kept-node fixture with a valid accepted property loss still refuses losing `SHA_LOCAL` and leaves PG unchanged. The completeness baseline includes declared removals; the gate2 query, count and comparison remain unchanged (`:1228`, `:1361`, `:1369`). Repository test (i) refuses deleting a complete signal. My additional fixture retains its docSha but loses its evidence, so row guards pass and gate2 refuses 1 → 0 in both apply and preview; all node/edge writes roll back.

4. **R4: calls without declarations.** The new gate1 argument defaults to an empty map (`graph-store.ts:715`); the transaction's declaration-specific branches are inactive when `declared` is absent. `upsertGraphAtomic` still supplies its fourth-argument removal set, executes the same transaction writer, and returns the same gate2 abort result when preview is absent (`:1440`, `:1448`). Refresh retains its three-argument call (`api/src/services/graph/refresh-run.ts:314`); repair retains its exclusion-only call (`api/src/services/graph/city-key-repair.ts:371`); purge retains its fourth-argument intended removals (`api/src/scripts/purge-avis-bylaws.ts:407`). These callers are outside the diff. My exclusion-only transaction test commits successfully without declarations, and existing repair/purge/city-key tests pass. The projection script keeps its three-argument plain call, original termination fields and original plain-call exit predicate (`api/src/scripts/project-graph-from-s3.ts:152`, `:218`, `:228`). Script-port tests assert the plain success argument vector and termination JSON, and the existing exit-0 GET-skip behavior. Offline rendering compares both manifests with `origin/main` for empty, one-city and multi-city plain projections: their argument vectors are identical.

5. **Preview and rollback material.** Plan/row/removal refusals precede the first graph insert (`graph-store.ts:1238`, `:1249`, `:1256`, `:1288`). Gate2 throws inside the transaction, and successful preview throws its sentinel before commit (`:1371`, `:1444`); the wrapper handles those results after rollback. My full node/edge snapshots verify gate1-refused preview, gate2-refused apply/preview and successful preview. Successful apply changes only the target city, even when another city holds the same IDs. Baseline queries use explicit node and edge columns, without `created_at` (`:1272`, `:1279`). They read before writes, but the script logs the returned preimages after the transaction completes (`project-graph-from-s3.ts:150`, `:157`). The corrected spec describes this ordering. The runbook now has a pre-apply stop to save preview preimages and identify a backup, and its city restore explicitly removes the 35 new nodes. Retrieval of actual rollback material and a rehearsed restore are **unverified** / **not covered**, respectively.

6. **R5 and regressions from the fixes.** The helper exports `LC_ALL=C` before its ASCII regexes, length check, sorting and `comm` (`deploy/ci/projection-declared-args.sh:20`). It rejects CR/LF in a nonempty declared projection's `PROJECT_CITIES` before `read` (`:40`). Empty declarations still return no flags before validating mode/cities (`:31`); the helper runs in a subprocess, so its locale change does not change the workflow parent's environment. The workflow still has ten inputs, validates declarations before deleting/applying a manifest, renders both placeholders and checks for unrendered `PROJECTION_ARGS` (`.github/workflows/run-job.yaml:385`, `:467`, `:473`, `:476`). The actual sed blocks render the literal §17.4 Brigham declaration into exactly one city with preview/apply flags in both manifests. The shell suite passes all 46 cases; additional direct probes refuse the previous counterexamples. CI invokes that shell suite at `.github/workflows/ci.yml:51`. Deployed workflow behavior and remote CI status are **unverified**.

The standard install and final sequential workspace typecheck pass, including `@radar/immo-mcp`. An initial typecheck failed with UI `pdfjs-dist` diagnostics while test dependency installation was also running. That initial result is retained below; its cause is **unverified**. No dependency manifest or lockfile change was made.

## Previous findings

All four rows were checked explicitly at `2815df82da0f4172578b46d5e130dcf1829da78c`.

| Finding | Status | Evidence at the reviewed commit |
|---|---|---|
| **SOL-853-01** — declared mode accepted baseline exclusions, hiding undeclared property/ref loss and a complete-signal drop | **fixed** | `api/src/services/graph/graph-store.ts:1203` throws for nonempty exclusions with declarations before the lock at `:1218`. DB regression test (j), `graph-store.test.ts:2166`, executed and passed. The original round-1 bypass fixture also throws, preserves nodes/props/refs/edges and keeps complete count 1 → 1. A transaction-boundary test observes `execute=0 select=0`. Exclusion-only repair behavior passes both an added DB probe and the existing repair tests. |
| **ASTRA-853-01** — locale-dependent non-ASCII acceptance and multiline `project_cities` | **fixed** | `deploy/ci/projection-declared-args.sh:20` exports `LC_ALL=C`; `:40` rejects CR/LF before `read`. Regression cases are at `projection-declared-args.test.sh:59` and `:62`. The 46-case suite passes; direct UTF-8 non-ASCII ID/key and multiline/CR-city probes each exit 1. My TypeScript parser probes also reject the non-ASCII/CR/LF cases. |
| **ASTRA-853-02** — repair measurement called read-only; expected failed run omitted | **fixed** | Spec `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md:752` names the diagnostic S3 report and explicitly expects the step-2 run to be red; `:757` also states that the after measurement writes the report. This matches the unconditional `store.put` at `api/src/scripts/repair-graph-city-key.ts:234` and nonzero refusal exit at `:244`. Remote execution is **unverified**. |
| **ASTRA-853-03** — incorrect preimage logging order, no pre-apply checkpoint, incomplete restore | **fixed** | Spec `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md:712` separates the pre-write read from post-transaction logging (`:715`), matching `graph-store.ts:1272` and `project-graph-from-s3.ts:150`/`:157`. Step 3b (`:754`) requires saving all 22 preview node preimages/deleted edges plus a backup identifier and stopping if unavailable. Restore text (`:761`) deletes all projected city rows, including the 35 new nodes, then restores the June nodes/edges or the identified backup. Actual restore rehearsal is explicitly **not covered**. |

**Additional required recheck — round-1 workspace typecheck:** the standard `make install ENV=review2-sol-853` succeeded. The final `make typecheck ENV=review2-sol-853` succeeded with `@radar/immo-mcp` checked and no missing `@sentropic/mcp-auth` or `@sentropic/oauth-verify` diagnostics. The initial UI-only failure and successful rerun are both recorded below.

## Commands run (with outputs)

Relevant excerpts follow, with terminal color codes omitted. Shell inspection used RTK after reading its bootstrap. All Make invocations used `ENV=review2-sol-853` last; no host Node/npm/Python/Docker command was used. Test Compose publishes no host ports. Throwaway files were confined to `.review-tmp/sol-r2-853/` and its config selected only this leg's two named test files.

**Target, both diffs and source inspection**

```text
rtk git branch --show-current
feat/projection-intended-removals

rtk git rev-parse HEAD origin/main
2815df82da0f4172578b46d5e130dcf1829da78c
baf66f4488fe062b65484b4ed173d8e495fd0fd4

rtk proxy git merge-base origin/main 2815df82da0f4172578b46d5e130dcf1829da78c
baf66f4488fe062b65484b4ed173d8e495fd0fd4

rtk git diff --stat origin/main...2815df82da0f4172578b46d5e130dcf1829da78c
18 files changed, 1709 insertions(+), 22 deletions(-)

rtk git diff 6b8e2c49efb09567aa19704f33c145c2a2c581c4..2815df82da0f4172578b46d5e130dcf1829da78c
10 files changed, 653 insertions(+), 10 deletions(-)

rtk proxy git diff --check origin/main...2815df82da0f4172578b46d5e130dcf1829da78c
rtk proxy git diff --check 6b8e2c49efb09567aa19704f33c145c2a2c581c4..2815df82da0f4172578b46d5e130dcf1829da78c
[both: no output; exit 0]
```

Unfiltered, path-scoped `rtk proxy git diff` reads covered every target implementation/test/workflow/manifest file, the delta's spec and review launch files. `cat`, `sed`, `rg` and line-numbered Bash reads covered the spec/plan, both round-1 reports, Make/Compose/Vitest setup and unchanged callers. One initial search used a nonexistent `api/src/services/refresh/refresh-run.ts` path and exited 2; a repository search located and read the actual `api/src/services/graph/refresh-run.ts`. A separate unused `api/tests/setup*` search also exited 2. Neither result was used as proof of missing code.

**Shell validation and rendering — all exit 0 unless shown otherwise**

```text
rtk bash deploy/ci/projection-declared-args.test.sh
projection-declared-args: 46 passed, 0 failed

rtk proxy bash -n deploy/ci/projection-declared-args.sh deploy/ci/projection-declared-args.test.sh docs/reviews/pr-853/run.sh
[no output]

rtk proxy bash -c 'sed -n "/^    inputs:/,/^concurrency:/p" .github/workflows/run-job.yaml | grep -Ec "^      [a-z_]+:$"'
10
```

Direct Bash invocations of the real helper used `MODE=apply` and nonempty declarations. Results, with each helper's exit captured explicitly:

```text
LC_ALL=fr_FR.UTF-8, PROJECT_CITIES=brigham, DECLARATIONS=remove=é
projection declarations refused: invalid remove list (expected remove=<id>,<id>,… with ids [A-Za-z0-9._-])
unicode-id exit=1

LC_ALL=C.UTF-8, PROJECT_CITIES=brigham, DECLARATIONS=lose=a:é
projection declarations refused: invalid lose list (expected lose=<id>:<key>,…)
unicode-key exit=1

PROJECT_CITIES=$'brigham\ndanville', DECLARATIONS=remove=a
projection declarations refused: project_cities must be a single line
multiline-city exit=1

PROJECT_CITIES=$'brigham\r', DECLARATIONS=remove=a
projection declarations refused: project_cities must be a single line
CR-city exit=1
```

`rtk bash .review-tmp/sol-r2-853/render.sh` executed the actual workflow sed blocks from `origin/main` and the target, without any cluster calls:

```text
UNCHANGED argv: deploy/k8s/32-graph-projection-only-job.yaml cities=[]
UNCHANGED argv: deploy/k8s/32-graph-projection-only-job.yaml cities=[brigham]
UNCHANGED argv: deploy/k8s/32-graph-projection-only-job.yaml cities=[brigham danville]
DECLARED argv: deploy/k8s/32-graph-projection-only-job.yaml mode=preview tokens=6 city=brigham
DECLARED argv: deploy/k8s/32-graph-projection-only-job.yaml mode=apply tokens=5 city=brigham
UNCHANGED argv: deploy/k8s/graph-projection-preprod/job.yaml cities=[]
UNCHANGED argv: deploy/k8s/graph-projection-preprod/job.yaml cities=[brigham]
UNCHANGED argv: deploy/k8s/graph-projection-preprod/job.yaml cities=[brigham danville]
DECLARED argv: deploy/k8s/graph-projection-preprod/job.yaml mode=preview tokens=6 city=brigham
DECLARED argv: deploy/k8s/graph-projection-preprod/job.yaml mode=apply tokens=5 city=brigham
```

```text
rtk make k8s-validate ENV=review2-sol-853
[k8s-validate] rendering deploy/k8s with kustomize…
[document-date-recovery] offline render ok (preprod + prod)
image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
[exit 0]
```

**Standard install and repository tests**

```text
rtk make ps ENV=review2-sol-853
NAME      IMAGE     COMMAND   SERVICE   CREATED   STATUS    PORTS
[no existing containers; exit 0]

rtk make install ENV=review2-sol-853
added 951 packages, and audited 965 packages in 29s
[exit 0; no installation override]

rtk make test-api SCOPE='src/services/graph/graph-store.test.ts src/scripts/projection-args.test.ts src/services/graph/city-key-repair.test.ts src/scripts/purge-avis-bylaws.test.ts tests/integration/graph-city-key.spec.ts' ENV=review2-sol-853
src/services/graph/graph-store.test.ts (158 tests)
tests/integration/graph-city-key.spec.ts (11 tests)
Test Files 5 passed (5)
Tests 225 passed (225)
[exit 0; DB-bound tests executed, including (j)]
```

**Workspace typecheck: initial failure and final success**

```text
rtk make typecheck ENV=review2-sol-853
> @radar/api@0.0.0 typecheck
> tsc --noEmit -p tsconfig.json
[no API diagnostics]
/workspace/ui/src/lib/components/maps/SignalPdfOverlay.svelte:7:36
Error: Could not find a declaration file for module 'pdfjs-dist'. '/workspace/node_modules/pdfjs-dist/index.js' implicitly has an 'any' type.
[same diagnostic at lines 8, 19, 445, 452 and 646; implicit-any item at line 637]
svelte-check found 7 errors and 7 warnings in 2 files
> @radar/immo-mcp@0.0.1 typecheck
> tsc --noEmit -p tsconfig.json
[no immo-mcp diagnostics]
make: *** [Makefile:119: typecheck] Error 1
[exit 2]
```

This first typecheck overlapped the test stack's dependency installation. Once that installation/test command and the first throwaway run had ended, I reran typecheck sequentially. Its cause relative to the first result remains **unverified**; no source or dependency configuration was changed to obtain the second result.

```text
rtk make typecheck ENV=review2-sol-853 > .review-tmp/sol-r2-853/typecheck-second.log 2>&1
> @radar/api@0.0.0 typecheck
> tsc --noEmit -p tsconfig.json
svelte-check found 0 errors and 7 warnings in 1 file
> @radar/immo-mcp@0.0.1 typecheck
> tsc --noEmit -p tsconfig.json
[domain, scoring and sources tsc commands also complete]
[exit 0]
```

**Throwaway adversarial tests**

The first run of the following command exited 2: 16 tests passed and one duplicate-normalization test failed because my fixture expected a deep property merge. Actual `mergeProps` shallowly replaces `properties` (`graph-store.ts:460`), so its second duplicate had also removed `flag`; the reported extra loss was correct. I corrected the second duplicate to retain `flag`, and also added a gate1-refused preview snapshot assertion, then reran:

```text
rtk make test-api SCOPE='--config ../.review-tmp/sol-r2-853/vitest.config.ts' ENV=review2-sol-853 > .review-tmp/sol-r2-853/adversarial-final.log 2>&1
../.review-tmp/sol-r2-853/script.test.ts (8 tests)
EXCLUSIVITY: nonempty baselineExcludeIds/intendedRemovals rejected; execute=0 select=0
SOL-853-01: rejected; complete signals 1 -> 1; node/edge snapshot unchanged
REPAIR COMPATIBILITY: no declarations + baseline exclusions commits
GATE2: apply and preview refused 1 -> 0; node/edge snapshots unchanged
../.review-tmp/sol-r2-853/guard.test.ts (9 tests)
Test Files 2 passed (2)
Tests 17 passed (17)
[exit 0]
```

The DB tests use the migrated review Postgres. Script tests import the real entry point while mocking DB/S3/logging/termination-file/exit ports: plain success and skipped GET exit 0; declared apply/preview success exit 0; declared refusal, missing object, invalid JSON and missing nodes exit 1. They assert parsed termination JSON, options routing and the before-row log payload. Those mocked script results do not establish deployed behavior.

**Cleanup and scope**

```text
rtk make clean COMPOSE_FILES_DEV='$(COMPOSE_FILES_BASE) -f docker-compose.dev.yml -f docker-compose.test.yml' ENV=review2-sol-853
Container radar-review2-sol-853-postgres-1 Removed
Container radar-review2-sol-853-minio-1 Removed
Volume radar-review2-sol-853_radar-test-root-node-modules Removed
Volume radar-review2-sol-853_radar-test-api-node-modules Removed
Volume radar-review2-sol-853_radar-root-node-modules Removed
Volume radar-review2-sol-853_postgres-data Removed
Network radar-review2-sol-853_radar Removed
[exit 0]

rtk make clean ENV=review2-sol-853
Volume radar-review2-sol-853_radar-api-node-modules Removed
[exit 0]
```

The extra combined-Compose cleanup removes the test dependency volumes that the default dev-only cleanup does not declare. Only this leg's review artifact is retained; its throwaway tests/logs/rendered fixtures are deleted. Concurrent review files are preserved. Final target/scope checks are recorded after cleanup below.

```text
rtk rm -r -- .review-tmp/sol-r2-853
[no output; exit 0]
rtk proxy bash -c 'if rmdir .review-tmp 2>/dev/null; then printf "%s\n" ".review-tmp removed"; else printf "%s\n" "Other concurrent temporary files preserved; this leg directory removed"; fi'
Other concurrent temporary files preserved; this leg directory removed

rtk proxy git diff --name-only
[no output; no tracked-file changes]
rtk git rev-parse HEAD
2815df82da0f4172578b46d5e130dcf1829da78c
rtk make ps ENV=review2-sol-853
NAME      IMAGE     COMMAND   SERVICE   CREATED   STATUS    PORTS
[no containers; exit 0]
```

The supplied leg stub is untracked; it is the only retained file authored by this reviewer. The shared `.review-tmp/` still held other concurrent files, whose contents were not read or modified.

## Findings

No new demonstrated finding in the round-2 delta or the whole PR under this lens. All four previous findings are fixed. No `SOL-853-R2-NN` finding is emitted. The initial typecheck failure is recorded as an observed command result, with its cause **unverified**; the final standard workspace typecheck passes.

## Verdict

**GO.** The original declared-mode bypass is rejected before the lock with no mutation, the repair's exclusion-only path remains usable, and the full-PR guard/preview checks pass. The 225 repository tests, 17 throwaway tests, 46 shell cases, final workspace typecheck and offline Kubernetes validation pass at the reviewed commit. Remote CI, current remote graph state, deployed execution and rollback-material retrieval remain **unverified**; a rehearsed restore is **not covered**. This is this leg's verdict, not a consensus or operational-execution claim.
