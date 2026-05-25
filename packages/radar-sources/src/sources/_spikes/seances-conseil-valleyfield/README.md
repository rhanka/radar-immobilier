# Seances du conseil — Valleyfield

## Source URLs

- <https://www.ville.valleyfield.qc.ca/seances-du-conseil>

## Format

Craft CMS HTML archive with agenda PDFs, minutes PDFs, and optional video
embeds.

## Access and Cost

Public and free.

## Sample Inventory

| Sample | Notes |
| ------ | ----- |
| `ordre-du-jour-2026-05-12.pdf` | Agenda PDF. |
| `proces-verbal-2026-05-05-1.pdf` | Minutes PDF. |
| `proces-verbal-2026-04-14.pdf` | Minutes PDF. |
| `Proces-verbal-18-novembre.pdf` | Older naming convention. |

## Field Inventory

- Session date and type.
- Agenda URL.
- Minutes URL.
- Video embed when present.
- Resolution, bylaw, PPCMOI, consultation, and adoption references inside PDFs.

## Complexity

Medium. The archive is useful and public, but large; older filenames contain
typos and naming inconsistencies.

## Automation Level

High for PDFs. Medium for linking agenda/minutes/video into one session graph.

## Effort Estimate

3-5 man-days.

## Recommendation

`build-later`. Build after avis publics to enrich the same dossiers over time.

## Risks

- Some future sessions may lack documents.
- Large archive needs incremental checkpoints.
- Evidence extraction must distinguish agenda intent from adopted decisions.
