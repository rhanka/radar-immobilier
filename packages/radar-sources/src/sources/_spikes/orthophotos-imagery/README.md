# Orthophotos / Imagery

## Source URLs

- <https://www.donneesquebec.ca/recherche/dataset/imagerie-orthorectifiee-du-quebec>
- <https://imagerie-telechargement.portailcartographique.gouv.qc.ca/>
- <https://servicesvecto3.mern.gouv.qc.ca/geoserver/Index_Telechargement_Imagerie_Orthorectifiee_Pub/wms?service=WMS&request=GetCapabilities&format=text/xml>

## Format

Index FGDB/GPKG/WMS/WFS. Imagery resources can be GeoTIFF, JPEG2000, WMS, or
WMTS depending on the project.

## Access and Cost

Public and free where published, typically with attribution requirements.

## Sample Inventory

- `Index_Imagerie_orthorectifiee_GPKG.zip`
- GéoMont Monteregie orthophotos package.

## Field Inventory

WFS index fields include `NOM_FICHIER`, `TELECHARGEMENT_FICHIER`,
`DATE_ACQUISITION`, `SAISON`, `TYPE_IMAGE`, `RESOLUTION`, `PROJECTION`,
`CODE_EPSG`, `FORMAT`, `TAILLE_FICHIER`, and `IDENTIFIANT`.

## Complexity

Medium-high.

## Automation Level

Medium.

## Effort Estimate

4-8 man-days.

## Recommendation

`build-later`. Build an index/WMS preview adapter first; defer heavy downloads
and computer-vision inference until demo needs are proven.

## Risks

- Image files are very large.
- Coverage recency varies by region.
- Vacancy/land-use computer vision is a separate product problem.
