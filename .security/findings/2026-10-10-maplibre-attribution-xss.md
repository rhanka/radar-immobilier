# MapLibre attribution sanitizer bypass (maplibre-gl 5)

- Status: open — exception PROPOSED, UNSIGNED (accepted_by: null, accepted_on: null)
- Severity: critical (GitHub, CVSS 10.0)
- Advisory: GHSA-jrc7-96c5-q579 / CVE-2026-85061 — maplibre-gl `<=6.4.0`, patched `6.4.1`
- Owner: repository owner (to confirm)
- Review by: 2026-10-17 (UTC)
- Register rows: `EXC-2026-10-10-maplibre-gl`, `EXC-2026-10-10-geo-map-engine`, `EXC-2026-10-10-geo-ui-svelte`

## Affected (root `package-lock.json`)

- `maplibre-gl@5.24.0` — `node_modules/maplibre-gl` (ui direct dependency)
- `@sentropic/geo-map-engine@0.6.1` — inherited (depends on `maplibre-gl ^5.24.0`)
- `@sentropic/geo-ui-svelte@0.1.1` — inherited (peer `maplibre-gl ^5.24.0`)

## Reachability

`DOM.sanitize` skips an adjacent dangerous attribute while mutating a live
attribute map; the attribution path can yield XSS without interaction.

- `GeoCityMapBase.svelte` disables the attribution control and renders the
  satellite attribution as escaped Svelte text (no `{@html}`).
- `CadastreMapView.svelte` keeps the attribution control with a constant OSM
  attribution.
- No `Popup`, `setHTML`, `setDOMContent` or direct `DOM.sanitize` call in `ui/src`.
- `GeoView` renders `GeoMap` from `@sentropic/geo-ui-svelte`; its style and
  attribution sources are unverified (package internals not inspected).
- No CSP compensating control is claimed.

## Why not fixed here

The fix needs `maplibre-gl >=6.4.1`, outside the ranges of both
`@sentropic/geo-*` packages; tracked by PR #657 / card #850.

## Compensating controls

Keep attributions constant or escaped; do not introduce user-supplied styles or
attribution HTML. Any untrusted attribution path invalidates this exception.

## Removal plan

Land PR #657 / card #850 with compatible `@sentropic/geo-*` releases, rebuild
the UI, check map attributions, rescan, delete the register rows.
