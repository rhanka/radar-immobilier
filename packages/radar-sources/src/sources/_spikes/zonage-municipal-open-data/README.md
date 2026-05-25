# Zonage Municipal Open Data

## Source URLs

- <https://www.donneesquebec.ca/recherche/dataset/?q=zonage+municipal>
- City ArcGIS/open-data hubs where available.

## Format

CSV, GeoJSON/JSON, SHP, KML/KMZ, FGDB, and ArcGIS REST depending on the city.

## Access and Cost

Public and free where municipalities publish it.

## Sample Inventory

- Quebec City open-data zoning package.
- Repentigny `zonagemunicipal` package.
- Sherbrooke ArcGIS FeatureServer `Zonage/FeatureServer/0`.

## Field Inventory

Observed fields include `NUMEROZONE`, `AFFECTATION`, `USAGE`, `MISEAJOUR`,
`LONGITUDE`, `LATITUDE`, `MUNICIPALITE`, `NO_ZONE`, and `GRILLEUSAGE`.

## Complexity

Medium-high because schemas are not standardized and geometry often lacks the
full regulatory grid.

## Automation Level

Medium.

## Effort Estimate

6-10 man-days for a reusable multi-city adapter.

## Recommendation

`build-later`. Build generic CKAN/ArcGIS support, but do not depend on open
zoning data for the Salaberry-de-Valleyfield demo.

## Risks

- No Salaberry-specific open zoning dataset was found in Donnees Quebec.
- City schemas vary widely.
- Geometry alone is insufficient for scoring without grids/bylaws.
