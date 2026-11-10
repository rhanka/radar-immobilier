# Lane report — artifact mockup « focus signal » — v2 real data

- Branch: `artifact/p/bbfae795/focus-signal-h203`
- Previous lane commit: `5bfb9624` (data found fictitious by the conductor, replaced below)
- Base: `preview-combo` @ `a89a3cc9`
- No push to `main`, no PR, no MCP publish call (conductor publishes).

## Blocking defect — root cause (evidence)

The v1 cases (`sig-longueuil-001`, `CO-2026-1187`, zone `H-203`, lots
`6 359 591` / `6 359 612`, `sig-valleyfield-001`, `PPU-2026-007`, `H-410`,
lot `5 870 223`) came from the immo MCP seam. Verified 2026-11-10:

- `mcp__immo.search_signals(city=longueuil)` returns `sig-longueuil-001`,
  but the preprod DB (`radar_next.graph_nodes`) holds exactly one
  Longueuil `Signal` (`signal-longueuil-derogation-zone-contraintes-2026`)
  plus three `event-longueuil-derogation-*` nodes. The MCP ids do not
  exist in the DB.
- `mcp__immo.search_signals(city=coaticook)` returns 0 signals while the
  DB holds 56 Coaticook `Signal` nodes. The MCP connector used by the
  previous lane is therefore not a real-data source for these cities and
  is not used in v2.

v2 source of truth: preprod DB read-only (`radar_next` on
`radar-postgres-0`, namespace `radar-immobilier-preprod`, kubeconfig
`~/.kube/radar-preprod-tenant.kubeconfig`, every query prefixed with
`SET default_transaction_read_only=on`). `signals`/`documents` tables are
empty; real data lives in `graph_nodes`, `zone_versions`, `lot_versions`.

## Cases chosen (all real, 2026-11-10)

1. Lévis — `signal-levis-densification-L0054`, avis de motion 2026-03-31,
   zone `L0054`: PV excerpt (p. 21) raises max height to 4 storeys / 18 m
   for classes C700 and L300 and removes the C700 floor-area cap. Three
   real lots intersecting the zone (PostGIS) carry the valuation.
2. Coaticook — `signal-coaticook-rezonage-c416`, projet de règlement
   2026-02-09: PV excerpt (p. 23 of PV20260209) names the four real lots
   moved from RB-414 / P-412 into C-416 (real signal↔lot link in the PV
   text). No residential template in the PV: valuation stays source-gap.
3. Rosemère — `signal-rosemere-rezonage-lot-3005325-2026`, second projet
   2026-03-09, règlement `801-70`: PV excerpt (p. 5) includes lot
   `3 005 325` in zone C-18 « sans changement ». Zone geometry absent
   from `zone_versions`: explicit source-gap.

## Provenance table (exact query or URL per value)

Access pattern for every DB row below:
`kubectl --kubeconfig ~/.kube/radar-preprod-tenant.kubeconfig -n radar-immobilier-preprod exec radar-postgres-0 -- psql -U radar -d radar_next -c "<SQL>"`,
each SQL prefixed by `SET default_transaction_read_only=on;`.

| Value shown | Exact source |
| --- | --- |
| Signal ids, stages, dates, descriptions, excerpts, pages | `SELECT props FROM graph_nodes WHERE id='<signalId>'` for the three ids above |
| Lévis excerpt p. 21, 4 storeys / 18 m, C700 cap removal | Same query, `signal-levis-densification-L0054` (docSha `1839a794…`) |
| Coaticook excerpt p. 23, lots and ex-zones RB-414/P-412 | Same query, `signal-coaticook-rezonage-c416` (docSha `8c4662d3…`, sourceUrl `coaticook.ca/upload/DOCUMENTS/PV/PV20260209.pdf`) |
| Rosemère excerpt p. 5, règlement 801-70, lot 3 005 325 | Same query, `signal-rosemere-rezonage-lot-3005325-2026` (docSha `d302f381…`) |
| Zone areas (L0054 947 711 m²; C-416 16 851; RB-414 49 104; P-412 79 058) | `SELECT code_affiche, round(ST_Area(geom::geography)) FROM zone_versions WHERE city_slug='<city>' AND code_norm IN (...)` |
| Lot areas (Lévis 4 174 / 9 139 / 10 467 m²; Coaticook 1 115 / 508 / 2 111 / 1 136 m²; Rosemère 4 238 m²) | `SELECT no_lot, round(ST_Area(geom::geography)) FROM lot_versions WHERE city_slug='<city>' AND no_lot_norm IN (...)` |
| Lévis lots inside L0054 | `SELECT l.no_lot, ST_Area(...) FROM lot_versions l JOIN zone_versions z ON z.city_slug='levis' AND z.code_norm='L0054' AND ST_Intersects(l.geom, z.geom) WHERE l.city_slug='levis'` |
| Rosemère zone C-18 label | `SELECT id, label FROM graph_nodes WHERE type='Zone' AND id='zone-rosemere-C-18'` (geometry absent from `zone_versions`: source-gap) |
| Median condo price Lévis 299 000 $ | Centris community profile, Lévis (Desjardins), fetched 2026-11-10: https://www.centris.ca/en/tools/community-profile/province-of-quebec/levis-desjardins |

## Real vs simulated incorporation

- Real: every signal, stage, date, excerpt, zone code, lot number, area
  and the Lévis price above.
- Incorporation simulée (badged in UI): Lévis lot↔signal link by spatial
  intersection with the signal zone; application of the real 4-storey
  parameter to real lot areas.
- Source-gaps shown, never filled: zoning grids (CES/COS), lot role
  values and servicing (empty `evidence` in `lot_versions`), Coaticook
  and Rosemère prices, Rosemère C-18 geometry, Coaticook/Lévis bylaw
  numbers (absent from the PV excerpts read).

## Formulas (LotAI-inspired, unchanged from v1)

- Gross floor (upper bound, no CES grid) = lot area × authorised storeys after.
- Theoretical units = gross × 80 % (net efficiency, shown) ÷ 85 m² (shown).
- Indicative value = units × cited public median price.
- Lévis results: lot 1 960 556 → 16 696 m², 157 units, 46 943 000 $;
  lot 2 244 656 → 36 556 m², 344 units, 102 856 000 $;
  lot 1 962 094 → 41 868 m², 394 units, 117 806 000 $ (upper bounds).

## Build and screenshots

- Build: `npm ci --workspace=ui --workspace=packages/radar-domain --workspace=packages/radar-scoring --workspace=packages/radar-sources` then `npm run build:artifact` in `node:24 --memory=1536m` (with `NODE_OPTIONS=--max-old-space-size=1024`): green.
- Screenshots (Chrome CDP 9333, harness `focus-signal`, looked at):
  `shots/01-liste-signaux.png`, `shots/02-focus-signal-levis-l0054.png`,
  `shots/03-valorisation.png`, `shots/04-survol-lot-carte.png`,
  `shots/05-focus-coaticook-sourcegap.png`,
  `shots/06-focus-rosemere-801-70.png`. Fictitious v1 shots deleted.
- Harness limit (unchanged): OSM tiles do not load from the sandboxed
  browser; the real artifact serves its basemap through the host tile
  relay and highlights the real geo layers.
