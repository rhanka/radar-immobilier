# Donnees Quebec Catalog

## Source URLs

- <https://www.donneesquebec.ca/recherche/fr/>
- <https://www.donneesquebec.ca/recherche/api/3/action/package_search>

## Format

CKAN JSON API: `package_search`, `package_show`, `datastore_search`, plus
direct resource files.

## Access and Cost

Public and free. Packages usually declare open-data licences such as CC-BY
4.0, but each package must be checked individually.

## Sample Inventory

- `package_search?q=zonage municipal`
- `package_show?id=roles-d-evaluation-fonciere-du-quebec`

## Field Inventory

Dataset `name`, `title`, `organization`, `license`, `update_frequency`,
`metadata_modified`, and `resources[]` with format, URL, last-modified, and
datastore flags.

## Complexity

Low. The main issue is inconsistent search relevance and varied resource
schemas.

## Automation Level

High.

## Effort Estimate

1.5-2.5 man-days.

## Recommendation

`build-now` as a shared discovery and resource-resolution layer for public
open-data adapters.

## Risks

- Municipal coverage is incomplete.
- Search relevance is inconsistent.
- Resource schemas and file formats vary by organization.
