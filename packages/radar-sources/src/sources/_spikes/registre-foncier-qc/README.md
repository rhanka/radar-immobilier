# Registre foncier du Quebec

## Source URLs

- <https://www.registrefoncier.gouv.qc.ca/Sirf/>
- <https://www.quebec.ca/habitation-territoire/information-fonciere/registre-foncier>
- <https://www.registrefoncier.gouv.qc.ca/Sirf/fr/repertoire/pf_repertoire.shtm>

## Format

Public paid web application with registry products, indexes, and document PDFs.
No open bulk API was identified during the spike.

## Access and Cost

Public but paid. The project input notes a `1.50 CAD/document` cost from
2026-04-01. Online consultation and document orders require accepting payment
terms. A bulk or partner path would need explicit authorization.

## Sample Inventory

| Sample | URL | Notes |
| ------ | --- | ----- |
| Registry application | <https://www.registrefoncier.gouv.qc.ca/Sirf/> | Redirects to the registry web application. |
| Product directory | <https://www.registrefoncier.gouv.qc.ca/Sirf/fr/repertoire/pf_repertoire.shtm> | Public product/repertoire entry point. |
| Quebec market statistics | <https://www.quebec.ca/habitation-territoire/information-fonciere/statistiques-marche-immobilier> | Public aggregate statistics related to the registry. |

## Field Inventory

- Lot and registration identifiers.
- Act/document references.
- Ownership, mortgage, radiation, and transaction records depending on product.
- PDF documents and registry indexes.

## Complexity

High. The source is valuable but paid, legal-record oriented, and not exposed
as an open API.

## Automation Level

Low without an authorized provider or bulk arrangement. Medium if a stable
licensed workflow or feed is obtained.

## Effort Estimate

- 12-20 man-days with authorized access and a stable workflow.
- 25+ man-days if browser/payment automation is required, which is not
  recommended.

## Recommendation

`manual-check` for Phase 1. Link registry evidence manually for demo parcels
when needed, and defer any adapter until commercial/legal access is clarified.

## Risks

- Payment automation and brittle browser flow.
- Personal/legal-record handling.
- Volume costs.
- Licence constraints around reuse, storage, and redistribution.
