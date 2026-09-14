# MinIO to OVH S3 cutover — second slice design

Date: 2026-09-13. Baseline: `332af1e80504bd8010cf9c3304fbaaa7b3c1b095`.
Status: source proposal awaiting conductor review and release. No provider, cluster,
secret, object, workflow, or runtime mutation is authorized by this document.

## Decisions and boundary

1. RAW, DOCS, and GRAPH remain separate physical planes. The existing preprod
   GRAPH bucket `radar-immobilier-graph-preprod` remains unchanged and is not a
   RAW or DOCS destination. Geo credentials and buckets are never reused. TEM is
   retained; MatchID is not mutated.
2. Preprod RAW/DOCS OVH bucket names are unknown. Inventory and provisioning are
   hard prerequisites; source defaults and the GRAPH bucket are not substitutes.
   Production coordinates are also unproved. Unknowns fail closed.
3. T1 gates only retirement/fencing of the legacy grounding path that depends on
   its replacement. Inventory, the migration tool, RAW/DOCS copy preparation,
   and non-grounding client binding do not wait for T1.
4. Builders prepare code and offline tests only. Provisioning, real copy, writer
   fencing, deployment, credential rotation, rollback, and deletion are conductor
   actions. Preprod acceptance precedes any production action.

## Frozen client matrix

The listed prefixes are source-known, not proof of complete live contents. A
full top-level inventory must classify every key before a plane can pass.

| Env / plane | Clients and current source | Source-known prefixes | Destination and runtime identity |
| --- | --- | --- | --- |
| preprod RAW | API main store: `http://radar-minio:9000`, bucket `radar-immobilier-raw`, path-style; confirmed in deployed config evidence | `raw/`, `ciblage/`, `jobs/`, `ontology/`, `state/`; inventory may add prefixes | New OVH bucket **UNKNOWN**, same keys/no added root prefix; `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`; Secret `radar-s3-credentials` keys `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| preprod DOCS | API effective `SCRAPE_S3_*` bucket is unproved; diag is `http://radar-minio:9000` / `radar-immobilier-docs-preprod`; scheduled refresh writes DOCS prefixes into the OVH GRAPH bucket | `raw/`, `runs/`, `parsed/`, `ontology/`, `state/`; never select `graph/` from the GRAPH bucket | New OVH bucket **UNKNOWN**, distinct from RAW/GRAPH/Geo; `SCRAPE_S3_ENDPOINT`, `SCRAPE_S3_REGION`, `SCRAPE_S3_BUCKET`, `SCRAPE_S3_FORCE_PATH_STYLE`; Secret `radar-scrape-s3-credentials` keys `SCRAPE_S3_ACCESS_KEY`, `SCRAPE_S3_SECRET_KEY` |
| preprod GRAPH | Projection, canonical writers, exports; `https://s3.bhs.io.cloud.ovh.net`, `bhs`, `radar-immobilier-graph-preprod`, virtual-host style | `graph/`, `graphify-34-backups/`, plus inventoried graph/export prefixes | Unchanged; `GRAPH_S3_*`; Secret `radar-graph-s3-credentials`. No second-slice copy or mutation |
| prod RAW | Git base prescribes MinIO; effective endpoint, bucket, prefixes, and identity are unproved | Inventory required | New OVH bucket **UNKNOWN** and dedicated `S3_*` identity; no action before preprod acceptance |
| prod DOCS | Effective API/diag/manual bindings are unproved; refresh base remains SCW-capable if armed | Inventory required | New OVH bucket **UNKNOWN** and dedicated `SCRAPE_S3_*` identity; no action before preprod acceptance |
| prod GRAPH | Physical binding unproved; executable refresh definition is SCW-capable | Inventory required | Dedicated OVH GRAPH bucket **UNKNOWN**; never reuse preprod GRAPH, RAW/DOCS, Geo, or MatchID identity |

For every row, the conductor must record endpoint, region, bucket, path-style,
exact included prefixes, root-level/unclassified keys, namespace, clients,
service accounts, Secret name/key names, access mode, bucket versioning/encryption/
retention/lifecycle, and an identity fingerprint or key id (never its value).
Migration credentials are distinct environment inputs:
`MIGRATION_SOURCE_ACCESS_KEY_ID`, `MIGRATION_SOURCE_SECRET_ACCESS_KEY`,
`MIGRATION_DESTINATION_ACCESS_KEY_ID`, and
`MIGRATION_DESTINATION_SECRET_ACCESS_KEY`. The destination identity has no
delete permission; runtime identities receive only their plane's required access.

## Bounded migration and proof tool

Add `deploy/ci/migrate-object-storage.sh` and
`deploy/ci/migrate-object-storage.hermetic.test.sh`; do not generalize the
grounding publisher or DB backup runner. The interface is:

```text
migrate-object-storage.sh <inventory|copy|verify|delta>
  --environment <preprod|prod> --plane <RAW|DOCS>
  --source-endpoint E --source-region R --source-bucket B
  --destination-endpoint E --destination-region R --destination-bucket B
  --prefix P [--prefix P ...] --report-dir DIR
  [--execute-copy] [--fence-record FILE]
```

- `inventory`, `verify`, and copy without `--execute-copy` are read-only. The
  tool has no delete operation. Existing destination objects are skipped only
  when byte hash and preserved metadata match; mismatches are conflicts and are
  never overwritten.
- At least one non-empty prefix ending in `/` is required. Empty/root, traversal,
  duplicate, or overlapping prefixes fail. Every normalized source tuple must
  differ from its destination tuple. Keys outside classified prefixes are
  reported as missing proof, never silently ignored.
- List every page and emit sorted source/destination manifests containing key,
  byte size, streamed SHA-256, `Content-Type`, and any present content encoding,
  cache control, disposition, user metadata, or tags. Preserve and compare those
  fields. Multipart ETags are recorded only as diagnostics, never as hashes.
- Copy missing objects through a bounded temporary file, then re-read and hash
  the destination. Defaults are concurrency 4, three retries per operation, and
  an abort after 20 object failures; all limits are overridable only with
  positive bounded values and are written to the report.
- `delta` requires a readable non-empty conductor-supplied fence record, repeats
  complete listings and hashes, and exits zero only for identical key sets,
  sizes, SHA-256 values, and preserved metadata with zero errors. It records the
  fence artifact digest but does not claim to have validated the fence itself.
- `summary.json` includes source/destination coordinates without credentials,
  prefix set, counts/bytes, missing/extra/conflicting objects, failures,
  `missingProof[]`, fence evidence digest, and `cutoverReady`. Any unreadable
  list/head/body, absent destination contract, or absent final fence evidence
  is non-zero and named in `missingProof[]`.

Hermetic tests shim the S3 CLI and cover default dry-run, prefix validation,
source/destination guard, pagination, missing-object copy, matching skip,
non-overwrite conflict, retry/error caps, metadata preservation, a multipart
ETag with different SHA-256, no delete calls, and delta refusal without a fence.

## Source implementation lots after release

1. Tool lot: the two new scripts above plus the existing scoped checker tests.
2. Preprod binding lot, only after destinations and Secrets exist: patch the
   complete RAW/DOCS coordinates in `deploy/overlays/preprod/kustomization.yaml`;
   make `deploy/k8s/refresh-diag/diag-refresh-job.yaml` use non-optional
   `SCRAPE_S3_*` ConfigMap/Secret refs and remove generic/MinIO fallback refs.
3. The scheduled refresh currently puts DOCS prefixes in the GRAPH bucket.
   Rebind only its `SCRAPE_S3_*` family in
   `deploy/k8s/refresh-cronjobs/kustomization.yaml`; keep `GRAPH_S3_*` byte-for-
   byte unchanged. This path is conditional on reconciliation proving T1 did
   not already make the same binding change.
4. Production binding lot, after preprod acceptance and prod inventory: update
   `deploy/k8s/30-api.yaml` with explicit complete RAW/DOCS/GRAPH coordinates
   and required per-plane Secret refs. No application resolver edit is needed
   because deployed manifests provide the complete families and bypass fallback.
5. Contract docs/checks: `deploy/k8s/secrets.example.yaml` contains credential
   fields only for the three dedicated Secrets; `deploy/k8s/README.md` records
   the operator contract; extend `deploy/ci/check-object-storage-bindings.sh`
   and `.test.sh` to reject incomplete families, MinIO/SCW object literals,
   optional/generic fallback, and RAW/DOCS reuse of the GRAPH or Geo identity.

No workflow edit is needed. Because `REFRESH_DIAG_ENABLED` is armed, the
conductor must disarm it as a recorded writer fence before the preprod delta, or
prove the copied DOCS destination and complete binding before merging the diag
change. The builder does not toggle the variable.

## Conductor cutover and acceptance

For preprod RAW and each physical DOCS source: freeze inventory, provision the
destination/identity, take the paired DB checkpoint, run dry-run inventory,
execute the non-destructive bulk copy, fence API/diag/refresh/manual writers,
run the final delta, apply reviewed bindings, and prove real upload/read,
scheduled refresh, PDF evidence read, DB projection, and isolated paired
DB/object recovery. Retain each source read-only. Repeat for production only
after preprod acceptance.

MinIO StatefulSet, Service, PVC, NetworkPolicies, credentials, and old objects
remain until parity, recovery, and zero-consumer evidence pass. Grounding removal
also waits for T1 replacement acceptance. Deletion is a separately approved
conductor action; local MinIO, TEM, GRAPH preprod, Geo, and MatchID are excluded.
