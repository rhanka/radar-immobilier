# Terrebonne conseil municipal PV spike

Date: 2026-08-06  
Status: acquired with an index-access gap; four recent official PDFs are
available through stable public WordPress upload URLs.

## Source and access evidence

- Official landing page: `https://terrebonne.ca/seances-du-conseil-municipal/`
- Official site and landing page: HTTP `403`, Cloudflare challenge
  (`cf-mitigated: challenge`, `server: cloudflare`, body starts with
  `Just a moment... Enable JavaScript and cookies to continue`).
- Official `robots.txt`: HTTP `200`, and advertises
  `https://terrebonne.ca/sitemap_index.xml`; the sitemap and WordPress REST
  endpoints were also HTTP `403` Cloudflare challenges.
- Direct PDF upload URLs in [catalog.json](./catalog.json): HTTP `200`,
  `application/pdf`, with a text layer suitable for `pdftotext` and Graphify.
- No login, payment wall, or SPA rendering is needed for the direct PDF files.

This is not a claim that the official index is scrapeable. A production adapter
must either maintain a polite URL manifest, obtain an official feed/export, or
use a permitted browser-mediated access path. It must not bypass the Cloudflare
challenge.

## Samples and fields

The four samples cover 2024-01-30, 2025-04-15, 2026-01-20, and 2026-02-17.
The 2026 samples contain directly usable urbanism evidence:

- consultation for zoning bylaw `1001-374`, concerning the Lachenaie
  hippodrome sector near rues Sarrazin and Saguenay (2026-01-20, p. 6);
- final adoption of zoning bylaw `1001-375`, enlarging zone `0363-82` to
  include lot `4 405 707` on chemin Saint-Charles (2026-01-20, pp. 11-12);
- minor variance `2025-00286`, single-family residence on lot `2 921 746`,
  zone `8860-67` (2026-02-17, p. 27);
- minor variance `2025-00309`, an uniplex at 621 rue Théberge, lot
  `2 440 578` (2026-02-17, pp. 32-33).

Observed fields are session date, resolution number, bylaw number, action
stage, zone, lot, address, consultation date, variance dossier, and the
operative zoning/urbanism text. Each catalog entry records its public URL and
SHA-256 so the graph can carry `sourceUrl` and `docSha` together.

## Automation assessment

- Direct acquisition: medium automation via the checked-in manifest and the
  standard `pv` fetch contract; keep a 2-second minimum delay between requests.
- Discovery: low automation until the Cloudflare-protected index is made
  accessible through an approved channel.
- PDF parsing: medium-high automation; these samples are text PDFs, while
  future files must retain an OCR fallback.
- Estimated production adapter effort after a durable discovery path:
  3-5 person-days, including manifest refresh, deduplication, provenance
  sidecars, parser regression fixtures, and retry/rate-limit handling.

Recommendation: `build-later` as a secondary PV source. The spike is
acquisition-ready for the four verified documents and demonstrates useful
densification signals, but the index 403 is a material operational risk.

