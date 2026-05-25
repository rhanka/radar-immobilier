# Infrastructure Canada HICC Projects

## Source URLs

- <https://www.infrastructure.gc.ca/gmap-gcarte/index-eng.html>
- <https://open.canada.ca/data/en/dataset/beee0771-dab9-4be8-9b80-f8e8b3fdfd9d>

## Format

CSV, JSON, XLSX, data dictionaries, and weekly Open Canada feed.

## Access and Cost

Public and free.

## Sample Inventory

- `https://www.infrastructure.gc.ca/alt-format/opendata/project-list-liste-de-projets-bil.csv`
- `https://www.infrastructure.gc.ca/alt-format/opendata/project-list-liste-de-projets-bil.json`

## Field Inventory

Project title, record ID, province, municipality, category, department,
program, status, total cost, and forecast dates in companion files.

## Complexity

Low-medium.

## Automation Level

High.

## Effort Estimate

2-3 man-days.

## Recommendation

`build-now` as official public-investment context across housing, roads, water,
transit, and community infrastructure.

## Risks

- Locations can be approximate.
- Federal funding scope only.
- Dates and status can lag.
- Municipality-name normalization is required.
