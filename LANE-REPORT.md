# Lane report — FIX #1063 « MCP immo : des données de test servies comme réelles »

- Repo: `rhanka/radar-immobilier`, fresh clone `radar-immobilier-fix-1063` from `main` @ `098fe62ad`
- Branch: `fix/immo-mcp-no-fixture-in-real-1063` — PR to `main`, **not merged**
- Issue: [rhanka/radar-immobilier#1063](https://github.com/rhanka/radar-immobilier/issues/1063)

## 1. Root cause (evidence-first)

Two different servers share the same twelve tools (`packages/immo-mcp/src/tool-definitions.ts`, handlers in `src/tool-handlers.ts`):

| Server | Entrypoint | Source selection |
|---|---|---|
| Local `immo` connector (stdio) | `src/server.ts` `buildImmoServer()` | **Always fixtures**: it calls `createDataSource({})` / `createRawDataSource({})` with an empty env, sets `dataMode: "simulation"` and logs `mode=synthetic`. `RADAR_API_BASE_URL` is deliberately ignored (synthetic claims are not a verified identity — pinned by `stateful-composition.test.ts`: “confine synthetic stdio claims to fixtures despite inherited storage and API settings”). |
| Connected MCP (preprod/prod, OAuth HTTP) | `src/server-http.ts` `main()` | `createDataSource(process.env)` / `createRawDataSource(process.env)`: `RADAR_API_BASE_URL` set → `http`, unset → `mock`. The startup line `dataMode=real domainMode=http rawMode=http` mixed two facts: `dataMode` was a **label** derived from `IMMO_MCP_DATA_MODE === "http"` (label only, never selected a source), while `domainMode`/`rawMode` were the actual seam modes. |

Why `search_signals(longueuil)` returned `sig-longueuil-001` / `CO-2026-1187` on the local connector: the stdio server is in **mock mode with no endpoint at all** — `MockDataSource.searchSignals` filters the in-memory `MOCK_SIGNALS` (`src/mocks.ts`), which contain exactly `sig-longueuil-001` (règlement `CO-2026-1187`, zone `H-203`, lots `6 359 591` / `6 359 612`). `search_signals(coaticook)` returns 0 because no Coaticook fixture exists — not because the base is empty. Nothing in the response marked this as fixture data, so it was presented as real.

On the preprod (http) seam with `RADAR_API_BASE_URL` set, `get_lot_card` already failed — but with `not_wired_yet:…`, and no response carried a provenance marker.

## 2. Tool-by-tool map (12 tools)

Modes: `mock` = fixture seam (stdio always; http when `RADAR_API_BASE_URL` unset), `http` = live radar API seam.

| Tool | mock seam | http seam (connected) | Real endpoint when live |
|---|---|---|---|
| `search_signals` | fixture (`MOCK_SIGNALS`) | **live** | `GET /api/v1/mcp/facets/signals/search` (`SIGNAL_SEARCH_PATH`, delegated per-user token) |
| `search_lots` | fixture (`MOCK_LOTS`) | **not_wired** | — (see separate lot below) |
| `get_lot_card` | fixture (`MOCK_LOTS`) | **not_wired** | — (see separate lot below) |
| `get_opportunity_dossier` | fixture | **not_wired** | — |
| `list_documents` | fixture (`MOCK_DOCUMENTS`) | **not_wired** | — |
| `read_document_excerpt` | fixture (mock bodies) | **not_wired** | — |
| `get_zones_geojson` | fixture (`MOCK_ZONE_FEATURES`) | **live** | `GET /api/geo/collections/qc-zonage-<slug>/items` |
| `get_lots_geojson` | fixture (`MOCK_LOT_FEATURES`) | **live** | `GET /api/geo/collections/qc-lots-<slug>/items` |
| `get_grille_pdf` | fixture | **live** | `qc-zonage-<slug>` collection lookup |
| `get_pv_pdf` | fixture | **live** | `GET /api/documents/raw?rawRef=` |
| `get_reglement_provenance` | fixture | **live** | `qc-zonage-norms-<slug>` collection |
| `query_zoning_events` | fixture | **live** | `qc-zoning-events-<slug>` collection |

## 3. Fix (this PR)

1. **Every response carries `source: "live" | "fixture"`** — added in `src/tool-handlers.ts` for all twelve tools (derived from the actual seam mode: `http` → `live`, `mock` → `fixture`), including GeoJSON payloads and `found: false` answers. Error responses built in `invokeTool` (`src/tools.ts`) carry it too.
2. **Explicit `not_wired` error, no fixture fallback** — `HttpDataSource.notWired` now throws `not_wired:http_data_source …` (was `not_wired_yet:…`). The five unwired domain tools fail explicitly in http mode; they never fall back to mocks.
3. **Connected server fails closed** — `server-http.ts` `main()` refuses to start without `RADAR_API_BASE_URL` (`config_error: … would serve fixture data as real`). The startup log now derives `dataMode` from the actual seam mode instead of the unrelated `IMMO_MCP_DATA_MODE` label.
4. **Contract test** — new `src/source-provenance.test.ts`: in real (http) mode all twelve tools are invoked through the production `invokeTool` path against a stubbed live API; unwired tools must be `isError` + `not_wired` with `source: "live"`, wired tools must return `source: "live"`, no response may carry `source: "fixture"` or fixture identifiers (`sig-longueuil-001`, `CO-2026-1187`); in simulation mode every response must be labelled `source: "fixture"`.
5. **Baseline evolution** — `deployed-baseline.test.ts` keeps the historical deployed capture byte-anchored; its `normalize` now canonicalises the two deliberate contract changes (`source` field, `not_wired:` prefix), same amendment pattern as the earlier `showDiscarded` one. Two live-expectation tests updated (`not_wired_yet` → `not_wired`); the historical fixture file itself is untouched.
6. README documents the provenance contract and the fail-closed startup.

### Separate lot — `get_lot_card` (and `search_lots`) wiring

Not done here, deliberately: no existing route can answer a single-lot query.
`GET /api/geo/:city/lots` (`api/src/routes/geo-lots.ts`) returns the first N lots with no `no_lot` filter, and the OGC `qc-lots-<slug>` collection is paginated the same way — scanning from the MCP could return a false `found: false` for a lot beyond the fetched page, i.e. replace one misleading answer with another.

Proposed lot (owner: to be assigned):
- Scope: add a `no_lot` filter (or `GET /api/geo/:city/lots/:noLot`) to the geo-lots route backed by `lot_versions` (city slug + `no_lot`), then wire `HttpDataSource.getLotCard` / `searchLots` to it; `get_zones_geojson` / `get_lots_geojson` are already live (table above, covered by the contract test).
- Acceptance: with `RADAR_API_BASE_URL` set, `get_lot_card(longueuil, <real cadastral no.>)` returns the base row with `source: "live"`, an unknown lot returns `found: false` (never a fixture), and the #1063 contract test is extended to move `get_lot_card`/`search_lots` from the not-wired list to the live list.
- The same pattern then applies to `get_opportunity_dossier` / `list_documents` / `read_document_excerpt` (issue items, not wired here).

## 4. Verification (local, `ENV=test-fix1063`, Make-only)

- Repro before fix: `make test-immo-mcp SCOPE=src/source-provenance.test.ts ENV=test-fix1063` → 3 failed (`source` undefined, `not_wired_yet` prefix).
- After fix: same command → 3 passed.
- Full package suite: `make test-immo-mcp ENV=test-fix1063` → **604 passed, 9 skipped, 74 files passed**.
- `make typecheck ENV=test-fix1063` → PASS. `make lint ENV=test-fix1063` → PASS (1 pre-existing warning in `api/tests/filtrage-golden-parity.spec.ts`, untouched file).
- Commits carry no `Co-Authored-By`, `Claude-Session` or “Generated with” line. No Python used in repo code. `.env` never read.
- CI: see PR (filled in below after push).

## 5. Residual / deployment note

- Preprod/prod pods must set `RADAR_API_BASE_URL`; after this PR the HTTP server will refuse to start without it (previously it would have served fixtures under OAuth). Verify the preprod deployment env before rollout.
- The local stdio `immo` connector remains a synthetic fixture server by design; its answers are now labelled `source: "fixture"` on every response, so fixture data can no longer be mistaken for real data.
