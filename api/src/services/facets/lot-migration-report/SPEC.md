# lot-migration-report local spec (report only, 6F)

Scope: map every `prospect_marks` source row to its qualified lot-facet
destination through `lot_versions.id` into the qualified canonical target.
No persistence, no network, no logging, no `prospect_marks` modification.

## Inputs

- `marks`: verbatim read-only projections of `prospect_marks` rows. Every
  source column is inventoried: id, `lot_version_id`, denormalized
  `no_lot`/`city_slug`, dimension, statut, mode, documentary `author_id`,
  supersession links, exact price text, listing URL, timestamp.
- `lotVersions`: read-only projections of `lot_versions` rows. A target is
  qualified iff `reconStatus` is exactly `"validated"`.
- `mapping`: `{ mappingVersion, importerVersion, destinationsQualified }`. No workspace,
  basket, or grant identity is invented here; `destinationsQualified`
  stays false until the 6K owner inputs exist. The importer version is
  supplied explicitly; 6F does not implement or activate an importer.
  Duplicate mark/version IDs reject the ambiguous snapshot with a generic
  error that contains no source values.

## Manifest

One row per source row, sorted by source id. Each row carries:

- `chainId`: the smallest source id of its supersession component.
- `nativeTarget`: `canonical:<JSON [citySlug, canonicalId]>` when the version
  resolves, else `denormalized:<JSON [citySlug, noLot]>`.
- `disposition`: `unresolved` for missing or unqualified lot versions, `conflict` for any
  integrity or collision diagnostic, else `mapped`.
- `diagnostics`: sorted codes; see below.
- `destination`: the projected facet (`favori` to selection,
  `sollicite`/`lettre_envoyee` to pipeline, `en_vente` to market,
  `ecarte` to archive) with the source mode passed through. Both
  converged qualified heads project: no winner is selected. Projection
  includes the resolved city and never an owner, workspace or basket ID.
- `observed`: exact inventory (dimension, statut, mode, documentary author,
  decimal price text, URL, timestamps, both supersession IDs, version and
  denormalized fields), plus price/URL shape diagnostics. Author IDs are
  documentary facts only and never establish ownership or capabilities.

## Diagnostics

- `target-unresolved`: missing version or unqualified canonical identity.
- `target-inconsistent`: denormalized `no_lot`/`city_slug` differ from the
  resolved lot version.
- `chain-broken`: missing, nonreciprocal or cross-dimension link; whole chain flagged.
- `chain-cycle`: a loop in either direction; whole chain flagged.
- `chain-cross-target`: the chain spans several lot versions.
- `chain-mixed-mode`: the chain mixes `real` and `simulation` rows.
- `heads-converged`: several heads share one native target and dimension.
- `destination-collision`: several heads project to one destination stream.
- `destination-unqualified`: destinations still pending (informational;
  never changes the disposition and never counts as a conflict).
- `import-treatment-required`: price or URL shape needs an explicit 6J
  import decision (non-canonical decimal, malformed/credentialed/non-HTTP URL, or market fields
  on a pipeline row).

## Counts and digests

Counts: `sourceEvents` (rows), `chains` (components), `nativeTargets`
(distinct), `sourceHeads` (no recorded successor), `projectedHeads`
(heads with a destination), `conflicts` (rows not `mapped`).

`sourceSnapshotId` digests the canonical source-plus-lot snapshot;
`manifestSha256` digests the complete mapping, versions and every manifest row. New source
data or a new mapping version changes the digest. Timestamps document
order only and never resolve a conflict.

## No-write and no client data

Tracked fixtures stay synthetic. Production imports only `node:crypto`
and local modules and emits no log line. The manifest contains exact
source values and must not be sent to a log sink. Source integration tests
seed only a dedicated disposable database; reporting uses a repeatable-read,
read-only transaction and verifies that the snapshot remains unchanged.
