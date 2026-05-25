# Adresses Quebec / IGO Geocoder

## Source URLs

- <https://www.donneesquebec.ca/recherche/dataset/adresses-quebec>
- <https://servicescarto.mern.gouv.qc.ca/pes/rest/services/Territoire/AdressesQuebec_Geocodage/GeocodeServer>

## Format

SHP, GPKG, FGDB, TAB, WMS, and ArcGIS GeocodeServer REST.

## Access and Cost

Public and free.

## Sample Inventory

- `https://diffusion.mern.gouv.qc.ca/Diffusion/RGQ/Vectoriel/Carte_Topo/Local/AQReseau/OGC(GPKG)/AQreseau_GPKG.zip`
- GeocodeServer `findAddressCandidates`.

## Field Inventory

Geocoder supports `Geocode`, `ReverseGeocode`, and `Suggest`. Observed fields
include `SingleLine`, `Street`, `City`, `ZIP`, `Score`, `Match_addr`, `House`,
`StreetName`, `State`, and `Addr_type`.

## Complexity

Low-medium.

## Automation Level

High.

## Effort Estimate

2-3 man-days.

## Recommendation

`build-now` for address normalization and municipal geocoding.

## Risks

- Rate limits are not obvious.
- Output CRS may require reprojection.
- Batch jobs must cache aggressively and stay polite.
