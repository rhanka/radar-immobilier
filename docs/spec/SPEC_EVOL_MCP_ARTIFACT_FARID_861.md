# SPEC_EVOL — MCP & Artifact Low-Effort Improvements (Farid #861 + Preprod 19/11)

Status: proposed specification (no implementation in this branch).
Base commit audited: `ac88f051b` (`origin/main`, post-preprod `3cec0e3`).
Inputs: PO UAT feedback on issue #861 ("Signaux à traiter", 2026-11-18) and complementary preprod MCP findings (2026-11-19).
Scope discipline: strictly low-effort (`S`), backwards-compatible, indisputable improvements that preserve existing architecture, data models, policies, and frozen `artifacts_*` tool-definition hashes.

---

## 1. Retained Evolutions (Lot Scope — All Effort `S`)

### EVO-1 — Document `/__reader/app/api/*` relay, facet write payloads, inactive `selection` heads, and exact-byte `maxSize` in `authoringGuide`

- **Problem**: The MCP authoring guide lists only read-only `GET /__reader/api/*` endpoints and omits the generic RW relay (#1076), scoped signal-facet write payloads, `selection` inactive-head semantics, and the no-padding rule for `artifacts_create_upload`'s `maxSize`.
- **Code proof**: `api/src/artifacts/reader-relay.ts:25-111` & `api/src/artifacts/content-serve.ts:206-211,651-675` (RW relay active); `packages/immo-mcp/src/registry/artifact-authoring-guide.ts:251,362-404,446` (read-only guidance only; `maxSize` wording leaves padding ambiguity); `api/src/routes/scoped-signal-facets.ts:31-35,50-65,88-115` & `api/src/services/facets/scoped-transition.ts:74-96` (full write contract); `api/src/routes/scoped-projection-revisions.ts:161-162` & `api/src/services/facets/classification-heads.ts:43-44` (`selection` retains `state: "inactive"` heads for `expectedHeadId`).
- **Minimal change**: Add an additive `relay` section (under `data`) in `packages/immo-mcp/src/registry/artifact-authoring-guide.ts` documenting: (1) `/__reader/app/api/*` usage (`x-preview-grant`, same-origin proof on writes, no basket-consent gate); (2) exact `POST /__reader/app/api/v1/workspaces/:workspaceId/signal-facets/personal/{select,deselect,discard,restore,reclassify}` schemas (`Idempotency-Key` UUID, `expectedHeadId`, `displayedFingerprint`, and `expectedSelectionHeads` only when `deselect` is non-empty with identical keys, noting short forms are pre-6B receipt replay only); (3) `selection` includes `state: "inactive"` heads for `expectedHeadId` so UIs must filter `state === "active"`; (4) `artifacts_create_upload`'s `maxSize` is an exact UTF-8 byte count (measure first, never pad). Bump `BASE_GUIDE_REVISION` (`r7` → `r8`). Leave `STABLE_TOOL_SUMMARIES` and `AUTHORING_GUIDE_SNIPPET` untouched so frozen tool hashes stay byte-identical.
- **Testable acceptance criterion**: `getAuthoringGuide()` exposes the bumped revision, documents `/__reader/app/api/*`, required write fields, `expectedSelectionHeads`/`deselect` coupling, `state === "active"` filtering, and exact-byte `maxSize` without padding; all existing `artifacts_*` tool definition hashes remain unchanged.
- **Test to add**: Extend `packages/immo-mcp/src/registry/artifact-authoring-guide.test.ts` to assert the new guide entries and bumped revision, and verify `packages/immo-mcp/src/registry/artifact-tool-definitions-hash.test.ts` passes untouched.
- **Regression risk**: Low (additive response data in `authoringGuide`; check guide size growth stays minimal, < 3 KiB).
- **Effort**: `S`.

### EVO-2 — Add an additive RW relay helper (`appFetch`) to `STARTER_READER_JS`

- **Problem**: The starter `reader.js` template exposes only read-only `GET /__reader/api/*` helpers and drops request bodies in `timedFetch`, forcing every write-capable page to hand-roll grant renewal and relay calls.
- **Code proof**: `packages/immo-mcp/src/registry/starter-files.ts:196-371` (`timedFetch` at `:254-266` omits `init.body`; `window.ImmoReader` at `:362-369` exposes only `workspaces`, `context`, `search`, `ensureGrant`, `reopenUrl`, `ReadError`); `packages/artifacts-host/src/reader-bridge-compat.ts:28-32` (`isLegacyReaderBridge` targets only pre-I2 bridges lacking `basket_consent_required`).
- **Minimal change**: Forward `init.body` in `timedFetch` (`starter-files.ts:257-259`) and expose an additive `window.ImmoReader.appFetch(apiPath, options)` method that validates `apiPath.startsWith("/api/")`, calls `ensureGrant()`, fetches `/__reader/app${apiPath}` with `credentials: "same-origin"` and `x-preview-grant: grant`, serializes JSON bodies with `Content-Type: application/json`, supports optional `idempotencyKey` (`Idempotency-Key` header), and throws `ReadError` with `status`, `code`, and optional `detail`/`current` on non-2xx. Keep all existing `ImmoReader` methods unchanged; bump `STARTER_VERSION` (`1.1.0` → `1.2.0`).
- **Testable acceptance criterion**: `window.ImmoReader.appFetch("/api/v1/workspaces/...", { method: "POST", body: {...}, idempotencyKey })` renews expired grants, sends `x-preview-grant` and `Idempotency-Key`, rejects non-`/api/` paths locally, and preserves existing `workspaces`/`context`/`search` behavior identically.
- **Test to add**: Add unit cases in `packages/immo-mcp/src/registry/starter-reader.test.ts` (GET/POST via `appFetch`, grant renewal, `Idempotency-Key`, error mapping, non-`/api/` rejection) and verify `packages/artifacts-host/src/reader-bridge-compat.test.ts` stays green.
- **Regression risk**: Low (purely additive method; published pages keep their own pinned `reader.js`, and `isLegacyReaderBridge` does not match v1.1+/v1.2).
- **Effort**: `S`.

### EVO-3 — Add sanitized diagnostic `detail` on `400 invalid_facet_command` in scoped signal-facet routes and align `discard` refinement

- **Problem**: `POST /api/v1/workspaces/:workspaceId/signal-facets/personal/*` returns bare `{ error: "invalid_facet_command" }` for every 400 (missing `Idempotency-Key`, missing fields, unfound pre-6B receipt, or `expectedSelectionHeads`/`deselect` mismatch) with no clue about the offending field.
- **Code proof**: `api/src/routes/scoped-signal-facets.ts:60-63` (`discard` schema omits the `superRefine` from `api/src/routes/signal-facets.ts:29-46`); `api/src/routes/scoped-signal-facets.ts:94,95,100,123`; `api/src/services/facets/scoped-writer.ts:65,221`; `api/src/services/facets/scoped-transition.ts:81,89,94`; `api/src/services/facets/target.ts:11-15` (`FacetError` lacks `detail`).
- **Minimal change**: Add optional `readonly detail?: string` on `FacetError` (`target.ts:11-15`), serialize `{ error: error.message, ...(error.detail ? { detail: error.detail } : {}) }` in `scoped-signal-facets.ts:123`, mirror `signal-facets.ts:29-46`'s `discard` `superRefine` in `scoped-signal-facets.ts:60-63`, and emit closed-vocabulary / field-path-only `detail` strings (`missing_or_invalid_idempotency_key`, `historical_receipt_not_found`, `expected_selection_heads_forbidden_without_deselect`, `expected_selection_heads_keys_must_match_deselect`, or `invalid_fields:<sorted-zod-paths>` — never echoing raw input values). Keep HTTP status `400`, `error: "invalid_facet_command"`, and lot-facet routes unchanged.
- **Testable acceptance criterion**: Each distinct 400 cause on `scoped-signal-facets` returns HTTP `400` with `error: "invalid_facet_command"` and a deterministic, value-free `detail` identifying the cause; valid commands and pre-6B receipt replays behave identically.
- **Test to add**: Extend `api/src/routes/scoped-signal-facets-db.test.ts` (and/or a lightweight route test) covering missing `Idempotency-Key`, unknown historical short-form receipt (`historical_receipt_not_found`), `discard` with `expectedSelectionHeads` and no `deselect`, and missing `displayedFingerprint`.
- **Regression risk**: Low (additive JSON field; verified zero exact `.toEqual({ error: "invalid_facet_command" })` assertions on signal-facet routes across `api/` — the lone exact assertion at `api/tests/integration/base-api-lot-transitions.spec.ts:124` covers lot facets only).
- **Effort**: `S`.

### EVO-4 — Accept `filter.period=30d` as a read-only URL alias for `1mo` in the Signals UI filter parser

- **Problem**: Opening the Signals UI with `?filter.period=30d` silently falls back to `all` and displays "Illimité" because the canonical preset token is `1mo`.
- **Code proof**: `ui/src/lib/signals/signal-date-filter.ts:32-42` (presets: `7d`, `1mo` = "Dernier mois" / `30 * DAY_MS`, `3mo`, `6mo`, `12mo`, `all`); `ui/src/lib/router/geo-filter-state.ts:54,102-122` (`RELATIVE_PERIODS.has("30d")` is `false`, falling through to `unrestrictedTimeRange()`).
- **Minimal change**: Following the existing read-alias pattern in `ui/src/lib/router/geo-filter-state.ts:124-131` (`dateBasis=scrap` → `acquisition`), map `PERIOD_ALIASES = { "30d": "1mo" }` in `readTimeRange` and `hasExplicitPeriod` (`:102-122`). Keep `writeGeoFilters` emitting the canonical `1mo` token unchanged.
- **Testable acceptance criterion**: `readGeoFilters({ period: ["30d"] })` resolves to `{ mode: "relative", relative: "1mo", ... }` ("Dernier mois"), works on legacy `subset=vivier-v2` links too, and `writeGeoFilters` canonicalizes it to `{ period: ["1mo"] }`.
- **Test to add**: Add a case to `ui/src/lib/router/geo-filter-state.test.ts` verifying `period: ["30d"]` reads as `1mo` and round-trips to `period: ["1mo"]`, while unknown tokens (e.g. `2w`) retain existing fallback behavior.
- **Regression risk**: Very low (single read-only alias; no existing preset or test uses `30d`).
- **Effort**: `S`.

### EVO-5 — Preserve the resolved `workspaceId` in `search_signals` MCP responses

- **Problem**: All four scoped signal tools require `signalRef.workspaceId`, yet no MCP tool exposes a workspace UUID — `search_signals` receives `workspaceId` from the API and discards it, leading callers to try `artifacts_list`'s `ownerId` (rejected with `workspace_membership_required`).
- **Code proof**: `packages/immo-mcp/src/signal-contract.ts:5-21` (`workspaceId` required); `packages/artifacts-host/src/read-metadata.ts:57-63` & `read-metadata.test.ts:26-30` (`artifacts_list` returns upstream `ownerId`, not `workspaceId`); `packages/immo-mcp/src/signal-tools.ts:28-29` & `api/drizzle/0048_signal_mcp_write.sql:64-66` (rejects non-member UUID); `api/src/services/facets/mcp-signal-search.ts:87,105` (API returns `workspaceId`); `packages/immo-mcp/src/signal-search-response.ts:14-29` (parses `workspaceId` then drops it); `packages/immo-mcp/src/tool-handlers.ts:145-146` (omits `workspaceId`).
- **Minimal change**: Return `{ signals, workspaceId }` from `parseSignalSearchResponse` / `HttpDataSource.searchSignals` (keeping mock mode `workspaceId` omitted) and include optional additive `workspaceId` in `searchSignalsHandler` (`{ source, ...(workspaceId ? { workspaceId } : {}), city, count, signals }`). Zero DB migration, zero grant change, zero input-schema or frozen tool-definition change.
- **Testable acceptance criterion**: In live `http` mode, `search_signals` includes the API-resolved `workspaceId` UUID alongside `source`, `city`, `count`, `signals`; in fixture mode, output is unchanged; callers can pass that `workspaceId` directly into `get_signal_classification` / `classify_signal` / `annotate_signal`.
- **Test to add**: Update `packages/immo-mcp/src/signal-search-response.test.ts` and `packages/immo-mcp/src/data-source.test.ts` to assert `workspaceId` passthrough; normalize optional `workspaceId` in `packages/immo-mcp/src/deployed-baseline.test.ts` (same pattern as `source` at `:51-66`).
- **Regression risk**: Low (additive JSON field on live response only; single-workspace users are unblocked immediately; multi-workspace discovery remains in §3).
- **Effort**: `S`.

### EVO-6 — Clarify workspace archive-only scope and `history` vs `mcpHistory` in signal-tool descriptions

- **Problem**: `classify_signal` and `get_signal_classification` tool descriptions do not state that `scope: "workspace"` accepts only `classe: "ecarte"` (causing `workspace_archive_only` surprises when `moderateArchive: true`) or that MCP writes appear in `mcpHistory` rather than global AI `history`.
- **Code proof**: `packages/immo-mcp/src/signal-contract.ts:26,30` (descriptions omit workspace archive-only rule and `mcpHistory`); `api/drizzle/0048_signal_mcp_write.sql:128-130,145-147,225-229` (`moderateArchive`, `history` = `signal_class_annotation_history`, `mcpHistory` = `signal_mcp_events`, `workspace_archive_only`).
- **Minimal change**: Update two description strings in `packages/immo-mcp/src/signal-contract.ts:26,30` before prod activation (`IMMO_MCP_SIGNALS_WRITE_ENABLED="0"` in prod): clarify on `classify_signal` that `scope: "workspace"` only accepts `classe: "ecarte"` (requires `moderateArchive`) and `non_classe` requires human confirmation, and on `get_signal_classification` that `history` is global AI history while `mcpHistory` is the scoped MCP/manual journal. Signal tools are outside `artifact-tool-definitions-hash.test.ts:51-70`.
- **Testable acceptance criterion**: `SIGNAL_TOOL_DEFINITIONS` surfaces both rules in `tools/list`; `artifact-tool-catalogue-stability.test.ts` and `artifact-tool-definitions-hash.test.ts` pass unchanged.
- **Test to add**: Add an assertion in `packages/immo-mcp/src/signal-tools.test.ts` checking `classify_signal` and `get_signal_classification` descriptions state these invariants.
- **Regression risk**: Very low (text-only on signal tools still inert in prod; no schema, runtime, or policy change).
- **Effort**: `S`.

---

## 2. Discarded Findings (Not Platform Code Defects or Unverified)

- **Classified signals vanish after page reload (Farid #7)**: Behavior of the specific "unclassified queue" page built during #861, not a platform limitation; `/__reader/app/api/*` already supports listing classified items and calling `deselect`/`restore`/`reclassify` (`api/src/artifacts/reader-relay.ts:25-111`, `api/src/routes/scoped-signal-facets.ts:88-133`).
- **Preprod workspace UUID changed since #760 (Farid #8a)**: Preprod data re-provisioning, not a code bug; reinforces dynamic workspace resolution (`workspaces.list.v1` in pages, EVO-5 in MCP).
- **Padding files to `maxSize` for S3 upload (Farid #2 premise)**: Code confirms `maxSize` binds S3 `Content-Length` to the exact byte length supplied (or defaults to 16 MiB when omitted — `packages/artifacts-host/src/p0b-uploads.integration.test.ts:110-160`, `artifact-authoring-guide.ts:251,446`); no padding is ever required when passing `maxSize: bytes.length` (clarified in EVO-1).
- **Drummondville PPCMOI specific record ("23 logements" missing 4+ flag, Farid #5 data instance)**: Live preprod DB was not queried per read-only audit scope; the underlying code predicate `isMulti4Plus` (`api/src/services/graph/graph-store.ts:2017-2029`) is confirmed and tracked in §3.

---

## 3. Out of Scope / To Decide (Hors lot, à décider)

1. **Server-side "signals to triage" cross-city queue & `by-city` latency (Farid #6)**: Replacing 23 client calls (~14 s, ~6 s in `readScopedByCity`, `api/src/services/facets/scoped-by-city.ts:28-119`) with a cross-city queue endpoint is a medium/heavy API evolution.
2. **Server-side "signal strength" score and 4+ units text extraction (Farid #5)**: Adding a signal strength score or parsing unit counts from `label`/`description` beyond `isMulti4Plus` (`api/src/services/graph/graph-store.ts:2017-2029`) requires extraction/scoring model work.
3. **Accepting short-form `{target, basket}` writes or removing `historicalSchemas` (Farid 400 #1)**: Bypassing `expectedHeadId`/`displayedFingerprint` (`api/src/services/facets/scoped-writer.ts:53-55,194-224`) or dropping pre-6B receipt recovery alters the 6A/6B write contract.
4. **Accepting `expectedSelectionHeads: { pertinent: null, a_surveiller: null }` without `deselect` (Farid 400 #2)**: Relaxing `assertScopedExpectations` (`api/src/services/facets/scoped-transition.ts:74-96`) diverges from `signal-facets.ts`, `write-intent-schemas.ts`, and 6A composite-discard guarantees.
5. **Filtering `state: "inactive"` heads out of `selection` responses (Farid #4)**: Omitting inactive heads from `coherent-city` (`scoped-projection-revisions.ts:161`) or `baskets.search.v1` (`classification-heads.ts:43-44`) breaks `expectedHeadId` tracking on re-selection.
6. **Dedicated MCP `list_workspaces` tool for multi-workspace accounts (i-cond #1)**: Listing all active workspaces with labels/slugs (when `search_signals` returns `workspace_ambiguous` or before any search) requires a `SECURITY DEFINER` SQL migration + role grant (`api/src/db/service-role-grants.ts:48-51`) or widening A2 token exchange (`packages/immo-mcp/src/authorized-egress.ts:9,66`).
7. **Allowing non-`ecarte` classifications in `scope: "workspace"` via MCP (i-cond #2)**: Workspace scope is intentionally archive-only (`0048_signal_mcp_write.sql:225-229`, `class-feedback-command.ts:28-30`); lifting it is a governance policy change.
8. **Merging `mcpHistory` into `history` in `get_signal_classification` (i-cond #3)**: Unifying global AI `signal_class_annotation_history` and scoped `signal_mcp_events` (`0048_signal_mcp_write.sql:128-130,146-147`) changes the data model and response contract.
9. **Relaxing human confirmation on `non_classe` or allowing `confirm_classification(verdict="down")` without reclassification (i-cond #4)**: Both `human_confirmation_required` (`0048_signal_mcp_write.sql:216-217`) and `reclassification_required` (`signal-tools.ts:42-45`, `0048_signal_mcp_write.sql:207-208`) are intentional safety policies.
10. **Widening reader sharing beyond view-only grants (Farid aside / Owner policy)**: Changing `artifacts_set_access` (`artifact-authoring-guide.ts:259-260,451-457`) beyond read-only is an access-control policy decision.
11. **Ranged S3 upload signing or requiring `maxSize` in `artifacts_create_upload` input schema (Farid #2)**: Switching from exact `Content-Length` PUT (`packages/artifacts-host/src/composition.ts:146`) or modifying `inputSchema` requires upstream `@sentropic/artifacts` changes and breaks the frozen tool-definition hash (`artifact-tool-definitions-hash.test.ts:80`).
12. **Serving the 84 KB `authoringGuide` as a separate MCP resource or tool (Farid test table)**: Splitting `authoringGuide` out of `artifacts_ensure`/`artifacts_get` (`artifact-authoring-guide.ts:10-11`, `artifact-provider.ts:492-504`) is a medium transport evolution to reconsider if context pressure grows.
