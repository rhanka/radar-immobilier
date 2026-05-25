# JLR

## Source URLs

- <https://solutions.jlr.ca/fr/>
- <https://solutions.jlr.ca/fr/fonctionnalites>
- <https://www.jlr.ca/professionnels-immobilier?hsLang=fr>
- <https://solutions.jlr.ca/fr/professionnels-secteur-public>

## Format

Commercial web product, exports, and possible custom data deliveries. No open
public API was identified during the spike.

## Access and Cost

Paid commercial account or enterprise/public-sector agreement. Public pages
describe property profiles, transactions, owner/contact data, comparables,
alerts, Excel/PDF exports, and custom data files.

## Sample Inventory

| Sample | URL | Notes |
| ------ | --- | ----- |
| Product overview | <https://solutions.jlr.ca/fr/fonctionnalites> | Describes product capabilities. |
| Public-sector offer | <https://solutions.jlr.ca/fr/professionnels-secteur-public> | Mentions custom databases and data delivery. |
| Sample municipality profile | <https://solutions.jlr.ca/hubfs/page-secteur-public/exemple-portrait-immobilier-municipalite.pdf?hsLang=fr> | Public sample PDF. |

## Field Inventory

- Property profiles.
- Transactions and comparables.
- Owner/contact data depending on product and licence.
- Alerts, PDF reports, Excel exports, and custom data files.

## Complexity

Low to medium after a proper agreement. High without one, because scraping or
building an unauthorized derivative database is not acceptable.

## Automation Level

High if the contract includes API, file feed, or export rights. Not automatable
through scraping.

## Effort Estimate

- 6-10 man-days with feed/API/export rights.
- 10-15 man-days for batch files plus entity/parcel mapping.

## Recommendation

`partner-required`. JLR is the best candidate for ownership/transaction
enrichment if a commercial agreement is available. Otherwise keep it outside
Phase 1 automation.

## Risks

- Strong provider dependency.
- Terms can restrict database building, derivative products, and resale.
- Sensitive/personal data governance and audit obligations.
