# T2 cutover reconciliation and bounded tool release

Date: 2026-09-13. Conductor: Codex / gpt-6-astra. Independent requested reviewer:
Claude / claude-fable-5 / high. This is not two-peer consensus.
Targets: implementation `332af1e8`, design `671380f4`; independent findings are
preserved in `fable-cutover-review.md` and `fable-cutover-design-review.md`.
This amendment prevails over conflicting wording in the original design.

## Reconciled findings

- A1 accepted: wire both the binding checker and its hermetic regression tests
  into the existing quality job in `.github/workflows/ci.yml`. A manually run
  script is not an enforced CI gate. No deployment or credential-bearing step.
- A2/B4 accepted: explicitly track the remaining `32b-reproject-etape-job.yaml`,
  base `34-refresh-cronjob.yaml`, refresh production overlay and executable
  workflows. They remain separate gated lots, not silently covered by nine-file
  first-slice checks. No retirement of grounding before T1 acceptance.
- A3 accepted: `radar-api` ConfigMap is a shared switch for API and Jobs. Fence
  and validate all affected clients before binding; independent Job readiness
  must not imply that a ConfigMap update is runtime-neutral for the API.
- B1 accepted: normal copy never overwrites a conflict. An explicit
  `--reconcile-owned` operation may replace only a key written by this exact
  migration, after source/destination writer fencing. Require the immutable
  ledger's full coordinate/key/hash/metadata match against the current
  destination, destination versioning, and a recoverable non-null prior
  VersionId. Record prior/new versions and hashes. Missing proof fails closed.
  Pre-existing or independently modified destination content is never replaced.
  This is a narrow correction to the original absolute no-overwrite rule,
  not permission for a live reconciliation or deletion now.
- B2 accepted, timestamp precedence rejected: source timestamps do not establish
  authoritative content. Inventory all physical sources before DOCS copying;
  identical key/bytes/metadata may deduplicate, different content is a conflict.
  Freeze the complete expected union in an input manifest, retaining provenance
  per key. Conflicts require explicit evidence-backed source selection before
  copying. No automatic newest-wins policy or hidden prefix rewriting.
- B3 accepted: add repeatable `--exclude-prefix`, disjoint from included
  prefixes, and record the classified non-copied set. This permits DOCS reads
  from the GRAPH bucket without copying or altering `graph/` and other explicitly
  classified graph prefixes. Truly unclassified keys still block acceptance.
- B5 accepted: require non-empty endpoint/region/bucket/path-style and complete
  credential families; validate endpoint scheme and actual target identity.

## Minimal tool contract additions

The existing inventory/copy/verify/delta interface remains. Add an optional
`--expected-manifest FILE`, mandatory for a multi-source destination, containing
the complete approved key/hash/metadata union and physical source provenance.
Only the union's keys may explain destination extras; unrelated extras remain
conflicts. Final readiness requires a fresh fenced observation of every source,
not just the last source copied. Hash the input manifest in every receipt.
The tool must not select source authority or claim a fence was validated.

`--reconcile-owned` is opt-in and requires the original ledger, fence evidence,
and versioning recovery proof described above; it is never a normal copy retry.
Hermetic tests cover foreign conflicts, changed owned copies, absent versioning,
source overlap with different bytes, approved union extras, explicit exclusions,
unclassified keys, and no deletion, in addition to the original design tests.

## Fresh read-only runtime facts

- The intended existing preprod principal is
  `system:serviceaccount:radar-immobilier-preprod:radar-immobilier`, resolved from
  `poc-k8s/clusters/poc-ca/kubeconfigs/radar-immobilier-preprod.kubeconfig`.
  No RBAC or credential mutation was needed.
- MinIO lists four buckets: `radar-immobilier-raw`, `radar-immobilier-docs`,
  `radar-immobilier-docs-preprod`, and `preprod-snapshot`.
- RAW lists 9 objects / 767488 bytes; DOCS enumeration hit a Kubernetes stream
  timeout and is incomplete. The bound MinIO volume is 40Gi, not useful bytes.
- OVH provider inventory proves `radar-immobilier-raw-preprod` in BHS already
  exists with 9 objects / 767488 bytes. Equal counts/sizes are not byte parity.
- Existing `radar-raw-s3-credentials` carries complete `RAW_S3_*` keys targeting
  that bucket, `https://s3.bhs.io.cloud.ovh.net`, region `bhs`, path-style false.
  Credential usability/content hashes remain unproved; values were not printed.
- API still uses MinIO; no copy, binding, fencing, or deletion has occurred.

## Release

Release ONLY the new migration script/hermetic test, the existing storage
checker/test, and the single CI quality-gate invocation, plus their contract docs
and this branch plan. Sol owns source and index after conductor handoff.
No API/overlay/diag binding edit yet; no cluster/provider/IAM/data operation.
RAW runtime wiring must reuse the proven existing RAW secret contract rather
than blindly replacing the generic MinIO credentials. Resolve DOCS sources,
snapshots, destination contract and complete recovery before any cutover.
The conductor separately verifies live evidence. TEM, Geo, MatchID and local
development MinIO remain outside deletion scope. Preprod precedes production.
