# SPEC — Signal query v1 (frozen for I-0)

Status: frozen. This file is the normative companion to
`packages/radar-domain/src/signals/signal-filter-v1.ts` (zod is authoritative;
this text must not contradict it). No production code reads this file.

## 1. Frozen transport spellings (single spelling each)

- App route: `GET /api/v1/workspaces/:workspaceId/signal-facets/query`
- Reader operation: `signals.query.v1`
- MCP tool: `query_signals`
- Body version: `contractVersion: "signal-query-v1"`

Existing transports are untouched: `baskets.search.v1`,
`signal-query-basic-v1`, and every current MCP tool stay bit-identical.

## 2. Filter shape (absence = unrestricted unless noted)

| Field | Type | Default |
| --- | --- | --- |
| `citySlug` | slug, optional; absent = all workspace-visible cities | absent |
| `requireZonage` | boolean | absent |
| `requireResidentielEligible` | boolean | absent |
| `requirePrecoce` | boolean | absent |
| `legacyZmp` | `{ z?, m?, p? }` | absent |
| `excludeAutomaticallyExcluded` | boolean | absent |
| `instruments` | `VivierInstrument[]` | absent |
| `stages` | `VivierStage[]` | absent |
| `regulatoryStatus` | `("firm" \| "anticipation")[]` | absent |
| `dateFrom` / `dateTo` | real civil dates, inclusive, `dateFrom <= dateTo` | absent |
| `dateBasis` | `document` \| `scrap` | `document` |
| `zoneCode` | string; requires `citySlug` (typed refusal otherwise) | absent |
| `zoneMatch` | `attached` \| `attached-or-unattached` | `attached` |
| `basket` | `all` \| `none` \| `pertinent` \| `a_surveiller` | `all` |
| `archive` | `exclude` \| `include` \| `only` | `exclude` |
| `personalHistory` | `any` \| `untouched` \| `has_history` | `any` |
| `excludePiia` / `excludeDerogations` | boolean | absent |
| `q` | folded substring, max 128, no ranking | absent |
| `sort` | `vivier_rank` \| `freshness_desc` | `freshness_desc` |
| `limit` | 1..100 | 50 |
| `cursor` | opaque signed cursor (digest of the normalized filter + snapshot) | absent |
| `include` | `facets` \| `membership` | `["facets"]` |

Named product-default example (guide only, never server semantics):
B axes + both display exclusions + last week + `sort: vivier_rank`.

## 3. Response shape

- `contractVersion`, coherence snapshot, `counts` with declared bases.
- `facets`, always including `facets.byCity: [{ citySlug, matched }]`
  counted on the same filter minus `citySlug` (`basis` written in response).
- `items`: strict cards, each carrying its `citySlug` plus resolved
  `zoneCodes` / `lotNos`. Never raw `props`.
- `membership` (optional, bounded): ordered ids + zone/lot unions.
  Over-ceiling = typed error, never silent truncation.
- `page`: cursor with `limit`, `nextCursor`, `truncated`.

Metamorphic rule (I-2): for every city in `byCity`,
`byCity[city] == query(city).counts.matched`, and the `byCity` sum equals the
city-less `matched`.

## 4. URL `filter.*` mapping (exhaustive over the geo filter state)

| URL key | Contract target |
| --- | --- |
| `filter.zonage` | `requireZonage` |
| `filter.residentiel` | `requireResidentielEligible` |
| `filter.precoce` | `requirePrecoce` |
| `filter.excludePiia` | `excludePiia` |
| `filter.excludeDerogations` | `excludeDerogations` |
| `filter.period` | client-resolved to `dateFrom`/`dateTo` at open (never sent) |
| `filter.dateFrom` | `dateFrom` |
| `filter.dateTo` | `dateTo` |
| `filter.dateBasis` | `dateBasis` (`acquisition` URL = `scrap`; document default unwritten; relative periods ignore it) |
| `filter.showDiscarded` | `archive` (`1` = `include`, absent = `exclude`; `only` has no URL spelling) |
| `filter.lotCategory` | out of scope: `LotFilterV1` (I-9b) |
| `filter.lotUsage` | out of scope: `LotFilterV1` (I-9b) |
| `filter.lotMinArea` | out of scope: `LotFilterV1` (I-9b) |
| `filter.zoneKind` | out of scope: `ZoneFilterV1` (I-9a) |
| `filter.zoneMillesime` | out of scope: `ZoneFilterV1` (I-9a) |
| `filter.lots` | out of scope: layer visibility (painting) |
| `filter.cptaq` | out of scope: layer visibility (painting) |
| `filter.citySearch` | out of scope: presentation search over the `byCity` facet |
| `filter.zoneSearch` | out of scope: presentation search over filtered zones |
| `filter.lotSearch` | out of scope: presentation search over filtered lots |
| `filter.subset` | legacy vivier key, normalized to B axes before mapping |
| `filter.legacyLayers` | legacy zones-only marker, maps to product defaults |

No `filter.*` key carries `citySlug` (route level), `zoneCode`
(zone focus level), `q` (no URL spelling in v1), `basket`,
`personalHistory`, `instruments`, `stages`, `regulatoryStatus`,
`legacyZmp`, `excludeAutomaticallyExcluded`, `sort`, `limit`, `cursor`,
or `include`. Those travel as explicit query arguments in I-2, never as
invented URL spellings here.

Executable translator (pure, tested): `geoFiltersToSignalFilter` in
`ui/src/lib/router/signal-query-v1-mapping.ts` applies the UI opening
rule (`excludeAutomaticallyExcluded: true`, `sort: "vivier_rank"`,
absolute-only `scrap` clock, `archive: "include"` iff the snapshot
reveals discarded signals, relative presets resolved to civil dates at
open).

## 5. Golden capture

- Fixtures (full case params, nodes, unclassified boundary node, archived
  ids): `ui/src/lib/signals/__golden__/signal-query-v1-fixtures.json`
- Expected outputs (32 cases: 16 city + 16 all-cities, incl. 2 typed
  refusals): `ui/src/lib/signals/__golden__/signal-query-v1-golden.json`
- Divergences (projection vs panel refilter): `ui/src/lib/signals/__golden__/signal-query-v1-divergences.json`
- Runner: `ui/src/lib/signals/signal-query-v1-golden.test.ts` (real client
  code paths: `projectComposedVivierB`, `keyForVivierB`,
  `filterNodesByDocumentDate` / `signalDocumentDateWindow`,
  `applyVivierBExclusions`, `rankVivierBNodes`, `nodeMatchesSubset`,
  `resultCivilDates`, `extractSignalZoneRefs/LotRefs`). Every case is first
  validated through `SignalFilterV1.safeParse` (`zoneCode` without `citySlug`
  is a typed refusal, recorded as such); `byCity` is counted on the same
  filter minus `citySlug`. Server-only dimensions (`excludeAutomaticallyExcluded:
  false` recomposition, `archive`, instruments/stages/regulatoryStatus,
  basket/personalHistory, `q`, `zoneCode` resolution) apply the documented v1
  predicate in the runner; the UI pipeline has no equivalent (gap), I-2
  implements them exactly. Owner decision D-A: the server classification is
  the reference; divergences are listed as visible gaps.

## 6. Volume thresholds (measured in I-0, enforced in I-2)

Measured in an isolated synthetic database on a deterministic production-like
corpus (seed `20261103`, 128 cities from the committed 127-slug vivier-B
denominator plus the pilot city as the heavy city; realistic JSON props,
relational lots, 60 basket heads on the heavy city; see
`api/tests/fixtures/signals-query-v1/volumes.json` and
`api/src/services/graph/signal-query-v1-volumes.test.ts`):

- 3,374 signals total, 914 max per city (pilot-city wall);
- 2,310 lots total, 639 max lots per city;
- heavy-city detail read: 914 rows / 711,059 JSON bytes;
- membership unions on the corpus: 716 distinct zone codes,
  1,354 distinct signal lot refs;
- basket search (`searchSignalClassifications`, limit 100) on the heavy
  city: 914 matched.

- `membership` ceiling: 10,000 ordered ids + unions, per request, both
  modes. Over-ceiling = typed error, never silent truncation. Covers the
  measured 3,374 (2.9× headroom), 716 zone codes, and 1,354 lot refs.
- Response stays under the existing 2,097,152-byte payload cap (heavy-city
  detail payload today: 711 kB).
- Phase-2 trigger (measured in I-2, single pass first): heaviest-city
  detail payload today > 1 MB, or all-cities fan-out p95 > 2 s, or
  `membership` demand beyond the 10,000 ceiling. Then the materialisation
  lot opens before I-6; I-3 stays served if its bounds hold.
