# Map I-4 fixtures — provenance

Captured once from the public production OGC API (`https://api.geo.sent-tech.ca`),
2026-11-03T17:57:07Z, for the I-4 artifact map base (`feat/artifact-map-socle`).

## Source queries (exact, replayable)

- Zones:
  `GET https://api.geo.sent-tech.ca/collections/qc-zonage-longueuil/items?f=json&bbox=-73.52,45.525,-73.505,45.535&limit=40`
- Lots:
  `GET https://api.geo.sent-tech.ca/collections/qc-lots-longueuil/items?f=json&bbox=-73.52,45.525,-73.505,45.535&limit=80`

Bounding box is WGS-84 (`CRS84`) `minLon,minLat,maxLon,maxLat`, a dense
Longueuil neighbourhood. `f=json` forces GeoJSON.

## Licence

- `qc-zonage-longueuil`: `Creative Commons Attribution 4.0 International`
  (`https://creativecommons.org/licenses/by/4.0/`), attribution
  `© Ville de Longueuil`. Known licence: this is the eligible collection
  the I-4 fixtures are built on (I-1A picks the pilot city in parallel;
  any eligible city is fine for these fixtures).
- `qc-lots-longueuil`: collection metadata reports `Unknown license`.
  The captured lot geometries are public cadastral shapes used here only as
  bounded test data; no owner or address data is kept (see sanitization).

## Stored files

- `zones-longueuil.geojson`: 40 features (`numberMatched: 81`,
  `numberReturned: 40`), sha256
  `046f39547694b3fd5ece6bff4615446c5cf5e6f110e1f7e632b382c8011d5ccb`
- `lots-longueuil.geojson`: 80 features (`numberMatched: 1076`,
  `numberReturned: 80`), sha256
  `d045b44823da1c951e649ad974a48b2b0562ce30ea2fab5619392d04e6512eb0`

Both files are compact (`jq -c`) single-line GeoJSON FeatureCollections.

## Sanitization (Loi 25)

Every feature `properties` had these keys removed at capture:
`adresse`, `code_postal`, `code_postal_precision`. No address or
`code_postal` field is exposed by these fixtures, and the map-base
qualification asserts their absence. Kept identifiers are cadastral and
non-personal: `NO_LOT` / `noLot`, `zone_code`, `surface_m2`, zone codes.
