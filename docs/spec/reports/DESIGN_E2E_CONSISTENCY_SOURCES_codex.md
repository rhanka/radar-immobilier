# Design - E2E Consistency In The Sources View

Status: Codex 5.5 independent design lane for double consensus.
Base: `origin/main` at `74ae0d8e2f9de55e64386d94df399ac8df20483d`.
Scope: design only. No implementation is included.

## Source Basis

Read basis:

- `api/src/routes/source-coverage.ts`
- `ui/src/lib/components/sources-map/SourceScorecard.svelte`
- `api/src/services/geo/priority-resolver.ts`
- `api/src/services/geo/run-geo-mapper.ts`
- `api/src/services/geo/measure-geo-mapping.ts`
- `docs/spec/SPEC_CONSOLIDATED_2026-07.md`
- `docs/spec/reports/wp1-data-state.md`
- `docs/spec/reports/wp3-mapper-recall-2026-06-28.md`
- `docs/spec/reports/wp3-33-anomalies.md`
- `docs/spec/reports/study-2026-07/report.md`

Requested but absent from this `origin/main` checkout:

- `docs/spec/reports/consolidation-30-2026-07.md`

The missing file matters only as a provenance gap. Its apparent content is mostly represented by
`study-2026-07/report.md` and `SPEC_CONSOLIDATED_2026-07.md`, which carry the focus 30, 1104/1106,
33 E2E, and 5000+ axes.

## Thesis

The Sources view currently answers: "does this city have the layers needed by the product?"
It does not answer: "do those layers agree along the actual opportunity chain?"

The new capability must therefore be a separate consistency lane, not a refinement of coverage.
A city can have excellent coverage and poor E2E consistency. Example: zones and lots can be served
live by geo while the PG mapper has not pulled them, or a signal can cite a proposed zone that does
not exist in the current zoning layer. Painting that city green because the sources exist would be a
false product claim.

The design below keeps three invariants:

1. Coverage and consistency stay separate in API, UI, sorting, and copy.
2. Every metric has an explicit denominator. Empty denominators never become 100 percent.
3. Province-wide consistency is batch/snapshot data. Live OGC calls are acceptable for one selected
   city, not for 1104 cities on every Sources load.

## E2E DAG

The product DAG for a real opportunity is:

```text
PV / raw document
  -> published Signal or DesignationEvent
  -> designated Zone reference
  -> served current Zone geometry
  -> matched Grid / norms for that Zone
  -> cadastral Lot attached to the served Zone
  -> optional TOD overlay on the Lot
```

There are two useful shortcuts:

- A signal can designate a lot directly through `no_lot`. That strengthens location, but it does not
  replace the zone and grid chain for zoning/norms.
- A lot can be attached to a zone by explicit code or by centroid. The latter is useful, but it is a
  weaker measurement and must be labelled as such internally.

TOD is an enrichment edge, not a core consistency gate today. The current code only propagates TOD if
the lot source already carries it, and the consolidated spec says the TOD increment is still pending
from geo. It should be counted and displayed, but it must not block "PV -> signal -> zone -> grid ->
lot" consistency unless the owner explicitly makes TOD a requirement for a given cohort.

## Edge Metrics

### E0 - PV <-> Signal Grounding

Question: is the published signal grounded in a real PV or municipal document?

Unit:

- Published graph nodes where `type in ('Signal', 'DesignationEvent')`, scoped to one city and one
  measurement snapshot.

Denominator:

- `published_signals = count(Signal or DesignationEvent nodes for city)`.

Numerator:

- `grounded_signals = count(published signals with at least one resolvable evidence ref)`, where
  a resolvable evidence ref must include a real raw-document key or URL plus a citation/excerpt. If
  the source is a PDF, page is required for "complete" grounding; bbox is recorded separately because
  current evidence has 0/27 bbox in the audit.

Metric:

- `grounding_coverage = grounded_signals / published_signals`.

This is not extraction recall. It does not answer "did we find every true signal in the PV?" That
requires a labelled PV corpus. It only answers "of the signals we publish, how many are backed by a
document reference that can be checked?"

Precision:

- Automatic precision is only formal: the doc ref exists and the excerpt field is present.
- Real precision is `audited_valid_groundings / sampled_grounded_signals`, where the sample verifies
  that the cited excerpt appears in the referenced document and supports the signal claim.
- Until that audit exists for a city or cohort, UI must not show "precision" as a global claim.

Current anchors:

- Source coverage already counts `signals.withCitation`.
- Consolidated numbers: focus 30 has 56/70 signals with verifiable citation; target is 100 percent.

### E1 - Signal <-> Served Zone

Question: when a signal designates a zone, does it resolve to a zone that is actually served?

Unit:

- A distinct zone-designation atom: `(signal_node_id, normalized_zone_code, designation_source)`.
- The designation source can be a canonical graph edge to a Zone node, a structured `zone_ref`, or a
  text-extracted reference above the resolver threshold. Deduplicate by `(signal_node_id,
  normalized_zone_code)`.

Denominator:

- `zone_designations = count(zone-designation atoms for city)`.

Also report applicability:

- `zone_designating_signals / published_signals`.

This prevents a city with no zone-designating signals from looking perfect. It is "not applicable" or
"not measured for zone chain", not 100 percent consistent.

Numerator:

- Strict PG mode: `matched_zone_designations = count(zone-designation atoms with a
  geo_resolutions row relation_type='concerns_zone' whose target joins a current zone_versions row
  for the same city with a non-null geometry)`.
- Live preview mode: a selected-city recomputation can fetch `qc-zonage-<city>` from OGC and match
  against the live feature codes. This is useful for a drawer drilldown, but not for province-wide
  headline numbers.

Metric:

- `signal_zone_recall = matched_zone_designations / zone_designations`.

This is recall over detected zone designations, not precision. It matches the established #74 mapper
language: 52/110, 63/110, then 71/120.

Precision:

- Formal precision: the target canonical id exists in `zone_versions`. The current
  `measure-geo-mapping.ts` computes only this kind of precision.
- Real precision: `audited_correct_zone_matches / sampled_matched_zone_designations`, where the
  source document truly refers to that zone and not to a bylaw number, a plan number, an affectation
  layer, or a broader family code.

Known ambiguity:

- Proposed zones are not necessarily present in current zoning. A non-match can be correct, not a
  mapper failure. The reason must be captured as `proposed_zone_not_current` or equivalent, not
  collapsed into generic "missing".

### E2 - Zone <-> Grid / Norms

Question: once a zone is resolved, can we attach its official grid or parsed norms?

There are two levels. They must not be collapsed:

- Grid link coverage: the zone has an official grid URL or document reference.
- Parsed norms coverage: the zone has parsed, verbatim norms such as density, usages, height, or
  margins, with cell/page/source evidence.

Unit for the chain:

- A distinct served zone reached from E1, or the corresponding signal-zone atom if the UI wants to
  weight repeated mentions. The default should be distinct zones for per-city data quality and
  signal-zone atoms for per-signal E2E path scoring.

Denominator:

- `served_signal_zones = distinct zone canonical ids matched by E1 for city`.

Numerators:

- `zones_with_grid_link = count(served signal zones with grillePdfUrl or equivalent official grid
  document ref)`.
- `zones_with_parsed_norms = count(served signal zones with at least one parsed norm field backed by
  evidence)`.

Metrics:

- `zone_grid_recall = zones_with_grid_link / served_signal_zones`.
- `zone_norms_recall = zones_with_parsed_norms / served_signal_zones`.

For E2E opportunity readiness, parsed norms are the strict metric. A grid link alone is partial: it
proves where to look, not that the product has extracted the rule.

Precision:

- Grid-link precision: sampled links whose document is the official grid for that zone.
- Norm precision: sampled parsed cells whose value, unit, and applicability match the official grid.

Current anchors:

- `source-coverage.ts` can measure grilles lazily for one city by fetching OGC zone items and applying
  `zoneGrillePdfUrl()` and `zoneNormes()`.
- Bulk Sources currently treats norms as absent unless the lazy value is hot in cache. That is correct
  for coverage, but insufficient for E2E consistency.
- Salaberry is the pilot with 97.9 percent of 15,510 lots carrying norms. Outside pilots, structured
  grid/norm coverage is not province-ready.

### E3 - Zone <-> Lot

Question: can cadastral lots be attached to the served zone?

There are two denominators. Both are useful, but they answer different questions.

City-wide lot assignment:

- Denominator: `served_lots = count(lot features for city with public geometry and not filtered as
  road/right-of-way when that flag exists)`.
- Numerator: `zone_joined_lots = count(served lots enriched with zoneCode and zoneJoin in
  {'code', 'centroid'})`.
- Metric: `lot_zone_assignment_recall = zone_joined_lots / served_lots`.

Signal-chain lot availability:

- Denominator: `served_signal_zones = distinct zones matched by E1`.
- Numerator: `signal_zones_with_lots = count(served signal zones with at least one joined lot)`.
- Metric: `signal_zone_lot_recall = signal_zones_with_lots / served_signal_zones`.

The second metric is the E2E chain metric. The first metric is a city data-quality metric and is good
for operations.

Precision:

- `zoneJoin='code'` is high confidence when the lot source carries an explicit zoning code and the
  code normalization is stable.
- `zoneJoin='centroid'` is useful but lower confidence, especially around split lots, boundaries,
  enclaves, water/road geometries, and multi-polygons. Precision must be sampled as
  `audited_correct_lot_zone_links / sampled_joined_lots`, stratified by join method.

Current anchors:

- `lot-zone-enrichment.ts` already computes `joinedByCode`, `joinedByCentroid`, and `unjoined`, but
  this happens per request and is not persisted as a province-wide measurement.
- Evaluation can benefit from live OGC enrichment immediately. Sources consistency should use a batch
  snapshot or a selected-city live preview, not a 1104-city live sweep.

### E4 - Signal <-> Direct Lot Reference

Question: if the PV mentions a lot number, does it resolve to a cadastral lot?

This edge is supplementary. It is valuable evidence, but it does not replace the zone/grid chain.

Unit:

- A distinct lot-reference atom: `(signal_node_id, normalized_no_lot)`.

Denominator:

- `lot_designations = count(lot-reference atoms for city)`.

Numerator:

- `matched_lot_designations = count(lot-reference atoms with geo_resolutions
  relation_type='concerns_lot' whose target joins a current lot_versions row for the same city)`.

Metric:

- `signal_lot_recall = matched_lot_designations / lot_designations`.

Precision:

- Direct lot refs are ambiguous province-wide because lot numbers can be duplicated in poor extracts
  or matched without city context. Precision must require same-city selection and sample audit.

## Per-City Computation Design

### Data Sources

Use the current sources, but classify every value by measurement mode.

Measured live and cheap:

- `/api/source/coverage` set-based aggregates: raw status, graph rows, signal counts, local PG
  zone/lots, and a single geo `/collections` listing for `qc-zonage-*`, `qc-lots-*`, `qc-tod-*`.
- Selected-city grilles: `/api/source/coverage/:citySlug/grilles` fetches one city of OGC zones and
  counts grid/norm attributes.
- Selected-city lot enrichment: `/api/geo/collections/qc-lots-<city>/items` can attach zone data and
  expose `zoneJoin`, but only for the requested page/bbox/limit.

Measured batch:

- Graph signal evidence census from `graph_nodes`.
- Canonical graph relation census from `graph_edges` when v2.3 edges are present.
- Mapper output from `geo_resolutions` and `geo_unresolved`.
- Current projected zones/lots from `zone_versions` and `lot_versions`.
- Province-wide zone-grid and zone-lot measurements, because they require per-city OGC feature
  fetches or spatial assignment.

Not measured without additional audit:

- True PV extraction recall.
- Human-grade precision for signal-zone matches.
- Human-grade precision for parsed grid/norm values.
- Human-grade precision for centroid lot-zone joins.

### Recommended API Shape

Do not overload the meaning of `worstStatus`.

Add a sibling consistency payload to each city, either directly in `/api/source/coverage` or through a
new `/api/source/consistency` endpoint joined client-side:

```text
city.consistency = {
  generatedAt,
  mode: 'batch-pg' | 'live-preview' | 'unmeasured',
  scope: 'focus30' | 'province1104' | 'e2e33' | 'selected-city',
  state: 'coherent' | 'partial' | 'unmeasured',
  readinessBand: 'strong' | 'usable' | 'weak' | 'unmeasured',
  blockers: [...],
  edges: {
    pvSignal: {...},
    signalZone: {...},
    zoneGrid: {...},
    zoneLot: {...},
    signalLot: {...}
  }
}
```

The exact TS names can follow repo conventions later. The design point is that coverage cells and
consistency cells are different objects with different labels and different denominators.

### Batch Snapshot

Province-wide consistency should come from a materialized snapshot produced by a bounded job, not by
the Sources page itself.

The snapshot should store, per city:

- counts and denominators for each edge;
- measurement mode (`pg`, `ogc-live-at-batch-time`, `sample-audit`);
- data freshness (`graph_created_at`, `geo_pull_at`, `ogc_listing_at`, `mapper_run_at`);
- top blocker reasons from `geo_unresolved` and from grid/lot assignment;
- path counts for priority signals and for all signals.

This can be stored in Postgres or as a JSON artifact in object storage and loaded by the API. The
important constraint is immutability of the measurement: the UI should not mix counts from different
times without showing it.

### Live Preview

For a selected city, a drawer can show a live preview:

- fetch OGC zones for that city;
- fetch OGC lots for the current bbox or a bounded full city request when safe;
- compute grid/norm attributes from zone properties;
- compute lot-zone assignment using the same enrichment code.

Live preview must be labelled as selected-city preview. It must not update province totals. Otherwise
the page would compare snapshot numbers for most cities with fresher live numbers for the clicked
city.

## E2E City Score

### Do Not Use A Single Percent As The Primary UI

The requested "E2E score per city" should exist, but not as a naked 0-100 color or headline. Averages
hide broken chains. A city with perfect PV, signals, and lots but no signal-zone mapping is not "75
percent E2E"; it is blocked at the zone edge.

Use three layers:

1. A tri-state consistency state.
2. A readiness band for sorting.
3. Edge counts for explanation.

### Tri-State

Internal state:

- `coherent`: all applicable core edges are measured and pass thresholds; no precision blocker is
  outstanding for the cohort being claimed.
- `partial`: at least one E2E path exists or at least one core edge is measured, but one or more core
  edges are below threshold, unmeasured, or formally precise only.
- `unmeasured`: prerequisites are missing or denominators are not available. Examples: no published
  signals, signals exist but none designate a zone, geo has live coverage but no PG mapper run, or
  only lazy cache values exist.

Client-facing labels should avoid jargon:

- `coherent` -> "Cohérent"
- `partial` -> "À qualifier"
- `unmeasured` -> "Non mesuré"

Do not reuse "Non couvert" for consistency. A city can be covered but not measured for consistency.

### Edge Scores

For each edge, compute a normalized internal value only when the denominator is valid:

- `pvSignal = grounded_signals / published_signals`
- `signalZone = matched_zone_designations / zone_designations`
- `zoneGrid = zones_with_parsed_norms / served_signal_zones`, with an optional partial credit flag
  when only a grid link exists
- `zoneLot = signal_zones_with_lots / served_signal_zones`
- `signalLot = matched_lot_designations / lot_designations`, supplementary

If the denominator is zero:

- If the edge is not applicable to the city, mark `not_applicable`, not 1.0.
- If the edge should be applicable but the census was not run, mark `unmeasured`, not 0.

### Aggregation

Use bottleneck readiness for the user-facing band:

```text
core_readiness = min(pvSignal, signalZone, zoneGrid, zoneLot)
```

Only include core edges whose denominators are applicable and measured. If any required core edge is
unmeasured, the city state is at most `partial`, and usually `unmeasured` if no E2E path can be shown.

Use a weighted mean only as a secondary sort key inside the same state:

```text
sort_score =
  0.25 * pvSignal +
  0.35 * signalZone +
  0.20 * zoneGrid +
  0.20 * zoneLot
```

Rationale:

- `signalZone` is weighted highest because the current reports identify it as the real bottleneck
  (focus proxy around 60 percent, province mapper 71/120 = 59.2 percent).
- `pvSignal` is a hard trust gate, but good PV grounding does not locate an opportunity.
- `zoneGrid` and `zoneLot` turn a located signal into a qualified lot opportunity.

The UI should not display `sort_score` as a percentage. It can sort rows and show the underlying
counts.

### Thresholds

Default thresholds for `coherent`:

- `pvSignal >= 0.95`, and for client-facing E2E proof, priority signals must be 100 percent grounded.
- `signalZone >= 0.85` for applicable zone-designating signals.
- `zoneGrid >= 0.80` on parsed norms, not merely grid links, unless the cohort explicitly allows
  "grid linked but norms not parsed" as partial.
- `zoneLot >= 0.95` for city-wide lot assignment or `signal_zone_lot_recall >= 0.95` for signal-chain
  scoring.
- Precision audit: no known false-positive class can dominate the sample. A formal DB-exists check is
  insufficient for `coherent`.

These thresholds are intentionally stricter than the current state. The current mapper result around
59 percent should appear as partial, not as a pass.

### Alignment With 30 / 1104 And 33 / 5000+

Report four distinct scopes:

- `focus30`: the 30 priority-rank cities. Denominator for city coverage is 30. Denominator for
  consistency is only the subset with applicable measured signal-zone data, and that subset must be
  printed.
- `province1104`: the eligible provincial target. Use 1104 for immo layers; if geo reports 1106,
  show it separately or normalize by excluding Montreal/Laval. Never mix the denominators in one
  fraction.
- `e2e33`: the 33 priority opportunity cohort. This is per-signal or per-opportunity path proof, not
  a city coverage metric. A city score can roll it up, but the cohort remains separate.
- `scale5000`: the target universe of 5000+ city-signal pairs. Until all-pair census and precision
  sampling exist, show only "not measured at scale" plus the count of pairs in the latest batch. Do
  not extrapolate precision from 27 audited signals or 55 mapper cities.

Recommended headline examples:

- "Coverage: 29/30 focus cities have zoning; 30/30 have lots."
- "Consistency: 14/30 focus cities have zone-designating signals; 28/47 zone designations match in
  the latest focus proxy."
- "E2E proof: 33 cohort tracked separately; N/N paths complete after batch run."

## UI Integration

### Scorecard

Keep the existing coverage scorecard rows:

- PV collected
- Signals extracted
- Zones served
- Norms/grid
- Lots
- TOD

Add a visually separate "Cohérence E2E" section below coverage:

- badge: `Cohérent`, `À qualifier`, or `Non mesuré`;
- subline: latest batch time and mode, for example `batch PG · 2026-07-05`;
- four compact edge rows:
  - `PV -> signaux`: `grounded / published`
  - `signaux -> zones`: `matched / designated`
  - `zones -> grilles`: `norms / served signal zones`
  - `zones -> lots`: `zones with lots / served signal zones` or `joined lots / served lots`
- optional supplementary row:
  - `signaux -> lots`: `matched / designated lot refs`

The coverage badge at the top must remain "Couverture: Servi/Partiel/Non couvert". The consistency
badge must be a second badge, not a replacement.

### Console

Add a mode or columns, not a new screen:

- Coverage columns remain sortable by coverage state.
- Consistency columns add `Cohérence`, `PV`, `S-Z`, `Z-G`, `Z-L`, `Blocker`.
- Default sort can keep worst coverage first. Add an explicit "Trier par cohérence" control so the
  user can find cities where sources are present but mappings are broken.

Recommended blocker labels:

- `Aucun signal publié`
- `Signal sans citation`
- `Aucune zone désignée`
- `Zone désignée non servie`
- `PG non pullé`
- `Grille absente`
- `Lots non joints`
- `Précision non auditée`

These labels are operational and neutral. Avoid "bug" unless the failure is known to be an
application defect.

### Map

Do not recolor the main Sources map by consistency by default. Coverage is the current map contract.

Add a segmented control or tab within Sources:

- `Couverture`
- `Cohérence`

In `Cohérence` mode, color by consistency state, not by a continuous score. If the batch snapshot is
missing, use the neutral "Non mesuré" color. Do not derive map color from live selected-city preview.

### API Compatibility

Short-term:

- Add optional consistency fields. Existing clients ignore them.
- Keep `worstStatus` unchanged for coverage.
- Add `consistencyState` or `consistency.state` for the new lane.

Medium-term:

- Extract shared client helpers parallel to `source-coverage-client.ts`, for example
  `source-consistency-client.ts`, so coverage logic and consistency logic do not become one mixed
  type.

## Risks And Pitfalls

### Denominator Drift

The project already has denominator drift:

- 1106 total municipalities in the geo registry.
- 1104 eligible immo target after excluding Montreal and Laval.
- focus 30 priority cities.
- 33 priority opportunity cohort.
- 5000+ future city-signal pairs.
- 70 focus signals, 250 Signal+DesignationEvent nodes, and 7200+ province signal/de nodes depending
  on unit.

Every display must print `num/denom` and the scope. A city with no zone-designating signal must not
get `signalZone = 1.0`. A province metric over 55 mapper-intersection cities must not be labelled as
1104 coverage.

### Coverage Is Not Consistency

Geo can serve zoning live while PG has not pulled it. The mapper and `geo_resolutions` are PG based.
Therefore:

- `qc-zonage-<city>` in the OGC listing proves coverage.
- It does not prove that a signal in PG resolves to that zone.

This is the highest-risk UI confusion. The design must keep separate badges and separate colors.

### Precision Is Mostly Unaudited

`measure-geo-mapping.ts` calls a resolution "correct" when the canonical id exists in the DB. That is
formal consistency, not semantic precision.

False positives can come from:

- bylaw numbers parsed as zone codes (`Z-94`, `Z-84`);
- wrong layer exposed under `qc-zonage-*` (affectation, plan, admin layer, lot numbers);
- family code vs sub-zone (`H1` vs `H1-30`);
- proposed zones not yet present in current zoning;
- city fallback matching a common code in the wrong municipality;
- numeric-only zone codes with low context;
- stale PG rows after geo changed.

The UI should show recall counts by default and reserve precision claims for sampled audits.

### Sampling Is Not Scale

The `wp3-33-anomalies` audit is valuable but covers 10 cities and 27 signals. The mapper measurement
covers 55 intersection cities and 120 code designations in its final run. Neither proves 5000+
city-signal precision.

For the 5000+ axis, the design should require:

- full pair census for recall-like metrics;
- stratified precision samples by city type, source type, zone code shape, join method, and mapper
  provenance;
- separate reporting for priority signals and all signals.

### Lazy Caches Can Lie If Promoted To Bulk Metrics

The grilles endpoint is intentionally lazy and cache-backed. It is correct for a selected-city
scorecard. It is not a province-wide denominator unless a batch has warmed and recorded every city
under controlled conditions.

Similarly, lot-zone enrichment is currently per OGC request and can be bbox/limit dependent. A city
metric must use a full-city bounded batch, not a map viewport page.

### Cost And Runtime

Expensive operations:

- scanning S3 graph JSON for all cities;
- fetching OGC zone features for hundreds of cities;
- fetching OGC lots for all cities, especially if full city lots are large;
- computing centroid joins at province scale;
- OCR/parsing grids and validating norms;
- human or LLM-assisted precision audits.

Controls:

- one batch snapshot per run, not per UI load;
- exact `qc-zonage-<slug>` and `qc-lots-<slug>` listing first, then fetch only eligible cities;
- focus 30 and 33 cohort runs before province runs;
- store counts, reasons, and freshness so UI can reuse them cheaply;
- cap selected-city live previews and label them as previews.

### Grid Link Is Not Norms

A `grillePdfUrl` is not the same as parsed, usable norms. For scoring and lot qualification, the
strict edge is parsed norms with evidence. Grid links can be partial progress, but should not unlock
"E2E coherent" by themselves.

### Centroid Join Is Useful But Not Absolute

Centroid joins are a pragmatic fallback. They can fail on split lots, boundary lots, multi-polygons,
thin lots, and zones with holes. Keep `zoneJoin` as part of the measurement and precision sample.
Do not merge code joins and centroid joins into one undifferentiated precision number.

## Recommended Implementation Order

1. Define the batch snapshot contract and compute E0/E1 from PG only. This gives immediate value with
   low cost and aligns with #74 mapper evidence.
2. Pull focus 30 zoning/lots into PG before judging focus consistency. Otherwise live coverage and PG
   consistency will keep disagreeing.
3. Add selected-city live preview for E2/E3 using existing OGC grid and lot enrichment code, labelled
   as preview.
4. Materialize E2/E3 batch metrics for focus 30, then for the 33 cohort.
5. Only after denominators and audit sampling are stable, add province1104 consistency summaries.

This order matches the consolidated roadmap: focus 30 first, then 33 proof depth, then 1104 and 5000+
scale.
