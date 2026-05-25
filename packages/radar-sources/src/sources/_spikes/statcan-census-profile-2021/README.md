# StatCan Census Profile 2021

## Source URLs

- <https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm?Lang=E>
- <https://www12.statcan.gc.ca/wds-sdw/2021profile-profil2021-eng.cfm>
- <https://api.statcan.gc.ca/census-recensement/profile/sdmx/rest/>

## Format

SDMX REST plus CSV, TAB, IVT, JSON, and XML download paths.

## Access and Cost

Public and free.

## Sample Inventory

- Salaberry-de-Valleyfield CSD DGUID: `2021A00052470052`.
- Census Profile SDMX API base URL above.

## Field Inventory

Population, dwellings, age, household/family, income, language, housing,
immigration, mobility, education, labour, and commuting.

## Complexity

Low-medium.

## Automation Level

High.

## Effort Estimate

2-4 man-days.

## Recommendation

`build-now` as the first socio-economic adapter and official municipal-context
baseline.

## Risks

- Five-year cadence.
- Rounded or suppressed values.
- Geography changes between censuses.
- Bulk files can be large if not sliced.
