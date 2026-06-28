# WPA frontA-data to geo transfer proposal

Date: 2026-06-27
Branch: `agent/wpa-geo-drop`
Status: proposal only. No `.track/` write was performed.

## Scope

This note prepares the transfer of the `frontA-data` WPA backlog toward `geo`.
It classifies each Track item currently created with `workspace=frontA-data`
as:

- `KEEP`: radar/immo keeps ownership.
- `DEPEND_GEO`: radar keeps product consumption, but the acquisition or geo
  source of truth should come from `geo`.
- `DROP`: candidate cancellation, requiring the human decision recorded in
  `BLOCKED.md`.

The proposal follows the existing RACI in `docs/spec/data-division-immo-geo.md`
and the PV clarification in `docs/spec/clarif-pv-scraping-geo.md`: `geo` owns
generic geospatial acquisition and reusable geo primitives; `immo` keeps PV
and council-session collection, semantic detection, mapper, scoring, signals,
and hard municipal scraping through Obscura.

## H2A and geo-doc inspection

- No local `.h2a/` directory is present in this worktree.
- `.agents/lanes` has no active `geo` lane.
- `docs/spec/data-division-immo-geo.md` and
  `docs/spec/clarif-pv-scraping-geo.md` both record that h2a was down/quiet
  when the immo/geo boundary was drafted. This proposal is therefore not a live
  `geo` acceptance.
- The durable local geo contract is still clear enough for a proposal:
  normalized GeoJSON/OGC layers with provenance from `geo`, plus immo-side
  business joins and scoring.

## Item classification

| Track item | Proposal | Justification | Expected geo artifact | Radar impact |
| --- | --- | --- | --- | --- |
| `01KTQP5EWW8Q7JNXYFZ9HWSS6Q` - WP A.2 data identification easy-first + remote agents | `KEEP` as immo parent, re-scope around non-geo acquisition and dependencies | The item mixes PV, YouTube, Obscura, city registry, geo sources, and Track updates. It should not be dropped because PV/YouTube/Obscura remain immo. It should not continue pretending immo owns all geo acquisition. | A geo dependency list covering municipality registry, zoning, role acquisition, and geo-source inventory. | Keeps the WPA parent useful while preventing duplicate geo acquisition work in radar. |
| `01KTQP5EYKW5J20JW5VF75TRS3` - A.2.1 city list and perimeter via CiblagePlan | `DEPEND_GEO` | City slug/MRC/lat/lon/pop/distance is generic geo reference data. Radar should keep only the business overlay: priority rank, exclusions, deprioritization, demo scope. | Canonical Quebec municipality registry from `geo`, with stable slug, MRC, coordinates, population, distance or enough fields for radar to compute distance, plus provenance and refresh cadence. | Radar can drop the municipality source-of-truth role from `radar-sources` once the geo registry is consumable; CiblagePlan keeps strategy fields. |
| `01KTQP5F0D6PMGRFFHYP8CEFXX` - A.2.2 generic PV scraper | `KEEP` | PVs are municipal text and the core immo signal source. The repo docs explicitly reject the idea that `geo` absorbs PV scraping. | None required for scraping. Downstream mapper consumes `geo` zones/lots when resolving mentions. | Preserves radar's main signal engine: notice of motion, bylaw number, adoption follow-up, and graphify. |
| `01KTQP5F227ETENEGY0E03F4XJ` - A.2.3 YouTube sessions | `KEEP` | Council-video transcript work is not geo data. It is an early textual signal source for immo. | None required, aside from optional zone/lot layers for later enrichment. | Keeps the approx. 15-day early signal path and graphify input stream in radar. |
| `01KTQP5F3TBJW90Y4A2SX7Z2Z5` - A.2.4 permanent todo + background agents + Obscura + Track update | `KEEP` but move out of geo-transfer scope | Hard scraping, Obscura, and agent orchestration remain immo/platform capabilities. Track writes should be done only by the designated writer checkout. | None. `geo` may provide OCR/georef primitives after immo retrieves a PDF. | Keeps large-scale municipal scraping operational without pushing anti-bot responsibility to `geo`. |
| `01KTQP5F5PARP1BX4A159NWRKV` - A.2.5 captcha to Obscura for lot owner identification | `TRANSFER_GEO_GATED` per decision `01KW5RX4BYHM31ZW4M0WXBR15S` | Owner identification touches captcha, land-registry access, ToS, Loi 25, and paid/legal data. Human decision: transfer to `geo`, but only behind explicit scraping/access warning, Loi 25 declaration, auth/authorization even on geo, separation from public layers, and audit logging. | New geo item `01KW5RXJF7YWYHM86XY411SWJ0` for controlled owner-data acquisition/storage/access. | Cancels the old FrontA-data implementation path while preserving the capability as controlled geo data, not demo/public map data. |
| `01KTQQB1YNYPFDXB9P1V7VDNZ2` - source municipal councils / PV refresh | `KEEP` | Same reason as A.2.2: PV refresh is the immo core signal stream. | None for collection; optional geo layers for post-collection resolution. | Keeps rolling six-month monitoring and adoption follow-up. |
| `01KTQQB20HMR25VB74QCNT6HEH` - source public notices refresh | `KEEP` | Public notices are textual pre-PV signals, not generic geospatial acquisition. | None for collection; optional geo layers for matching zone/lot references. | Keeps pre-PV anticipation in radar and feeds the same graphify/scoring path. |
| `01KTQQB22M45MT8J7RD5WQ27MR` - source YouTube sessions refresh | `KEEP` | Video transcript acquisition is not geo-owned. | None. | Keeps another early signal stream and avoids overloading `geo` with non-geo media work. |
| `01KTQQB24Q0X5HMTFWW5JQDPQB` - source zoning PDF/GeoJSON one-shot | `DEPEND_GEO` | Zoning layer acquisition, PDF plan OCR, and deterministic georeferencing are generic geo capabilities. Immo keeps semantic references and temporal mapper logic. | OGC or equivalent normalized zoning collections per city, with `code_affiche`/normalized code, geometry, source URL/raw reference, fetched-at timestamp, and confidence/provenance for PDF-derived geometry. | Radar stops duplicating zoning acquisition and consumes a single geo source of truth for map display and signal-to-zone resolution. |
| `01KTQQB270VKEM8BGYM06B8S4N` - source role-evaluation one-shot | `DEPEND_GEO` | MAMH role acquisition is open georeferenced data keyed by lot and reusable outside immo. Immo should keep valuation/usage interpretation for scoring and no PII owner fields. | Normalized non-PII role/evaluation layer keyed by `NO_LOT`/`no_lot_norm`, with values/usages allowed for radar, provenance, and refresh cadence. | Lot detail and scoring can use role data without radar owning the acquisition adapter long-term. |
| `01KVB9MZ7Y96B2B18BNBC2SVC2` - P4 data quality view per-city PV/YouTube/ontology/zones/lots | `KEEP` with `geo` dependency | The view is a radar product/admin surface, but its geo coverage metrics must come from `geo`. Radar owns PV/YouTube/ontology coverage. | Per-city geo coverage status: lots, zoning, constraints, municipality registry freshness, source quality, and known blockers. | Produces an honest data-quality dashboard without conflating immo scrape status and geo layer readiness. |

## Transfer queue for geo

These are the candidate requests to pass to `geo`, not Track writes:

1. Own the Quebec municipality registry as the canonical geo reference, with
   radar retaining a business-priority overlay.
2. Own zoning acquisition and zoning-plan PDF georeferencing as OGC/GeoJSON
   layers with provenance and confidence.
3. Own MAMH role/evaluation acquisition as a non-PII, lot-keyed normalized
   layer.
4. Own `GeoSourceInventory` and the municipal geo-platform survey.
5. Publish per-city geo coverage status consumable by the radar data-quality
   view.

## Track update proposal

The designated Track writer can apply this later:

1. Add a progress note to WPA/frontA-data pointing to this document.
2. Re-scope the `frontA-data` parent as "immo signal acquisition plus geo
   dependencies".
3. Mark city registry, zoning source, role source, and P4 geo coverage as
   `DEPEND_GEO` in whatever Track vocabulary the conductor chooses.
4. Do not close `A.2.5` until the human decision in `BLOCKED.md` is resolved.

## Non-transferable radar responsibilities

Radar/immo keeps these even if `geo` accepts every transfer candidate:

- PV and public-notice scraping.
- YouTube/council-session transcription and graphify input preparation.
- Notice-of-motion to bylaw to adoption semantic detection.
- Signal, opportunity, score, and evidence semantics.
- Text-to-zone/lot temporal mapper and unresolved-match audit.
- Obscura and hard municipal scraping posture.
- Track writes from the designated writer checkout only.
