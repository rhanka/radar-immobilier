# Exact signal metadata, lot 1

## Scope

This implements lot 1 of the November 13 signals lazy-loading design supplied
to i-cond. City pagination and infinite scrolling belong to lot 2. Geometry
belongs to a separate lane. Existing URL preferences and city-card reads remain
in place. Selection panels and badges are outside this change.

## Canonical filter and contract

`GET /api/v1/workspaces/:workspaceId/signal-facets/by-city?contract=metadata-v2`
accepts `scope=quebec`, inclusive `dateFrom`/`dateTo`, `dateBasis=document|scrap`,
`classes=pertinent,a_surveiller,non_classe,ecarte` (any subset; `none` is empty),
`requireZonage`, `requireResidentielEligible`, `requirePrecoce`, `excludePiia`
and `excludeDerogations` (boolean flags encoded as `0|1`). Absent bounds mean
unlimited. Civil dates and date order are validated. Unknown contracts and
unsupported scopes fail with 400.

The response contains `contract`, `snapshot`, `totalMatched`, `classCounts`,
`facetCounts`, and `cities`. Every city contains `citySlug`, `matched`,
`classCounts`, `facetCounts`, and `facetsByClass`. The latter holds at most 128
five-bit/class cells, including archives. A zero-match city stays in the
response when it contributes to another facet. No individual card is returned.

Axes combine with AND; selected classes combine with OR. Each facet applies
all restrictions except itself. Relevance counts apply every non-class
restriction and ignore class selection. Exclusion counts describe what the
exclusion hides, even when it is enabled. The shared domain reduction is used
over SQL-grouped cells. Map and rail retain these bounded cells for exact local
filter feedback; they also send the active canonical criteria on metadata reads.
Loading a city cannot replace these counters with card counts.

## Projection and SQL

Migration **0049_signal_metadata** is additive and replayable. 0047 and 0048
remain reserved for the concurrent lanes. Journal indices remain contiguous;
the migration tag intentionally skips those reserved filenames.

`signal_metadata` stores one row per `(city_slug,node_type,node_id)`: classifier
version, effective document/acquisition date arrays, filter bits, the domain
rank tuple, and graph attachments. It contains neither signal properties nor
descriptions or evidence text. Out-of-universe targets retain a row with null
bits. The rank uses graph-carried publication dates with the existing ingestion
fallback. S3-only date enrichment is still a city-card concern in this lot.

Both graph import paths rebuild the city projection before publishing its
source revision, in the same transaction and under the city advisory lock.
Deletion cascades from the graph identity. The idempotent backfill takes the
same lock and uses the same projection function. `signal_metadata_versions`
records completion/version per city. Missing rows or versions produce an
explicit 503 `signal_metadata_backfill_required`; there is no payload fallback.

The authorized read uses a repeatable-read transaction. It validates session,
approved account, workspace membership, scoped activation and resolved personal
history. SQL joins authorized active personal heads and workspace archives.
Priority is archive, pertinent, watch, AI, unclassified. Any manual history
suppresses AI for the target across readers, without exposing another reader's
private state. The query groups fine rows by city, bits and effective class.
Date windows use `EXISTS (unnest(...))`: multiple matching dates count once.
Aggregation never selects graph properties, descriptions or proofs.

The private response snapshot binds the PostgreSQL MVCC snapshot to the viewer,
workspace and projection version. No application cache is introduced here.
Durable scope cache invalidation remains lot 3.

## Activation and rollback

1. Apply migration 0049, then fully roll out the new API/writers while the old
   UI keeps using the unversioned contract. Finish replacing old writers before
   backfilling; old writers do not maintain this projection.
2. Run `make db-backfill-signal-metadata SKIP_DOTENV=1 ENV=<isolated-env>` using
   the target environment's injected database configuration. Compose invocations
   in this lane also use `--env-file /dev/null`.
3. Qualify PostgreSQL parity, plans, the unlimited budget and real UI clicks.
4. Activate the new UI as part of the coordinated API/UI release after the
   backfill has been verified. Existing clients without `contract` keep the
   previous aggregate contract. metadata-v2 clients fail visibly against an old
   API. They never switch to full city cards to build metadata.
5. Roll back API and UI together. Leave the additive tables in place. Rebuilding
   and replaying the migration are safe; never remove data for rollback.

The old unversioned contract remains for other current callers, including the
live feed. It can be removed only after those callers have migrated.

## Qualification

- Unit matrix: 8 axes combinations × 4 exclusions × 16 class selections.
- PostgreSQL: current cube parity, dates including unknown/multiple dates,
  idempotent projection, rollback, two readers/workspaces, AI/manual precedence,
  explicit HTTP versioning, old client and migration-journal replay.
- Plans: `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` must contain no graph payload
  relation or properties, descriptions or evidence text.
- Local benchmark: 21,615 targets in 763 cities, real golden classifier corpus
  repeated with synthetic identities and 8 KB evidence padding. First metadata
  call, no application cache; PostgreSQL buffers uncontrolled after projection
  writes. Metadata is measured first, legacy second. This is a synthetic local
  cardinality match, not a production restore or a browser-render measurement.
- Real-stack Playwright: native clicks on period, relevance, axes, exclusions
  and city; exact counters, canonical URL, no cards before city selection.

One local sample on November 13: old scoped aggregate **628.884 ms** and
**916,284 JSON bytes**; metadata-v2 **141.048 ms** and **229,834 JSON bytes**.
The timers surround authorized service reads. HTTP transport, JSON serialization
and browser rendering are outside the timer; JSON bytes are measured separately.
This is 4.46 times faster and 74.9% smaller on this fixture. The subsequent
EXPLAIN execution took **19.559 ms**, with 621 shared-buffer hits and no reads.
The application-cold budget of one second passed. These numbers do not establish
a cold PostgreSQL disk-cache result or a production/browser rendering result.

Typecheck, lint and 28 targeted UI tests passed. Final API and real-click
qualification results and commands are recorded in the PR report.
