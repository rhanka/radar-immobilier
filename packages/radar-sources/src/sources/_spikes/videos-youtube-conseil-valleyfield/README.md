# Council Videos — Valleyfield

## Source URLs

- <https://www.ville.valleyfield.qc.ca/seances-du-conseil>
- <https://www.youtube.com/user/VilleValleyfield>

## Format

HTML video embeds pointing to YouTube videos. The municipal page associates
videos with council sessions by proximity in the HTML.

## Access and Cost

Public pages are free. Transcript availability and API costs need confirmation.

## Sample Inventory

Observed embed IDs include `KTQenrHeNLo`, `FowjQD5jczk`, `6e1Dc45xV8Y`,
`QDWWfRQHyPk`, and `pxYlWEZu_IQ`.

## Field Inventory

- Video ID.
- Council session association.
- Possible title/date metadata through page context or YouTube metadata.
- Transcript text only if captions or transcription pipeline are available.

## Complexity

High. Video is valuable for early discussion signals, but transcript acquisition
is not a simple public-document fetch.

## Automation Level

Partial.

## Effort Estimate

5-8 man-days, excluding paid transcription volume costs.

## Recommendation

`build-later`. Keep out of BR07; revisit after PDF-based sources are working.

## Risks

- YouTube feed/caption scraping restrictions.
- Captions may be absent or low quality.
- Transcription cost and latency.
- Malformed or legacy embed URLs.
