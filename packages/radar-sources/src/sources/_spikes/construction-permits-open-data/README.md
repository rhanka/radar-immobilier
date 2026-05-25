# Construction Permits Open Data

## Source URLs

- <https://www.donneesquebec.ca/recherche/dataset/?q=permis+construction>
- <https://donnees.montreal.ca/dataset/permis-construction>

## Format

CSV, JSON, XML, GeoJSON, SHP, and PowerBI-style links depending on the city.

## Access and Cost

Public and free where published.

## Sample Inventory

- Laval permit open-data package.
- Montreal `permis-construction` dataset.

## Field Inventory

Observed fields include `NO_PERMIS`, `TYPE_PERMIS`, `DATE_EMISSION`,
`COUT_PERMIS`, `NOMBRE_LOGEMENTS`, `LOTS`, `ADRESSE`, `no_demande`,
`emplacement`, `nature_travaux`, `nb_logements`, `longitude`, and `latitude`.

## Complexity

Medium. Data is easy where published, but municipal coverage is incomplete.

## Automation Level

High where public datasets exist.

## Effort Estimate

4-6 man-days.

## Recommendation

`build-later`. Useful market-traction enrichment for cities that publish it;
defer for Valleyfield unless a public source appears.

## Risks

- No Salaberry-specific open permit feed found.
- Schemas differ across cities.
- Permit semantics are local and require normalization.
