# PPCMOI — Valleyfield

## Source URLs

- <https://www.ville.valleyfield.qc.ca/ppcmoi>
- <https://www.ville.valleyfield.qc.ca/avis-publics>

## Format

Municipal HTML pages, accordions, project pages, and PDF chains.

## Access and Cost

Public and free.

## Sample Inventory

| Sample | Notes |
| ------ | ----- |
| `Reglement-402-PPCMOI.pdf` | PPCMOI framework bylaw. |
| `Fiche-explicative_PPCMOI.pdf` | Explanatory document. |
| `2025-0198_74-RUE-MADEN_CAHIER-PROJET_ppcmoi.pdf` | Project package. |
| `PPCMOI2026-0061-Avis-public-assemblee-de-consultation.pdf` | Consultation notice. |
| `PPCMOI2026-0066-Avis-public-assemblee-de-consultation.pdf` | Consultation notice. |

## Field Inventory

- PPCMOI number.
- Address/project label.
- Stage documents: project package, public notice, resolution, register, final
  approval where available.
- Affected use, density, building, and derogation details inside PDFs.

## Complexity

Medium. The hard part is lifecycle reconstruction across notices, project
files, bylaws, and council minutes.

## Automation Level

Medium-high.

## Effort Estimate

3-4 man-days once avis publics and PDF extraction exist.

## Recommendation

`build-now` as enrichment after the avis-publics vertical slice.

## Risks

- Lifecycle state is textual and may vary by project.
- Requires document graph linking.
- Address normalization is necessary for map use.
