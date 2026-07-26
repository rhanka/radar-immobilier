# Audit correction — apply Steve's scoring frame before measuring B′

**Date:** 2026-07-25
**Purpose:** correct the measurement frame before answering how many retained B′ cities are “Steve 6–10” or “Steve approximately 3”. This note supersedes any interpretation that treats those labels as one city-level score.

> **Live-data addendum (2026-07-26):** a read-only production audit has now
> reconstructed 172 current B′ cities. This note's score-semantics conclusions
> remain in force, while its statement that the cohort snapshot is absent is
> superseded. See
> [`audit-bprime-live-production-steve-2026-07-26.md`](audit-bprime-live-production-steve-2026-07-26.md).

## Primary frame read first

This correction is grounded in `docs/spec/input/carte-steve/README.md`, `docs/spec/SPEC_CONTROLE_PARITE_VILLES_STEVE.md`, `docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md`, `docs/spec/SPEC_EVOL_SOCLE_STATES_SCORING.md`, and `packages/radar-scoring/src/steve30/dataset.ts`.

The four cities in Steve's cartographic corpus are an isolated **golden control dataset**. Their lot flags and team marks are compared with independently derived radar data for parity; they must never train, feed, or automatically alter B′.

### Steve truth, source and strict scope

The owner designates `docs/reports/recette/RECETTE_VIVIER_BPRIME_STEVE30.md` as the known ground truth for the 30-city Steve review. This audit therefore accepts its Steve notes and qualitative verdicts as the benchmark.

The primary source was also recovered from reachable Git history, although it is not in the audited revision: `docs/spec/input/user-evaluation/Cahier_presentation_Radar_Immobilier.docx` (blob `9a627ff55637022fa78314a69590f1406dbe957c`, in historical commit `0fd1151df6f06abd405c85fbc5c3f8bf6770eb4e`). It is Steve Chaperon's *Radar immobilier — Bilan du prototype et recommandations*, dated 10 July 2026. Its introduction says it is based on an analysis of **30 targeted cities** and section 3 is titled *Synthèse des 30 villes analysées*. The table has one header plus 30 city rows. The two recovered derivative reports, `steve-eval-analyse-plan_2026-07-10.md` and `steve-analyse-complete-planifiee_2026-07-11.md`, explicitly identify that cahier as their source and likewise call the calibration set “30 cities × note /10 × why”.

No wider source of **Steve /10 ratings** was found in the current tree or in the reachable Git artefacts searched by Steve/Chaperon/cahier provenance. The four-city cartographic corpus is much larger in lots and marks, but contains no comparable city/opportunity /10 labels. Thus the rating ground truth is strictly limited to **30 reviewed cities / 31 labelled signals**, of which **16 signal labels have a numeric note**. It is not legitimate to manufacture a Steve note for any of the other approximately 166 B′ cities.

The known numeric benchmark contains ten high signal labels (6–10/10) and six low labels (0–4/10). The low labels are not six low cities: Mont-Saint-Hilaire has both 0/10 and 7/10 signals. The B′ acceptance target deliberately retains every high-labelled city, deliberately excludes regulatory/noise lows such as Rosemère, and deliberately retains owner-driven low cases such as Saint-Côme-Linière (3/10) and Petite-Rivière-Saint-François (2/10). This is expected signal-selection behaviour, not an inconsistency.

### Evidentiary boundary from the B-corpus analysis

`docs/reports/analyse-vivier-b/` is a useful diagnosis of extraction and noise, **not a scoring dataset**. It is a 2026-07-17 snapshot of Vivier B (about 914 signals / 341 cities), whereas the owner asks about the current B′ cohort of approximately 166 cities. Its three-strata corpus contains duplicated IDs, incomplete fields by stratum, and a residential pre-filter; its README and adversarial review expressly invalidate many of Sonnet's exact ratios and its CPTAQ/YouTube conclusions. It cannot be used to estimate any 166-city high/low distribution.

What survives the adversarial review is directional evidence for criterion repair: `nb_unites_max` is sometimes absent despite an explicit unit count in text; `DesignationEvent` classification coverage is very poor in the production check; no structured dossier/regulation link is served; and regulatory-to-zone density evidence still needs geo data. CPTAQ absence, YouTube absence, lexical “noise” buckets, and the three-block gisement verdict must not be treated as measured truth.

## The decisive distinction

| Measure | Unit | Scale | What it answers | Role in this audit |
|---|---|---:|---|---|
| **T1** | Signal | /10 | Which regulatory signal type should be surfaced first? | Natural measure for the B′ detection vivier. |
| **T2** | Opportunity dossier, linked from a signal to one or more lots | 0–5 | How attractive is a reality-anchored opportunity after regulatory, risk, timing, land, and market evidence? | Downstream; not a B′ city score. |
| **Steve30** | One reviewed signal/opportunity | /10 | Steve's acquisition interest in that particular reviewed case. | Small signal-level calibration reference; not a city-level B′ label table. |
| **Steve control corpus** | Lot and team mark | no universal score | Whether radar reproduces Steve's data/derived lot flags in four golden cities. | Parity control only. |

The authoritative scoring specification rejects the idea that T1 is a preliminary version of T2. A signal may deserve high detection priority while its downstream opportunity is partial, capped, or rejected. A city may contain multiple, conflicting signals: Steve30's Mont-Saint-Hilaire has both a 0/10 promoter-tailored signal and a 7/10 signal.

## What “6–10 versus approximately 3” means here

The owner resolves the audit metric: these terms mean the accepted Steve /10 notes in the 30-city recipe. T1 remains necessary to repair signal-selection criteria, but it is not a substitute for the known Steve notes.

### A. B′ detection quality: T1

The committed T1 grid gives residential rezoning 10, CPTAQ 8, PPCMOI 7, relevant derogation 5, and irrelevant derogation 1. Political intention, plan refonte, grid modification, TOD, and public investment are an explicitly configurable 5–7 band; their exact subtype values are still an owner decision.

**T1 has no defined “approximately 3” class.** It must not be substituted for the Steve /10 benchmark. It can, however, explain and repair which signal types B′ retains, using explicit bands plus `unmapped` and `indeterminate` status.

### B. Acquisition interest: Steve30/T2

Steve30's 3/10 is an acquisition judgement for one signal. It can depend on ownership, project scale, regulatory substrate, lot evidence, and timing. It is closer in purpose to T2, but it is not the T2 0–5 score and must not be silently converted into one.

Only 16 Steve30 rows are numeric. The owner-provided recipe and recovered primary cahier make those notes the accepted benchmark for this audit, but the B′ cohort has no frozen signal-level join to them.

## Correct current result

No committed or accessible frozen export identifies the approximately 166 B′ cities and the signal IDs that retain them. The live endpoints needed to obtain them require authentication. The accepted Steve benchmark is therefore known, but it cannot yet be intersected with the current B′ population.

| Quantity | Defensible status |
|---|---|
| Known Steve benchmark | **10** high signal labels (6–10) and **6** low labels (0–4), across 15 distinct scored cities because Mont-Saint-Hilaire is mixed. |
| High (6–10) inside the current approximately 166 B′ cities | **Not measurable:** the snapshot is absent. The recipe specifies expected inclusion of all ten high labels; Sutton is fully proven offline, Coaticook only partially, and the other target checks remain production-QA gaps. |
| Low (approximately 3, operationally 0–4) inside the current approximately 166 B′ cities | **Not measurable:** the snapshot is absent, and owner-driven low cases are intentionally retained while regulatory/noise lows should be excluded. |
| “166” denominator | **Unverified:** owner-reported only, not versioned. |

This does not mean that 166 cities are poor opportunities. It means that the known labels cannot yet be intersected with a frozen current B′ population.

## B′ correction that follows from the frame

1. **Preserve two taxonomies.** GEO emits a source-neutral regulatory type with field provenance; IMMO derives the Steve/B′ T1 type and band from it. Map each B′ signal, with cited evidence, to the closed T1 taxonomy before aggregating to its city. Persist mapping/grid version, confidence, and source reference.
2. **Keep discovery recall separate from high-T1 membership.** An indeterminate rezoning/refonte remains a legitimate `à-approfondir` discovery candidate, but cannot count in T1 6–10 until residential densification and subtype are evidenced. An `etape`-only hit must be labelled and reviewed rather than alone create a high-T1 result; it must also not be silently discarded merely to improve apparent precision.
3. **Aggregate cities without inventing a city note.** Publish signal IDs and the maximum **evidenced** T1 band for each city, plus `mixed` and `unmapped` flags. A city is not approximately 3 merely because it has one weak signal if another is a confirmed 10.
4. **Score acquisition only downstream.** T1 signals generate dossiers. Apply the existing T2 availability doctrine: unknown is `non-disponible`; partial scores expose coverage and cap engagement; full acquisition evidence is not required to triage T1.
5. **Use Steve's four cities only for parity.** Compare independently scraped lots/zones/TOD and permitted team-mark exports to `ControlLot`/`ControlMark`. A parity miss is an audit finding, never an automatic B′ or scoring mutation.

No numeric weights should be retuned from the small in-sample Steve30 set. Any later grid change must be versioned and evaluated on a frozen signal-level cohort.

## Minimum reproducible measurement run

1. Freeze `citySlug`, stable `signalId`, B′ classification, source excerpt, timestamp, algorithm commit, and exact `z/r/p` axes.
2. Freeze the T1 subtype-to-value table, including open 5–7 subtypes and whether any 3 band exists.
3. Measure at **signal** level: coverage and confusion matrix for T1 bands; report unmapped/indeterminate separately.
4. Roll up to cities only through a declared maximum-evidenced-T1 rule and publish mixed-city counts.
5. Join returned signals to the accepted 30-city recipe labels by canonical signal/reference; retain the recovered primary-cahier citation as provenance metadata and compare only like-for-like acquisition cases.
6. Run four-city lot parity independently; do not use it to inflate B′ totals.

## Audit conclusion after applying the frame

The available evidence still cannot answer “how many of the 166 are 6–10 and how many are approximately 3.” The only defensible extrapolation is **criterion-level**, not a predicted Steve score: report whether a B′ signal is analogous to a known high/low case, which required evidence is absent, and whether it remains indeterminate. The correct next output is a frozen, signal-level T1 coverage table plus a separate, evidence-capped T2/Steve30 analysis—not a speculative city distribution or invented rating distribution.
