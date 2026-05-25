# Zonage Plans and Grids — Valleyfield

## Source URLs

- <https://www.ville.valleyfield.qc.ca/reglements-municipaux/zonage-et-ses-amendements>

## Format

HTML detail page with codified zoning PDFs, grids, plan sheets, and amendment
attachments.

## Access and Cost

Public and free.

## Sample Inventory

| Sample | Notes |
| ------ | ----- |
| `Reglement-150-codifie-150-48.pdf` | Codified zoning bylaw. |
| `Zones-H-Residentielles-pvc-et-150-48.pdf` | Residential zone grids. |
| `Feuillet-1.pdf` | Zoning plan sheet. |
| `URBA-AN2-2026-04-14-Reglement-150-50-Grilles.pdf` | Grid amendment. |
| `URBA-AN3-2026-04-14-Second-projet-de-reglement-150-51-Plans.pdf` | Plan amendment. |

## Field Inventory

- Zone class and zone number.
- Use grid rows and density/use constraints.
- Plan sheets and amendment numbers.

## Complexity

High. Valuable but table/map extraction from PDFs is materially harder than
notice extraction.

## Automation Level

Medium.

## Effort Estimate

6-9 man-days.

## Recommendation

`build-later`. Not the BR07 starting point, but needed for stronger scoring.

## Risks

- PDF table extraction quality.
- Georeferencing plans.
- OCR may be required.
- Amendments must be applied to the correct codified baseline.
