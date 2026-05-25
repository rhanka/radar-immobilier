# Cadastre / Infolot

## Source URLs

- <https://appli.foncier.gouv.qc.ca/Infolot/>
- <https://www.quebec.ca/habitation-territoire/information-fonciere/cadastre/consulter-cadastre>

## Format

Interactive public web map, plus paid cadastral extract/order paths for richer
geospatial data. No open public API was identified during the spike.

## Access and Cost

Basic consultation is public and free. Enhanced maps and cadastral extracts are
paid/licensed. The production path should use official extracts when available,
not browser automation against the live Infolot UI.

## Sample Inventory

| Sample | URL | Notes |
| ------ | --- | ----- |
| Infolot application | <https://appli.foncier.gouv.qc.ca/Infolot/> | Public cadastral consultation entry point. |
| Quebec cadastre consultation page | <https://www.quebec.ca/habitation-territoire/information-fonciere/cadastre/consulter-cadastre> | Describes public consultation and service path. |

## Field Inventory

- Lot number / parcel identifier.
- Geometry / boundaries when an official extract is available.
- Address or location search fields through the interactive UI.
- Possible historical owner name at lot creation in some paid contexts, but not
  a current ownership source.

## Complexity

High if limited to scraping the interactive map. Medium if the project obtains
official vector extracts for the target geography.

## Automation Level

Medium with official extracts. Low if relying on live map automation.

## Effort Estimate

- 4-7 man-days with official geospatial extracts.
- 10-15 man-days if only browser workflow automation is available.

## Recommendation

`build-later`. Use as a lot-geometry and parcel-normalization source once an
official extract path is confirmed. Do not use it as current ownership proof.

## Risks

- Terms-of-use and robots risk if scraping the interactive map.
- Cadastre is legal parcel geometry, not a reliable current ownership record.
- Lot/address matching can be ambiguous for subdivided or recently changed
  parcels.
