# MTMD Travaux Routiers

## Source URLs

- <https://www.donneesquebec.ca/recherche/dataset/travaux-routiers>

## Format

Donnees Quebec metadata plus WFS, GeoJSON, CSV, SHP, GPKG, and WMS.

## Access and Cost

Public and free.

## Sample Inventory

- `https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:chantiers_mtmdet&srsname=EPSG:4326&outputformat=geojson&count=1`

## Field Inventory

`identifiant`, `routeAutoroute`, `entraveType`, `debut`, `fin`, `miseAJour`,
`identificationDesTravaux`, URLs, detours, localization, direction,
description, and LineString geometry.

## Complexity

Low-medium.

## Automation Level

High.

## Effort Estimate

2-3 man-days.

## Recommendation

`build-later` for transport disruption/context snapshots.

## Risks

- Operational roadwork, not always long-term investment.
- Current-state feed needs snapshots to preserve history.
- No direct CSD key; spatial intersection is required.
