# CPTAQ Decisions

## Source URLs

- <https://www.donneesquebec.ca/recherche/dataset/decisions-de-la-cptaq>
- <https://carto.cptaq.gouv.qc.ca/cgi-bin/cptaq?SERVICE=WMS&VERSION=1.0.0&REQUEST=GetCapabilities>
- <https://demeter.cptaq.gouv.qc.ca/>

## Format

SHP ZIP, WMS, DBF/TXT detail tables, and public search pages.

## Access and Cost

Public and free.

## Sample Inventory

- `https://carto.cptaq.gouv.qc.ca/data/shapefiles/demandes.zip`

## Field Inventory

Geometry fields include `No_dossier`, `Resultat`, `Id`, `Flag`, and `Trie`.
Detail fields include `Nature_co`, `Finalite_co`, `Usage_co`, `Date_dec`,
`Nature`, `Finalite`, and `Usage`.

## Complexity

Medium. Geometry and detail tables require joining, and legal text may need a
separate fetch.

## Automation Level

Medium-high.

## Effort Estimate

5-7 man-days.

## Recommendation

`build-later` after the agricultural-zone filter. High-value unlock/de-risk
signal.

## Risks

- Some decisions may be absent or point-only.
- Many-to-many relation between shapes and details.
- Legal validation may require decision text/PDF.
