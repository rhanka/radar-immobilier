# Reglements d'urbanisme — Valleyfield

> **WP4 real fetch — 2026-06-08.** Listing HTTP 200 (171 234 bytes), detail
> page HTTP 200 (140 051 bytes), bylaw PDF HTTP 200 `application/pdf`
> (446 881 bytes). Public, no login. Samples in `samples/`.

## Source URLs

- <https://www.ville.valleyfield.qc.ca/reglements-municipaux?cat=reglement-durbanisme&terme=>
- <https://www.ville.valleyfield.qc.ca/reglements-en-attente>
- Detail page (real): `reglements-municipaux/projet-de-reglement-450-02-modifiant-le-reglement-450-concernant-le-plan-durbanisme`
- Bylaw PDFs (CloudFront CDN): `https://dua3m7xvptjbw.cloudfront.net/documents/reglements/<name>.pdf`

## Format

HTML listing with pagination, detail pages, categories, and PDF attachments.

## Access and Cost

Public and free.

## Sample Inventory (REAL, HTTP 200)

Real files in `samples/`:

- `reglements-urbanisme-listing-urls.txt` — 25 real bylaw detail-page URLs
  extracted from the `cat=reglement-durbanisme` listing (HTTP 200).
- `reglement-450-02-pdf-urls.txt` — the 2 real CloudFront PDF URLs attached to
  the `projet-de-reglement-450-02` detail page (`Reglement-450-02.pdf` =
  446 881 bytes `application/pdf`, plus its `Annexe-C` plan PDF).

Observed bylaw families on the urbanisme listing (real slugs): 149 (lotissement),
150 (zonage), 151 (construction), 152 (administration), 153 (PIIA), 154 (PAE),
250 (usages conditionnels), 402 (PPCMOI), 432 (logements abordables), 450 (plan
d'urbanisme). PDFs live under `dua3m7xvptjbw.cloudfront.net/documents/reglements/`
— same CDN as avis publics (one CDN, two document collections: `avis/`, `reglements/`).

## Field Inventory

- Bylaw number.
- Category, title, and publication/adoption date.
- Current versus pending status inferred from source path.
- PDF attachments and amendment chains.

## Complexity

Medium. The page is structured enough to crawl, but status and amendment links
need normalization.

## Automation Level

Medium-high.

## Effort Estimate

3-5 man-days.

## Recommendation

`build-now` in the same source family as avis publics.

## Risks

- Pagination and duplicates.
- Current/pending split across pages.
- Bylaw amendments need graph linking to base regulations.
