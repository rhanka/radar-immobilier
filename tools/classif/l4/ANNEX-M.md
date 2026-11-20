# Annex M — Metrics and cost function (pilot v3)

Carry-over of plan v2 §F-1, updated for the v3 owner decisions of 04/11: reference set D
instead of the dev consensus, primary criterion on « shown » (P∪S), Pertinent masked as a
secondary S113-only diagnostic, `unresolved` handling, pre-registered `indeterminate`
supports. Sources: `sources-bundle.md:2091, 2096–2103, 2122–2137, 2898`, `dossier-v3.md` A.6.
This annex is written BEFORE L3b (review §E-4) and frozen before series P0: thresholds and
supports below are pre-registered in the L4 series manifests; changing them after opening a
half makes the series exploratory.

## M.1 Unit, aggregation, definitions

- **Unit**: one radar record (signal- or event-), one step per row (R-07: no regrouping). A
  PV item carries one annotation per item (no per-act annotation in this pilot).
- **Case**: the reference-set row. A case is **shown** when its verdict is pertinent (P) or
  à surveiller (S). Execution failures and unread inputs count as shown (fail closed).
- **Pertinent masked**: a P case predicted non_pertinent (N). On reference D the P support
  is tiny (≈ 5/504 in pass 1): Pertinent masked is NOT a selection criterion on D.
- **Secondary measure S113** (Steve's labels, ≈ 38 P, flagged `golden-exposed`): Pertinent
  masked with the exact one-sided 95 % Clopper–Pearson upper bound on the effective n.
  Diagnostic only, outside selection (annotators consulted the golden set in phase A).
- **Noise**: share of shown cases whose reference is N. **P alone** is the second operating
  point (recall/precision on P).
- **Unresolved**: reference-D rows with status `unresolved` are neither scored nor in any
  denominator. Every reported metric is published with AND without the unresolved rows.
- **Precision P∪S**: share of shown predictions whose reference is P or S.
- **Agreement**: 3-class agreement with raw agreement, prevalence and supports alongside
  (no weighted κ). Per-code Cohen κ, McNemar pairwise tests and the city-cluster bootstrap
  (≥ 10,000 draws) are pure utilities (`l4/metrics.mjs`, unit-tested) run in the L5 report,
  never in series selection.
- **Comparator**: B′ passes 1–3 recomputed on the frozen corpus, compared in shown/masked
  only, in the L5 report (not in series manifests). The 21/09 observed P∪S share (49/73 =
  67.1 %, other population) is reported, never used as a comparator.

## M.2 Primary analysis (per series, tuning half then blind half)

Intersection-union per evaluated route: `pass` if shown-recall AND shown-precision pass;
`fail` if either fails or the failure rate exceeds the pre-registered ceiling;
`indeterminate` otherwise. The blind half is scored ONCE per series by the executor role;
aggregates only; nothing returns to the optimisers.

- **(1) Shown recall**: recall of P∪S vs reference D, with the exact one-sided 95 %
  Clopper–Pearson LOWER bound. `pass` if the lower bound ≥ the pre-registered floor.
- **(2) Shown precision**: same construction on the shown predictions. `pass` if the lower
  bound ≥ the pre-registered floor.
- **Indeterminate supports** (pre-registered): shown-recall is `indeterminate` when the
  half holds fewer than 30 P∪S reference cases; shown-precision is `indeterminate` when it
  holds fewer than 30 shown predictions. Bounds are still published.
- **Failure ceiling** (pre-registered): execution-failure share of the half; above it the
  route `fail`s regardless of (1)–(2). Failures stay in every denominator.

## M.3 Selection (lexicographic, tuning half only)

1. Shown recall (lower bound, then point estimate);
2. Shown precision (lower bound, then point estimate);
3. Most recent prompt version;
4. Lowest measured cost (input+output tokens, USD when priced; unpriced seats count 0
   with their token counts published).

The blind half NEVER selects, ranks, or stops anything (adaptation ban, review §A-3b):
it is read once per series, by the owner only.

## M.4 S113 reading scale

113 items detect only large gains (McNemar: 155 pairs for 10 points at 20 % discordance,
`dossier-v3.md` A.6): an S113 comparison without a significant McNemar result is
`indeterminate`, never a win. S113 is `golden-exposed` (phase-A consultation) and stays
out of every selection.

## M.5 Series manifests (pre-registered before each series)

`tools/classif/l4/manifests/series-<k>.json`: prompt sha, routes, halves sha256, shown
floors, failure ceiling, indeterminate supports, budget {spent, cap}. The blind run refuses
a series whose manifest is missing, uncommitted, or modified after the blind open.
