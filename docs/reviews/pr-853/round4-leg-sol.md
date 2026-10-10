status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: feat/projection-intended-removals@3fcdcec0deabc5042b416ca4d3da086b8b0abd0f
round: 4

## Reasoning

Reviewed both mandatory targets:

- Delta: `4c2e58478b180b1032a0d0d07002ee477da43c43..3fcdcec0deabc5042b416ca4d3da086b8b0abd0f`.
- Whole PR: `origin/main...4c2e58478b180b1032a0d0d07002ee477da43c43`. Local `origin/main` and its merge base with that target are both `baf66f4488fe062b65484b4ed173d8e495fd0fd4`.

HEAD matched the requested round-4 commit. Read the repository bootstrap/master/workflow/testing rules, harness review/test guidance, spec §17, branch plan, previous findings and round-3 review records. This leg remained independent of the other round-4 reviewer. No cluster, bucket or GitHub API was contacted; no fetch, commit or push was made. Only this leg file is retained as reviewer-authored work. Temporary tests and render fixtures were confined to `.review-tmp/sol-r4/`, then removed.

**Delta.** The only executable change is in `api/src/scripts/projection-termination.test.ts`: the existing cap-0 test has an accurate name at `:34`, and the new test at `:43` keeps `abortedCities` oversized after every declaration list shrinks. All four loop candidates therefore exceed the byte budget. Only the final return at `projection-termination.ts:33` can satisfy the assertion `declared === "truncated"`. The test also parses the JSON, asserts at most `TERMINATION_MAX_BYTES` UTF-8 bytes, omitted `abortedCities`, and retained `ok`, `aborted`, `total` and `preview`. All five committed termination tests passed. The other delta files are historical round-3 review records/prompts. A separate runtime-path diff returned exit 0 with no differences between the two requested commits.

**Termination and exits.** The helper checks each independently serialized candidate with `Buffer.byteLength(body, "utf8")` at `projection-termination.ts:30`. The committed multi-byte-key test passed. The final fallback drops `abortedCities` and declaration lists; the sole production caller's remaining report fields are a fixed event string and numeric counters (`project-graph-from-s3.ts:219`). This establishes the byte bound for that caller's report shape; an arbitrary extended `Record<string, unknown>` is not covered.

Independent tests imported the real script and mocked only its config/logger, DB/upsert, S3, termination-write and exit ports. Declared apply/preview success exited 0 with the declaration plan retained. Declared GET failure, invalid JSON, missing `nodes`, DB error and refusal exited 1 with the expected counters; absent projection reports remained `declared: null`. A parser-valid 5,000-character ASCII city and a refused preview reached the actual final fallback through the script: valid 186-byte JSON, exit 1, `declared: "truncated"`, no `abortedCities`, counters/preview retained. Invalid declared argv exited 1 before DB/S3 creation. A failed termination write retained the refusal exit.

Plain success and the three skip cases exited 0; plain DB error/refusal exited 1. Every plain termination string matched `JSON.stringify(report).slice(0, 4000)` exactly, and every attempted plain upsert kept its three-argument call. The plain character-slicing expression and exit predicate remain unchanged by the delta (`project-graph-from-s3.ts:222`, `:229`). A new plain-mode byte/valid-JSON guarantee is not covered.

**Whole-PR R1–R5 recheck at HEAD.** Runtime files are identical to the whole-PR target, so the following HEAD checks also exercise its implementation.

| Requirement | Evidence |
|---|---|
| R1 — a declaration absent from the plan fails | `checkDeclaredChanges` derives removals from current IDs absent from the candidate, and losses from retained rows (`graph-store.ts:959`). `declaredNotInPlan` is checked before exemptions/writes at `:1238`. The committed declaration-plan cases and DB test (f), `graph-store.test.ts:2108`, executed and passed. |
| R2 — undeclared removals/losses stay refused | Accepted keys are filtered only for their specific node (`graph-store.ts:726`). Row guards run at `:1249`; the extra check at `:1256` refuses bare-node removals too. DB tests (e)/(e2) passed. My DB probe accepted `muni:flag` but refused undeclared `other:flag`, preserving the full node/edge snapshot. Declaration/exclusion combinations remain rejected before the lock (`:1200`, `:1203`); DB test (j) passed. |
| R3 — gate2/gate3 run normally | Gate3 receives the removal set, not the accepted-key map (`graph-store.ts:918`). My DB probes supplied a valid declared property loss and still refused losing `SHA_LOCAL` in apply and preview, preserving full snapshots. Gate2 retains the complete baseline and after-count rollback (`:1228`, `:1369`); DB test (i), `graph-store.test.ts:2188`, passed. |
| R4 — no-option behavior unchanged | Added loss arguments default to empty maps; declaration-only branches remain inactive. Refresh, repair and purge callers have no PR diff. DB test (g), repair/purge tests and city-isolation integration tests passed. Entry-point probes retained plain exits/content. The actual baseline/current workflow sed blocks rendered identical plain argument vectors for zero, one and two cities in both manifests. |
| R5 — bounded validated workflow inputs | `projection-declared-args.sh:20` fixes ASCII locale; the helper validates single-line declarations, one city, allowed characters, 4096-byte ASCII length, 64 removals/16 losses, duplicates and removal/loss exclusivity. All 46 shell cases passed; independent 4096/4097-byte boundary probes accepted/refused respectively. Validation precedes job delete/apply (`run-job.yaml:384`, `:476`). Both manifests rendered the expected declared preview/apply flags plus one city. |

The successful-preview rollback test (h), `graph-store.test.ts:2145`, also passed. No runtime regression or R1–R5 failure introduced by the delta was demonstrated. Remote CI/deployed execution remain **unverified**; the runbook's restore rehearsal is **not covered**.

## Previous findings

**SOL-853-R3-01: fixed.** `projection-termination.test.ts:34` now identifies the original case as cap-0 list shrinking. The new fixture at `:43` reaches the final counts-only return and asserts the requested truncation marker, omitted city list, counters/preview, parseable JSON and byte bound. Both tests executed successfully. The independent actual-entry-point fallback probe also passed.

**ASTRA-853-R2-01: fixed.** The runtime byte check at `projection-termination.ts:30` is unchanged, and the committed multi-byte-key regression test at `projection-termination.test.ts:24` passed. The final fallback is now covered by the committed test as well as the independent script probe.

## Commands run (with outputs)

Relevant command outputs follow, with terminal colors omitted. TypeScript/npm/container execution went through Make. Every Make invocation used `ENV=review4-sol-853` last. The test Compose stack publishes no host ports; script S3 access was mocked.

```text
rtk git branch --show-current
feat/projection-intended-removals
rtk git rev-parse HEAD
3fcdcec0deabc5042b416ca4d3da086b8b0abd0f
rtk git rev-parse origin/main
baf66f4488fe062b65484b4ed173d8e495fd0fd4
git merge-base origin/main 4c2e58478b180b1032a0d0d07002ee477da43c43
baf66f4488fe062b65484b4ed173d8e495fd0fd4

rtk git diff --stat 4c2e58478b180b1032a0d0d07002ee477da43c43..3fcdcec0deabc5042b416ca4d3da086b8b0abd0f
5 files changed, 487 insertions(+), 1 deletion(-)
rtk git diff --stat origin/main...4c2e58478b180b1032a0d0d07002ee477da43c43
24 files changed, 2381 insertions(+), 22 deletions(-)

rtk proxy git diff --check 4c2e58478b180b1032a0d0d07002ee477da43c43..3fcdcec0deabc5042b416ca4d3da086b8b0abd0f
rtk proxy git diff --check origin/main...4c2e58478b180b1032a0d0d07002ee477da43c43
[both: no output; exit 0]
```

Path-scoped unfiltered diffs and `sed`/`grep` reads covered the script/parser/helper/store/tests, workflow/validator/manifests, spec/plan, previous review findings and Make/Compose/Vitest setup. Both complete mandatory diffs were also captured locally. A runtime-path `git diff --quiet` between the requested commits returned 0. An initial inspection used `api/src/services/refresh/refresh-run.ts` and printed `No such file or directory`; `git ls-files '*refresh-run*'` located `api/src/services/graph/refresh-run.ts`, whose caller and empty PR diff were then checked.

```text
rtk make install ENV=review4-sol-853 > .review-tmp/sol-r4/install.log 2>&1
added 951 packages, and audited 965 packages in 24s
[exit 0]

rtk make typecheck ENV=review4-sol-853 > .review-tmp/sol-r4/typecheck.log 2>&1
@radar/api, radar-immobilier-ui, @radar/immo-mcp, @radar/domain,
@radar/scoring and @radar/sources typechecks completed
svelte-check found 0 errors and 7 warnings in 1 file
[exit 0]

rtk make test-api SCOPE='src/scripts/projection-termination.test.ts src/scripts/projection-args.test.ts src/services/graph/graph-store.test.ts src/services/graph/city-key-repair.test.ts src/scripts/purge-avis-bylaws.test.ts tests/integration/graph-city-key.spec.ts' ENV=review4-sol-853 > .review-tmp/sol-r4/committed.log 2>&1
projection-termination.test.ts (5 tests)
projection-args.test.ts (23 tests)
graph-store.test.ts (158 tests)
city-key-repair.test.ts (21 tests)
purge-avis-bylaws.test.ts (12 tests)
graph-city-key.spec.ts (11 tests)
Test Files 6 passed (6)
Tests 230 passed (230)
[exit 0; declared DB cases (d), (e), (e2), (f), (g), (h), (j), (i) executed]
```

Shell validation/rendering used a temporary additional Makefile. The render probe extracted only the actual sed commands from baseline/current workflow files and used local manifests; it executed no workflow cluster commands.

```text
rtk make -f Makefile -f .review-tmp/sol-r4/Makefile review-shell ENV=review4-sol-853
bash deploy/ci/projection-declared-args.test.sh
projection-declared-args: 46 passed, 0 failed
bash -n deploy/ci/projection-declared-args.sh deploy/ci/projection-declared-args.test.sh
[no syntax diagnostics]
bash .review-tmp/sol-r4/render.sh
PLAIN argv matched origin/main: deploy/k8s/32-graph-projection-only-job.yaml; zero/one/two cities
DECLARED argv matched: deploy/k8s/32-graph-projection-only-job.yaml; preview
DECLARED argv matched: deploy/k8s/32-graph-projection-only-job.yaml; apply
PLAIN argv matched origin/main: deploy/k8s/graph-projection-preprod/job.yaml; zero/one/two cities
DECLARED argv matched: deploy/k8s/graph-projection-preprod/job.yaml; preview
DECLARED argv matched: deploy/k8s/graph-projection-preprod/job.yaml; apply
BOUNDARY: 4096-byte declaration accepted; 4097-byte declaration refused with empty stdout
[final run exit 0]
```

The first shell-only invocation passed. The first invocation with the added render probe exited 2 after the six rendering checks, at the throwaway fixture's length assertion: `7 + 31 × 129 + 91 = 4097`, whereas the probe expected 4096. Only the temporary fixture was corrected to a 90-character final ID; the rerun above passed. No repository implementation was changed.

```text
rtk make test-api SCOPE='--config ../.review-tmp/sol-r4/vitest.config.ts' ENV=review4-sol-853 > .review-tmp/sol-r4/probes.log 2>&1
SCRIPT declared success preview=false: exit=0; plan retained; 288 bytes
SCRIPT declared success preview=true: exit=0; plan retained; 287 bytes
SCRIPT declared get-error: exit=1; bounded valid JSON; counters retained
SCRIPT declared invalid-json: exit=1; bounded valid JSON; counters retained
SCRIPT declared no-nodes: exit=1; bounded valid JSON; counters retained
SCRIPT declared db-error: exit=1; bounded valid JSON; counters retained
SCRIPT declared refused: exit=1; bounded valid JSON; counters retained
SCRIPT plain ok: exit=0; original termination bytes matched
SCRIPT plain get-error: exit=0; original termination bytes matched
SCRIPT plain invalid-json: exit=0; original termination bytes matched
SCRIPT plain no-nodes: exit=0; original termination bytes matched
SCRIPT plain db-error: exit=1; original termination bytes matched
SCRIPT plain refused: exit=1; original termination bytes matched
SCRIPT final fallback: exit=1; 186 bytes; truncated; city omitted; counters/preview retained
SCRIPT invalid declaration: exit=1; DB/S3/write not called
DB gate3 preview=false: valid accepted loss; ref loss refused; full node/edge snapshot unchanged
DB gate3 preview=true: valid accepted loss; ref loss refused; full node/edge snapshot unchanged
DB gate1: muni:flag accepted; other:flag refused; full snapshot unchanged
Test Files 2 passed (2)
Tests 20 passed (20)
[exit 0; also includes failed-write exit preservation and real-plan Unicode gate1 refusal]
```

Cleanup and final scope checks:

```text
rtk make clean ENV=review4-sol-853
[review Postgres/MinIO containers, network and dev dependency/data volumes removed; exit 0]
rtk make clean COMPOSE_FILES_DEV='-f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml' ENV=review4-sol-853
Volume radar-review4-sol-853_radar-test-root-node-modules Removed
Volume radar-review4-sol-853_radar-test-api-node-modules Removed
[exit 0]
rtk make ps ENV=review4-sol-853
NAME      IMAGE     COMMAND   SERVICE   CREATED   STATUS    PORTS
[no containers; exit 0]
rtk proxy bash -c 'rm -r -- .review-tmp/sol-r4; rmdir .review-tmp; test ! -e .review-tmp; printf "%s\n" ".review-tmp removed"'
.review-tmp removed
[exit 0]
rtk proxy git diff --name-only
rtk proxy git diff --check
[both: no output; exit 0]
rtk git rev-parse HEAD
3fcdcec0deabc5042b416ca4d3da086b8b0abd0f
rtk git status --short
?? docs/reviews/pr-853/round4-leg-sol.md
?? docs/reviews/pr-853/round4-prompt-sol.md
```

The extra clean includes the test dependency volumes omitted by default dev-only cleanup. Tracked-file diffs remained empty after installation and testing; the supplied leg file was initially untracked.

## Findings

No new demonstrated finding in either mandatory target. No `SOL-853-R4-NN` finding is emitted.

## Verdict

**GO.** SOL-853-R3-01 is fixed. The 230 focused repository tests, 20 independent probes, 46 shell cases, offline rendering/boundary checks and standard workspace typecheck passed. No R1–R5 regression was demonstrated. Remote CI/deployed execution remain **unverified**; restore rehearsal is **not covered**. This verdict covers this independent leg only.
