# MTMD Reseau Routier RTSS

## Source URLs

- <https://www.donneesquebec.ca/recherche/dataset/reseau-routier-rtss>

## Format

WFS, GeoJSON, CSV, SHP, GPKG, and WMS.

## Access and Cost

Public and free.

## Sample Inventory

- `https://ws.mapserver.transports.gouv.qc.ca/swtq?service=wfs&version=2.0.0&request=getfeature&typename=ms:bgr_v_sous_route_res_sup_act&srsname=EPSG:4326&outputformat=geojson`

## Field Inventory

Road network geometry, functional class, route hierarchy, and RTSS linear
referencing codes such as route/troncon/section/sous-route.

## Complexity

Medium.

## Automation Level

High.

## Effort Estimate

2-3 man-days.

## Recommendation

`build-later` as a supporting layer if road proximity or hierarchy enters
scoring.

## Risks

- Support layer rather than opportunity signal.
- Province-wide fetches may be heavy.
