# SPEC_EVOL — Source Feasibility `radar-immobilier`

> **Status**: EVOL, opened for BR05 `feat/source-investigation-spikes`.
> **Inputs**: `docs/spec/input/VISION.md` section 4 and
> `docs/spec/input/PROCESS.md` annexes A/B.
> **Initial date**: 2026-05-25

## Status Updates

- **2026-05-25**: BR05 opened and parallel investigations completed across
  municipal/MRC, public geospatial, property/market, and socio-infrastructure
  source families. The branch now carries 34 spike notes under
  `packages/radar-sources/src/sources/_spikes/**`.

## 1. Goal

Evaluate every source family requested by the client and decide how each source
should enter the Phase 1 roadmap: build now, use as enrichment later, keep as a
manual due-diligence checkpoint, or drop until a commercial/legal agreement
exists.

The output is not production scraping code. BR05 produces feasibility notes and
effort estimates that inform BR06 data-model work, BR07 vertical slice scope,
and the final pricing pack.

## 2. Evaluation Rubric

| Dimension | Meaning |
| --------- | ------- |
| Access | Public/free, public/paid, API key, account, partner contract, or blocked. |
| Format | HTML, RSS, PDF, video, API JSON, CSV, GeoJSON, SHP, GPKG, WMS, FGDB, or mixed. |
| Automation | `high`, `medium`, `low`, or `manual` for a production adapter. |
| Difficulty | `low`, `medium`, `high`, or `blocked`, including format, auth, rate-limit, and legal constraints. |
| Evidence value | Whether the source can directly support a scored opportunity or only enrich context. |
| Adapter effort | Estimated production effort in man-days after the spike, including edge cases. |
| Recommendation | `build-now`, `build-later`, `manual-check`, `partner-required`, or `drop-for-phase-1`. |

## 3. Source Inventory

| Family | Spike notes |
| ------ | ----------- |
| Valleyfield municipal documents | `avis-publics-valleyfield`, `seances-conseil-valleyfield`, `videos-youtube-conseil-valleyfield`, `ppcmoi-valleyfield`, `reglements-urbanisme-valleyfield`, `zonage-plans-grilles-valleyfield`, `permis-construction-valleyfield` |
| MRC Beauharnois-Salaberry | `schema-amenagement-mrcbhs`, `avis-reglements-mrcbhs`, `seances-conseil-maires-mrcbhs` |
| Quebec open/geospatial data | `donnees-quebec-catalog`, `roles-evaluation-fonciere-mamh`, `zonage-municipal-open-data`, `construction-permits-open-data`, `cptaq-zone-agricole`, `cptaq-decisions`, `bdzi-flood-zones`, `grhq-hydrography`, `adresses-quebec-igo-geocoder`, `orthophotos-imagery` |
| Property and market | `cadastre-infolot`, `registre-foncier-qc`, `transactions-immobilieres`, `jlr`, `centris-mls` |
| Socio-economic and infrastructure | `statcan-census-profile-2021`, `statcan-wds-socioeconomic-tables`, `statcan-core-public-infrastructure-assets`, `mtmd-travaux-routiers`, `mtmd-reseau-routier-rtss`, `artm-grands-projets`, `exo-gtfs-transit-service`, `salaberry-info-travaux-projets`, `infc-hicc-projects` |

## 4. Consolidated Feasibility Matrix

This matrix is completed progressively from the spike notes in
`packages/radar-sources/src/sources/_spikes/**`.

| Source | Access | Format | Automation | Difficulty | Evidence value | Effort | Recommendation | Notes |
| ------ | ------ | ------ | ---------- | ---------- | -------------- | ------ | -------------- | ----- |
| `avis-publics-valleyfield` | public/free | HTML + PDF | high | medium | direct change signal | 2-3 md | `build-now` | BR07 starting point: derogations, PPCMOI, zoning amendment notices, registers, referendum approvals. |
| `seances-conseil-valleyfield` | public/free | HTML + PDF | high | medium | decision timeline | 3-5 md | `build-later` | Build after avis publics to link agenda/minutes evidence. |
| `videos-youtube-conseil-valleyfield` | public/free | HTML embeds/video | partial | high | early discussion signal | 5-8 md | `build-later` | Defer; transcripts/captions are uncertain and should not block BR07. |
| `ppcmoi-valleyfield` | public/free | HTML + PDF | medium-high | medium | high-value weak signal | 3-4 md | `build-now` | Strong enrichment once avis/PDF extraction exists. |
| `reglements-urbanisme-valleyfield` | public/free | HTML + PDF | medium-high | medium | regulatory context | 3-5 md | `build-now` | Same family as avis publics; needed to resolve bylaw references. |
| `zonage-plans-grilles-valleyfield` | public/free | HTML + PDF maps/grids | medium | high | scoring context | 6-9 md | `build-later` | Table/map extraction and georeferencing make this later than BR07. |
| `permis-construction-valleyfield` | public/free pages only | HTML/portal | low | high | market validation | 1-2 md | `drop-for-phase-1` | No public enumerable permit feed observed. |
| `schema-amenagement-mrcbhs` | public/free | HTML + large PDFs | medium-high | medium-high | long-term planning context | 3-4 md | `build-later` | Useful for context, not an alert source. |
| `avis-reglements-mrcbhs` | public/free | HTML + PDF | medium-high | medium | regional regulatory signal | 2-4 md | `build-later` | Add after city-level avis. |
| `seances-conseil-maires-mrcbhs` | public/free | HTML + PDF | medium | medium | regional context | 3-5 md | `build-later` | Lower signal density than city sources. |
| `donnees-quebec-catalog` | public/free | CKAN JSON | high | low | source discovery | 1.5-2.5 md | `build-now` | Shared resource resolver for open-data adapters. |
| `roles-evaluation-fonciere-mamh` | public/free caviarded | CSV/XML/GPKG | high | medium | parcel/value/use enrichment | 5-8 md | `build-now` | Key BR06/BR07 enrichment; needs MAMH dictionary/XSD. |
| `zonage-municipal-open-data` | public/free where published | mixed GIS/API | medium | medium-high | zoning context | 6-10 md | `build-later` | No Salaberry open zoning dataset found; use generic support later. |
| `construction-permits-open-data` | public/free where published | mixed tabular/GIS | high | medium | market traction | 4-6 md | `build-later` | Useful for other cities; no Salaberry feed found. |
| `cptaq-zone-agricole` | public/free | SHP/WMS | high | medium | hard constraint filter | 3-5 md | `build-now` | Core spatial de-risking layer with legal caveats. |
| `cptaq-decisions` | public/free | SHP/WMS/DBF | medium-high | medium | unlock/de-risk signal | 5-7 md | `build-later` | Build after agricultural-zone filter. |
| `bdzi-flood-zones` | public/free | REST/WMS/bulk GIS | high | medium | risk constraint | 3-5 md | `build-later` | REST/WMS first; bulk data is large. |
| `grhq-hydrography` | public/free | WMS/FGDB index | high | low-medium | environmental context | 3-4 md | `build-later` | Needs local setback/bylaw interpretation. |
| `adresses-quebec-igo-geocoder` | public/free | GeocodeServer/GIS | high | low-medium | geocoding/normalization | 2-3 md | `build-now` | Immediate utility for address and sector normalization. |
| `orthophotos-imagery` | public/free | WMS/WFS/imagery | medium | medium-high | visual validation | 4-8 md | `build-later` | Start with index/preview; defer computer vision. |
| `cadastre-infolot` | public/free + paid extracts | web map/extracts | medium | medium-high | parcel base | 4-7 md | `build-later` | Use official extracts; do not scrape live map. |
| `registre-foncier-qc` | public/paid | web/PDF | low | high | ownership due diligence | 12-20 md | `manual-check` | Manual demo evidence only until authorized bulk workflow exists. |
| `transactions-immobilieres` | public aggregate + paid parcel data | HTML/feed | high if licensed | medium | market value context | 2-10 md | `build-later` | Public aggregate useful; parcel-level requires provider access. |
| `jlr` | partner/paid | commercial feed/export | high if contracted | medium | ownership/transaction enrichment | 6-10 md | `partner-required` | Best paid enrichment candidate if contract permits reuse. |
| `centris-mls` | partner/paid | MLS/feed/stat pages | low without feed | high | market listing context | 8-15 md | `partner-required` | Do not scrape public listings; formal feed required. |
| `statcan-census-profile-2021` | public/free | SDMX/CSV | high | low-medium | socio-economic context | 2-4 md | `build-now` | Official municipal baseline; Salaberry CSD DGUID `2021A00052470052`. |
| `statcan-wds-socioeconomic-tables` | public/free | WDS/CSV | medium-high | medium | curated indicators | 3-5 md | `build-later` | Use a table whitelist after Census Profile. |
| `statcan-core-public-infrastructure-assets` | public/free | WDS/CSV | medium | low | macro background | 1-2 md | `drop-for-phase-1` | Too coarse for pilot opportunity evidence. |
| `mtmd-travaux-routiers` | public/free | WFS/GIS | high | low-medium | infrastructure disruption/context | 2-3 md | `build-later` | Snapshot current-state feed for history. |
| `mtmd-reseau-routier-rtss` | public/free | WFS/GIS | high | medium | road proximity support | 2-3 md | `build-later` | Supporting layer, not a primary signal. |
| `artm-grands-projets` | public/free | HTML | medium-low | medium-high | transit project context | 4-6 md | `drop-for-phase-1` | Montreal-region bias; weak Valleyfield relevance. |
| `exo-gtfs-transit-service` | public/free | GTFS | high | medium | transit accessibility | 2-4 md | `build-later` | Good for accessibility context, not project alerts. |
| `salaberry-info-travaux-projets` | public/free | HTML | medium | medium-high | local infrastructure context | 4-6 md | `build-later` | Useful pilot context with street geocoding. |
| `infc-hicc-projects` | public/free | CSV/JSON/XLSX | high | low-medium | public investment context | 2-3 md | `build-now` | Official federal project context; normalize municipality names. |

## 5. BR07 Candidate

BR07 should start with `avis-publics-valleyfield`.

Reasons:

- It is official, public/free, stable enough to crawl politely, and directly
  exposes high-signal notices for derogations, PPCMOI, zoning amendments,
  consultation assemblies, register notices, and referendum approval.
- It can produce raw PDF evidence quickly, which fits the BR02 S3/database
  model and lets BR06 evolve schema from real source documents.
- The next linked sources are clear: `reglements-urbanisme-valleyfield`,
  `ppcmoi-valleyfield`, then `seances-conseil-valleyfield`.
- `videos-youtube-conseil-valleyfield` should be explicitly deferred until
  transcript availability and costs are settled.

## 6. Phase 1 Source Set

Recommended first production sequence:

1. `avis-publics-valleyfield`
2. `reglements-urbanisme-valleyfield`
3. `ppcmoi-valleyfield`
4. `donnees-quebec-catalog`
5. `adresses-quebec-igo-geocoder`
6. `roles-evaluation-fonciere-mamh`
7. `cptaq-zone-agricole`
8. `statcan-census-profile-2021`
9. `infc-hicc-projects`

Manual/partner-dependent for Phase 1:

- `registre-foncier-qc`: manual due-diligence evidence only.
- `jlr`: strongest paid enrichment candidate if contract terms allow a feed or
  export reuse.
- `centris-mls`: do not scrape public listings; use only with a formal feed.

## 7. Remaining Open Questions

- Confirm the exact MAMH XML dictionary/XSD path for role d'evaluation fields.
- Confirm Scaleway/production storage costs for large PDF/GIS retention once
  ingestion cadence is known.
- Confirm whether a JLR or registry access agreement is commercially realistic
  for the proposal phase.
