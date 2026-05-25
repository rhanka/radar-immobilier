# GRHQ Hydrography

## Source URLs

- <https://www.donneesquebec.ca/recherche/dataset/grhq>
- <https://servicescarto.mern.gouv.qc.ca/pes/services/Territoire/GRHQ_simple_WMS/MapServer/WMSServer>
- <https://servicescarto.mern.gouv.qc.ca/pes/services/Territoire/GRHQ_WMS/MapServer/WMSServer>

## Format

CSV/SHP index, FGDB directories, and WMS services.

## Access and Cost

Public and free.

## Sample Inventory

- `https://diffusion.mern.gouv.qc.ca/Diffusion/RGQ/Documentation/GRHQ/Index_GRHQ.csv`

## Field Inventory

Index fields include `Bloc`, `Zone`, and `FGDB`. Public layers include
hydrographic junctions, Strahler order, flow direction, typology, and
waterbodies.

## Complexity

Low-medium.

## Automation Level

High.

## Effort Estimate

3-4 man-days.

## Recommendation

`build-later` as environmental proximity enrichment after core regulatory
sources.

## Risks

- Hydrography is not itself the regulatory buffer.
- Scoring needs local bylaw interpretation for setbacks and riparian strips.
