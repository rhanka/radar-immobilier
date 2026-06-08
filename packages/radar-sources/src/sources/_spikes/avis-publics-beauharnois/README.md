# Avis publics — Beauharnois

> **WP4 real fetch — 2026-06-08.** Verified by server-side HTTP from the
> investigation env. Public, no login, robots.txt-allowed.

## Source URLs

- Page: <https://ville.beauharnois.qc.ca/la-ville/administration-et-vie-democratique/avis-publics>
- Short alias: <https://ville.beauharnois.qc.ca/avis-publics>
- PDFs: `https://ville.beauharnois.qc.ca/wp-content/uploads/<name>.pdf`

## Format

**WordPress** HTML (distinct CMS from Valleyfield, which is Craft). Notices are
plain `<a href>` links to PDFs in `/wp-content/uploads/`. No `icon-block--is-link`
class — confirms a **per-CMS adapter** is required (vs a single universal one).

## Access and Cost

Public and free. `robots.txt`: `Disallow: /wp-admin/` only — the page and
`/wp-content/uploads/` are allowed. No API/RSS observed.

## Sample Inventory (REAL, HTTP 200)

| PDF | Type |
| --- | ---- |
| `AP_DM-2026-0037.pdf` | Dérogation mineure (172 691 bytes, application/pdf — fetch confirmed). |
| `AP-assemblee-consultation_701-102.pdf` | Assemblée de consultation publique. |
| `PROJETREG-701-102.pdf` | Projet de règlement 701-102. |
| `AEV_REG_2026-07.pdf` / `AEV_REG_2026-11.pdf` | Avis d'entrée en vigueur. |
| `REG_2026-11-Modifiant-2022-18.pdf` | Règlement modificateur. |

Full real URL list: `samples/avis-pdf-urls.txt`.

## Field Inventory

- Notice title (HTML link text) + PDF URL.
- Notice type encoded in filename: `AP_DM` (dérogation mineure), `AP-assemblee-consultation`,
  `AEV_REG` (entrée en vigueur), `PROJETREG`, `REG`.
- Bylaw references (`701-102`, `2026-07`, `2026-11`, `2022-18`).
- Address/sector references inside the PDFs (OCR/LLM).

## Complexity

Medium. Stable WordPress markup; extraction depends on PDF text/OCR and
filename/title normalization. Filename convention is informative.

## Automation Level

High (list + fetch + hash fully automatable; classification first-pass from filename).

## Effort Estimate

1.5–2 man-days for a WordPress-flavored avis adapter, reusing the Valleyfield
parse/classification logic (only the link-selector + base URL differ).

## Recommendation

`build-now` — second city proving the multi-CMS architecture (Craft vs WordPress).

## Risks

- No official API/RSS.
- WordPress theme/markup change.
- PDF text quality.
- Notices must be linked to bylaws/PPCMOI to reconstruct context.

## Multi-city note

Municipal source → **one adapter per CMS engine**. Valleyfield = Craft
(`icon-block--is-link`), Beauharnois = WordPress (`/wp-content/uploads/`).
Code MAMH Beauharnois = **70022** (confirmed in role index CSV).
