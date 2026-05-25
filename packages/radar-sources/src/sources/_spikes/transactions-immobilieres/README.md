# Transactions immobilieres

## Source URLs

- <https://www.quebec.ca/habitation-territoire/information-fonciere/statistiques-marche-immobilier>
- Registre foncier, JLR, and Centris/MLS are the likely parcel-level suppliers.

## Format

Public aggregate HTML/statistical tables for market indicators. Parcel-level
transaction data appears to require paid registry access or commercial feeds.

## Access and Cost

Aggregate statistics are public/free. Property-level transactions are paid or
licensed through the Registre foncier or private providers.

## Sample Inventory

| Sample | URL | Notes |
| ------ | --- | ----- |
| Quebec market statistics | <https://www.quebec.ca/habitation-territoire/information-fonciere/statistiques-marche-immobilier> | Monthly aggregate sales, transfers, mortgages, and difficulty indicators. |

## Field Inventory

- Aggregate monthly sales and transfer counts.
- Aggregate mortgage and financial-difficulty indicators.
- Parcel-level transaction details only through paid/private sources.

## Complexity

Low for aggregate context. Medium to high for parcel-level evidence, depending
on the provider contract.

## Automation Level

High for public aggregate statistics. High for a contracted feed. Low for
ad-hoc scraping.

## Effort Estimate

- 2-4 man-days for aggregate public context.
- 6-10 man-days for a contracted parcel-level feed integration.

## Recommendation

`build-later` for aggregate market context. Use parcel-level transactions only
through authorized JLR/Registre access.

## Risks

- Aggregate data cannot prove a specific property's transaction history.
- Private feeds may include personal or commercially restricted data.
- Provider schemas can differ materially from registry documents.
