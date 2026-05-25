# SPEC_EVOL — Source Feasibility `radar-immobilier`

> **Status**: EVOL, opened for BR05 `feat/source-investigation-spikes`.
> **Inputs**: `docs/spec/input/VISION.md` section 4 and
> `docs/spec/input/PROCESS.md` annexes A/B.
> **Initial date**: 2026-05-25

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

| Source | Primary role | Spike slug | Initial automation hypothesis |
| ------ | ------------ | ---------- | ----------------------------- |
| Avis publics municipaux | Change detection | `avis-publics-valleyfield` | high if HTML/RSS, medium if PDF-only |
| Proces-verbaux municipaux | Strategic watch | `proces-verbaux-valleyfield` | medium |
| Council videos | Early discussion signal | `videos-conseil-valleyfield` | medium with transcript fallback |
| PPCMOI | Weak opportunity signal | `ppcmoi-valleyfield` | medium |
| Zoning bylaws | Core regulatory context | `zonage-reglements-valleyfield` | medium to high |
| Zoning plans and grids | Detailed regulatory context | `zonage-plans-grilles-valleyfield` | medium to high |
| Construction permits | Market validation | `permis-construction` | high where open data exists |
| Cadastre / Infolot | Parcel base | `cadastre-infolot` | low to medium without official API |
| Registre foncier | Ownership due diligence | `registre-foncier` | manual or partner-required |
| Donnees Quebec | Open-data discovery | `donnees-quebec` | high |
| Roles d'evaluation fonciere | Financial pre-scoring | `roles-evaluation-fonciere` | high to medium |
| CPTAQ agricultural zone | Major constraint filter | `cptaq-zone-agricole` | high |
| CPTAQ decisions | Unlock signal | `cptaq-decisions` | medium |
| BDZI flood zones | Risk constraint | `bdzi-zones-inondables` | high |
| GRHQ hydrography | Environmental constraint | `grhq-hydrographie` | high |
| Adresses Quebec | Geocoding / normalization | `adresses-quebec` | high |
| Orthophotos / imagery | Visual validation | `orthophotos-imagerie` | medium |
| Real-estate transactions | Market value analysis | `transactions-immobilieres` | partner-required |
| JLR | Transactional enrichment | `jlr` | partner-required |
| Centris / MLS | Residential market analysis | `centris-mls` | partner-required |
| StatCan socio-economic data | Context | `statcan-socioeco` | high |
| Transport / infrastructure | Value catalyst | `transport-infrastructures` | medium |
| MRC planning schemes | Long-term planning vision | `schemas-amenagement-mrc` | medium |

## 4. Consolidated Feasibility Matrix

This matrix is completed progressively from the spike notes in
`packages/radar-sources/src/sources/_spikes/**`.

| Source | Access | Format | Automation | Difficulty | Evidence value | Effort | Recommendation | Notes |
| ------ | ------ | ------ | ---------- | ---------- | -------------- | ------ | -------------- | ----- |

## 5. BR07 Candidate

The expected BR07 starting point remains `avis-publics-valleyfield`, because it
is the most direct public signal for zoning, PPCMOI, derogation, and public
consultation changes. BR05 must confirm whether the official Valleyfield entry
point is stable enough for production automation, and whether PV/video sources
should be linked in the first vertical slice or deferred to enrichment.

## 6. Open Questions

- Which exact municipal pages provide stable archives for Valleyfield notices,
  minutes, agendas, bylaws, and zoning grids?
- Which Donnees Quebec datasets cover Valleyfield specifically versus only
  provincial layers?
- Which paid/private sources are commercially realistic for Phase 1 pricing?
- Which sources can be represented as evidence documents in the first schema
  without overfitting BR06 to Valleyfield-only quirks?
