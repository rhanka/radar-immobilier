# Roles d'evaluation fonciere — MAMH

## Source URLs

- <https://www.donneesquebec.ca/recherche/dataset/roles-d-evaluation-fonciere-du-quebec>
- <https://www.quebec.ca/habitation-territoire/information-fonciere/evaluation-fonciere>

## Format

CSV index, XML files per municipality, ZIP archive of all XML files, and
georeferenced ZIP resources such as GPKG/FGDB.

## Access and Cost

Public and free, but caviarded. The data must not be used for
re-identification.

## Sample Inventory

- `https://donneesouvertes.affmunqc.net/role/indexRole2026.csv`
- Salaberry-de-Valleyfield file `RL70052_2026.xml`
- `https://donneesouvertes.affmunqc.net/role/ROLE2026_GEOPACKAGE.zip`

## Field Inventory

Geographic code, territory name, resource link, coded XML fields such as
`RLM01A`, `RLM02A`, `RL0101*`, `RL0103A*`, `RL0301A`, `RL0401A`, and
`RL0405A`.

## Complexity

Medium. The XML is coded and needs the MAMH dictionary/XSD.

## Automation Level

High.

## Effort Estimate

5-8 man-days.

## Recommendation

`build-now` after the source-discovery layer. This is important for parcel,
value, use, and building enrichment.

## Risks

- Annual and quarterly update paths must be reconciled.
- Large files require streaming.
- Privacy/caviardage constraints must be enforced.
