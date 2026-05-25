# Construction Permits — Valleyfield

## Source URLs

- <https://www.ville.valleyfield.qc.ca/permis-de-construction>
- <https://valleyfield.edemandes.com/fr/create>

## Format

Municipal instruction pages and a private online request portal. No public
enumerable permit feed was observed for Valleyfield.

## Access and Cost

Public pages are free. Granular permit records are not exposed publicly in the
observed sources.

## Sample Inventory

| Sample | Notes |
| ------ | ----- |
| Municipal permit page | Describes permit categories and online request path. |
| eDemandes portal | Online request/submission workflow, not a public archive. |

## Field Inventory

- Permit types.
- Required documents and instructions.
- Online request/suivi links.
- MRC aggregate counts may exist separately, but not parcel-level permit data.

## Complexity

High for granular automation because no public feed was found.

## Automation Level

Low.

## Effort Estimate

1-2 man-days for monitoring public instruction pages only. Unknown for granular
records without a data-sharing agreement.

## Recommendation

`drop-for-phase-1` as a granular adapter. Revisit if a public or partner feed
appears.

## Risks

- Privacy/legal constraints.
- No enumerable records.
- Portal automation would target a service workflow, not public evidence.
