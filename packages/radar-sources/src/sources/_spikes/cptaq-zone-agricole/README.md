# CPTAQ Zone Agricole

## Source URLs

- <https://www.donneesquebec.ca/recherche/dataset/zone-agricole-transposee>
- <https://carto.cptaq.gouv.qc.ca/cgi-bin/cptaq?SERVICE=WMS&VERSION=1.0.0&REQUEST=GetCapabilities>
- <https://demeter.cptaq.gouv.qc.ca/>

## Format

SHP ZIP, WMS, and public map/search interfaces.

## Access and Cost

Public and free, under Donnees Quebec licence and CPTAQ limitations.

## Sample Inventory

- `https://carto.cptaq.gouv.qc.ca/data/shapefiles/ZA_transposee.zip`

## Field Inventory

Observed layers include `zone_agricole_s` with `Mrc`, `Date_maj`, `Zonage`
and `zone_agricole_l` with `Id`, `Source`, `Texte`, `Date_maj`.

## Complexity

Medium.

## Automation Level

High.

## Effort Estimate

3-5 man-days.

## Recommendation

`build-now` as a core agricultural-zone constraint filter with explicit caveat
flags.

## Risks

- Transposed layer is not the official legal plan.
- Some inclusion/exclusion effects may be missing.
- Legal interpretation still requires caution.
