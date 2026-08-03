# Canonical SET-RECALL measurement contract for geo↔immo zoning events

## 0. Status and scope

**Status: FROZEN shared measurement contract.** This document is the canonical definition of SET-RECALL for geo↔immo `zoning-events`. Geo consumes it to measure recall; immo consumes the resulting measure to interpret the cutover.

This contract is separate from both the taxonomy crosswalk and the B′ contract. It MUST NOT redefine either one. It consumes the frozen crosswalk at commit `b9c121d` (`docs/spec/CROSSWALK_TAXONOMIE_GEO_IMMO.md` and `docs/spec/crosswalk-taxonomie.json`) only to derive the comparable neutral geo type.

The normative terms **MUST**, **MUST NOT**, and **ALWAYS** are acceptance requirements.

## 1. Exact identity key and `crosswalked_type`

For every matchable event, the ordered grouping key is:

```text
key(event) = (muni, source_url_norm, date_iso, crosswalked_type)
```

The identity portion is exactly `(muni, source_url_norm, date_iso)`. All three serialized values MUST be present and equal. The matcher MUST NOT alias or case-fold municipalities, follow or rewrite URLs, apply date windows, infer missing values, or use fuzzy/text/entity matching.

`source_url_norm` is the document identity: an upstream-prepared normalized URL aligned with `immo.source_url`. The measure compares that value exactly and performs no further normalization. It MUST NOT substitute `docSha`. Thus `doc` means `source_url_norm` combined with `muni` and `date_iso`, not a document hash.

This is the measurement-field spelling of the crosswalk `b9c121d` §1 identity `(municipality, source_url, date)`: identity remains exact and only type is relaxed.

`crosswalked_type` is derived as follows:

- immo: `reverse-map(canonicalGeoCategory(immo.kind))` through crosswalk `b9c121d`, yielding the authorized neutral geo type;
- geo: the emitted neutral geo type;
- `UNMAPPED`: no matchable key is emitted. This includes, among others, immo `piia`, immo `modification_reglementation` (canonicalized to `autre`), geo `autre`, and every other gap declared by the crosswalk.

An event with an incomplete exact identity or an `UNMAPPED` type cannot join any group. An immo event in either case nevertheless remains in the fixed recall denominator.

## 2. SET-RECALL formula: multiset, grouped, min-based

Let `G` be the union of distinct matchable immo keys and distinct matchable geo keys. For every `g ∈ G`, an absent-side count is zero:

```text
immo_count[g] = number of immo events with key g
geo_count[g]  = number of geo events with key g
matched[g]    = min(immo_count[g], geo_count[g])

recall = (Σ_g matched[g]) / 85
```

This is multiset recall: duplicate events contribute through their multiplicity, but each group contribution is capped by the number of real immo events in that group. It is not a set-presence score and not a Cartesian `N × M` score.

Illustrative complete sample (constructed to expose the arithmetic, not an observed breakdown):

| Group | `immo_count` | `geo_count` | `matched` | `over_split` |
|---|---:|---:|---:|---:|
| `g₁` | 50 | 990 | 50 | 940 |
| `g₂` | 31 | 31 | 31 | 0 |
| `UNMAPPED` immo events (no group) | 4 | — | 0 | — |

The numerator is `50 + 31 = 81`; recall is `81 / 85 = 95.3%`. The 940 excess geo events do not increase or decrease recall.

## 3. Anti-gaming guardrails

1. **Bounded matching:** `matched[g] ≤ immo_count[g]` ALWAYS, because `matched[g]` is the minimum. No group can count beyond the real immo events present.
2. **Fixed denominator:** the denominator is ALWAYS the full **85 DesignationEvents** from immo. No reference event may be removed, reweighted, artificially copied, or force-mapped to raise recall. Distinct real events sharing one key retain their multiset multiplicity.
3. **Honest unmapped ceiling:** the four known `UNMAPPED` immo events remain in the denominator and contribute zero to the numerator. Under crosswalk `b9c121d`, the maximum honest recall is therefore `81 / 85 = 95.3%`.
4. **Exact identity:** SET-RECALL relaxes uniqueness by counting a multiset; it does not relax identity. Any difference in `muni`, `source_url_norm`, or `date_iso` creates a different group and cannot match.
5. **Separate precision gate:** geo over-split is never a way to increase recall. Precision is measured and gated independently as specified in §4.

The implementation MUST expose per-group `immo_count`, `geo_count`, and `matched`, plus the summed numerator, so every bound and the fixed denominator are auditable.

## 4. Precision is separate

Precision is not part of SET-RECALL. It is defined independently:

```text
precision = (Σ_g matched[g]) / total_geo_events
over_split[g] = geo_count[g] - matched[g]
```

`total_geo_events` is the count of **all** geo events emitted in the evaluated corpus before key, identity, or type filtering. It includes geo events with `UNMAPPED` types or incomplete identities. Such events create no matchable group but still lower precision; they can never be discarded to inflate it.

In the constructed §2 example, precision is `81 / 1021 = 7.93%`, while recall remains `81 / 85 = 95.3%`; `over_split[g₁] = 940`. This deliberately shows that severe over-split can coexist with high recall and MUST NOT be hidden inside the recall score.

Precision is gated separately by the acceptance recipe before serving: incoming HARD events require **0 false positives**. This gate may block serving, but it MUST NOT alter recall's numerator, denominator, identity, type mapping, or grouping.

**Recall and precision MUST be reported together.** The evaluation MUST NEVER surface recall alone; every recall figure MUST be accompanied by its precision and per-group `over_split`, so that geo over-split can never be hidden by omission (WP6 anti-gaming requirement, geo-archi).

## 5. Why null `zone_ref` is not a recall problem

`zone_ref` is null for **72 of the 85** immo DesignationEvents. It is not a key field and is not consulted by this measure.

For one exact `(muni, source_url_norm, date_iso, crosswalked_type)` group containing `N` immo events and `M` geo events, the contribution is `min(N, M)`. The measure does not disambiguate by zone, does not require one-to-one-per-zone pairing, and never counts `N × M`. Null, equal, or different `zone_ref` values therefore have no effect on SET-RECALL.

## 6. Provenance

The geo/jointures lane supplied the following authoritative formula verbatim. Its harness is not present in this checkout; the committed jointures implementation is expected to reproduce it, with file:line and SHA still **TBD**:

```text
SET-RECALL (multiset) :
  key(event) = (muni, source_url_norm, date_iso, crosswalked_type)
  crosswalked_type : immo = reverse-map(canonicalGeoCategory(immo.kind)) via crosswalk b9c121d → type geo neutre ; geo = type neutre émis. UNMAPPED (piia, modification_reglementation→autre, geo 'autre', etc.) → PAS de key matchable.
  Pour chaque groupe g : immo_count[g], geo_count[g] ; matched[g] = min(immo_count[g], geo_count[g]).
  recall = ( Σ_g matched[g] ) / 85
```

Type semantics come exclusively from crosswalk commit `b9c121d689aede3574086f1fbfef1351e9ecd903`. This document does not amend that crosswalk or B′.

The geo-side implementation and measurement reference is `docs/spec/SPEC_RECALL_MATCHING.md` (geo WP6, geo-archi), which cites this contract's frozen commit. That geo-side document is a reference and implementation aid; it is **not** a competing canonical definition. This contract is the single canonical SET-RECALL measurement authority; any change requires a new reviewed revision here.

## 7. Traceability and conformance vectors

| Contract claim | Authority / verification |
|---|---|
| Exact `(muni, URL, date)` identity; type-only relaxation | Crosswalk `b9c121d`, §1; geo/jointures formula in §6 |
| Reverse-mapped neutral type and explicit gaps | Crosswalk `b9c121d`, §§4–5 and machine contract |
| Fixed denominator 85; four `UNMAPPED`; ceiling 81/85 | Geo/jointures answers; crosswalk `b9c121d`, §§0, 5, and 6 |
| Multiset counts and `min` aggregation | Geo/jointures formula in §6; normative formula in §2 |
| `zone_ref` null for 72/85 and excluded from matching | Geo/jointures answers; normative rule in §5 |
| Precision and incoming-HARD zero-FP gate | Geo/jointures answers; crosswalk `b9c121d`, §6.1 |
| Jointures implementation | **TBD:** committed file:line + SHA to be appended without changing the formula |

Minimum conformance vectors:

- same type but one differing identity field → `matched = 0` across the two resulting groups;
- one exact group with `immo_count = 2`, `geo_count = 5` → `matched = 2`, `over_split = 3`;
- one geo-only matchable group with `immo_count = 0`, `geo_count = 3` → `matched = 0`, `over_split = 3`, group retained in the audit;
- one geo event with an `UNMAPPED` type or incomplete identity → no matchable group, but `total_geo_events` increases by one;
- one `UNMAPPED` immo event → no matchable group, numerator unchanged, denominator still 85;
- same exact key with null or differing `zone_ref` values → counts unchanged;
- same `docSha` with different `source_url_norm`, or different `docSha` with the same exact key → only the URL-based exact key controls matching;
- all 81 matchable immo events covered, regardless of geo over-split → recall `81/85`, never above it.
