# d3-report local spec (report only)

Scope: read the `Triage` sheet from a lot-1 inventory and match rows
against an identified synthetic graph set. No persistence, no network.

## Inputs

- `WorkbookInventory` from `captureWorkbookInventory` (lot 1, read only).
- `IdentifiedGraphSet` from `buildGraphSet` (`snapshotId` plus sha256 of
  the canonical JSON, one graph per city slug).
- Municipality authority is `QC_MUNICIPALITIES` by exact name (NFC,
  trimmed, case ignored). Tests may inject a synthetic list.

## Triage rows

- Sheet `Triage`. Useful columns `#`, `Ville`, `MRC / Région`,
  `N° règlement`, `Classement`, located by header label.
- A missing or duplicated header is an error.
- Retained rows are below the header row with a non-empty `Classement`,
  whatever the visibility. Each row keeps its locator.
- Stored as raw/value pairs so empty, raw and unrecognized stay distinct.

## Resolver (`d3-report-v1`)

- City: exact `QC_MUNICIPALITIES` name; MRC only disambiguates homonyms.
  Zero slugs is unresolved, two or more is a conflict.
- Targets: `N° règlement` tokens split on `,`, `;` or newline, normalized
  with `normalizeReglementKey`. A token without a digit is ignored and
  counted apart.
- Candidate: a `Signal` or `DesignationEvent` node of the city graph whose
  adapter token set contains the token. The adapter (`real-graph-adapter-v1`)
  reads `reglement_number`, `cible_reglement_numero` and camelCase
  `cibleReglementNumero` at `props` plus nested `props.properties`, as scalars
  or arrays, normalized the same way. One node yields one token set: repeated
  aliases on that node stay one candidate. One is a resolved native triplet
  (slug, type, id); two or more is a conflict; zero is unresolved.
- Unsupported graph values (wrong kinds, non-finite numbers, malformed
  `properties`) never match. The exported `extractGraphNodeTokens` API returns
  their locations and kinds in `unsupported`; the aggregate D3 report does not
  store these per-node diagnostics. Absent or blank values stay silent.
  Only recognized keys at the two supported locations are inspected.

Exclusive status, in order: unique city with a missing graph is
`unavailable`; else any city or target conflict is `ambiguous`; else at
least one target with all resolved is `fully_resolved`; else at least one
resolved is `partially_resolved`; else `unresolved`.

## Report

Pure function of inventory plus graph set: rule and adapter versions,
snapshot identity plus digest, line total, five statuses (summing to lines),
intended references, ignored tokens, distinct resolved triplets and the
classement breakdown. No signal count is derived from rows and no per-row
diagnostic is stored or logged.

## No-write and no client data

Tracked inputs stay synthetic. The real workbook copy, when present,
lives under git-ignored `tmp/steve/`, is read only, never committed, and
is removed after the run. Only counts are asserted from it.
