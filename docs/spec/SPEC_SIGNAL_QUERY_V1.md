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

## 5. Golden capture

- Fixtures: `ui/src/lib/signals/__golden__/signal-query-v1-fixtures.json`
- Expected outputs: `ui/src/lib/signals/__golden__/signal-query-v1-golden.json`
- Divergences (projection vs panel refilter): `ui/src/lib/signals/__golden__/signal-query-v1-divergences.json`
- Runner: `ui/src/lib/signals/signal-query-v1-golden.test.ts` (real client
  code paths: `projectComposedVivierB`, `filterNodesByDocumentDate`,
  `applyVivierBExclusions`, `rankVivierBNodes`, `nodeMatchesSubset`,
  `matchesDocumentDateWindow`, `extractSignalZoneRefs/LotRefs`).

## 6. Volume thresholds (measured in I-0, enforced in I-2)

Measured on the test DB with documented seeds (`i0-vol-a/b/c`, 6+3+3 = 12
signal rows; see `api/tests/fixtures/signals-query-v1/volumes.json`):
per-city reads return the full visible population with raw `props`
(`i0-vol-a`: 6 rows / 6,514 JSON bytes / 2 ms; `i0-vol-b/c`: 3 rows /
5,248 bytes / 0-1 ms; city aggregate over the seeded slugs: 9 ms).
These seeds are small by design (method proof, not a production census —
the commented corpus is ~3,294 signals with a ~914-signal wall for a large
city in B view): I-2 re-measures on the real corpus before enforcing.

- `membership` ceiling: 10,000 ordered ids + unions, per request, both
  modes. Over-ceiling = typed error, never silent truncation. Covers the
  measured 12 plus the commented ~3.3k corpus with headroom.
- Response stays under the existing 2,097,152-byte payload cap.
- Phase-2 trigger (measured in I-2, single pass first): heaviest-city
  detail payload today > 1 MB, or all-cities fan-out p95 > 2 s, or
  `membership` demand beyond the 10,000 ceiling. Then the materialisation
  lot opens before I-6; I-3 stays served if its bounds hold.
