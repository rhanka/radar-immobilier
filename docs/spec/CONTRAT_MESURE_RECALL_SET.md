# Canonical SET-RECALL measurement contract for geo↔immo zoning events

> **Terminology.** "SET-RECALL", "KPI-20 recall", "directional recall immo→geo",
> and geo's "STEVE" metric all name **the same measure** defined here:
> `recall = Σ_g min(immo_count[g], geo_count[g]) / 85`. The canonical title stays
> "SET-RECALL"; downstream may use any of the synonyms.

## 0. Status and scope

**Status: CANONICAL — amended (rev 2, owner GO Option A).** This document is the
single canonical definition of the KPI-20 recall measure for geo↔immo
`zoning-events`. Geo consumes it to measure recall; immo consumes the resulting
measure to interpret the cutover. This revision **supersedes the frozen commit
`2335a7d`** and must be re-cited at its new commit SHA by every downstream
document (geo-side `SPEC_RECALL_MATCHING.md`, recette).

**Amendment delta (owner GO Option A, routed by the conductor)** — three changes,
nothing else:

1. **The gated METRIC is the directional recall immo→geo (geo's STEVE metric); the
   symmetric precision is REMOVED as a gate term.** The amendment changes *which
   metric the gate reads* (directional recall, not symmetric precision — see §4),
   **not** the acceptance threshold. The **threshold is unchanged**: `≥ 95 %`
   (`≥ 81/85` matched), defined by crosswalk `b9c121d` §1, which this contract
   **consumes and does not amend** (§2). The recall formula itself is also
   unchanged — it was already directional (denominator = the 85 immo events).
2. **Recall-side N-A guard (§5, owner requirement).** A muni with 0 reference
   events is **N-A only if scraped to demonstrated completeness**; a non-scraped
   0 is a **GAP (UNKNOWN)**, never N-A. Prevents the fabricated N-A (owner-forbidden).
3. **`date_iso` identity semantics (§1.1).** `date_iso` = the **decisional/séance
   date** the document attests, not the PV transcription date. Reconciliation
   rule specified; **no date window introduced** (crosswalk `b9c121d` §1 stays
   exact).

This contract is separate from both the taxonomy crosswalk and the B′ contract.
It MUST NOT redefine either one. It consumes the frozen crosswalk at commit
`b9c121d` (`docs/spec/CROSSWALK_TAXONOMIE_GEO_IMMO.md` and
`docs/spec/crosswalk-taxonomie.json`) for the comparable neutral geo type **and
for the acceptance threshold** (`b9c121d` §1). **This amendment does not touch
crosswalk `b9c121d`** — §1's `date_iso` clause specifies which date the existing
`date` field carries; it does not relax b9c121d's exactness or introduce a window.

**OPEN (owner):** whether the `≥ 95 %` threshold should be revisited now that the
gate metric is framed as directional recall is an **owner decision**; this
contract does **not** change the threshold and does not presume it will change.

The normative terms **MUST**, **MUST NOT**, and **ALWAYS** are acceptance requirements.

## 1. Exact identity key and `crosswalked_type`

For every matchable event, the ordered grouping key is:

```text
key(event) = (muni, source_url_norm, date_iso, crosswalked_type)
```

The identity portion is exactly `(muni, source_url_norm, date_iso)`. All three
serialized values MUST be present and equal. The matcher MUST NOT alias or
case-fold municipalities, follow or rewrite URLs, apply date windows, infer
missing values, or use fuzzy/text/entity matching.

`source_url_norm` is the document identity: the normalized form of the event
`source_url` (aligned with `immo.source_url`). **Both geo and immo MUST produce
`source_url_norm` by applying EXACTLY the normalization below, then compare the
results by exact string equality.** Any deviation diverges the measure. It MUST
NOT substitute `docSha`. Thus `doc` means `source_url_norm` combined with `muni`
and `date_iso`, not a document hash.

Normalization is the geo/jointures harness function `normalizeSourceUrl` (the
authoritative implementation and its definitive file:line + harness SHA are
pinned in §8; the seven rules below are the stable behavioural spec):

1. `trim`; empty string → `null`.
2. `new URL(s)`; parse failure → `null` (absolute URL required).
3. hostname → lowercase. NO `www` strip; NO http→https; scheme and port unchanged.
4. pathname: strip trailing slashes (`/\/+$/`) only when its length > 1.
5. query: drop every param whose lowercased name starts with `utm_` OR is in `VOLATILE` = {`fbclid`, `gclid`, `mc_cid`, `mc_eid`, `_ga`, `_gl`, `ref`, `source`, `download`, `cache`, `timestamp`, `ts`}; sort the remaining params by (name, then value) and re-append them.
6. fragment (`#…`): kept, not stripped.
7. return `url.toString()`; the match is exact string equality of this value.

This is the measurement-field spelling of the crosswalk `b9c121d` §1 identity `(municipality, source_url, date)`: identity remains exact and only type is relaxed.

### 1.1 `date_iso` semantics: decisional (séance) date, PV reconciled, no window

`date_iso` is the ISO date of the **decisional event the source document attests
— the council session / décision (séance) date**. It is **NOT** the document's
transcription or publication date (the procès-verbal date). Both geo and immo
MUST populate `date_iso` from this same decisional anchor.

- **Known divergence:** immo has historically keyed on the **PV date**, while geo
  is understood to key on the **séance date** (to be confirmed by the geo lane —
  see the OPEN dependency below). When they differ, the identity fails on an
  otherwise-identical event (same `muni`, same `source_url_norm`), and the event
  is lost to recall even though both sides describe the same decision. Observed:
  Sutton — **1 of 3 events** lost to exactly this PV-vs-séance date gap.
- **Reconciliation rule (canonical):** the side carrying a PV date **MUST
  reconcile it to the séance date the PV documents** before forming the key. The
  match then stays **exact equality on the canonicalized séance date** — **no
  date window, no tolerance** is introduced (consistent with crosswalk `b9c121d`
  §1 "MUST NOT use date windows"). Reconciliation happens **producer-side, before
  key formation**; the matcher itself never infers a missing value.
- **Honesty guard:** where the séance date is genuinely unrecoverable on one
  side, that event's cross-match identity is **incomplete** → it stays in the
  recall denominator as an **honest gap** and MUST NOT be force-matched by
  widening the date or aliasing. A recovered séance date is a real fix; a widened
  window is gaming and is forbidden.
- **Implementation dependency (OPEN, for immo-extraction + geo-jointures to
  confirm):** immo must be able to map PV→séance date, and geo must expose the
  séance date it keys on. The *rule* is canonical here; the *capability* to
  populate it on each side is a lane confirmation, not an assumption of this
  contract.

`crosswalked_type` is derived as follows:

- immo: `reverse-map(canonicalGeoCategory(immo.kind))` through crosswalk `b9c121d`, yielding the authorized neutral geo type;
- geo: the emitted neutral geo type;
- `UNMAPPED`: no matchable key is emitted. This includes, among others, immo `piia`, immo `modification_reglementation` (canonicalized to `autre`), geo `autre`, and every other gap declared by the crosswalk.

An event with an incomplete exact identity or an `UNMAPPED` type cannot join any group. An immo event in either case nevertheless remains in the fixed recall denominator.

## 2. Directional recall immo→geo (STEVE): multiset, grouped, min-based

The KPI-20 measure is the **directional recall immo→geo** — geo's **STEVE**
metric. "Directional" means the denominator is the immo reference set (the 85
DesignationEvents); the measure asks *how many of immo's real events geo also
emits*, never the reverse. Let `G` be the union of distinct matchable immo keys
and distinct matchable geo keys. For every `g ∈ G`, an absent-side count is zero:

```text
immo_count[g] = number of immo events with key g
geo_count[g]  = number of geo events with key g
matched[g]    = min(immo_count[g], geo_count[g])

recall = (Σ_g matched[g]) / 85          # directional immo→geo, 85 = immo denominator
```

This is multiset recall: duplicate events contribute through their multiplicity,
but each group contribution is capped by the number of real immo events in that
group. It is not a set-presence score and not a Cartesian `N × M` score. Because
`matched[g] = min(immo_count[g], geo_count[g]) ≤ immo_count[g]`, **geo
over-emission can never inflate this recall** — the directionality is
self-bounding, which is precisely why the gate needs the recall alone and not a
symmetric precision term (§4).

**Acceptance threshold (unchanged, from crosswalk `b9c121d` §1).** The gate passes
at **`recall ≥ 95 %`**, operationalized as **`≥ 81/85` matched**. This threshold
is defined by `b9c121d` §1 (consumed here, not amended). The amendment makes the
**directional recall** the gated metric; it does **not** move this threshold.

**Current measured value (record — this is a measurement, NOT a passing state).**
At geo emission SHA `a5c0cf41`, the STEVE directional recall is
**70 / 85 = 82.35 %**. This is **BELOW** the `≥ 95 %` threshold — a **gap to
close**, not a green state. The **honest ceiling is 81 / 85 = 95.29 %** (the four
`UNMAPPED` immo events, §3 guardrail 3). The **11-event gap between the current
measure and the ceiling** (`81 − 70`) is recall lost to identity-key divergences
(the §1.1 PV-vs-séance date gap among them) and to groups geo does not yet emit —
it is recoverable by fixing emission and by the §1.1 date reconciliation, **never**
by shrinking the denominator or relaxing identity.

Illustrative constructed sample (to expose the arithmetic, not an observed breakdown):

| Group | `immo_count` | `geo_count` | `matched` | `over_split` |
|---|---:|---:|---:|---:|
| `g₁` | 50 | 990 | 50 | 940 |
| `g₂` | 31 | 31 | 31 | 0 |
| `UNMAPPED` immo events (no group) | 4 | — | 0 | — |

The numerator is `50 + 31 = 81`; recall is `81 / 85 = 95.29 %`. The 940 excess geo events do not increase or decrease recall.

## 3. Anti-gaming guardrails

1. **Bounded matching:** `matched[g] ≤ immo_count[g]` ALWAYS, because `matched[g]` is the minimum. No group can count beyond the real immo events present.
2. **Fixed denominator:** the denominator is ALWAYS the full **85 DesignationEvents** from immo. No reference event may be removed, reweighted, artificially copied, or force-mapped to raise recall. Distinct real events sharing one key retain their multiset multiplicity.
3. **Honest unmapped ceiling:** the four known `UNMAPPED` immo events remain in the denominator and contribute zero to the numerator. Under crosswalk `b9c121d`, the maximum honest recall is therefore `81 / 85 = 95.29 %`.
4. **Exact identity:** SET-RECALL relaxes uniqueness by counting a multiset; it does not relax identity. Any difference in `muni`, `source_url_norm`, or `date_iso` creates a different group and cannot match. §1.1 canonicalizes *which* date `date_iso` carries (séance, not PV) but keeps the equality exact.
5. **Symmetric precision is NOT a gate.** Geo over-split is never a way to *increase* recall (guardrail 1 already bounds it), and — per owner GO Option A — it is **not gated as a precision penalty either**: the symmetric precision (§4) conflates immo's structural under-emission with a fake geo defect, so it MUST NOT block the cutover. The only correctness gate on geo emission is the **incoming-HARD zero-false-positive** gate (§4), which is a *fabrication* check, not a *symmetry* check, and is preserved.

The implementation MUST expose per-group `immo_count`, `geo_count`, and `matched`, plus the summed numerator, so every bound and the fixed denominator are auditable.

## 4. Precision: reported for transparency, NOT gated

The **symmetric precision is removed from the acceptance gate** (owner GO Option
A). It is still **computed and reported** for transparency, but it MUST NOT block
the cutover and MUST NOT be "ground down." It is defined as:

```text
precision = (Σ_g matched[g]) / total_geo_events
over_split[g] = geo_count[g] - matched[g]
```

`total_geo_events` is the count of **all** geo events emitted in the evaluated
corpus before key, identity, or type filtering. It includes geo events with
`UNMAPPED` types or incomplete identities; such events lower the reported
precision and **can never be discarded to inflate it**.

**Why symmetric precision does not grade geo (rationale, sourced geo):** immo
emits **one event per acte**; geo emits the **whole regulatory cycle** (one event
per `règlement × étape`). Geo therefore legitimately emits many more events than
immo for the same decision, so `Σmatched/total_geo` is **structurally low by
design** — it measures immo's emission granularity, **not a geo fault**. As an
illustration of the asymmetry, at jointures harness SHA `c5b855c2` the symmetric
precision was **6.58 %** with **over_split ≈ 1042**; this over-split is a **decoy**
(a recall↔precision Pareto artifact) and MUST NOT be optimized against.

**⚠ Snapshot coherence (do not read as a coherent pair).** The recall
`70/85 @ a5c0cf41` and the precision `6.58 % / over_split 1042 @ c5b855c2` come
from **two different geo snapshots** (different emission states; the 6.58 %/1042
figures are not the precision of the `a5c0cf41` recall run — they imply a
different `matched`). Because symmetric precision is de-gated, this incoherence
does **not** affect the gate, but it MUST be labeled as such and never presented
as one measurement. **For the coherent reported pair, geo MUST supply the
precision and `over_split` measured at the SAME emission SHA as the gated recall
(`a5c0cf41`).**

**Distinct and preserved — the incoming-HARD zero-FP correctness gate.** Separate
from symmetric precision, the acceptance recipe still requires **0 false
positives** on incoming HARD-classified geo events before serving. This is a
*fabrication* gate (a geo event that describes a decision that did not happen),
**not** the symmetric-precision term removed above. It MAY block serving, but it
MUST NOT alter recall's numerator, denominator, identity, type mapping, or
grouping. Removing symmetric precision from the gate does **not** remove this
zero-FP gate.

**Reporting rule (revised).** The **gate is the directional recall** (§2) against
the unchanged `≥ 95 %` threshold. Every recall figure MUST still be reported
**together with** its symmetric precision and per-group `over_split` **at the same
emission SHA**, as context — so the asymmetry stays auditable (the original WP6
anti-gaming intent: no hiding over-split) — but those context metrics are
explicitly **de-weaponized**: they inform, they do not gate.

## 5. Recall-side N-A guard: 0 events is N-A only when completeness is proven

A muni whose immo reference denominator is **0** (no DesignationEvent of
densification) is **N-A only when its scrape completeness is demonstrated**. This
is the recall-side application of the absence-source attestation contract
(`docs/spec/CONTRAT_ATTESTATION_ABSENCE_SOURCE.md`, `e58285d`) and the N-A
criteria (`docs/spec/CRITERES_PREUVE_NA_KPI_IMMO.md`, `3163877`):

- **N-A PROVEN** ⟺ a reproducible triplet **{source scrapée, date, résultat = 0
  DesignationEvent de densification}** on a muni **scraped to demonstrated
  completeness**. The 0 is then a *proven legitimate absence*.
- **GAP (UNKNOWN)** ⟺ 0 events on a muni **not** scraped to completeness. An
  un-scraped or partially-scraped 0 is *absence of evidence*, not evidence of
  absence. It MUST remain **UNKNOWN** and MUST NOT be relabelled N-A.
- **Anti-fabrication (owner-forbidden):** "no densification event found in our
  pipeline" is **never** by itself an N-A. Only completeness-demonstrated scrape
  converts a 0 into N-A. This is the central guard against the fabricated N-A.

This guard governs how a **null immo denominator** is interpreted; it does not
change the recall arithmetic of §2. A muni with 0 immo events simply **contributes
no event to the fixed 85-event denominator** (it neither raises nor lowers the
numerator); its palier cell is COMPLET / N-A / UNKNOWN per the rule above.

## 6. Why null `zone_ref` is not a recall problem

`zone_ref` is null for **72 of the 85** immo DesignationEvents. It is not a key field and is not consulted by this measure.

For one exact `(muni, source_url_norm, date_iso, crosswalked_type)` group containing `N` immo events and `M` geo events, the contribution is `min(N, M)`. The measure does not disambiguate by zone, does not require one-to-one-per-zone pairing, and never counts `N × M`. Null, equal, or different `zone_ref` values therefore have no effect on SET-RECALL.

## 7. Provenance

The geo/jointures lane supplied the following authoritative formula verbatim; the
committed jointures implementation reproducing it is pinned in §8:

```text
SET-RECALL (multiset, directionnel immo→geo) :
  key(event) = (muni, source_url_norm, date_iso, crosswalked_type)
  crosswalked_type : immo = reverse-map(canonicalGeoCategory(immo.kind)) via crosswalk b9c121d → type geo neutre ; geo = type neutre émis. UNMAPPED (piia, modification_reglementation→autre, geo 'autre', etc.) → PAS de key matchable.
  Pour chaque groupe g : immo_count[g], geo_count[g] ; matched[g] = min(immo_count[g], geo_count[g]).
  recall = ( Σ_g matched[g] ) / 85
```

Figures and their SHAs — note the two SHAs play **different roles** and are **not
the same snapshot**:

| Metric | Value | SHA (role) | Gate role |
|---|---|---|---|
| acceptance threshold | `≥ 95 %` (`≥ 81/85`) | crosswalk `b9c121d` §1 (consumed) | **the threshold** |
| STEVE directional recall immo→geo | **70 / 85 = 82.35 %** | `a5c0cf41` (geo **emission/measurement** SHA) | **gated metric — current measured value, BELOW threshold** |
| honest ceiling (4 `UNMAPPED`) | 81 / 85 = 95.29 % | — | max achievable |
| symmetric precision `Σmatched/total_geo` | 6.58 % (earlier snapshot) | `c5b855c2` (jointures **implementation** harness SHA) | reported context, **NOT gated**; re-measure at `a5c0cf41` for the coherent pair |
| over_split | ≈ 1042 (earlier snapshot) | `c5b855c2` | reported context (decoy), **NOT gated** |

Type semantics come exclusively from crosswalk commit `b9c121d689aede3574086f1fbfef1351e9ecd903`. This document does not amend that crosswalk or B′.

The geo-side implementation and measurement reference is `docs/spec/SPEC_RECALL_MATCHING.md` (geo WP6, geo-archi), which cites this contract's commit. That geo-side document is a reference and implementation aid; it is **not** a competing canonical definition. This contract is the single canonical KPI-20 recall authority; any change requires a new reviewed revision here. **Downstream re-cite:** the geo-side reference and recette MUST re-point from `2335a7d` to this revision's new commit SHA.

## 8. Traceability and conformance vectors

| Contract claim | Authority / verification |
|---|---|
| Directional recall immo→geo; 85 immo denominator; self-bounding | §2; guardrail 1 in §3 |
| Acceptance threshold `≥ 95 %` (`≥ 81/85`) unchanged; from `b9c121d` §1 | Crosswalk `b9c121d` §1; §0 delta 1, §2 |
| STEVE current measure 70/85 = 82.35 % @ geo `a5c0cf41` is BELOW threshold; ceiling 81/85 | Geo/jointures answers (owner GO Option A); §2, §7 |
| Symmetric precision (6.58 % @ `c5b855c2`, earlier snapshot) de-gated; over_split 1042 a decoy; not the `a5c0cf41` pair | Owner GO Option A rationale; §4 (snapshot-coherence note) |
| incoming-HARD zero-FP correctness gate preserved (distinct from precision) | §4; crosswalk `b9c121d` §6.1 |
| `date_iso` = séance date, PV reconciled producer-side, no window (Sutton 1/3) | §1.1; crosswalk `b9c121d` §1 (exact, no window) |
| Recall-side N-A only on completeness-proven scrape; else GAP | §5; attestation `e58285d`; N-A criteria `3163877` |
| Exact `(muni, URL, date)` identity; type-only relaxation | Crosswalk `b9c121d`, §1; geo/jointures formula in §7 |
| Reverse-mapped neutral type and explicit gaps | Crosswalk `b9c121d`, §§4–5 and machine contract |
| Fixed denominator 85; four `UNMAPPED`; ceiling 81/85 | Geo/jointures answers; crosswalk `b9c121d`, §§0, 5, and 6 |
| Multiset counts and `min` aggregation | Geo/jointures formula in §7; normative formula in §2 |
| `zone_ref` null for 72/85 and excluded from matching | Geo/jointures answers; normative rule in §6 |
| `source_url_norm` normalization (7 rules) + definitive file:line | Jointures harness SHA `c5b855c2`: `normalizeSourceUrl` at `acquisition/src/zoning-events-recall-gate.ts:491` |
| Jointures implementation SHA + file:line | Harness SHA `c5b855c2` (lane/jointures): `setRecallFor` at `acquisition/src/zoning-events-recall-gate.ts:709` (helpers `setRecallGroupKey:677`, `canonicalizeImmoCategory:466`); `normalizeSourceUrl` at `:491` — implements this formula and the seven normalization rules verbatim |

Minimum conformance vectors:

- same type but one differing identity field → `matched = 0` across the two resulting groups;
- **immo PV date ≠ geo séance date for the same decision → `matched = 0` until reconciled producer-side to the séance date; after reconciliation, exact equality matches (no window used)**;
- one exact group with `immo_count = 2`, `geo_count = 5` → `matched = 2`, `over_split = 3`, and this over_split **does not lower the gate** (reported only);
- one geo-only matchable group with `immo_count = 0`, `geo_count = 3` → `matched = 0`, `over_split = 3`, group retained in the audit;
- one geo event with an `UNMAPPED` type or incomplete identity → no matchable group, but `total_geo_events` increases by one (lowers reported precision, never the gate);
- one `UNMAPPED` immo event → no matchable group, numerator unchanged, denominator still 85;
- **a muni with 0 immo densification events and NO completeness-proven scrape → UNKNOWN (GAP), never N-A; with the {source, date, 0-result} triplet on a completeness-proven scrape → N-A**;
- a current measured recall of `70/85 = 82.35 %` → **below** the `≥ 95 %` threshold: reported as a gap, never as a passing gate;
- same exact key with null or differing `zone_ref` values → counts unchanged;
- same `docSha` with different `source_url_norm`, or different `docSha` with the same exact key → only the URL-based exact key controls matching;
- all 81 matchable immo events covered, regardless of geo over-split → recall `81/85 = 95.29 %`, never above it.
