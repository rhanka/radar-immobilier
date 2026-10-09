status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/signal-filters-residential-unknown@1877c840bf1ecf783394d62a6ffa71765a5de02c
lens: correctness

## Reasoning

Reviewed `git diff origin/main...1877c840bf1ecf783394d62a6ffa71765a5de02c` independently, without consulting other reviewers. The worktree HEAD matches the target; the local `origin/main` is `782d20c96c54e7035438aa6fdccdc4ccba82acf4`. No remote, database, or cloud resource was accessed.

**Predicate and enum boundaries.** `isResidentialEligible` implements the stated rule. Both explicit residential outcomes return before the instrument/stage checks, so `non` cannot become eligible even for a refonte or an early stage. For `indetermine`, the complete enum partitions as follows:

| Instruments | `avis_motion`, `projet_reglement` | `consultation_publique`, `second_projet`, `adoption`, `entree_vigueur`, `inconnu` |
| --- | --- | --- |
| `rezonage`, `refonte` | Eligible | Eligible |
| `ppcmoi`, `plan_urbanisme`, `autre` | Eligible | Ineligible |
| `derogation`, `piia` | Ineligible | Ineligible |

This checks all seven instrument values and all seven stage values by inspection of the branches and their sets. The predicate reads the canonical current `etape`, not `etapes_historique`. The upstream classifier still normalizes annotations, preserves valid annotated stages over label inference, and produces the unchanged enum. There is no residential reclassification or lexicon change.

**Server/client parity.** The counter and `projectComposedVivierB` both call the same domain predicate. Both remove server exclusions before applying the axes. `countForVivierCity` selects the corresponding stage buckets, including the eligible outside-zoning bucket when `z` is unchecked. Let `S` be `stageCounts`, `H` be `stageCountsHorsZonage`, and `SR`/`HR` their residential-eligible counterparts. `early` sums the two early stages; `all` sums all seven:

| z | r | p | Server badge composition / equivalent panel membership |
| --- | --- | --- | --- |
| true | true | true | `early(SR)` |
| true | true | false | `all(SR)` |
| true | false | true | `early(S)` |
| true | false | false | `all(S)` |
| false | true | true | `early(SR) + early(HR)` |
| false | true | false | `all(SR) + all(HR)` |
| false | false | true | `early(S) + early(H)` |
| false | false | false | `all(S) + all(H)` |

The existing eight-combination parity test passes. Its indeterminate fixtures are rezonings, so that test alone would not prove the new rule. The added UI projection test separately proves the early `autre` case, the late-stage rejection with `p` unchecked, and default badge parity. The component harness verifies the actual `p`/`r` toggle sequence.

**Counter invariants and legacy A.** The predicate only changes the two eligible stage buckets. It does not change classification, `qualified`, `residentialUnknown`, `excludedByReason`, `total`, or either unfiltered stage bucket. The early unknown regression remains `qualified=0`, `residentialUnknown=1`, and preserves `total = qualified + residentialUnknown + sum(excludedByReason)`. Legacy `z|m|p` uses `extractLegacyZmpInput`/`classifyLegacyZmpSignal`; its `r` intersections use `classifyBPrime` and `isResidentielPertinent`, not the modified predicate. Those implementations are unchanged. The Sutton/Coaticook fixtures and residential subset assertions pass.

**Regression sensitivity.** The new tests contain concrete expected results rather than assertions that merely compare two consumers of the same implementation. At `origin/main`, the predicate ends with membership in `{rezonage, refonte}`. It therefore returns false for the added `indetermine`/`autre`/`projet_reglement` fixture, contrary to the new domain assertion, API eligible-stage count, UI default selection, and dry-run `after: true` assertion. The updated domain fixture also covers an early unknown `ppcmoi` through its factory default. The component harness would show two default nodes instead of the asserted three. This baseline comparison was established from the actual `origin/main` source; I did not switch files or claim a baseline test execution.

**Dry-run audit.** For ordinary projected scalar fields, `auditRow` extracts `category`, `description`, and `etape` from `props.properties`, matching `listCitiesWithSignalNodes`, and passes the same full props, label, type, ID, and source reference to the existing classifier. It preserves the classifier's own fallback handling instead of introducing a new classification path. The previous predicate matches the baseline source. Both display exclusions, the server exclusion reason, zoning, and the early-stage requirement gate the reported default view.

The optional window uses the shared `matchesDocumentDateWindow` with `dateBasis: "document"`: inclusive civil-day boundaries, persisted reference dates, stage-date fallback under the shared rules, and no creation-date substitution. Only the default-view counters are windowed, as the script documents; overall eligibility changes still describe the full input. Without `--window`, the report covers all dates rather than implicitly choosing three months.

The S3 path uses `buildNodeRow`, including its type precedence and nested props representation. It is not a complete replay of database projection: see finding 1. The NDJSON path is explicitly the way to measure the served projection; this review does not assert that canonical S3 and currently served PG contain identical sets.

There is no write invocation in the script. `--apply` exits with code 2 before loading either data source. NDJSON uses `readFileSync`; S3 uses `readCanonicalCityGraph`, whose read operation is `getWithEtag`. Classification and reporting do not persist anything. Repeating the audit over the same ordered input, window, and options is deterministic and leaves the input unchanged. The live S3 path and CLI exit branch were inspected, not executed.

**Local verification.** All commands ran from the worktree root through the supplied Vitest tooling (with the required `rtk` prefix). Results: **273 tests passed; 14 database-bound tests deliberately excluded before execution**.

```text
rtk api/node_modules/.bin/vitest run --configLoader runner --root packages/radar-domain src/vivier/counts.test.ts src/signals/document-date-filter.test.ts src/signals/vivier-display-exclusions.test.ts
  22 passed across counts.test.ts and document-date-filter.test.ts.
  No domain test file matched vivier-display-exclusions.test.ts.

rtk api/node_modules/.bin/vitest run --configLoader runner --root api src/scripts/residential-tristate-dry-run.test.ts src/services/graph/vivier-v2.test.ts src/services/graph/bprime-recette.test.ts
  90 passed: dry-run 2, classifier 74, B-prime acceptance 14.

rtk api/node_modules/.bin/vitest run --configLoader runner --root api src/services/graph/graph-store.test.ts -t '^(?!DB-bound:)'
  135 passed; 14 DB-bound tests skipped.

rtk api/node_modules/.bin/vitest run --configLoader runner --config .review-env/vitest.ui.review.config.mts src/lib/signals/vivier-view-mode.test.ts src/lib/components/maps/SignauxRailFilterHarness.test.ts
  26 passed: projection 22, component harness 4.
```

The UI run emitted a Tailwind content-configuration warning; neither UI suite failed. No production dataset was read, so the reported 853-signal diagnosis and production outcome are not independently remeasured here.

## Findings

1. **S3 audit does not collapse repeated node IDs as the writer does.**
   - **Severity:** non-blocking.
   - **File:line:** `api/src/scripts/residential-tristate-dry-run.ts:185`.
   - **Evidence:** `rowsFromCanonicalGraph` maps every array element through `buildNodeRow` and counts every resulting signal row. Both `upsertGraph` and `upsertGraphAtomic` instead call `mergeNodeRows` before projection (`graph-store.ts:922` and `:1089`); the graph schema does not reject repeated IDs. A concrete counterexample is the PR's `draftBylaw` fixture repeated twice in `nodes`: the audit produces two identical changed/default-view-after rows, while `mergeNodeRows` produces one projected row. Thus `nodes`, `eligibilityChanged.nodes`, and `defaultView.after` are 2 rather than 1 for that valid input. This is demonstrable from the pure mapping/merge code; it is not a claim that the production snapshot contains duplicates. The unique-ID fixtures in the two new script tests do not exercise this case. The served filter and the PG-dump audit are unaffected.
   - **Fix:** apply the writer's `mergeNodeRows` to all built rows before filtering by signal type, and add a duplicate-ID regression including merged refs. Keep the documented distinction between canonical-source auditing and measuring the current served PG set.

2. **The instrument-set comment still states the superseded eligibility rule.**
   - **Severity:** non-blocking.
   - **File:line:** `packages/radar-domain/src/vivier/counts.ts:109`.
   - **Evidence:** the comment says any instrument other than rezonage/refonte left indeterminate “is NOT eligible.” The new branch at lines 152–153 admits early unknown `autre`, `ppcmoi`, and `plan_urbanisme`; the passing new `autre` regression directly contradicts the comment. The updated B-prime contract and the predicate's own new documentation correctly describe the code.
   - **Fix:** describe this set as the instruments eligible at every stage and point to the separate early-stage exception, removing the blanket statement about all other instruments.

## Verdict

**GO-with-nits.** No blocking defect demonstrated in the filter change, server/client composition, counter invariants, or legacy A behavior. Address the S3 audit's duplicate-ID accounting and the stale comment; neither finding invalidates the served predicate fix.
