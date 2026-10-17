status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: feat/projection-intended-removals@4c2e58478b180b1032a0d0d07002ee477da43c43
round: 3

## Reasoning

Reviewed both mandatory targets at the requested HEAD:

- Delta: `2815df82da0f4172578b46d5e130dcf1829da78c..4c2e58478b180b1032a0d0d07002ee477da43c43`.
- Whole PR: `origin/main...4c2e58478b180b1032a0d0d07002ee477da43c43`. The local `origin/main` and merge base are `baf66f4488fe062b65484b4ed173d8e495fd0fd4`.

Read the bootstrap, master/workflow/testing rules, harness review/testing guidance, spec §17, branch plan and both permitted round-2 legs/prompts. This leg stayed independent: I did not read or communicate with the other round-3 reviewer. No cluster, bucket or GitHub API was contacted. Tests used the isolated local review Postgres; script DB/S3 ports were mocked. No implementation/dependency file was changed, and no commit or push was made.

**Delta and termination bound.** `projection-termination.ts:30` measures the serialized JSON with `Buffer.byteLength(body, "utf8")` against 4000 bytes, including the Unicode omission marker. Each list-cap candidate is serialized independently, so neither UTF-8 sequences nor JSON tokens are sliced. The final fallback at `:33` removes `abortedCities` and substitutes `declared: "truncated"`. At its sole runtime caller (`project-graph-from-s3.ts:219`), the remaining report fields are a fixed event string and numeric counters; the fallback is bounded for that actual report shape. I did not infer a bound for arbitrary extra fields allowed by the helper's generic `Record<string, unknown>` parameter.

The real plan function produced 40 undeclared losses from multi-byte database keys. Its full report was 5486 bytes; the new helper returned valid 3421-byte JSON, retained refusal counts and represented the loss list as 24 entries plus `…+16`. Gate1 still refused those losses. The entry-point test wrote a valid 3415-byte Unicode summary and still exited 1. A separate probe reached the final fallback with a validated 5000-character ASCII city slug in `abortedCities`: valid JSON, 186 bytes, counters/preview retained, `declared: "truncated"`. JSON-escaped control characters, quotes, backslashes and four-byte characters also stayed within the byte budget.

The plan delta adds the two new helper/test paths to Allowed Paths (`plan/817-BRANCH_feat-projection-intended-removals.md:25`). The round-2 review additions describe earlier targets; their reported test outcomes were not treated as evidence that tests pass at this HEAD. One demonstrated coverage gap in the new committed test remains, detailed below.

**Exit codes and plain-mode content.** The delta changes only the declared-summary helper call at `project-graph-from-s3.ts:222`; it leaves the exit predicate at `:229` and the plain `JSON.stringify(report).slice(0, 4000)` expression unchanged. My entry-point probes imported the real script while mocking only the DB/upsert, S3, logger, termination-file and exit ports. Declared apply/preview success exited 0 and retained the plan/preview fields. Declared refusal, GET failure, invalid JSON, missing nodes and DB error exited 1 with the expected counters and valid bounded summaries; no result report means `declared: null`. Plain success and the three skip cases exited 0; plain refusal and DB error exited 1. Every plain termination string matched the original report serialization exactly, and its upsert call retained three arguments. Invalid declared argv produced exit 1 before DB/S3 creation and wrote no termination file. A failed termination-file write retained the refusal exit. The existing plain-mode character slicing is unchanged; no new plain-mode byte-bound guarantee is claimed.

**Whole-PR R1–R5 recheck.**

| Requirement | Evidence at this HEAD |
|---|---|
| R1 — a declaration absent from the plan fails | `checkDeclaredChanges` derives removals from current IDs absent from the normalized candidate and losses from retained rows (`graph-store.ts:959`). `declaredNotInPlan` is checked before exemptions/writes (`:1238`). The committed unknown-ID/surviving-key declaration tests and DB test (f) executed and passed. |
| R2 — undeclared removals/losses stay refused | Gate1 filters accepted keys only for their specific node (`graph-store.ts:726`); row guards run at `:1249`. The extra removal check at `:1256` covers bare nodes without properties/refs. DB tests (e)/(e2) passed. My DB probe accepted `muni:flag` but refused undeclared `other:flag` and retained the complete node/edge snapshot. Nonempty declaration/exclusion combinations are still rejected before the lock (`:1200`, `:1203`); test (j) passed. |
| R3 — gate2/gate3 run normally | Gate3 receives the removal set, not the accepted-key map (`graph-store.ts:918`). Removed IDs have already been checked against the plan. My DB probes supplied a valid declared kept-node property loss and still refused losing `SHA_LOCAL` in apply and preview, with identical full snapshots. Gate2 retains the full completeness baseline (`:1228`) and after-count comparison/rollback (`:1369`); committed test (i) passed. |
| R4 — no-option behavior unchanged | Declaration-specific branches are inactive; added accepted-loss arguments default to empty maps. Refresh (`refresh-run.ts:314`), repair (`city-key-repair.ts:371`) and purge (`purge-avis-bylaws.ts:407`) calls are unchanged. Their focused tests, city-isolation integration tests and no-option DB test (g) passed. Actual workflow sed blocks produced identical plain argument vectors to `origin/main` for zero, one and two cities in both manifests. |
| R5 — bounded validated workflow inputs | The helper's ASCII locale/regex checks, single-line checks, 4096-character declaration limit, 64/16 item limits, duplicate checks and removal/loss exclusivity remain (`projection-declared-args.sh:20`). All 46 shell cases passed. Independent 4096/4097-byte ASCII boundary probes accepted/refused respectively. The workflow has ten inputs and validates declarations before delete/apply (`run-job.yaml:384`, `:476`). Both manifest renderings produced the expected declared preview/apply flags and exactly one city. |

Successful preview still rolls back through its sentinel (`graph-store.ts:1444`); the committed DB preview test (h) passed. The helper import is type-only for `DeclaredChangesReport`, and the standard API typecheck passed. No runtime regression or guard bypass introduced by the delta was demonstrated.

Verification: 229 focused repository tests, 27 throwaway probes, 46 shell cases and offline Kubernetes validation passed. The first standard workspace typecheck failed with five missing-module diagnostics in `immo-mcp`; the second standard install/typecheck sequence passed without tracked-file changes or installation overrides. The cause of the first result is **unverified**. Remote CI, deployed execution and current remote graph state remain **unverified**; a rehearsed restore is **not covered**.

## Previous findings

**ASTRA-853-R2-01: fixed.** The character-count check is replaced by a UTF-8 byte check at `api/src/scripts/projection-termination.ts:30`. The final fallback at `:33` serializes a bounded report for the script's fixed fields without slicing JSON. The committed Unicode regression test at `projection-termination.test.ts:24` passed and asserts both parseable JSON and the byte limit. My independent real-plan/entry-point probes also passed, and my actual-fallback probe returned valid 186-byte JSON. The committed final-fallback coverage is **partial**, as described in SOL-853-R3-01; that does not negate the demonstrated behavioral fix.

## Commands run (with outputs)

Relevant output excerpts follow, with terminal colors omitted. All execution of TypeScript/npm/container operations went through Make; every Make invocation used `ENV=review3-sol-853` last. Temporary config/tests/Make targets/render fixtures/logs were confined to `.review-tmp/sol-r3/` and deleted afterward. The temporary Vitest config selected only this leg's three test files.

Target and source inspection:

```text
rtk git status --short --branch
* feat/projection-intended-removals...origin/feat/projection-intended-removals
[the supplied round-3 leg/prompt files were untracked]

rtk git rev-parse HEAD
4c2e58478b180b1032a0d0d07002ee477da43c43
rtk git rev-parse origin/main
baf66f4488fe062b65484b4ed173d8e495fd0fd4
rtk proxy git merge-base origin/main 4c2e58478b180b1032a0d0d07002ee477da43c43
baf66f4488fe062b65484b4ed173d8e495fd0fd4

rtk git diff --stat 2815df82da0f4172578b46d5e130dcf1829da78c..4c2e58478b180b1032a0d0d07002ee477da43c43
8 files changed, 698 insertions(+), 26 deletions(-)
rtk git diff --stat origin/main...4c2e58478b180b1032a0d0d07002ee477da43c43
24 files changed, 2381 insertions(+), 22 deletions(-)

rtk proxy git diff --check 2815df82da0f4172578b46d5e130dcf1829da78c..4c2e58478b180b1032a0d0d07002ee477da43c43
rtk proxy git diff --check origin/main...4c2e58478b180b1032a0d0d07002ee477da43c43
[both: no output; exit 0]
```

Path-scoped `git diff`/unfiltered `rtk proxy git diff`, `cat`, `sed` and `rg` covered the helper/script/parser/store and tests, workflow/manifests/shell validator, spec/plan, round-2 leg/prompt files, review launcher, unchanged callers and Make/Compose/Vitest setup. An optional `rg --files` search for additional instruction files under `api`, `docs/reviews` and `plan` returned no matches (exit 1); it was not used as evidence of missing implementation. An out-of-range Makefile `sed` read returned no output; the actual target was subsequently located and read.

Standard install and first typecheck, executed sequentially:

```text
rtk make install ENV=review3-sol-853
added 951 packages, and audited 965 packages in 20s
[exit 0]

rtk make typecheck ENV=review3-sol-853
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

The PR diff for `packages/immo-mcp`, `package.json`, `package-lock.json` and `Makefile` was empty. Dependency manifests and their installed `dist` directory contents were inspected read-only; no dependency files were repaired. Attribution of that first typecheck result to this PR is **unverified**.

Focused repository tests:

```text
rtk make test-api SCOPE='src/scripts/projection-termination.test.ts src/scripts/projection-args.test.ts src/services/graph/graph-store.test.ts src/services/graph/city-key-repair.test.ts src/scripts/purge-avis-bylaws.test.ts tests/integration/graph-city-key.spec.ts' ENV=review3-sol-853
src/scripts/projection-termination.test.ts (4 tests)
src/scripts/projection-args.test.ts (23 tests)
src/services/graph/city-key-repair.test.ts (21 tests)
src/scripts/purge-avis-bylaws.test.ts (12 tests)
src/services/graph/graph-store.test.ts (158 tests)
tests/integration/graph-city-key.spec.ts (11 tests)
Test Files 6 passed (6)
Tests 229 passed (229)
[exit 0; declared DB cases (d), (e), (e2), (f), (g), (h), (j), (i) executed]
```

Shell validation and rendering through the throwaway Make target:

```text
rtk make -f Makefile -f .review-tmp/sol-r3/Makefile review-shell ENV=review3-sol-853
bash deploy/ci/projection-declared-args.test.sh
projection-declared-args: 46 passed, 0 failed
bash -n deploy/ci/projection-declared-args.sh deploy/ci/projection-declared-args.test.sh
[no syntax diagnostics]
bash .review-tmp/sol-r3/render.sh
WORKFLOW inputs=10
PLAIN argv unchanged: [both manifests; cities=[], [brigham], [brigham danville]]
DECLARED argv: [both manifests; preview/apply; exact flags + one city]
BOUNDARY 4096-byte declarations: accepted
BOUNDARY 4097-byte declarations: refused (projection declarations refused: declarations are 4097 characters, at most 4096)
[exit 0]
```

The render script extracted the actual baseline/HEAD sed blocks and used local manifest files only; it did not execute the workflow's cluster calls.

Independent throwaway tests:

```text
rtk make test-api SCOPE='--config ../.review-tmp/sol-r3/vitest.config.ts' ENV=review3-sol-853 > .review-tmp/sol-r3/adversarial.log 2>&1
SCRIPT declared preview=true: exit=0; bytes=287; plan retained
SCRIPT declared preview=false: exit=0; bytes=288; plan retained
SCRIPT declared missing: exit=1; valid JSON; counts retained
SCRIPT declared invalid-json: exit=1; valid JSON; counts retained
SCRIPT declared no-nodes: exit=1; valid JSON; counts retained
SCRIPT declared db-error: exit=1; valid JSON; counts retained
SCRIPT declared refused: exit=1; valid JSON; counts retained
SCRIPT Unicode refusal: exit=1; bytes=3415
SCRIPT plain success: exit=0; original termination bytes matched
SCRIPT plain missing: exit=0; original termination bytes matched
SCRIPT plain invalid-json: exit=0; original termination bytes matched
SCRIPT plain no-nodes: exit=0; original termination bytes matched
SCRIPT plain db-error: exit=1; original termination bytes matched
SCRIPT plain refused: exit=1; original termination bytes matched
UNICODE real plan: full=5486 bytes; summary=3421 bytes; losses=24+16; gate1 refused
FINAL FALLBACK: 186 bytes; declared=truncated; preview=true; aborted=1; valid JSON
COMMITTED FALLBACK FIXTURE: declared is an object; final fallback branch not reached
DB GATE3 preview=false: valid accepted loss; SHA_LOCAL loss refused; full node/edge snapshot unchanged
DB GATE3 preview=true: valid accepted loss; SHA_LOCAL loss refused; full node/edge snapshot unchanged
DB GATE1: accepted muni:flag; undeclared other:flag refused; full snapshot unchanged
script.test.ts (16 tests)
termination.test.ts (8 tests)
guards.test.ts (3 tests)
Test Files 3 passed (3)
Tests 27 passed (27)
[exit 0]
```

Final standard install/typecheck sequence and offline validation:

```text
rtk make install ENV=review3-sol-853 > .review-tmp/sol-r3/install-second.log 2>&1
changed 1 package, and audited 965 packages in 6s
[exit 0]
rtk make typecheck ENV=review3-sol-853 > .review-tmp/sol-r3/typecheck-second.log 2>&1
> @radar/api@0.0.0 typecheck
> tsc --noEmit -p tsconfig.json
svelte-check found 0 errors and 7 warnings in 1 file
> @radar/immo-mcp@0.0.1 typecheck
> tsc --noEmit -p tsconfig.json
[domain, scoring and sources typechecks also completed; no errors]
[exit 0]

rtk make k8s-validate K8S_VALIDATE_WITH_CLUSTER=0 ENV=review3-sol-853
[document-date-recovery] offline render ok (preprod + prod)
image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
[exit 0]
```

Cleanup:

```text
rtk make clean ENV=review3-sol-853
[review Postgres/MinIO containers, network, dev dependency/data volumes removed; exit 0]
rtk make clean COMPOSE_FILES_DEV='-f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml' ENV=review3-sol-853
Volume radar-review3-sol-853_radar-test-api-node-modules Removed
Volume radar-review3-sol-853_radar-test-root-node-modules Removed
[exit 0]
rtk make ps ENV=review3-sol-853
NAME      IMAGE     COMMAND   SERVICE   CREATED   STATUS    PORTS
[no containers; exit 0]
```

The extra clean declares the test dependency volumes omitted by default dev-only cleanup. This leg's temporary files were deleted and other concurrent files preserved. Final scope/HEAD checks:

```text
rtk rm -r -- .review-tmp/sol-r3
[no output; exit 0]
rtk proxy bash -c 'if rmdir .review-tmp 2>/dev/null; then printf "%s\n" ".review-tmp removed"; else printf "%s\n" "This leg directory removed; concurrent temporary files preserved"; fi'
.review-tmp removed
[exit 0]
rtk proxy git diff --name-only
[no output; no tracked-file changes; the supplied leg file is untracked]
rtk git rev-parse HEAD
4c2e58478b180b1032a0d0d07002ee477da43c43
rtk proxy git diff --check
[no output; exit 0]
```

Only this review leg is retained as a file authored by this reviewer.

## Findings

### SOL-853-R3-01 — The committed fallback test does not reach the final fallback

- **Severity:** non-blocking.
- **File:line:** `api/src/scripts/projection-termination.test.ts:34`; unexercised return: `api/src/scripts/projection-termination.ts:33`.
- **Evidence:** The test supplies one 5000-character removal string and a short fixed report, then expects `declared.plannedRemovals` to be `["…+1"]` (`projection-termination.test.ts:40`). At cap 0, the long string is replaced by that short marker, so the loop returns at `projection-termination.ts:30`; the final fallback would instead set `declared` to the string `"truncated"`. My independent replay confirmed the object-shaped result. A separate oversized-`abortedCities` fixture reached the actual final fallback and returned valid 186-byte JSON. Its behavior works at this HEAD, but that branch is **not covered** by the committed regression test named for it.
- **Fix:** Keep the cap-0 list test with an accurate name, and add a report that still exceeds 4000 bytes after all lists shrink, such as a long validated ASCII city in `abortedCities`. Assert `declared === "truncated"`, omitted `abortedCities`, retained counters/preview, valid JSON and at most `TERMINATION_MAX_BYTES` UTF-8 bytes.

No blocking runtime finding was demonstrated in either mandatory target.

## Verdict

**GO-with-nits.** ASTRA-853-R2-01 is fixed. The new byte bound, actual fallback, entry-point exits, plain-mode termination content and R1–R5 checks passed; one non-blocking committed-test coverage gap remains. The final standard workspace typecheck passed. The initial typecheck failure is retained above with its cause **unverified**. Remote CI/deployed execution remain **unverified**, and restore rehearsal is **not covered**. This verdict belongs to this independent leg only.
