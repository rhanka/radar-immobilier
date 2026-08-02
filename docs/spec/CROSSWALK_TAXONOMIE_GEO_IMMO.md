# Canonical geo↔immo taxonomy crosswalk (`zoning-events`)

## 0. Status and scope

**Status: FROZEN shared contract.** This is the single canonical type crosswalk for geo `zoning-events`. Its consumers are geo, which measures recall, and immo, which derives the Steve product view. Any mapping change requires joint geo+immo review and a new reviewed revision of this file and `crosswalk-taxonomie.json`.

This contract is separate from B′. It neither defines nor changes B′ classification, eligibility, filtering, or acceptance. Its sole purpose is to reconcile the geo event kind with exactly one declared immo axis. The ≥95% recall objective is measured on the geo recall-gate sample, currently **85 DesignationEvents**; **81/85 = 95.3%**. The separate **167-city cohort** is used for coverage and precision and is never a recall denominator. The target is never authority to add an unproved mapping.

## 1. Event identity is exact; only type is relaxed

The identity key is the ordered triple **(`municipality`, `source_url`, `date`)**. A match requires exact equality of all three serialized values. The matcher MUST NOT case-fold or alias municipalities, normalize or follow URLs, use date windows, infer missing values, or perform fuzzy/text/entity matching.

After exact identity succeeds, and only then, this crosswalk may relax the type component. Category input MUST first pass through the finite `canonicalGeoCategory` function; this is exact canonicalization, not fuzzy matching. A mapped row matches only its declared axis: `same_identity AND ((axis = category AND canonicalGeoCategory(immo.category) is in targets) OR (axis = etape AND immo.etape is in targets))`.

An `UNMAPPED` row never matches. A missing identity field never matches. For the recall ≥95% gate on the geo sample, currently **85 DesignationEvents**, at least **81/85** must match; no gap may be removed from the denominator or force-mapped to reach that number.

## 2. Geo taxonomy — verbatim and exhaustive

Authoritative upstream source (not present in this checkout): `acquisition/src/zoning-events-emit.ts:38-48`, `ZoningEventType`, supplied verbatim by the geo lane. `validateZoningEvent` rejects every other value. The **10** values, verbatim: `ppcmoi | changement-de-zonage | projet-reglement | entree-en-vigueur | derogation-mineure | cptaq | consultation | registre-referendaire | alienation | autre`.

## 3. Immo taxonomy — verbatim

The canonical crosswalk category axis is `GEO_CATEGORY_MAPPING` (`packages/radar-domain/src/geo/geo-category-mapping.ts:92-188`), **14 semantic ids + `autre`**, verbatim: `rezonage | modification_zonage | changement_usage | derogation | derogation_mineure | piia | ppcmoi | usage_conditionnel | lotissement | subdivision | densification | zone_agricole | cptaq | patrimoine | autre`.

Its closed `SYNONYMS` object (`geo-category-mapping.ts:214-224`), used by `canonicalGeoCategory` (`geo-category-mapping.ts:208-225`), contains, verbatim: `amendement_zonage → modification_zonage`; `modification_reglementaire → modification_zonage`; `reglementation_urbanisme → modification_zonage`; `densification_residentielle → densification`; `densification_multifamiliale → densification`; `contrainte_agricole → zone_agricole`; `exclusion_zone_agricole → cptaq`; `projet_particulier → ppcmoi`. Every other unknown becomes `autre`.

Real graph counts (`geo-category-mapping.ts:32-36`) prove positive occurrences for `rezonage` 552, `derogation` 108, `piia` 101, `cptaq` 57, `ppcmoi` 50, `lotissement` 35, `densification` 26, `usage_conditionnel` 19, `changement_usage` 8, `modification_zonage` 12, `zone_agricole` 5, and `patrimoine` 5, plus 1,438 nulls among 2,634 `Signal` nodes. These positive counts are anti-gaming evidence that the named canonical categories are real; the comment's ellipsis is not evidence of zero for unlisted ids.

`ZONAGE_CATEGORIES` (`api/src/services/graph/graph-store.ts:1094-1110`), **15 values**, verbatim: `rezonage | derogation | derogation_mineure | piia | cptaq | ppcmoi | lotissement | subdivision | densification | usage_conditionnel | modification_zonage | changement_usage | zone_agricole | contrainte_reglementaire | patrimoine`.

`NON_ZONAGE_CATEGORIES` (`api/src/services/graph/vivier-v2.ts:91-96`), **4 values**, verbatim: `acquisition_fonciere | infrastructure | vente_terrain | vente_institutionnelle`.

`ETAPE_ENUM` (`radar/ontology/graphify-output-contract.md:632`), **11 values**, verbatim: `avis_motion | projet_reglement | consultation_publique | second_projet | adoption | entree_vigueur | derogation_mineure | piia | ppcmoi | usage_conditionnel | inconnu`.

The canonical crosswalk step target set is the narrower `ANTICIPATION_MAPPING` (`geo-category-mapping.ts:264-281`): `avis_motion | projet_reglement | consultation_publique | second_projet | adoption | entree_vigueur | inconnu`. The four autonomous-instrument values `derogation_mineure | piia | ppcmoi | usage_conditionnel` remain valid ontology `ETAPE_ENUM` values (`graphify-output-contract.md:573-582`) but are deliberately not targeted on the step axis here; this contract aligns their semantic kinds on category when an authorized geo equivalent exists. The axes are not interchangeable. `instrumentFromSignal` proves immo instrument clusters, but instrument derivation is evidence, not an additional matching axis.

## 4. Exhaustive normative crosswalk (geo → immo)

Cardinality is stated in the geo→immo direction. `1↔n` therefore has the reverse reading `n↔1`. For mapped rows, `axis` is normative; `—` means no proved axis or target.

| Geo kind | Status | Axis | Cardinality | Exact immo target(s) | Semantic justification / provenance |
|---|---|---|---|---|---|
| `ppcmoi` | mapped | category | 1↔1 | `ppcmoi` | Same Québec planning instrument; canonical id has 50 observed records. Closed synonym `projet_particulier` resolves here. It does not authorize immo step `ppcmoi`. |
| `changement-de-zonage` | mapped | category | 1↔n | `modification_zonage`, `rezonage`, `changement_usage` | Immo explicitly groups these ids, with observed counts 12, 552, and 8. The third target, `changement_usage`, comes from this immo-side grouping (`geo-category-mapping.ts:92-111`; `instrumentFromSignal`, `vivier-v2.ts:480`), not from an observed jointures pair; it is recall-neutral (0 of 85) and awaits geo-side (`geo-archi`) ratification. **⚖ ARBITRAGE RÉSOLU:** coded `modification_reglementaire` canonizes to `modification_zonage`; observed `modification_reglementation` does not. |
| `projet-reglement` | mapped | étape | 1↔1 | `projet_reglement` | Same regulatory-process stage; hyphen/underscore are the only taxonomy spelling difference. |
| `entree-en-vigueur` | mapped | étape | 1↔1 | `entree_vigueur` | Same coming-into-force stage; hyphen/underscore and the preposition are the taxonomy spelling difference. |
| `derogation-mineure` | mapped | category | 1↔n | `derogation_mineure`, `derogation` | Geo has one neutral derogation kind, `derogation-mineure`, which buckets all derogations. Immo groups both ids into the same derived instrument (`api/src/services/graph/vivier-v2.ts:484`: `if (candidate === "derogation" || candidate === "derogation_mineure") return "derogation"`). Authoritative jointures evidence `6fcd5f9d` establishes the 1↔n cardinality. |
| `cptaq` | mapped | category | 1↔1 | `cptaq` | Exact id has 57 observed records; `exclusion_zone_agricole` canonizes here. **⚖ ARBITRAGE:** distinct canonical `zone_agricole` is broader and remains unmapped. |
| `consultation` | mapped | étape | 1↔1 | `consultation_publique` | Geo's regulatory consultation kind corresponds to the explicit public-consultation process stage. |
| `registre-referendaire` | **UNMAPPED** | — | — | `[]` | No referendum-register category or step exists in either immo enum. This process gap must remain visible. |
| `alienation` | **UNMAPPED** | — | — | `[]` | **⚖ ARBITRAGE:** alienation is broader than sale; the geo enum alone does not prove `vente_terrain` or `vente_institutionnelle`, both non-zoning categories. |
| `autre` | **UNMAPPED** | — | — | `[]` | Catch-all is not a specific semantic equivalent and cannot match immo `inconnu`. |

The autonomous machine contract is `docs/spec/crosswalk-taxonomie.json`: `$contract` freezes identity, normalization, vocabularies, and validation; `mappings` mirrors this table. JSON `axis: "etape"` means the displayed `étape`, and `null` denotes an unmapped axis/cardinality.

## 5. Explicit gaps on both sides and recall impact

Geo-only gaps are `registre-referendaire` (no immo referendum stage), `alienation` (scope not proved equal to immo sales), and `autre` (catch-all). They cannot produce a type match. Against an immo reference they remain false negatives; without a corresponding reference they may affect precision, not recall.

| Immo-only value | Axis | Why no geo equivalent is authorized |
|---|---|---|
| `piia` | category | **⚖ ARBITRAGE:** geo emits no PIIA kind; PIIA is not PPCMOI. |
| `lotissement` | category | No geo subdivision/lotting kind. |
| `subdivision` | category | No geo subdivision/lotting kind. |
| `densification` | category | Outcome/theme, not one of the 10 geo kinds. |
| `usage_conditionnel` | category | No geo conditional-use kind. |
| `zone_agricole` | category | **⚖ ARBITRAGE:** agricultural-zone subject is not necessarily CPTAQ. |
| `contrainte_reglementaire` | category | No geo regulatory-constraint kind. |
| `patrimoine` | category | No geo heritage kind. |
| `autre` | category | Canonical catch-all remains non-specific; geo `autre` cannot match it. |
| `acquisition_fonciere` | category (non-zoning) | Acquisition is not proved equivalent to geo alienation. |
| `infrastructure` | category (non-zoning) | No geo infrastructure kind. |
| `vente_terrain` | category (non-zoning) | **⚖ ARBITRAGE:** a sale is only one form of alienation; scope is unproved. |
| `vente_institutionnelle` | category (non-zoning) | **⚖ ARBITRAGE:** same alienation gap; institutional sale is narrower. |
| `avis_motion` | étape | No geo notice-of-motion kind. |
| `second_projet` | étape | No geo second-draft kind; generic `projet-reglement` does not prove this stage. |
| `adoption` | étape | No geo adoption kind. |
| `inconnu` | étape | Unknown is not equivalent to geo catch-all `autre`. |

The raw-only `ZONAGE_CATEGORIES` value `contrainte_reglementaire` and all four `NON_ZONAGE_CATEGORIES` remain explicit gaps above. The four autonomous-instrument `ETAPE_ENUM` values remain valid ontology steps but are not crosswalk step targets. Exact coded synonyms are covered, but **⚖ ARBITRAGE RÉSOLU:** `modification_reglementaire → modification_zonage → changement-de-zonage`, while the distinct observed spelling `modification_reglementation → autre → UNMAPPED`.

Every geo recall-gate reference whose required canonical axis has a gap remains a false negative unless another independently valid mapped axis applies to that same exact identity. Gaps stay in the **85-DesignationEvent recall denominator**; the crosswalk alone cannot assert success beyond the measured 81/85.

### Observed DesignationEvent HORS-MAP assumptions

Upstream jointures evidence `6fcd5f9d` reports the only HORS-MAP records among **85** DesignationEvent references; none is silently dropped:

| Raw immo category | Count | Contract outcome |
|---|---:|---|
| `piia` | 3 | UNMAPPED: geo has no PIIA kind, and PIIA ≠ PPCMOI. |
| `modification_reglementation` | 1 | UNMAPPED: not a coded synonym; `canonicalGeoCategory` returns `autre`. |

The honest mapped ceiling is therefore **69 (`changement-de-zonage`) + 9 (`derogation-mineure`) + 2 (`ppcmoi`) + 1 (`cptaq`) = 81/85 = 95.3%**. **OPEN (outside this frozen crosswalk):** adding the `-ation` variant to immo `SYNONYMS` would yield `modification_zonage`, hence `changement-de-zonage`, and **82/85**; that is a separate immo-canon change requiring its own acceptance gate.

## 6. Anti-gaming guardrails

1. **PIIA ≠ PPCMOI.** PIIA is a plan d'implantation et d'intégration architecturale; PPCMOI is a projet particulier de construction, de modification ou d'occupation d'un immeuble. They MUST NEVER map to each other. Immo code also branches them separately at `vivier-v2.ts:482-483`.
2. Match all three identity fields exactly before consulting this table. The table relaxes type only and is not a fuzzy matcher.
3. Category canonicalization is exactly the coded `trim().toLowerCase()`, known-id lookup, then eight substitutions from `SYNONYMS` at `geo-category-mapping.ts:214-224`; the enclosing `canonicalGeoCategory` function is at `geo-category-mapping.ts:208-225`, and unknown becomes `autre`. Do not add any other normalization or infer mappings from a topic, institution, or resemblance.
4. `UNMAPPED` means an empty target set, not fallback to `autre`, `inconnu`, a nearest label, or free text.
5. Report unmatched records and counts. Never drop, relabel, duplicate across axes, or post-hoc tune them to pass 95%.
6. Consumer validation MUST enforce the exact 10-key set and allowed status/axis/cardinality enums; mapped rows require non-null axis/cardinality and targets, unmapped rows require empty targets and null axis/cardinality; targets must be unique and belong to that axis vocabulary; `1↔1` requires one target and `1↔n` more than one. Reject every violation.

## 6.1. Immo consumer obligations (application) — Obligations du consommateur immo (application)

An immo application that consumes this crosswalk to derive DesignationEvents from neutral geo events MUST submit to its acceptance gate: (i) the exhaustive list of derived DesignationEvents; and (ii) per event, evidence exposing the exactly aligned `source_url` and `date`. The exact `municipality` identity rule in §1 remains mandatory.

The acceptance gate is asymmetric and blocking: outgoing `bprime`/`precoce` losses MUST equal **0** (anti-loss), and incoming HARD false positives MUST equal **0**. Every derived incoming event without exact URL+date proof is blocking.

The application PR MUST provide that list and per-event proof, not only the 7,221-node replay. This obligation frames the future extraction/application lot; it is descriptive and changes neither the mapping table, the 81/85 ceiling, nor upstream evidence SHA `6fcd5f9d`.

## 7. Traceability

| Claim | Authoritative location |
|---|---|
| Geo `ZoningEventType`, 10 exhaustive values | Upstream geo `acquisition/src/zoning-events-emit.ts:38-48`, supplied verbatim by geo lane; file absent from this checkout |
| Canonical immo category ids, 14 + `autre` | `packages/radar-domain/src/geo/geo-category-mapping.ts:92-188` |
| Closed category synonyms and unknown fallback | `SYNONYMS` at `packages/radar-domain/src/geo/geo-category-mapping.ts:214-224`; `canonicalGeoCategory` at `packages/radar-domain/src/geo/geo-category-mapping.ts:208-225` |
| Real category counts (2,634 Signals) | `packages/radar-domain/src/geo/geo-category-mapping.ts:27-36` |
| Observed HORS-MAP spelling/counts (85 DesignationEvents) | Upstream jointures evidence `6fcd5f9d`, supplied by the geo lane; source absent from this checkout |
| Canonical anticipation/step axis | `packages/radar-domain/src/geo/geo-category-mapping.ts:264-281` |
| Immo zoning categories, 15 values | `api/src/services/graph/graph-store.ts:1094-1110` |
| Category inclusion/exclusion semantics | `api/src/services/graph/graph-store.ts:1062-1089` |
| Immo non-zoning categories, 4 values | `api/src/services/graph/vivier-v2.ts:91-96` |
| Immo step enum, pipeline/autonomous semantics, 11 values | `radar/ontology/graphify-output-contract.md:552-582,632` |
| Immo instrument clusters and PIIA/PPCMOI separation | `api/src/services/graph/vivier-v2.ts:470-494` |
| Exact identity and type-only relaxation | Normative geo-lane joining invariant supplied with this contract request; codified in §1 and §6 |
| Immo application evidence and asymmetric acceptance gate | Normative consumer obligation supplied with this contract request; codified in §6.1 |
| Machine-readable mapping | `docs/spec/crosswalk-taxonomie.json` (must remain semantically identical to §4) |
