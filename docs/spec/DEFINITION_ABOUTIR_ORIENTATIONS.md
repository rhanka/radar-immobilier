# Frozen definition of “ABOUTIR” by orientation

## 0. Status and scope

This frozen companion to the B′ specification gives `geo`, `zones`, and `qa` one
city-level target for orientations #3, #10, and #13. WP8.1 owns the B′ specification,
WP4 reconciliation levels 1/2/3, and WP5 corpus replay and the outgoing budget
(`docs/spec/decision-tracking-structure-v2.md:31-39`).

The frozen replay reference is 7,221 `Signal` + `DesignationEvent` records over a 724-city
baseline; the recorded B′ marker is 6,777 retained records over 720 cities
(`docs/reports/analyse-vivier-b/corpus_contexte.md:1-4`; `plan/BPLEXOCC-BRANCH_fix-bprime-lexique-veto-occurrence.md:30-36,102-106`). The
orientation scorecard is per city on the owner-designated 167-city cohort; the missing
repository-backed cohort manifest is OPEN-1 (§6).

For an orientation, a city is **ABOUTI** if and only if all `(a)`–`(d)` pass. A failed or
unavailable criterion is never inferred from another; the data model keeps
`effet_densifiant` unknown until geo confirms the grid delta
(`docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:8-16`).

## 1. Transverse invariant — served-proof guarantee

1. A proof is **served** only when its reference resolves to archived S3 bytes with a
   recorded SHA-256; an upstream public URL and acquisition date remain provenance, but
   the product never depends on that URL staying alive. Geo already requires a real
   HTTP(S) acquisition source, retrieval time, and SHA-256 before serving a zone
   (`docs/spec/geo-contracts/contrat-jointure-immo-zones-lots.md:225-258,279-282`).
2. The UI performs **no runtime liveness probe**. S3 archival is the availability
   guarantee. If the archived proof cannot be resolved and hash-verified, the datum is
   not served and product copy is **“Non couvert”**; no guessed substitute is allowed
   (`docs/spec/geo-contracts/immo-zone-lot-provenance-api-20260722.md:194-206,389-412`).
3. The neutral, derived product coverage vocabulary is limited to **“Servi”**, **“Partiel”**,
   and **“Non couvert”**. It is not verbatim measurement-report wording, which uses
   **“mappée”**, **“non mappée”**, and **“absente”**. A disjoint zone/grid pair may add
   the neutral explanation **“grille non mappée”**; it never displays an invented norm
   (`docs/reports/coherence-zones-normes-focus30_2026-07.md:3-5,22,68-72`).
4. At the geo boundary, `properties.proof` remains the passthrough
   `immo-feature-proof/v1` envelope. Public payloads use a stable `feature_ref`; raw S3
   keys/URIs, signed URLs, local paths, job IDs, and credentials are never exposed
   (`docs/spec/geo-contracts/contrat-jointure-immo-zones-lots.md:172-198`; `docs/spec/geo-contracts/immo-zone-lot-provenance-api-20260722.md:63-85,194-206`).

## 2. ABOUTIR #3 — zoning rectification + minutes on the 167

The owner-frozen pattern is preserved verbatim below. It operationalizes the Grand
Filet’s PV-centric target and deep `zone → grid → lot` vertical
(`docs/spec/SPEC_REORIENTATION_GRAND_FILET.md:8-24,79-83`).

- **(a) zone géoréférencée / recalée (PDF → georef)** — pass when every zone expected
  for the city in the frozen 167-city receipt is served with geometry derived from a
  declared real source; PDF-derived geometry records `method = georeference`. Missing
  or untraceable geometry fails `(a)`
  (`docs/spec/geo-contracts/contrat-jointure-immo-zones-lots.md:225-258`).
- **(b) preuve de zone SERVIE vivante (URL + SHA archivée S3, JAMAIS morte)** — pass
  only when every zone counted in `(a)` satisfies §1; count hash-valid served proofs
  over expected zones. A dead/missing archive fails `(b)`, regardless of UI state
  (`docs/spec/geo-contracts/contrat-jointure-immo-zones-lots.md:172-198,225-258`).
- **(c) réconciliée au vivier (fold zones + lots)** — pass when every accepted zone is
  folded into the city’s B′ view and its lots carry the recorded zone link; measure
  reconciled zones and lots against the city receipt, with `null` retained rather than
  guessed where no spatial link exists
  (`docs/spec/geo-contracts/contrat-jointure-immo-zones-lots.md:51-80,89-106,133-150`).
- **(d) recette VERTE (rejeu 7221, verdict correct)** — pass when the frozen corpus is
  replayed and the city’s expected/actual verdicts match for all records affected by
  #3, with every outgoing record enumerated. The replay is mandatory; a stable count
  alone is not correctness
  (`plan/BPLEXOCC-BRANCH_fix-bprime-lexique-veto-occurrence.md:102-115,288-299`; `docs/spec/decision-tracking-structure-v2.md:34-38`).

## 3. ABOUTIR #10 — double vintages

- **(a) georef/data — same-vintage zoning and standards grid, dated provenance.** Pass
  when the served zoning dataset and served standards grid identify the same vintage,
  or both identify dates/provenance plus an explicit, testable reconciliation. An
  undocumented or irreconcilable mismatch fails `(a)`; Mont-Tremblant is the canonical
  counterexample (`RA-4xx` zoning versus `RA-1xx` grid)
  (`docs/reports/coherence-zones-normes-focus30_2026-07.md:11-22`;
  `docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:41-46`).
- **(b) live served proof.** Pass only when both datasets satisfy §1 and their dated
  provenance and hashes are in the replay receipt. An unarchived dataset fails `(b)`
  (`docs/spec/geo-contracts/contrat-jointure-immo-zones-lots.md:225-258,279-282`).
- **(c) reconciliation — usable `zone → grid` chain.** Measure real code overlap as
  `|Z ∩ G| / |Z|`, where `Z` is the set of served zoning codes and `G` the set of codes
  carrying served standards. **PROPOSAL P10-T1:** pass at `≥ 50%`, the report’s existing
  “OK” boundary; this threshold is not frozen and remains pending OPEN-2. `|Z| = 0`, an
  absent grid, or 0% overlap cannot pass
  (`docs/reports/coherence-zones-normes-focus30_2026-07.md:3-9,60-66`).
- **(d) green recipe — measured coherence, never a promise.** Replay recomputes `Z`,
  `G`, their intersection, and the ratio from served records. Expected and rendered
  coverage must agree: qualifying data is “Servi”, non-zero sub-threshold data is
  “Partiel”, and absent/disjoint data is “Non couvert” with “grille non mappée” where
  applicable; no norm value is synthesized
  (`docs/reports/coherence-zones-normes-focus30_2026-07.md:3-9,22,60-72`).

## 4. ABOUTIR #13 — signal/zone mapping

- **(a) georef/data — every B′ signal mapped to touched zone(s), with provenance.** Pass
  at `mapped_with_provenance / B′ signals in city = 100%`. Each relation identifies the
  signal, one or more exact public zone references, mapping method, and evidence; no
  nearby-zone substitution is allowed
  (`docs/spec/decision-tracking-structure-v2.md:31-38`;
  `docs/spec/reports/wp3-mapper-recall-2026-06-28.md:27-45,49-65`).
- **(b) live served proof.** Pass only when every mapping’s signal evidence and zone
  reference resolve through §1. The public relation uses `feature_ref`, never an S3 key;
  unresolved proof fails `(b)`
  (`docs/spec/geo-contracts/immo-zone-lot-provenance-api-20260722.md:63-85,194-206`).
- **(c) reconciliation — mapping feeds `effet_densifiant`.** Pass when every mapping is
  consumed by the before/after standards-grid comparison on the touched zone and emits
  `oui`, `non`, or `inconnu` from evidence; the mapper plus two grid vintages are explicit
  prerequisites to this central criterion
  (`docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:10-15,41-46`).
- **(d) green recipe — correct relation, zero silent outgoing records.** Replay compares
  every signal’s expected and actual zone set and verdict. The accounting identity is
  `correct + incorrect + explicit Non couvert = all B′ signals in city`; any omitted
  signal fails `(d)`. An explicit unmapped signal avoids silence but still fails `(a)`
  and `(c)` (`docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:3-4`;
  `docs/spec/reports/wp3-mapper-recall-2026-06-28.md:8-23,310-329`; `docs/spec/decision-tracking-structure-v2.md:34-38`).

## 5. Replay measurement matrix

| Orientation | Criterion | Repository source | City-level replay measurement |
|---|---|---|---|
| #3 | (a) georef | `docs/spec/geo-contracts/contrat-jointure-immo-zones-lots.md:225-258` | expected zones with admitted geometry / expected zones = 100% |
| #3 | (b) proof | `docs/spec/geo-contracts/contrat-jointure-immo-zones-lots.md:172-198,225-258` | hash-valid archived proofs / expected zones = 100% |
| #3 | (c) fold | `docs/spec/geo-contracts/contrat-jointure-immo-zones-lots.md:51-80,89-106` | expected zones and lots reconciled to B′ / expected = 100% |
| #3 | (d) recipe | `plan/BPLEXOCC-BRANCH_fix-bprime-lexique-veto-occurrence.md:102-115,288-299` | expected verdict set = actual verdict set; outgoing ledger exhaustive |
| #10 | (a) vintages | `docs/reports/coherence-zones-normes-focus30_2026-07.md:11-22` | same vintage, or dated provenance plus explicit reconciliation |
| #10 | (b) proof | `docs/spec/geo-contracts/contrat-jointure-immo-zones-lots.md:225-258,279-282` | zoning proof = valid AND grid proof = valid |
| #10 | (c) overlap | `docs/reports/coherence-zones-normes-focus30_2026-07.md:3-9,60-66` | real `|Z ∩ G| / |Z|`; proposed pass `≥ 50%` |
| #10 | (d) recipe | `docs/reports/coherence-zones-normes-focus30_2026-07.md:22,68-72` | recomputed ratio and honest product state/value agree |
| #13 | (a) mapping | `docs/spec/reports/wp3-mapper-recall-2026-06-28.md:27-65` | provenance-backed mapped signals / B′ signals = 100% |
| #13 | (b) proof | `docs/spec/geo-contracts/immo-zone-lot-provenance-api-20260722.md:63-85,194-206` | resolvable mapping proofs / mappings = 100% |
| #13 | (c) delta | `docs/spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md:41-46` | mappings consumed by evidenced before/after delta / mappings = 100% |
| #13 | (d) recipe | `docs/spec/reports/wp3-mapper-recall-2026-06-28.md:8-23,310-329` | expected zone set/verdict match; omitted signals = 0 |

## 6. OPEN — owner decision required

- **OPEN-1 — canonical 167-city cohort:** designate the versioned repository manifest
  (city slugs plus snapshot/hash). The repo anchors 724 baseline cities and 720 at the B′
  marker, but not the membership of the 167-city acceptance cohort
  (`plan/BPLEXOCC-BRANCH_fix-bprime-lexique-veto-occurrence.md:30-36,102-106`).
- **OPEN-2 — #10 overlap threshold:** accept, replace, or complement PROPOSAL P10-T1
  (`≥ 50%`). The only repository-backed boundary is the focus-31 report’s “OK” threshold;
  it yielded 9 OK, 9 partial, 6 served-but-0%-mapped, 5 grid-absent, and 2 zoning-absent
  cities (`docs/reports/coherence-zones-normes-focus30_2026-07.md:7-9,60-66`).
- **OPEN-3 — frozen correctness oracle:** designate the versioned expected per-city
  verdict/mapping fixture for #3(d) and #13(d). Existing receipts prove that replay is
  required but do not define this 167-city oracle
  (`plan/BPLEXOCC-BRANCH_fix-bprime-lexique-veto-occurrence.md:102-115,288-299`).
- **OPEN-4 — ambiguous multi-zone semantics:** decide the expected zone set for a signal
  that names only a street/family or intersects multiple zones. Current evidence measures
  strict designated codes and documents family/sub-zone gaps; it does not freeze that
  owner rule (`docs/spec/reports/wp3-mapper-recall-2026-06-28.md:49-65,206-219`).
