# StatCan WDS Socioeconomic Tables

## Source URLs

- <https://www.statcan.gc.ca/en/developers/wds>
- <https://www150.statcan.gc.ca/n1/en/type/data>

## Format

WDS JSON REST and CSV ZIP bulk tables.

## Access and Cost

Public and free.

## Sample Inventory

- `https://www150.statcan.gc.ca/t1/wds/rest/getFullTableDownloadCSV/14100287/en`

## Field Inventory

Depends on the curated table: labour, income, housing, construction,
commuting, and related indicators. Most useful tables carry a `GEO`
dimension, but municipal coverage varies.

## Complexity

Medium.

## Automation Level

Medium-high.

## Effort Estimate

3-5 man-days for a curated indicator catalog.

## Recommendation

`build-later`. Start with a whitelist of tables rather than a generic scraper.

## Risks

- Metadata varies table by table.
- Not all tables resolve to municipality level.
- Vector IDs and dimensions require metadata management.
