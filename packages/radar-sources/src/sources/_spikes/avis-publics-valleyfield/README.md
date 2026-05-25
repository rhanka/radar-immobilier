# Avis publics — Valleyfield

## Source URLs

- <https://www.ville.valleyfield.qc.ca/avis-publics>

## Format

Craft CMS HTML archive with public PDF attachments served from the city's CDN.

## Access and Cost

Public and free. No API or RSS feed was observed.

## Sample Inventory

| Sample | Notes |
| ------ | ----- |
| `2026-05-20-Avis-de-derogation-mineure.pdf` | Minor derogation notice. |
| `PPCMOI2026-0066-Avis-public-assemblee-de-consultation.pdf` | PPCMOI consultation notice. |
| `AP_Avis-Registre-150-49-1.pdf` | Register notice for zoning amendment. |
| `AP_150-49_150-50_assemblee_consultation.pdf` | Consultation notice for zoning amendments. |
| `Avis-public-Approbation-referendaire-150-51.pdf` | Referendum approval notice. |

## Field Inventory

- Notice title.
- PDF URL.
- Publication or notice date, often visible in title or filename.
- Notice type: derogation, PPCMOI, consultation, register, entry into force.
- Bylaw or file references such as `150-49`, `150-50`, `150-51`.
- Address or sector references inside PDFs.

## Complexity

Medium. The source is stable and public, but extraction depends on PDF text/OCR
and title/filename normalization.

## Automation Level

High.

## Effort Estimate

2-3 man-days for a production adapter covering list, fetch, hash, PDF text
extraction, and first-pass classification.

## Recommendation

`build-now`. This is the BR07 vertical-slice starting point.

## Risks

- No official API/RSS.
- Dates are semi-structured.
- PDF text quality may vary.
- Notices must be linked to bylaws/PPCMOI documents to reconstruct context.
