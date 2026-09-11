# Zoning family deduction from municipal codes

## Purpose and decision

The map keeps owner choice B: a resolved zoning family is shown in the panel,
legend, fill and filter. No provenance qualifier is added to visible UI copy.
This specification instead records how the family was resolved, which code
tokens are supported, and where the result remains partial or unknown.

The target precedence is:

1. `affectation` supplied by the municipal source;
2. `kind` supplied by the source;
3. an alphabetic token extracted from the zone code, as a last-resort fallback.

For example, `CO-939` contains token `CO`; the audited fallback resolves it to
canonical kind `CONS`, whose UI label is **Conservation**. Source `affectation`
still wins when it exists. The zone code remains the zone identity.

## Provenance boundary

The fallback table is measured from Mont-Tremblant and South Shore datasets and
the nine regulatory sources summarized by the Fable 5.1 audit. It is not a
Quebec standard: every municipality defines its own zoning lettering. A token
retained below can therefore produce a wrong label in another city, especially
where the evidence is city-specific or partial.

Source keys used below:

- `CORE`: restricted audited core listed by Fable across the reviewed corpus.
- `MT`: Mont-Tremblant by-law (2008)-102, chapter 1 article 10, chapter 3 and grids.
- `SH`: South Shore sources: Candiac 5000 article 15, Saint-Constant 1528-17
  article 17, and Delson 901 grids.
- `COLLISION`: a reviewed municipality assigns another meaning to the token.
- `SOURCE-GAP`: the audit found no supporting table.

The audit summary reports 51 tokens, but the table at production base
`73b0931` contains 49. Its category totals also list four non-verified tokens
while its source-gap section names five (`RB`, `RV`, `PU`, `FO`, `VILL`). This
spec does not manufacture the two missing tokens or hide that discrepancy. The
status below covers every one of the 49 tokens present in the production table;
when the abbreviated audit provides no token-level citation, the status is
conservatively `PARTIEL`.

## Token-level status and UI action

| Token | Audit status | Evidence | UI action |
|---|---|---|---|
| `H` | FONDÉ+source | CORE; Delson 901 | keep `H` |
| `HA` | PARTIEL | measured MT/SH table | keep `H` |
| `R` | PARTIEL | COLLISION: recreational in La Conception | remove |
| `RA` | PARTIEL | measured MT table | keep `H` |
| `RB` | source-gap | SOURCE-GAP | remove |
| `RC` | DOUTEUX | residential and commercial | correct to `MIXTE` |
| `RM` | PARTIEL | measured MT/SH table | keep `H` |
| `RV` | source-gap | SOURCE-GAP | remove |
| `RF` | PARTIEL | COLLISION: recreational-forestry in Lac-Sainte-Marie | remove |
| `RFM` | PARTIEL | measured MT table | keep `H` |
| `RMF` | PARTIEL | measured MT table | keep `H` |
| `RTF` | PARTIEL | measured MT table | keep `H` |
| `V` | PARTIEL | measured MT table | keep `H` |
| `VP` | PARTIEL | measured MT table | keep `H` |
| `VF` | PARTIEL | measured MT table | keep `H` |
| `TV` | DOUTEUX | tourist resort does not establish habitation | remove |
| `VILL` | source-gap | SOURCE-GAP; reviewed code is `VIL` | remove; do not add `VIL` |
| `M` | FONDÉ+source | CORE | keep `MIXTE` |
| `MS` | FONDÉ+source | CORE; Saint-Constant | keep `MIXTE` |
| `MXTV` | FONDÉ+source | CORE | keep `MIXTE` |
| `MXT` | FONDÉ+source | CORE | keep `MIXTE` |
| `MF` | PARTIEL | measured MT table | keep `MIXTE` |
| `CU` | PARTIEL | measured MT table; `CV-`/`VA-` sector suffixes | keep `MIXTE` |
| `C` | FONDÉ+source | CORE; SH | keep `C` |
| `CM` | PARTIEL | measured MT/SH table | keep `C` |
| `CA` | PARTIEL | measured MT table | keep `C` |
| `CCM` | PARTIEL | measured MT table | keep `C` |
| `I` | FONDÉ+source | CORE; SH | keep `I` |
| `ID` | NON-FONDÉ | Saint-Constant: unstructured island in agricultural zone | remove |
| `IN` | PARTIEL | measured table | keep `I` |
| `IND` | PARTIEL | measured table | keep `I` |
| `EX` | PARTIEL | measured table | keep `I` |
| `U` | FONDÉ+source | CORE | keep `U` |
| `P` | FONDÉ+source | CORE | keep `P` |
| `PU` | source-gap | SOURCE-GAP | remove |
| `CGS` | NON-FONDÉ | Saint-Constant: large-format commercial | correct from `P` to `C` |
| `A` | FONDÉ+source | CORE; MT | keep `A` |
| `AG` | PARTIEL | measured MT table | keep `A` |
| `AF` | PARTIEL | measured MT table | keep `A` |
| `FO` | source-gap | SOURCE-GAP | remove |
| `CONS` | FONDÉ+source | CORE | keep `CONS` |
| `CONSERVATION` | PARTIEL | measured source label/token | keep `CONS` |
| `CO` | FONDÉ+source | Candiac, Saint-Constant, MT and Delson | keep `CONS` |
| `CR` | FONDÉ+source | MT only | keep `CONS` |
| `CF` | FONDÉ+source | MT only | keep `CONS` |
| `CFA` | FONDÉ+source | MT only | keep `CONS` |
| `REC` | FONDÉ+source | CORE | keep `REC` |
| `RE` | FONDÉ+source | CORE | keep `REC` |
| `TO` | DOUTEUX | tourist token; only a last-resort measured mapping | keep `REC`, visibly separate from conservation |

## Implemented corrections

- UI code fallback removes unsupported, source-gap and colliding global mappings,
  maps `CGS` to commercial and `RC` to mixed use, and keeps `TO` only under
  recreation.
- `CONS` and `REC` now have distinct design-system tokens, fallback colours and
  labels. `REC` is labelled `Récréation / tourisme`, so `TO` and `RE` are not
  presented as conservation.
- The radar-api prefix table is unchanged in this branch. Its known `ID` and
  `CGS` errors remain outside this UI correction and are assigned to GEO.
- CPTAQ availability is probed at city selection with `limit=1`, independently
  from layer activation. A missing collection leaves `Agricole` as a normal,
  non-interactive family; an available collection exposes the stable
  `Agricole (CPTAQ)` toggle before activation.
- Zone/lot number controls target the actual design-system label span and match
  legend rows at `0.75rem` and `rgb(71 85 105)` (`text-slate-600`).
- A lone neutral lot category is hidden, while the `Lots` heading and zone-number
  control remain. Neutral stays visible whenever another lot category exists.

## Unchanged radar-api mechanism

`lot-zone-enrichment.ts` retains its separate two-step resolver: a recognized
source `zone.kind` wins; otherwise `zoneKindFromCode()` applies the radar-api
prefix table. No file under `api/` is changed by this branch. At this branch
head, that table still resolves `(I|ID)-` as industrial and `(P|CGS)-` as
public, and `zone.kindSource` is not emitted anywhere under `api/src`.

The current browser path consumes geo-api collections directly, bypassing this
radar-api overlay. Its `ID` and `CGS` deductions are therefore known but are not
corrected here. The GEO work owns both the correction and deprecation path:
publish source-backed `zone_family`, migrate consumers to it, then retire the
legacy radar-api code-prefix fallback. Numeric lot scoring remains outside this
branch.

## Residual limits and target state

- Retained `PARTIEL` and MT-only tokens can still be wrong outside their measured
  municipalities. An unknown or removed token must remain unresolved/neutral.
- The UI `kind` field can originate upstream and does not yet carry a per-city
  regulatory citation. No `kindSource` field currently closes that provenance
  gap in radar-api.
- The target is GEO-published `zone_family` with city-scoped regulation/article
  metadata and source `affectation` available as tier 1. Code-token inference
  remains tier 3 until that migration is complete.

## Effect verification

- `lot-potential-visual.test.ts`: corrected and rejected token effects.
- `zone-kind-style.test.ts` and `zone-kind-filter.test.ts`: precedence,
  `CO-939`, distinct family tokens/fallback colours, labels and filters.
- `SignauxMapView.test.ts`: selection-time CPTAQ probing, non-interactive
  agriculture when absent, stable toggle labels, the actual DS label node and
  the published `Checkbox.svelte` variable-consumption contract, plus both
  neutral-lot legend cases.
