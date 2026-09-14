# Immo MinIO / OVH runtime evidence — 2026-09-13

Status: partial inventory, RAW read parity proven, no runtime cutover.
Conductor-owned evidence; no credentials or document contents are reproduced.

## Effective bindings and access

Read the deployed resources through the existing intended Immo preprod service
account, `system:serviceaccount:radar-immobilier-preprod:radar-immobilier`, using
the kubeconfig already present in `poc-k8s/clusters/poc-ca/kubeconfigs/`.
No role, credential, ConfigMap, workload or provider resource was changed.

API `radar-api`, image `ghcr.io/rhanka/radar-api:8e18f01`, still inherits:
`S3_ENDPOINT=http://radar-minio:9000`, bucket `radar-immobilier-raw`, region
`fr-par`, path-style true. MinIO is ready 1/1. The scheduled scrape explicitly
uses OVH `radar-immobilier-graph-preprod` as its SCRAPE bucket; this does not
establish that the API or diagnostic was migrated.

The exact deployed source (`8e18f01:api/src/config.ts`, resolvers at lines
228–272) is important: absent SCRAPE settings inherit the generic endpoint,
region and credentials, but the bucket defaults to `radar-immobilier-docs`,
**not** the generic RAW bucket. GRAPH inherits this resolved SCRAPE binding.
The API has no explicit SCRAPE/GRAPH overrides, so both also point to MinIO
DOCS. Changing only the generic endpoint would redirect these clients to an
unproven OVH bucket. Complete explicit per-plane bindings are required.

Provider inventory via the existing authenticated OVH CLI proves BHS containers
`radar-immobilier-raw`, `radar-immobilier-raw-preprod`, both GRAPH containers,
`radar-immobilier-p3-backup`, `radar-immobilier-refresh-test`,
`radar-preprod-snapshot`, and `radar-secret-anchor`. Their existence is not
permission to repurpose or delete them. No new container was provisioned.

The existing preprod Secret `radar-raw-s3-credentials` has the complete
`RAW_S3_*` family and targets `radar-immobilier-raw-preprod`, endpoint
`https://s3.bhs.io.cloud.ovh.net`, region `bhs`, path-style false. Its values
stayed inside the authorized Kubernetes read pipeline and verification process;
they were neither printed nor persisted locally. Read access is proven below;
write, multipart, versioning and recovery capabilities are not yet proven.

## MinIO source inventory

`ListBuckets` observed four buckets at 17:08:28 UTC:

| Bucket | Observed inventory | Status |
| --- | --- | --- |
| `radar-immobilier-raw` | 9 objects, 767488 bytes | Complete and rechecked |
| `radar-immobilier-docs-preprod` | Count and useful bytes unknown | Listing incomplete |
| `radar-immobilier-docs` | Count and useful bytes unknown | Not yet inventoried |
| `preprod-snapshot` | Count and useful bytes unknown | Not yet inventoried |

RAW consists of `ontology/` (1 object, 19392 bytes) and `raw/` (8 objects,
748096 bytes). First DOCS listing ended in a Kubernetes stream I/O timeout;
a second bounded 100-key request hit its explicit 20-second abort. This does
not prove an empty bucket, denied permission, or unusable data. No deletion is
justified by these failures. The first request's remote-process lifetime was
not established; do not multiply unbounded retries.

PVCs are `minio-data-radar-minio-0` (40Gi) and
`postgres-data-radar-postgres-0` (5Gi), both Bound / `block-standard`.
Allocated capacity is not object payload volume or one-node placement proof.
At 17:55 UTC, bounded `df -B1 /data` reported 42177347584 total bytes,
29791633408 used and 12368936960 available (71%). This filesystem usage
includes storage metadata; it is not a useful-document byte count.

## RAW byte and metadata parity — passed

At **2026-09-13T17:11:53.599Z**, a read-only process in the existing API container
compared MinIO `radar-immobilier-raw` with OVH
`radar-immobilier-raw-preprod` using their distinct existing identities.

- Complete sorted key sets: equal, **9 objects / 767488 bytes**.
- Every object body: independently read from both endpoints; **9/9 SHA-256 equal**.
- Every object's Content-Type, Content-Encoding, Cache-Control,
  Content-Disposition, user metadata and tags: **9/9 equal**.
- Full key/size/ETag/LastModified listings before and after reads: stable.
- Sorted-key-set SHA-256:
  `cb3263ef981938134d88cf979c094bfac4a139eee1f53a18ceb6dff79a4d88cb`.
- ETags served only as read preconditions/change indicators, not byte hashes.
- No object copy, overwrite, deletion, write probe or lifecycle change occurred.

This proves an existing RAW copy is readable and identical at the observation
point. It does **not** prove writer fencing, DB/object recovery, runtime client
cutover, or completion of the other three MinIO buckets. Those remain gates.

## Next evidence

Finish bounded DOCS/snapshot enumeration and classify all live consumers; prove
required destination write/recovery behavior in an explicitly isolated prefix;
record the paired DB checkpoint and writer fence, then recheck final parity
before applying reviewed bindings. MinIO retirement and production remain gated.
TEM, Geo, MatchID and local-development MinIO are unchanged.
