# BDZI Flood Zones

## Source URLs

- <https://www.donneesquebec.ca/recherche/dataset/base-de-donnees-des-zones-inondables>
- <https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/>
- <https://www.cehq.gouv.qc.ca/zones-inond/carte-esri/index.html>

## Format

FGDB ZIP, GPKG ZIP, SQLite ZIP, WMS, and ArcGIS REST layers.

## Access and Cost

Public and free.

## Sample Inventory

- `BDZI_GPK.zip` under the public blob storage path.
- ArcGIS REST layer `22` for flood-zone polygons.

## Field Inventory

Observed REST fields include `Description`, `No_rapport`, `Nm_rapport`, and
`OBJECTID`. Related layers include floodplain limits, study locations, and map
sheets.

## Complexity

Medium.

## Automation Level

High via REST/WMS.

## Effort Estimate

3-5 man-days.

## Recommendation

`build-later`. Use REST/WMS first as a risk filter; postpone bulk downloads
unless offline geoprocessing is required.

## Risks

- Bulk files are large.
- Cadence is irregular.
- Currentness and legal interpretation need caution.
