# SPEC — Live geo regulations and norms coverage

Date: 2026-07-14  
Track: `01KXGYVG85VWDB9ES9XVC0X25T` — Lot3b EVOL-VIVIER-V2
## 1. Problem

Geo serves regulation references and normative values that Source coverage did
not expose. Radar must report this evidence without inferring legal
applicability or a densification effect.

## 2. Objective

Expose deterministic, live, per-served-zone coverage for regulation sources,
normative values, legacy norms, and grid PDFs in the existing Source layer.

## 3. Non-goals

- Do not compute or display `effet_densifiant` from these fields.
- Do not scrape or interpret municipal regulations in Radar.
- Do not change core PV/signals/zoning/lots coverage semantics.
- Do not add a separate regulations column.

## 4. Counting unit

The unit is one zoning feature returned by `qc-zonage-<city>`. Duplicate zone
codes remain distinct served features. Each counter increments at most once per
served feature. Auxiliary `qc-zonage-norms-<city>` duplicates contribute
existential evidence to every matching served feature.

Matching uses only an explicit recognized zone-code property, normalized with
the existing zone-code normalizer. Feature IDs are never a join fallback.
Implementation must preaggregate auxiliary evidence flags by normalized code in
`O(zoning + auxiliary)` time.

## 5. Exact allowlists

```ts
export const REGLEMENT_KEYS = [
  "reglement_url",
  "reglement_numero",
  "reglement_millesime",
  "reglement_page_source",
  "Reglement",
  "REGLEMENT",
  "url_reglement",
  "URL_REGLEMENT",
] as const;

export const NORMATIVE_VALUE_KEYS = [
  "densite_value",
  "hauteur_min_value",
  "hauteur_max_value",
  "frontage_min_value",
  "superficie_min_value",
  "marge_avant_min_value",
  "marge_laterale_min_value",
  "marge_arriere_min_value",
] as const;
```

No other regulation alias is recognized. Valid evidence is a finite number, a
non-empty trimmed string, or at least one valid array item. Booleans, objects,
empty strings, and non-finite numbers are absent.

## 6. Counters and wire fields

Lazy success and warm bulk `normes` expose:

```ts
{
  zoneCount: number;
  numberMatched: number | null;
  complete: boolean;
  zonesWithGrille: number;
  zonesWithReglement: number;
  zonesWithLegacyNormes: number;
  zonesWithNormativeValues: number;
  covered: number;
  state: "absent" | "declared" | "verified";
}
```

`covered` is the per-feature union of the four evidence predicates and never
exceeds `zoneCount`. `numberMatched` refers only to the zoning collection; no
auxiliary matched counter is added to the wire contract.

## 7. Completeness and errors

`numberMatched` is valid only when it is a finite non-negative integer.
Invalid, fractional, negative, infinite, or absent values normalize to `null`.
For a requested limit `L`:

- valid `numberMatched <= features.length` means the page is complete;
- valid `numberMatched > features.length` means it is incomplete;
- null with `features.length < L` means it is complete;
- null with `features.length >= L` means it is incomplete.

Overall completeness requires both zoning and auxiliary pages to be complete.
A zoning 404 short-circuits auxiliary loading and returns a complete zero-zone
business result. Missing/malformed `features` or invalid JSON returns
`available:false, error:"invalid-response"`. Fetch rejection or non-success
HTTP returns `available:false, error:"geo-unreachable"`.

## 8. State and cache semantics

- `verified`: complete, non-empty zoning, and every served feature is covered.
- `declared`: some but not all features are covered, or any page is incomplete.
- `absent`: complete measurement with no recognized evidence.
- `available:false`: technical failure, never business absence.

Bulk cold state is `measured:false, available:null` and displays `Non mesuré`.
Warm success carries every field in §6. Cached failure is `measured:true,
available:false` and displays `Indisponible`. Success and failure caches use the
same finite-size discipline and TTL-based freshness.

## 9. Source UI and accessibility

The single existing column and scorecard row are named `Règlements & normes`.
A measured Console cell is a keyboard-operable control. Enter or Space reveals
an accessible description containing all four `X/Y` counters and:

`Ne qualifie pas l'effet densifiant ; delta ancien↔nouveau requis.`

The Console updates immediately when the selected scorecard resolves its lazy
success or failure. It must never show `Non mesuré` beside a resolved scorecard.
Loading uses the accessible label `En cours`. An incomplete result displays the
generic wording `Mesure geo incomplète`, because incompleteness may originate
from the auxiliary page while `numberMatched` describes zoning only.

## 10. Test acceptance

Focused API tests cover exact allowlists, duplicate existential evidence,
linear preaggregation behavior, page completeness, normalized matched counts,
wire errors, bounded failure caching, and warm bulk propagation. Component
tests cover keyboard access, detailed descriptions, cold-to-success/failure
transitions, auxiliary truncation wording, and no `Densifie` claim.

The exhaustive browser state matrix is deferred because `make test-e2e` is a
placeholder. Focused unit/component coverage is required in this lot.

## 11. Final MVP scope

Lot3b includes the lazy Source measurement, its warm bulk projection, the
existing Console cell, the scorecard row, and focused API/UI tests described
above. `verified` attests only that recognized evidence is served by Geo; it
does not attest legal applicability or densification.

The detailed zone-to-lot `zoneReglementNormes` fold, provenance/conflict model,
and lot detail UI are explicitly deferred to a separate item. No file under
`lot-zone-enrichment` is changed by this MVP.
