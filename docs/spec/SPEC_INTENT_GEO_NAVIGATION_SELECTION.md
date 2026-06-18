# SPEC INTENT — Geographic Navigation And Selection Buckets

> Status: intent clarification for the map redesign.
> Date: 2026-06-18.
> Scope: geographic routes, Province / City / Zone navigation, Signal / Data
> inspection mode, selection buckets, PDF evidence display, and zone/lot fallback
> rules.

## 1. Decision

The geographic experience is organized around three spatial levels:

1. **Province** — Quebec-wide overview.
2. **City** — one municipality, with zones and lots visible.
3. **Zone** — one zoning area, with lots as the primary selectable geometry.

Each level has an inspection switch:

- **Signal**: regulatory/opportunity evidence projected onto the current geography.
- **Données**: source/data-quality/geometric coverage for the current geography.

The visible French UI labels are fixed as `Province`, `Ville`, `Zone`,
`Signal`, and `Données`.

This does not create a marketing or dashboard detour. The first screen remains
the usable map experience. The four product concerns already documented
elsewhere still exist, but the map shell uses the geographic route hierarchy
above.

## 2. Routes

Canonical routes:

| Level | Route | Meaning |
| --- | --- | --- |
| Province | `/geo/region/quebec` | Quebec overview. |
| City | `/geo/city/:citySlug` | One municipality, e.g. `/geo/city/plaisance`. |
| Zone | `/geo/zone/:citySlug/:zoneKey` | One resolved zone or fallback zone. |

Mode is a URL state, not a separate route:

```text
/geo/region/quebec?mode=signal
/geo/city/plaisance?mode=data
/geo/zone/plaisance/H-123?mode=signal
```

Additional state remains shareable: selected ids, focused id, filters, viewport,
and open panel sections. URL state must be stable enough for support/debugging.

Route transitions are part of the product contract:

- city click from `/geo/region/quebec` triggers a smooth `flyTo`, then lands on
  `/geo/city/:citySlug`;
- zone click from `/geo/city/:citySlug` triggers a smooth `flyTo`, then lands on
  `/geo/zone/:citySlug/:zoneKey`;
- the URL may update immediately with an explicit `transitioning` state, or at
  transition completion, but it must never leave the user in an unshareable map
  state.

The current hash-view router (`/#/signaux`, `/#/carte-signaux`, etc.) is a
compatibility layer only. The geographic shell must own real `/geo/*` routes, or
provide redirects/aliases that preserve the canonical `/geo/*` state in
browser history.

`zoneKey` is stable and API-owned. It uses the official zone code when
available. Fallback zones use an explicit namespace, for example
`fallback:<citySlug>`, and are never formatted as if they were official zoning
codes.

## 3. Province Level

At `/geo/region/quebec`:

- Municipalities are selectable.
- Signal mode colors municipalities by aggregate signal severity/count.
- Data mode colors municipalities by data readiness: PV/Youtube, ontology graph,
  zones, lots, and PDF/source evidence.
- Selecting a city triggers a smooth map transition, then updates the URL to
  `/geo/city/:citySlug`.
- The right panel may show a city summary before navigation, but deep inspection
  belongs to the City route.

## 4. City Level

At `/geo/city/:citySlug`:

- The municipality boundary remains visible as context.
- The municipality boundary is no longer selectable and is not colored as the
  active entity.
- Zones become the primary selectable geometry.
- Lots are visible inside zones when lot geometry is available.
- Signal mode projects aggregate signal severity/count onto zones.
- Data mode projects zone/lot availability and source quality onto zones/lots.
- If no official zone polygons are available but lots carry structured zone
  metadata keyed by the API-owned `zoneKey`, zones may be rendered as lot-union
  fallback groups.
- If neither zone polygons nor structured lot-zone metadata are available, the
  whole city is represented as one fallback zone for click/selection purposes.
  This fallback uses `zoneKey = fallback:<citySlug>` and must be explicit in the
  UI and API (`geometryStatus:
  "lot-union-fallback" | "text-only" | "missing"`), never disguised as official
  zoning.

Structured lot-zone metadata is preferred over textual descriptions. Do not parse
free-form lot descriptions to invent a zone relation. If the data only exists as
unstructured text, the status is partial and the city-level fallback is used.

## 5. Zone Level

At `/geo/zone/:citySlug/:zoneKey`:

- The map zooms smoothly to the selected zone or fallback zone extent.
- The zone outline is context; lots become the primary selectable geometry.
- Signal mode projects signal severity/count onto lots.
- Data mode shows lot geometry/data quality and source coverage.
- If signal-to-lot relations exist (`targets_lot`, `subject_of`, `subdivides`,
  or resolved graph edges), color the specific lots.
- If signals are only resolved to the zone, distribute the zone-level signal
  state to lots as inherited context, visually distinct from direct lot evidence.
- If the zone is a city fallback zone, the UI must label it as a fallback group,
  not as a real zoning code.

## 6. Selection Bucket

The selection bucket is shared across levels and supports:

- `municipality`, `signal`, `zone`, and `lot` entity kinds.
- Multi-select and de-select.
- Full color for selected entities.
- 50% opacity for non-selected entities when at least one entity is selected.
- Hover and focus states independent from selected state.
- Collapsible groups: Cities, Signals, Zones, Lots.

The left and right panels use the same entity grouping. Their difference is
status:

- Left panel: navigation and selection only.
- Right panel: selected entities plus detailed fiches.

Detailed fiches are right-panel only.

## 7. Signal Evidence Card

Signal and DesignationEvent fiches must display:

- label;
- grounded description;
- citation/excerpt;
- source PDF/raw document link;
- document date when available;
- page and bbox/highlight when available;
- graph relations to zones, lots, bylaws, and source documents.

Clicking the PDF/source link opens an overlay over the map, not a blocking modal
that hides the context. When `bbox` is available, the cited region is highlighted.
When only page/excerpt is available, the PDF opens at the page and the excerpt is
shown next to the viewer.

The UI must not silently omit missing evidence. Missing citation, PDF link, page,
or bbox is shown as an evidence completeness state so Graphify v2.3 gaps remain
visible.

## 8. API/Data Contracts To Confirm

The UI expects:

- `GET /api/geo/:city/lots` to expose a stable zone grouping key per lot when
  available, not only a label-like description.
- `GET /api/geo/:city/zones?fallback=lots` to return official zones, lot-union
  fallback zones, or an explicit no-zone response.
- graph signal detail endpoints to expose description, citation/excerpt, PDF/raw
  link, page, bbox when available, and relation ids for zone/lot/bylaw/source.
- data quality endpoints to distinguish configured-but-empty, not configured,
  fallback, official, and partial states.

## 9. Open Questions

1. Province scope: is `region/quebec` always the whole province, or should MRC /
   metro regions become first-class route scopes later?

Default assumption until decided: `region/quebec` is the whole-province view.
