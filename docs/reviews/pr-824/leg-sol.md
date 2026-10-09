status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: fix/signal-filters-residential-unknown@1877c840bf1ecf783394d62a6ffa71765a5de02c
lens: does-it-reproduce-and-filter-regression

## Reasoning

The supplied node reproduces the defect: its default-view count is **0 on origin/main and 1 at the reviewed commit**, on both the aggregate/rail path and the panel projection. The changed repository tests fail against the original predicate and pass against the reviewed predicate. I reproduced no blocking functional regression. There is one documentation nit below.

Reviewed target: `git diff origin/main...1877c840bf1ecf783394d62a6ffa71765a5de02c`. Local `origin/main` and the merge base are both `782d20c96c54e7035438aa6fdccdc4ccba82acf4`; HEAD is the requested commit. I did not fetch or consult another review. All evidence here comes from local files, pure functions, and local unit tests. No database, S3, external network, or Python was used. This verifies the supplied node and constructed regression cases; it does **not** independently establish the branch plan's production totals (853, 61) or the production-wide absence of other signals.

The API classifier and aggregate implementation are unchanged between these refs. Classification of the supplied shape remains `zonage=oui`, `residentiel=indetermine`, `instrument=autre`, `etape=projet_reglement`, `exclusion_reason=null`. Its document date is within July 5–October 5. The functional change is the shared residential predicate: the unknown remains unknown, but becomes eligible for the checked `r` axis. `qualified=0` and `residentialUnknown=1` are preserved.

I tested server aggregation and client date/display filtering separately before comparing `countForVivierCity` with `projectComposedVivierB`, rather than manufacturing aggregate counters from the panel's selected IDs. A second, synthetic contract matrix exercises all schema-valid instrument/stage/tri-state/exclusion combinations, including all four server exclusion reasons.

**Does `r` still filter with `p` checked? Yes, but its effect is narrower.** With the supplied generic early unknown alone, HEAD yields `z∩r∩p = z∩p = 1`; main yielded 0 versus 1. On the mixed fixture set with both default display exclusions enabled, HEAD yields 8 versus 9: the removed item is an early PIIA whose `nb_unites_max=4` satisfies the display proof requirement while the residential classification remains unknown. When PIIA/derogation display exclusions are unchecked, unknown individual authorisations are also still removed by `r`. Explicit residential `non` is already removed by the server exclusion, even with every axis unchecked.

The precise eligibility delta, exhausted across all seven instruments, seven stages, and three residential states, is six cases: unknown `autre`, `ppcmoi`, or `plan_urbanisme`, at `avis_motion` or `projet_reglement`, change from false to true. No previously eligible case becomes ineligible. Unknown PIIA/derogation, late non-rezoning/non-reform unknowns, and explicit `non` behave as before.

Against `docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md` §1/§3, retaining these early unknowns supports the stated “indéterminé GARDÉ” discovery intent without converting unknown residential status or density effect into positive evidence. It does not implement universal retention of every unknown; the existing individual-authorisation and late-stage restrictions remain. Against `plan/BPCS-BRANCH_fix-bprime-residentiel-eligible.md`, it is a real change to the older narrower decision: that plan's “unknown non-rezoning stays filtered” discriminator no longer holds at early stages for the three instruments above. Its protection against unknown individual authorisations remains intact. The PR explicitly changes the formal B′ contract §1 to this stage-dependent rule. I therefore treat the observed widening as an intentional contract evolution, not an accidental count/list regression. Parity alone would not establish this distinction.

## Reproduction log

Commands below ran from the worktree root. Raw output is retained in `.review-logs/leg-sol/`. Temporary test/config/input/guard files were created only in `./.review-tmp` and deleted after verification. The supplied `.review-env` configuration was reused without editing it.

### Identity and comparison method

```sh
rtk git branch --show-current
# fix/signal-filters-residential-unknown
rtk git rev-parse HEAD origin/main
# 1877c840bf1ecf783394d62a6ffa71765a5de02c
# 782d20c96c54e7035438aa6fdccdc4ccba82acf4
rtk git merge-base origin/main 1877c840bf1ecf783394d62a6ffa71765a5de02c
# 782d20c96c54e7035438aa6fdccdc4ccba82acf4
rtk git diff origin/main HEAD -- api/src/services/graph/graph-store.ts api/src/services/graph/vivier-v2.ts packages/radar-domain/src/signals/vivier-display-exclusions.ts packages/radar-domain/src/signals/document-date-filter.ts
# empty
```

The first ordinary `git checkout origin/main -- <two source files>` failed before changing files because the shared Git index is read-only:

```text
fatal: Unable to create '/home/antoinefa/src/radar-immobilier/.git/worktrees/fix-signal-filters/index.lock': Read-only file system
```

That preliminary batch is retained as `failed-swap-*.log` and is **not** used as main evidence. I then used a private index to perform the explicitly authorized temporary source checkout without writing shared Git metadata:

```sh
rtk cp /home/antoinefa/src/radar-immobilier/.git/worktrees/fix-signal-filters/index .review-tmp/isolated-index
GIT_INDEX_FILE=.review-tmp/isolated-index rtk git checkout origin/main -- packages/radar-domain/src/vivier/counts.ts ui/src/lib/signals/vivier-view-mode.ts
rtk git diff origin/main -- packages/radar-domain/src/vivier/counts.ts ui/src/lib/signals/vivier-view-mode.ts
# empty; both source files match main
```

The PR's tests were retained to test the main predicate. The new audit script was also retained for its tests; it does not exist on main. This is a transplant of the reviewed tests onto the original production predicate, not a claim that the new test files existed on main. The unchanged API classification/aggregation and display/date code above make this an actual baseline comparison for the requested paths.

After all baseline processes completed:

```sh
GIT_INDEX_FILE=.review-tmp/isolated-index rtk git checkout HEAD -- packages/radar-domain/src/vivier/counts.ts ui/src/lib/signals/vivier-view-mode.ts
rtk git diff HEAD -- packages/radar-domain/src/vivier/counts.ts ui/src/lib/signals/vivier-view-mode.ts
# empty
```

All affected suites and the independent check were rerun after restoration and passed.

### Repository tests: red on main, green on the reviewed commit

```sh
rtk api/node_modules/.bin/vitest run --configLoader runner --root packages/radar-domain src/vivier/counts.test.ts
rtk api/node_modules/.bin/vitest run --configLoader runner --root api src/services/graph/graph-store.test.ts -t 'server-side signal date windows'
rtk api/node_modules/.bin/vitest run --configLoader runner --config .review-env/vitest.ui.review.config.mts src/lib/signals/vivier-view-mode.test.ts src/lib/components/maps/SignauxRailFilterHarness.test.ts src/lib/signals/vivier-b-display-filter.test.ts
rtk api/node_modules/.bin/vitest run --configLoader runner --root api src/scripts/residential-tristate-dry-run.test.ts
```

| Suite | Original predicate (`main-*.log`, exit 1) | Reviewed predicate (`head-*.log`, exit 0) |
|---|---|---|
| Domain counts | 2 failed, 7 passed | 9 passed |
| API date/display aggregate group | 1 failed, 4 passed, 144 skipped by test-name selection | 5 passed, 144 skipped by selection |
| UI projection, rail harness, display exclusions | 2 failed, 32 passed | 34 passed |
| Audit script unit tests | 2 failed | 2 passed |

Decisive baseline failure output:

```text
counts.test.ts:101: expected +0 to be 1
counts.test.ts:172: expected false to be true
graph-store.test.ts:702: expected +0 to be 1
vivier-view-mode.test.ts:322: expected [] to deeply equal [ 'event-26-220' ]
SignauxRailFilterHarness.test.ts:112: Expected: "3"; Received: "2"
residential-tristate-dry-run.test.ts: eligibilityChanged.toEligible expected 1, received 0
```

Restored-HEAD commands and outputs (`restored-*.log`):

```sh
rtk api/node_modules/.bin/vitest run --configLoader runner --root packages/radar-domain src/vivier/counts.test.ts
# 9 passed; exit 0
rtk api/node_modules/.bin/vitest run --configLoader runner --root api src/services/graph/graph-store.test.ts src/scripts/residential-tristate-dry-run.test.ts -t 'server-side signal date windows|residential-tristate-dry-run'
# 7 passed, 144 skipped by selection; exit 0
rtk api/node_modules/.bin/vitest run --configLoader runner --config .review-env/vitest.ui.review.config.mts src/lib/signals/vivier-view-mode.test.ts src/lib/components/maps/SignauxRailFilterHarness.test.ts
# 26 passed; exit 0
```

DB-bound graph-store tests were not selected; there was no Postgres attempt or `EAI_AGAIN` failure to disregard. UI runs emitted the Tailwind missing-content warning but passed.

Additional period/date checks:

```sh
rtk api/node_modules/.bin/vitest run --configLoader runner --root packages/radar-domain src/signals/document-date-filter.test.ts
# 13 passed; exit 0; head-date-domain.log
rtk api/node_modules/.bin/vitest run --configLoader runner --config .review-env/vitest.ui.review.config.mts src/lib/signals/signal-date-filter.test.ts src/lib/router/geo-filter-state.test.ts
# 23 passed; exit 0; head-date-ui.log
```

### Independent exact-node and filter checks

```sh
rtk api/node_modules/.bin/vitest run --configLoader runner --config .review-tmp/vitest.config.mts .review-tmp/filters.test.ts
# HEAD: 6 passed; exit 0; head-independent.log
REVIEW_REVISION=main rtk api/node_modules/.bin/vitest run --configLoader runner --config .review-tmp/vitest.config.mts .review-tmp/filters.test.ts
# original predicate: 6 passed using baseline expectations; exit 0; main-independent.log
rtk api/node_modules/.bin/vitest run --configLoader runner --config .review-tmp/vitest.config.mts .review-tmp/filters.test.ts
# restored HEAD: 6 passed; exit 0; restored-independent.log
```

The temporary config set root to this worktree, included only `.review-tmp/**/*.test.ts`, used Node test environment, put its cache under `.review-tmp`, and aliased `@radar/domain` and `$lib` to this worktree's sources. It used the actual API aggregate/classifier and UI count/projection/date functions.

The exact-node test used the supplied label, ID, city, type, null category/description, nested properties (`status`, `etape`, `etape_date`, `instrument`, resolution, regulation number, regulatory status), and `refs[0]` with both `publishedAt` and the known `documentDate`. Its decisive calls were:

```ts
const options = {
  dateFrom: "2026-07-05", dateTo: "2026-10-05",
  excludePiia: true, excludeDerogations: true,
};
const city = aggregateGraphSignalProjectionRows([reference], options)[0]!;
const v = city.vivierV2Counts;
const defaultCount = v.stageCountsResEligible.avis_motion
  + v.stageCountsResEligible.projet_reglement;
// Panel: same classified reference, client document-date filter and display
// exclusions, then projectComposedVivierB(nodes, { z:true, r:true, p:true }).
```

Observed output, reduced to the decisive fields:

```text
main: zonage=oui residentiel=indetermine instrument=autre etape=projet_reglement exclusion=null
      stageCounts.projet_reglement=1; stageCountsResEligible.projet_reglement=0
      qualified=0; residentialUnknown=1; defaultCount=0; panel=[]
head: zonage=oui residentiel=indetermine instrument=autre etape=projet_reglement exclusion=null
      stageCounts.projet_reglement=1; stageCountsResEligible.projet_reglement=1
      qualified=0; residentialUnknown=1; defaultCount=1; panel=[event-26-220]
```

The 35-row fixture set included the supplied node, confirmed residential early/late signals, unknown PPCMOI/plan, unknown rezoning/reform at adoption, generic unknowns at all five non-early stages, all four exclusion reasons, unknown and confirmed-residential PIIA/derogation, PIIA with and without project proof, signals outside confirmed zonage, and document/stage/acquisition date cases. All constructed cases are **synthetic regression fixtures**, not purported production measurements.

For each of six periods (`all`, `3mo`, `6mo`, `12mo`, one-day custom document, custom acquisition), each of four PIIA/derogation toggle settings, and all eight axes, the test independently ran:

```ts
const bulk = aggregateGraphSignalProjectionRows(rows, apiDateAndDisplayOptions);
const detail = applyVivierBExclusions(
  filterNodesByDocumentDate(rows.map(toServerClassifiedNode), range, basis),
  clientDisplayExclusions,
);
// For each axes tuple:
expect(countForVivierCity(cityEntry, keyForVivierB(axes)))
  .toBe(projectComposedVivierB(detail, axes).nodes.length);
```

Output: `fixtures=35, combinations=192`, zero mismatches on both versions. Relative presets resolved calendar boundaries with October 5, 2026 pinned as “now”; acquisition basis was used only for the custom period.

HEAD counts below are **both rail and panel**. Vector order is `z/r/p = 000,001,010,011,100,101,110,111`; `0` means unchecked. Column toggles are `excludePiia/excludeDerogations`.

| Period | 0/0 | 0/1 | 1/0 | 1/1 |
|---|---|---|---|---|
| all | 31,23,23,20,29,21,21,18 | 29,21,22,19,27,19,20,17 | 29,21,22,19,27,19,20,17 | 27,19,21,18,25,17,19,16 |
| 3mo | 23,15,15,12,21,13,13,10 | 21,13,14,11,19,11,12,9 | 21,13,14,11,19,11,12,9 | 19,11,13,10,17,9,11,8 |
| 6mo | 27,19,19,16,25,17,17,14 | 25,17,18,15,23,15,16,13 | 25,17,18,15,23,15,16,13 | 23,15,17,14,21,13,15,12 |
| 12mo | 28,20,20,17,26,18,18,15 | 26,18,19,16,24,16,17,14 | 26,18,19,16,24,16,17,14 | 24,16,18,15,22,14,16,13 |
| custom document, July 29 | 2,2,2,2,2,2,2,2 | 2,2,2,2,2,2,2,2 | 2,2,2,2,2,2,2,2 | 2,2,2,2,2,2,2,2 |
| custom acquisition, September 29–30 | 1,1,1,1,1,1,1,1 | 1,1,1,1,1,1,1,1 | 1,1,1,1,1,1,1,1 | 1,1,1,1,1,1,1,1 |

On main, the 3mo + both exclusions vector was `19,11,6,3,17,9,5,2`. Changes occur only in vectors requiring `r`; period, `z`, `p`, and the display exclusions continue to select the same underlying cohorts.

Specific unchanged-behavior assertions passed on both versions:

| Case | Reproduced behavior |
|---|---|
| Explicit non-residential; four server exclusion reasons | Never in the panel, including `000` with both display exclusions off |
| July 5 / October 5 document dates | Included at the inclusive 3mo bounds |
| July 4 / October 6 / missing date | Excluded from 3mo; unrestricted period retains date-less rows |
| Stage date alone July 29 | Included via existing document-stage fallback |
| Document July 4, stage July 29 | Document takes precedence; excluded from 3mo |
| Document July 4, acquired September 29 | Excluded from 3mo document basis, retained in custom acquisition window |
| Residential PIIA without project proof | Hidden with PIIA exclusion on; revealed when off |
| Residential PIIA with units/project proof | Retained by display exclusion |
| Derogations | Hidden with derogation exclusion on; revealed when off, subject to the same `r` rule |
| Unknown PIIA/derogation at early stage | Still rejected by checked `r` |
| Unknown `autre` at consultation, second project, adoption, entry into force, unknown stage | Still rejected by checked `r`; accessible when `r` is off and `p` permits the stage |
| Unknown rezoning/reform at adoption | Still residential-eligible; rejected by checked `p` |

Independent contract enumeration output:

```text
CONTRACT_MATRIX {"classifications":2058,"combinations":32,"mismatches":0}
PREDICATE_DELTA [
  ppcmoi/avis_motion/indetermine: false -> true,
  ppcmoi/projet_reglement/indetermine: false -> true,
  plan_urbanisme/avis_motion/indetermine: false -> true,
  plan_urbanisme/projet_reglement/indetermine: false -> true,
  autre/avis_motion/indetermine: false -> true,
  autre/projet_reglement/indetermine: false -> true
]
```

The 2,058 classifications enumerate seven instruments × seven stages × three zonage states × all valid residential/exclusion pairs (omitting `residentiel=non` with no exclusion, which the schema rejects). Four display-toggle settings × eight axes were checked. A separate 147-case instrument/stage/residential enumeration established the six predicate deltas above and no eligibility losses.

The PIIA counterexample to a universal “r does nothing when p is checked” claim is a `DesignationEvent` at `avis_motion`, `instrument=piia`, a neutral label, and `props.properties.nb_unites_max=4`: no residential wording, no server exclusion, and an in-window document. Actual classification output remained `residentiel=indetermine`. The units satisfy the display proof check; checked `r` excludes it on both refs. HEAD mixed-fixture output was:

```text
R_WITH_P: withoutR=9, withR=8, removed=[piia-unknown-project]
R_WITH_P_GENERIC_ONLY: withoutR=1, withR=1
```

An initial throwaway run had two failed fixture assumptions (`head-independent-initial.log`): labels containing only plural “logements” did not yield confirmed residential classification. Inspection showed the unchanged server residential marker regex recognizes singular `logement`, but not that plural alone. I added explicit “résidentiel” to the fixtures intended to be confirmed residential, retained a separate unknown-with-units PIIA fixture, and reran both refs. This was a correction to review fixtures, not a PR defect or a code change.

### Audit script and refusal of writes

The script's two unit tests passed at HEAD as recorded above. I additionally exercised the real CLI with a local NDJSON record containing the supplied node. A temporary preload denied filesystem mutation APIs and external network connection APIs, recorded reads of the input file, and disabled TSX's disk cache. It also blocked the loader's two attempted local IPC connections; their destinations and TSX stack traces are recorded in the logs. No network connection was allowed.

```sh
TSX_DISABLE_CACHE=1 REVIEW_INPUT=.review-tmp/reference.ndjson rtk proxy node --require ./.review-tmp/io-guard.cjs --import ./api/node_modules/tsx/dist/loader.mjs api/src/scripts/residential-tristate-dry-run.ts --apply --from-ndjson=.review-tmp/reference.ndjson --window=2026-07-05..2026-10-05
```

Observed in `apply-final.log`, exit **2**:

```text
[residential-tristate] --apply refused: the residential verdict is derived at read time; no persisted field to write. Deploy the predicate fix. Missing Graphify 3.4 fields are backfilled by graphify-34-enrich.ts (dry-run by default, S3-first).
IO_GUARD {"exitCode":2,"filesystemWrites":0,"network":0,"blockedLocalIpc":2,"inputReads":0,...}
```

The input is not even read before refusal. Source inspection confirms the `--apply` branch precedes option parsing and either NDJSON or S3 reads (`api/src/scripts/residential-tristate-dry-run.ts:230`). Together with the write/network guards, this confirms no data write on the tested path. The initial `rtk node` invocation returned exit 2 with empty captured output, so `rtk proxy node` was used to recover unfiltered evidence.

```sh
TSX_DISABLE_CACHE=1 REVIEW_INPUT=.review-tmp/reference.ndjson rtk proxy node --require ./.review-tmp/io-guard.cjs --import ./api/node_modules/tsx/dist/loader.mjs api/src/scripts/residential-tristate-dry-run.ts --from-ndjson=.review-tmp/reference.ndjson --window=2026-07-05..2026-10-05 --json
```

Observed in `dry-run-cli.log`, exit **0**:

```text
mode=dry-run; nodes=1; cities=1
eligibilityChanged: nodes=1, cities=1, toEligible=1, toIneligible=0
defaultView: before=0, after=1, citiesAfter=1
missingPersistedFields: nodes=0, cities=0
writesRequired=0
example: event-26-220, autre, projet_reglement, indetermine, r=filtered -> r=eligible
IO_GUARD: filesystemWrites=0, network=0, blockedLocalIpc=2, inputReads=1
```

Final hygiene: both temporarily replaced source files matched HEAD, `git diff --check origin/main...1877c840bf1ecf783394d62a6ffa71765a5de02c` exited 0, and `.review-tmp` was removed. No commit or push was performed. No other tracked file retains a modification.

## Findings

1. **severity: non-blocking — the instrument-set comment still states the pre-fix eligibility rule.**
   - **file:line:** `packages/radar-domain/src/vivier/counts.ts:109`.
   - **Evidence:** the comment says any other instrument left indeterminate “is NOT eligible.” The independent predicate enumeration proves six contrary cases at HEAD: early unknown `autre`, `ppcmoi`, and `plan_urbanisme` now return true. The original statement was accurate on main; it becomes misleading with this PR. The new predicate's own comment and the formal contract correctly explain the added stage-dependent rule.
   - **Fix:** limit this comment to the all-stage rezoning/reform exception, or explicitly refer to the separate early-stage exception below. Preserve the statement that unknown individual authorisations remain ineligible.

No blocking finding survived reproduction. The intentional narrowing of `r`'s effect with `p` checked is documented in Reasoning; this review does not claim the older BPCS decision is behaviorally unchanged.

## Verdict

**GO-with-nits.** The supplied defect is reproduced and fixed; the added tests distinguish main from HEAD; all tested filter combinations preserve rail/panel parity and the protected exclusions. `--apply` exits 2 without a data write. Correct the stale eligibility comment. This verdict covers the assigned local reproduction/regression lens, not production-corpus quality or a deployment validation.
