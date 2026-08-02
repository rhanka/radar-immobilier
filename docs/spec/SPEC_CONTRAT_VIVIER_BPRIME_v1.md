# Formal contract — B′ opportunity pool v1 (WP8.1)

Normative terms **MUST**, **MUST NOT**, **SHALL**, and **PASS** are acceptance requirements. A requirement tagged **OPEN — décision propriétaire requise** is not silently defaulted and cannot be reported green.
## 0. Status and scope

- **Status:** formal WP8.1 contract. WP8.1 is “Spec du vivier B′”; its implementation concerns are WP3.1 axes, WP3.2 instruments/lexicon, WP3.3 exclusions/residential eligibility, and WP3.4 counters/server-client parity (`docs/spec/decision-tracking-structure-v2.md:33-38`).
- **Acceptance anchor:** the Steve-30 table was frozen at commit `0b90faf8ba48c4103f42b0e46a610eb28b746fb5`; its current operative status is **CIBLE — QA prod required city by city**, not an offline success claim (`docs/reports/recette/RECETTE_VIVIER_BPRIME_STEVE30.md:3-16,65-86`). Commit `b33c25b87d479579a0f32398a6adef3e1f47245e` is not an anchor for B′.
- **Measurement population:** the fixed production count is 7,221 `Signal` + `DesignationEvent` records (`docs/reports/analyse-vivier-b/corpus_contexte.md:1-3`). The complete replay baseline spans 724 cities, with the `classifyBPrime` marker at 6,777 records over 720 cities (`plan/BPLEXOCC-BRANCH_fix-bprime-lexique-veto-occurrence.md:34-35,102-106`). The rules below are city-independent and target all 167 owner-scope cities; the missing replay snapshot and 167-city manifest are OPEN-01.
- **Scope:** classification, B′ membership, axes, instruments, lexicons, exclusions, named counters, legacy A continuity, parity, and acceptance. Acquisition completeness, geo joins, scoring, and code changes are outside this document except where they are explicit acceptance dependencies (`docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:41-49`).

## 1. Definition of the B′ pool

For a served `VivierV2` classification `c`, define `Z(c) := c.zonage.valeur = "oui"`, `R(c) := isResidentialEligible(c)`, `P(c) := c.etape ∈ {avis_motion, projet_reglement}`, and `E(c) := c.exclusion_reason != null`. The default signal pool is exactly **B′ = { c | !E(c) ∧ Z(c) ∧ R(c) ∧ P(c) }**; a city is present iff at least one of its signals is in B′ (`packages/radar-domain/src/vivier/counts.ts:103-127`; `ui/src/lib/signals/vivier-view-mode.ts:317-349`).
`R(c)` is true for `residentiel=oui`, and for `residentiel=indetermine` only when `instrument ∈ {rezonage, refonte}`; it is false for `residentiel=non` and for every other indeterminate instrument (`packages/radar-domain/src/vivier/counts.ts:103-127`). Exclusions dominate all eight axis combinations and cannot be relaxed by unchecking an axis (`ui/src/lib/signals/vivier-view-mode.ts:317-348`).

`qualified` is **not** B′ membership: it is the strict epistemic count `!E ∧ zonage=oui ∧ residentiel=oui`. Eligible indeterminate rezonings/refontes can belong to B′ while remaining outside `qualified` (`packages/radar-domain/src/vivier/counts.ts:143-175`; `api/src/services/graph/bprime-recette.test.ts:46-58`). The served effect enum is exactly `{densifie,reduit,stable,inconnu}`, while the B′ overlay currently emits only `inconnu` (`packages/radar-domain/src/vivier/vivier-v2.ts:6-12`; `packages/radar-domain/src/signals/b-prime.ts:171-184`). B′ is a discovery pool; unknown effect and B′ membership MUST NOT be presented as a proven density increase or a Steve score (`docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:42-49,54`).
## 2. Deterministic residential tri-state `{oui, non, indetermine}`

`BPrimeClassification` is the detailed B′ overlay (`residentiel`, two B′ reasons, provenance, stage, unknown effect); the served pool uses the larger `VivierV2` DTO (`zonage`, per-axis source/confidence, instrument, stage history, four wire reasons, provenance, confidence). They MUST NOT be conflated (`packages/radar-domain/src/signals/b-prime.ts:12-19`; `packages/radar-domain/src/vivier/vivier-v2.ts:46-83`).

Inputs are resolved from direct fields, then nested `props.properties`, then `props`; decision text is normalized to lowercase without diacritics and consists only of resolved `label + description` (`packages/radar-domain/src/signals/b-prime.ts:79-81,131-142`). A provenance-only excerpt is audit context, never classification evidence (`packages/radar-domain/src/signals/b-prime.test.ts:103-108`).

The following table defines the **B′ card-overlay `BPrimeClassification.residentiel`**; it is ordered and the first matching row wins (`packages/radar-domain/src/signals/b-prime.ts:143-168`). The served `VivierV2.residentiel` is computed independently, then B′ can only overlay an exclusion as specified in §5 (`api/src/services/graph/vivier-v2.ts:202-227,515-554`).

| Priority | Predicate | `residentiel` |
|---:|---|---|
| 1 | frank commercial/industrial category or `FRANC_NON_RESIDENTIEL_RE`, and no strong residential evidence | `non` |
| 2 | no row 1, and complete reform (`category=refonte`, narrow complete-reform expression, or explicit `instrument=refonte`) | `indetermine` |
| 3 | no prior row, and residential category or `RESIDENTIAL` text evidence | `oui` |
| 4 | otherwise | `indetermine` |

Residential categories are exactly `{densification,developpement_residentiel,logement,logement_abordable,habitation}`; frank commercial/industrial categories are `{commercial,commerce,commerces,industriel,industrie}`; strong categories are the residential set without `densification` (`packages/radar-domain/src/signals/b-prime.ts:34-39,71-77`). Strong regex evidence includes housing/habitation, mixed use, and explicit conversion to residential and overrides a frank marker; bare “densification” or “residential” is weak and cannot rescue a commercial-only signal (`packages/radar-domain/src/signals/b-prime.ts:60-69,149-168`). Regex definitions in code are normative; consumers MUST import or execute them, not maintain mirrors (`packages/radar-domain/src/signals/b-prime.ts:40,53-69`).
## 3. Axes `z/r/p` and retained legacy `z/m/p`

| Axis | Checked requirement | Unchecked behavior | Authority |
|---|---|---|---|
| `z` | `zonage.valeur=oui` | also admit non-excluded `non|indetermine` zonage | `ui/src/lib/signals/vivier-view-mode.ts:330-345` |
| `r` | residential eligibility from §1 | also admit non-excluded residential unknowns | `packages/radar-domain/src/vivier/counts.ts:103-127` |
| `p` | stage `avis_motion|projet_reglement` | admit every canonical stage | `ui/src/lib/signals/vivier-view-mode.ts:66-67,407-428` |

All axes are checked by default (`ui/src/lib/signals/vivier-view-mode.ts:64-67`). The new `z` classifier MUST NOT infer zonage from the corrupted `etape` field; source/type/category evidence is required (`docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:10-16`).

Legacy A remains computed in parallel on the same record as `z/m/p`: `z=isZonageSignal`, `m=isMulti4Plus`, `p=isPrecoceSignal`, with all intersections retained and A=`z∩m∩p` (`api/src/services/graph/vivier-v2.ts:636-689`; `docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:16`). New `r` is not a rename of legacy `m`; B keys are in the opaque `vivier-v2` namespace and cannot collide with A keys (`ui/src/lib/signals/vivier-view-mode.ts:16-29,89-122`).
## 4. Instruments and lexicons

The served instrument enum is exactly `{rezonage, ppcmoi, piia, derogation, refonte, plan_urbanisme, autre}` and is separate from stage and stage history (`packages/radar-domain/src/vivier/vivier-v2.ts:14-34,59-69`; `docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:14`). A recognized explicit instrument/category has authority before free text; within free-text heuristics, regulatory `refonte` precedes PPCMOI, PIIA, derogation, and plan (`api/src/services/graph/vivier-v2.ts:453-493`).

The regulatory-reform lexicon is a bounded positive list, not a whole-text blacklist: every occurrence of `refonte(s)` is evaluated independently on its following tail; one positive urbanism occurrence is sufficient and another non-regulatory occurrence cannot veto it (`api/src/services/graph/vivier-v2.ts:299-329,418-450`). Urban objects, qualified generic objects, bounded coordination/filler, separators, structured `^refontes?(?:_|$)` categories, and both apostrophe code points are defined normatively in `api/src/services/graph/vivier-v2.ts:338-438`; the rationale and occurrence rule are recorded in `plan/BPLEXOCC-BRANCH_fix-bprime-lexique-veto-occurrence.md:167-232`.

For the B′ card overlay, R1 is strict: a present valid stage annotation wins; a present invalid or empty annotation yields audited `inconnu`; text inference runs only when annotation is absent (`packages/radar-domain/src/signals/b-prime.ts:113-128,139-140,171-173`). The served stage separately gives a valid annotation authority, otherwise uses the canonical derived history/text result (`api/src/services/graph/vivier-v2.ts:275-297,582-601`). Instrument, served stage, and `etapes_historique` MUST remain separate fields.
## 5. Exclusions and residential eligibility

| Namespace / value | Exact condition |
|---|---|
| B′ `pole_commercial_regional` | normalized decision text matches `REGIONAL_COMMERCIAL_POLE_RE`; reason priority is above B′ non-residential (`packages/radar-domain/src/signals/b-prime.ts:55-58,171-177`) |
| B′ `non_residentiel_franc` | no regional-pole reason and tri-state result is `non` (`packages/radar-domain/src/signals/b-prime.ts:162-177`) |
| B′ `null` | neither condition applies |
| wire `piia_non_pertinent` | `instrument=piia ∧ residentiel=non` |
| wire `derogation_hors_sujet` | `instrument=derogation ∧ residentiel=non` |
| wire `non_residentiel_franc` | remaining `residentiel=non`, including a newly applied B′ exclusion |
| wire `hors_zonage` | no earlier reason and `zonage=non` |
| wire `null` | no exclusion condition applies (`api/src/services/graph/vivier-v2.ts:503-512`) |

An existing wire reason is never overwritten. If the wire classification was not excluded, either detailed B′ reason maps to wire `non_residentiel_franc`; the graph card retains the detailed B′ reason (`api/src/services/graph/vivier-v2.ts:515-554`). `residentiel=non` with a null wire reason is invalid (`packages/radar-domain/src/vivier/vivier-v2.ts:59-82`). Rosemère and Saint-Charles-Borromée MUST NOT receive fabricated lexical evidence: their target exclusions depend on semantic geo marking (`docs/reports/recette/RECETTE_VIVIER_BPRIME_STEVE30.md:18-25,73-77,95-100`).
## 6. Named counters and server/client parity

| Field | Exact population |
|---|---|
| `qualified` | non-excluded, `zonage=oui`, `residentiel=oui` |
| `residentialUnknown` | every non-excluded record not counted in `qualified` (not only `residentiel=indetermine`) |
| `excludedByReason` | four wire-reason integer buckets |
| `stageCounts` / `stageCountsHorsZonage` | non-excluded records partitioned by `zonage=oui` vs other, then canonical stage |
| `stageCountsResEligible` / `stageCountsResEligibleHorsZonage` | the same two partitions restricted by `R(c)` |
| `total` | every input classification exactly once (`packages/radar-domain/src/vivier/counts.ts:129-178`) |

The mandatory partition is `total = qualified + residentialUnknown + Σ excludedByReason` (`packages/radar-domain/src/vivier/counts.ts:30-65,93-99`). For every city and all eight `z/r/p` combinations, the server recomposition, rail count, and panel signal-ID count MUST be equal; the current formulas and exhaustive model test are `ui/src/lib/signals/vivier-view-mode.ts:407-428` and `ui/src/lib/signals/vivier-view-mode.test.ts:492-544`.
## 7. Executable acceptance criteria

Every replay produces a machine-readable result per criterion and per city: `PASS|FAIL|OPEN`, observed value, expected value, failing signal IDs, corpus identifier, code SHA, and timestamp. “Mechanically correct city” means BP-02 through BP-15 pass for all its rows; “B′ achieved city” additionally requires its applicable ground truth gate. No OPEN may be reported PASS.

BP-22 and BP-23 apply to every candidate lot in the general 167-city cohort, not only Steve-30. This §7 is the sole contract authority; §5 of `feat/recette-rejeu-harness:docs/reports/recette/RECETTE_HARNESS_REJEU_PROD.md` is the canonical implementation. `scripts/recette/diff-snap.py` emits named entrants and outgoings, and `scripts/recette/per-city-verdict.py` pronounces the verdict.

| ID | Atomic testable statement | Source | Method on the 7,221 replay | Acceptance threshold |
|---|---|---|---|---|
| BP-01 | Replay input is the fixed Signal+DesignationEvent population | T01 | validate type and count before classification | exactly 7,221; invalid type 0 |
| BP-02 | Every input contributes exactly one valid served classification | T02,T03 | classify all rows; compare input/output/`total`; schema-parse each output | 7,221/7,221; parse errors 0 |
| BP-03 | B′ overlay: frank non-residential without strong evidence yields `non` | T04,OPEN-11 | compare emitted predicate trace/oracle with row 1 | divergences 0 |
| BP-04 | B′ overlay: strong evidence prevents the frank non-residential result | T04,OPEN-11 | compare emitted predicate trace/oracle with ordered rows 1-2 | divergences 0 |
| BP-05a | B′ overlay: a complete reform surviving row 1 yields `indetermine` | T04,OPEN-11 | compare emitted predicate trace/oracle with row 2 | divergences 0 |
| BP-05b | B′ overlay: residential evidence surviving rows 1-2 yields `oui` | T04,OPEN-11 | compare emitted predicate trace/oracle with row 3 | divergences 0 |
| BP-05c | B′ overlay: a residual case yields `indetermine` | T04,OPEN-11 | compare emitted predicate trace/oracle with row 4 | divergences 0 |
| BP-06 | B′ overlay: provenance-only excerpts never change the decision | T05 | reclassify after removing only provenance excerpt fields | changed decisions 0 |
| BP-07a | B′ overlay: present annotation is authoritative and invalid is audited unknown | T06 | run `classifyBPrime`; partition valid/invalid/absent annotations | divergences 0 |
| BP-07b | Served stage uses a valid annotation, otherwise its derived result | T06b | compare `VivierV2.etape` with annotated-or-derived rule | divergences 0 |
| BP-08 | New `z` never becomes `oui` from `etape` alone | T07 | identify rows whose sole zonage evidence is stage; inspect new-axis output | stage-only positives 0 |
| BP-09 | Structured instrument authority cannot be overwritten by free text | T08 | compare recognized explicit/category token with instrument output | overwrites 0 |
| BP-10 | Refonte is bounded, positive, and evaluated per occurrence without global veto | T09 | log every occurrence/tail; run canonical probes plus full-corpus scan | false global veto 0; canonical probes 100% |
| BP-11 | Detailed B′ reasons and wire mapping obey §5 without overwrites | T10 | compare overlay reason, pre-overlay wire reason, and final reason row by row | discordances 0 |
| BP-12 | Default membership is exactly `!E∧Z∧R∧P` | T11 | derive predicate trace for every signal and compare served membership | symmetric difference 0 |
| BP-13 | Named counter partition and stage subpartitions are exact | T12 | verify formula globally/per city; sum stage partitions and eligible subsets | equality exact; excluded-in-stage 0; subset overflow 0 |
| BP-14 | Server = rail = panel for every axis composition | T13 | compare three counts per city for all 8 `z/r/p` combinations | mismatches 0 |
| BP-15 | Legacy `z/m/p` is emitted in parallel and unchanged from its frozen baseline | T14,OPEN-10 | calculate legacy membership/count keys on the same rows and diff baseline | missing memberships 0; membership drift 0 |
| BP-16a | Relaxing all axes reveals every non-excluded classification, including unknowns | T15 | compare `{z:false,r:false,p:false}` projection with the set `!E` | symmetric difference 0 |
| BP-16b | Unknown density effect is never promoted to `densifie`; any stage/instrument/evidence ordering remains OPEN-09 | T15b,OPEN-09 | assert an unknown effect remains labelled unknown; do not assert an unresolved ranking order | promotions to `densifie` 0 |
| BP-17 | Every known geo density effect carries proof, source, and vintage | T16,OPEN-12 | validate the owner-approved effect-evidence schema per known effect | evidence coverage 100% |
| BP-18 | The live Steve-30 projection equals the frozen target column | T17,OPEN-04,OPEN-05,OPEN-13 | run the frozen metric on real endpoint data city by city | 30/30 exact; synthetic rows 0 |
| BP-19 | Every Steve city rated at least 6/10 is present | T17 | count default B′ membership for the ten high-rated cities | 10/10 present |
| BP-20 | Every Steve-30 row is backed by committed real data or an explicit QA-prod gap | T18 | set-partition the 30 canonical rows | orphan rows 0; fabricated fixtures 0 |
| BP-21 | B′ is achieved over the complete owner scope | OPEN-01–OPEN-05,OPEN-12,OPEN-13 | require every manifest city mechanically correct plus its ground-truth gate | 167/167, with OPEN count 0 |
| BP-22 | On the early ∩ residential-eligible ∩ zoning B′ axis, every outgoing signal blocks by default; only a named, proven false-positive correction is admitted, while every entrant is named and traced in non-blocking SOFT-REVIEW | T19 | diff candidate versus `main` membership per signal for each lot; reconcile every outgoing against the explicit correction ledger and emit the complete entrant list | uncorrected outgoings 0; otherwise FAIL; entrants have no blocking threshold |
| BP-23 | Every candidate lot has a candidate-versus-`main` snapshot of B′ membership by signal | T20 | classify both versions for every signal in the lot and compare membership with `scripts/recette/diff-snap.py` | lot coverage 100%; missing or duplicate signal IDs 0; absent comparison FAIL |

The BP-18 target vector, in canonical row order, is `2,2,2,4,1,2,2,3,2,2,0,1,0,3,0,3,2,0,2,2,2,0,0/0/1,3,2/2,2,2,0,1,1` (`api/src/services/graph/bprime-recette.fixture.ts:139-170`). Offline evidence can currently close only Sutton fully and Coaticook partially; all other claims remain QA gaps (`api/src/services/graph/bprime-recette.test.ts:41-84,134-188`).
## 8. Traceability matrix

| Trace | Criteria | Repository authority |
|---|---|---|
| T01 | BP-01 | `docs/reports/analyse-vivier-b/corpus_contexte.md:1-14` |
| T02 | BP-02 | `api/src/services/graph/vivier-v2.ts:618-629`; `packages/radar-domain/src/vivier/counts.ts:129-141` |
| T03 | BP-02 | `packages/radar-domain/src/vivier/vivier-v2.ts:3-82` |
| T04 | BP-03–BP-05c | `packages/radar-domain/src/signals/b-prime.ts:34-77,141-168` |
| T05 | BP-06 | `packages/radar-domain/src/signals/b-prime.test.ts:103-108` |
| T06 | BP-07a | `packages/radar-domain/src/signals/b-prime.ts:113-128,139-140,171-173` |
| T06b | BP-07b | `api/src/services/graph/vivier-v2.ts:275-297,582-601` |
| T07 | BP-08 | `docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:10-16` |
| T08 | BP-09 | `api/src/services/graph/vivier-v2.ts:453-493` |
| T09 | BP-10 | `api/src/services/graph/vivier-v2.ts:299-450`; `plan/BPLEXOCC-BRANCH_fix-bprime-lexique-veto-occurrence.md:167-232` |
| T10 | BP-11 | `packages/radar-domain/src/signals/b-prime.ts:171-177`; `api/src/services/graph/vivier-v2.ts:503-554` |
| T11 | BP-12 | `packages/radar-domain/src/vivier/counts.ts:103-127`; `ui/src/lib/signals/vivier-view-mode.ts:317-349` |
| T12 | BP-13 | `packages/radar-domain/src/vivier/counts.ts:30-65,129-178` |
| T13 | BP-14 | `ui/src/lib/signals/vivier-view-mode.ts:407-428`; `ui/src/lib/signals/vivier-view-mode.test.ts:492-544` |
| T14 | BP-15 | `api/src/services/graph/vivier-v2.ts:636-689`; `api/src/services/graph/bprime-recette.test.ts:229-243` |
| T15 | BP-16a | `docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:9-15,34-38`; `ui/src/lib/signals/vivier-view-mode.ts:330-348` |
| T15b | BP-16b | `docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:49,54`; `packages/radar-domain/src/vivier/vivier-v2.ts:170-223` |
| T16 | BP-17 | `docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:42-46` |
| T17 | BP-18–BP-19 | `docs/reports/recette/RECETTE_VIVIER_BPRIME_STEVE30.md:30-83`; anchor `0b90faf8ba48c4103f42b0e46a610eb28b746fb5` |
| T18 | BP-20 | `api/src/services/graph/bprime-recette.test.ts:191-227` |
| T19 | BP-22 | implementation: `feat/recette-rejeu-harness:docs/reports/recette/RECETTE_HARNESS_REJEU_PROD.md` §5; `scripts/recette/diff-snap.py`; `scripts/recette/per-city-verdict.py` |
| T20 | BP-23 | implementation: `feat/recette-rejeu-harness:docs/reports/recette/RECETTE_HARNESS_REJEU_PROD.md` §5; `scripts/recette/diff-snap.py` |
## 9. OPEN — owner decisions required

- **OPEN-01 — replay identity:** provide a versioned URI/path, schema, immutable hash, and row-cardinality rule for the 7,221 snapshot. The repo currently contains only the measured count and partial-strata description; those strata have 836 distinct IDs and 45 duplicates, so they are not the full replay (`docs/reports/analyse-vivier-b/README.md:14-31`; `plan/BPLEXOCC-BRANCH_fix-bprime-lexique-veto-occurrence.md:288-299`).
- **OPEN-02 — 167-city manifest:** freeze the 167 canonical slugs, aliases, vintage, relation to the 7,221 snapshot, and treatment of duplicate municipalities. No repository artefact currently names that cohort; Steve-30 is the only executable city manifest (`api/src/services/graph/bprime-recette.fixture.ts:124-170`).
- **OPEN-03 — truth outside Steve-30:** define owner QA/gold evidence and recall, precision, outgoing-budget, and document-completeness thresholds for cities outside the frozen table. Mechanical correctness alone cannot prove semantic correctness (`docs/reports/recette/RECETTE_VIVIER_BPRIME_STEVE30.md:65-86`).
- **OPEN-04 — multi-slug targets:** freeze the ordered slug mappings behind Hemmingford `0/0/1` and Notre-Dame-de-Lourdes `2/2`; the executable fixture currently exposes one canonical slug per display row (`api/src/services/graph/bprime-recette.fixture.ts:161-165`).
- **OPEN-05 — geo-dependent exclusions:** define the semantic geo field, provenance, and QA rule that make Rosemère and Saint-Charles-Borromée reach `0`; until then BP-18 is legitimately OPEN for those rows, never lexically fabricated (`docs/reports/recette/RECETTE_VIVIER_BPRIME_STEVE30.md:18-25,73-77`).
- **OPEN-06 — reason preservation:** decide whether `pole_commercial_regional` requires a dedicated wire/counter bucket or may continue to collapse into `non_residentiel_franc` (`api/src/services/graph/vivier-v2.ts:540-554`).
- **OPEN-07 — dual reform lexicons:** decide whether the narrow private `completeReform` test in `b-prime.ts` must converge on the active bounded per-occurrence instrument lexicon; the divergence is explicitly recorded (`plan/BPLEXOCC-BRANCH_fix-bprime-lexique-veto-occurrence.md:308-312`).
- **OPEN-08 — stage vocabulary:** decide how B′ card stages `accorde|refuse` map into the served/counter stage enum, which currently lacks both, and reconcile BPrimeEtape `consultation` with served VivierEtape `consultation_publique` (`packages/radar-domain/src/signals/b-prime.ts:1-10`; `packages/radar-domain/src/vivier/vivier-v2.ts:25-34`).
- **OPEN-09 — ranking order:** resolve the conflict between normative `stage → instrument → evidence` and current `evidence → stage → instrument`; no order is invented here (`docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:15`; `packages/radar-domain/src/vivier/vivier-v2.ts:170-183`).
- **OPEN-10 — legacy baseline:** freeze a full-corpus legacy membership artifact/hash; the repository only commits a Sutton golden, insufficient for BP-15 over 7,221 rows (`api/src/services/graph/bprime-recette.test.ts:229-243`).
- **OPEN-11 — residential oracle:** expose a versioned predicate trace or pin a reference-output oracle for the private category sets/regex predicates used by BP-03–BP-05c; comparing `classifyBPrime` to itself is not acceptance (`packages/radar-domain/src/signals/b-prime.ts:34-77,131-168`).
- **OPEN-12 — geo effect evidence:** define exact field paths, schema, join identity, provenance, and vintage for a known density effect before BP-17 can run (`docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:42-46`).
- **OPEN-13 — Steve metric:** choose and freeze the historical early `stageCounts` formula versus the current default `z/r/p` formula using `stageCountsResEligible`; existing offline fixtures do not discriminate them (`api/src/services/graph/bprime-recette.test.ts:24-32`; `ui/src/lib/signals/vivier-view-mode.ts:407-428`).

Known conformance gap, not an owner decision: the active new-axis classifier still calls the legacy `isZonageSignal(type, category, etape)` fallback (`api/src/services/graph/vivier-v2.ts:229-257`), while BP-08 forbids stage-only zonage. WP8.1 specifies the gate but does not modify application code.
