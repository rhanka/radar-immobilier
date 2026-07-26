# Audit — B′ cohort of approximately 166 cities versus Steve ratings

**Date:** 2026-07-25
**Audited revision:** `e2d1b60a1037bd8505a67d717ac18c9afcb5150a`
**Scope:** the owner-reported current B′ cohort of approximately 166 cities,
the committed B′ implementation, and the committed Steve-30 material. This is
a read-only audit. No live database export or authenticated production data was
provided.

> **Frame correction (read first):** this report initially treated “Steve” as
> a single acquisition-score meaning. Steve's framework separates T1 signal
> triage from T2 opportunity scoring, and the four-city corpus is a parity
> control rather than training data. The authoritative reframing is
> [`audit-bprime-steve-frame-correction-2026-07-25.md`](audit-bprime-steve-frame-correction-2026-07-25.md).

> **Live-data addendum (2026-07-26):** the initial absence of a B′ snapshot is
> superseded by a read-only production audit. It reconstructs **172 live B′
> cities** from `graph_nodes`; the inability to assign Steve ratings beyond the
> labelled cases remains. Read
> [`audit-bprime-live-production-steve-2026-07-26.md`](audit-bprime-live-production-steve-2026-07-26.md)
> before using any count in this report.

## Executive answer

There is **no defensible split** of the approximately 166 cities into Steve
6–10/10 and approximately 3/10 from the data currently available in this
worktree.

| Requested result | Defensible result today | Why |
|---|---:|---|
| Cities confirmed as Steve 6–10/10 | **Not measurable** | The 166-city membership and its contributing signal IDs are absent; B′ does not contain the decisive Steve dimensions. |
| Cities confirmed as Steve approximately 3/10 | **Not measurable** | A low Steve assessment can arise from owner, lot, scale, or exploitability; none can be inferred as “3” from a B′ candidate. |
| Cities assessable from the frozen evidence | **0 / unverified approximately 166** | “166” is owner-reported, not a committed snapshot. The repository provides no member-level evidence for it. |
| Cities to classify after a snapshot is supplied | **Every snapshot member initially abstained** | This is a state before assessment, **not** a claim that every city is low-value. |

This is not a failure of arithmetic. It is a missing denominator, an
incompatible unit of analysis, and incomplete evidence. Reporting a numerical
estimate anyway would manufacture precision.

## What is and is not available

### The B′ cohort cannot be reproduced

The application computes B′ dynamically from current `graph_nodes`; it does
not commit a B′ city list. The default B axes are `z=true`, `r=true`,
`p=true`: a city is retained if it has at least one non-excluded, zoning,
residential-eligible, early-stage signal. The relevant aggregate is the early
part of `stageCountsResEligible`.

The required production endpoints exist (`/api/graph-signals/by-city` then
`/api/graph-signals/:city`), but their unauthenticated response was `401` on
the audit date. No export from either endpoint is versioned. The only nearby
quantity in code is a non-snapshot comment, “1,141 nodes / ~197 cities”; it is
not the B′ cohort and cannot establish 166.

Consequently, this audit cannot verify that the current cohort is 166, name
the cities, or show which signal retained each city.

### The Steve material is not a scoring table for those cities

The committed calibration set contains 31 labelled signals across 30 cities.
Only 16 labels have numeric notes: ten are 6–10 and six are 0–4. The remaining
15 labels are qualitative/no-note or signal-unavailable. It is neither a
random sample of B′ nor a member-level labelling of the reported 166.

Moreover, Steve labels **signals/opportunities**, not cities. Mont-Saint-Hilaire
has both a 0/10 promoter-tailored signal and a 7/10 signal. A city-level score
would destroy that distinction. The existing B′ × Steve fixture confirms only
Sutton fully and Coaticook partially; its remaining 28 city targets are
explicit production-QA gaps, not observations.

The primary source is absent from the audited revision but recoverable from
reachable Git history: `docs/spec/input/user-evaluation/Cahier_presentation_Radar_Immobilier.docx`
(blob `9a627ff55637022fa78314a69590f1406dbe957c`, historical commit
`0fd1151df6f06abd405c85fbc5c3f8bf6770eb4e`). It is Steve Chaperon's dated
10 July 2026 cahier, expressly based on **30 targeted cities**, with section 3
“Synthèse des 30 villes analysées”. The derived reports named by the dataset
are also recovered historical blobs. This strengthens provenance, but it does
not widen the rating truth beyond 30 cities / 31 signal labels, only 16 of
which are numeric; it cannot justify extrapolating a note to B′.

## Why the current criteria cannot mean “Steve 6–10”

B′ and Steve answer different questions:

| B′ currently detects | Steve evaluates |
|---|---|
| A municipal regulatory signal that may concern residential densification, early enough to investigate. | Acquisition interest in a specific opportunity. |
| Zoning, residential relevance, instrument, stage, source/evidence, confidence, and a mostly-unknown densification effect. | Regulatory and land exploitability, owner, project scale, precedent, distance, and other acquisition factors. |

Three implementation facts make over-classification particularly likely if a
B′ city is read as a high Steve score:

1. `isResidentialEligible` intentionally keeps a rezoning/refonte whose
   residential nature is `indetermine`. That is a sensible recall choice for a
   **discovery queue**, but no evidence of a 6+/10 opportunity.
2. Zoning is currently positive when either `category` **or** annotated
   `etape` matches a zoning vocabulary. The evolving specification identifies
   `etape` as a corrupted field and says it must not be used as a zoning
   detection fallback. Signals admitted only by that fallback require review,
   not a high-value interpretation.
3. `effet_densifiant` is normally `inconnu` until a before/after zoning-grid
   delta is available. The specification calls that delta Steve’s central
   criterion. Unknown is therefore not a permissible proxy for “densifies”.

The present criteria are thus **miscalibrated only if B′ is presented as a
Steve score**. They remain directionally appropriate for a broad,
recall-oriented detection vivier.

## Recommended correction: separate discovery from a Steve verdict

Do not narrow the B′ discovery pool merely to make it resemble the 16
in-sample labels. Instead, make the semantic status explicit and prohibit an
unknown from becoming a high acquisition rating.

| Status | Minimum evidence | Permitted claim |
|---|---|---|
| **B′ discovery / investigate** | Current B′ logic, including an eligible unknown rezoning/refonte. | A municipal signal may warrant review. No Steve rating. |
| **Regulatory densification evidenced** | Zoning supported by source/type or category (not `etape` fallback alone); residential `oui`; cited source; and `effet_densifiant = densifie` from a dated grid delta. | The signal has verified regulatory densification evidence. Still no Steve 6+/10 claim. |
| **Steve-rating eligible** | The preceding evidence plus signal-to-zone linkage, usable lot/exploitability data, owner status, and project-scale evidence, all with provenance and vintage. | A 0–10 assessment or a bounded score may be calculated. |
| **Steve low (approximately 3) confirmed** | Complete evidence for the specific signal and a documented low result under the agreed Steve rubric. All relevant signals for a city must be assessed before calling the *city* low. | A low assessment for that signal; city aggregation must state its rule. |
| **Abstain / surveillance** | Any decisive field unknown, including residential relevance, grid delta, lot, owner, or scale. | Neither high nor low. |

Two immediate criterion changes follow from that table:

- Keep indeterminate rezonings/refontes and `etape`-only zoning hits in the
  discovery queue, but tag them **`to_confirm`** and exclude them from any
  “Steve plausible 6+” count.
- Make a cited before/after grid delta a gate for the *evidenced regulatory*
  tier, not an optimistic ranking boost. Do the same for the owner, lot, and
  scale coverage required before assigning a Steve verdict.

This correction changes the meaning of a displayed tier, not the breadth of
the radar. It protects recall while stopping the current semantic leap from
“may be a relevant regulatory signal” to “high acquisition interest.”

## What should not be changed yet

Do not retune numeric scoring weights from the 16 numeric labels. The existing
Steve convergence is explicitly in-sample, the source corpus is only 30
reviewed cities, and the B′ members are not joined to the labels. Reweighting
on those records would be circular. Under the project scoring rules, any later
weight change also requires a scored-data specification and weights totaling
100.

Do not call a B′ candidate “approximately 3” merely because it lacks land or
owner data. Missing data is an abstention, not negative evidence.

## Measurement protocol required to answer the owner’s question

1. **Freeze the cohort.** Export the authenticated by-city response with the
   timestamp, B′ commit, graph snapshot/version, and exact `z/r/p` axis state.
   Preserve the city slugs and the signal IDs that retain each city.
2. **Export the evidence.** For every retained city, export its B′ signal
   classifications, stable IDs, document references/extracts, source page,
   confidence, and exclusion reason.
3. **Join at signal/dossier level.** Import the recovered immutable Steve
   cahier into the governed source set and map every benchmark label to a
   canonical signal ID or regulation/source reference. Unmatched labels remain
   unmatched; do not join on city alone.
4. **Enrich only what is needed to score.** Record the dated grid delta,
   signal-to-zone mapping, lots/exploitability, owner category, and project
   scale. Keep every unavailable value explicitly unknown.
5. **Publish an abstaining partition.** At signal level report `6–10
   confirmed`, `0–3 confirmed`, `4–5`, and `indeterminate`. If city roll-up is
   needed, document it before calculation: a city is high only if it has at
   least one confirmed high signal; it is low only if every relevant signal is
   assessed low and none is indeterminate.
6. **Report coverage alongside results.** A valid result is a four-way
   partition with coverage by field, not a forced 166-city score distribution.

## Audit disposition

**No numerical Steve distribution is accepted for the owner-reported
approximately 166 B′ cities on the available data.** The appropriate current
result is that every as-yet-unfrozen cohort member is indeterminate pending a
frozen cohort and signal-level evidence. The proposed criterion correction is
to retain B′ as a discovery vivier while reserving Steve-like ratings for
evidence-complete signals; it must be measured on a frozen, independently
sourced dataset before any scoring calibration is changed.

## Evidence references

- `api/src/services/graph/graph-store.ts` — dynamic graph-node selection and
  `isZonageSignal` category/`etape` fallback.
- `ui/src/lib/signals/vivier-view-mode.ts` — default B axes and city retention
  aggregate.
- `packages/radar-domain/src/vivier/counts.ts` — residential-eligible unknown
  rezoning/refonte behaviour.
- `api/src/services/graph/vivier-v2.ts` and
  `packages/radar-domain/src/vivier/vivier-v2.ts` — available classification
  fields and `effet_densifiant` handling.
- `packages/radar-scoring/src/steve30/dataset.ts` and `features.ts` — Steve
  labels and acquisition dimensions.
- `docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md` — grid delta as central Steve
  evidence and the intended no-unknown-as-favourable rule.
- `docs/reports/recette/RECETTE_VIVIER_BPRIME_STEVE30.md` — Sutton/Coaticook
  fixture scope and production-QA gaps.
