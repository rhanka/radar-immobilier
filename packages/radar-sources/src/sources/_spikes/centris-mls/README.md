# Centris / MLS

## Source URLs

- <https://www.centris.ca/fr>
- <https://www.centris.ca/fr/outils/statistiques-immobilieres>
- <https://www.centris.ca/fr/politique-confidentialite-conditions-utilisation>

## Format

Public consumer website and public aggregate statistics. Listing-level MLS data
requires formal Centris/APCIQ/broker/MLS authorization.

## Access and Cost

The public site is for personal/non-commercial use. The terms prohibit
copying, scraping, data collection, storage, reorganization, manipulation, and
commercial reuse without authorization.

## Sample Inventory

| Sample | URL | Notes |
| ------ | --- | ----- |
| Public site | <https://www.centris.ca/fr> | Consumer listing interface, not a scraping source. |
| Statistics page | <https://www.centris.ca/fr/outils/statistiques-immobilieres> | Public aggregate market statistics. |
| Terms | <https://www.centris.ca/fr/politique-confidentialite-conditions-utilisation> | Explicit reuse restrictions. |

## Field Inventory

- Public aggregate market statistics by region/municipality where exposed.
- Listing-level price, property, and status data only through authorized
  partner feeds.

## Complexity

High without formal access. Medium with an authorized MLS/data feed.

## Automation Level

Low without a formal feed. Medium with an authorized feed.

## Effort Estimate

- 2-3 man-days for public aggregate stats only.
- 8-15 man-days with an authorized listing feed.

## Recommendation

`partner-required`. Do not integrate listing-level Centris data in Phase 1
unless a formal feed is secured. Public aggregate stats can remain market
context.

## Risks

- Very high terms-of-use and IP risk for scraping.
- Proprietary, time-sensitive MLS data.
- Broker/board governance constraints.
