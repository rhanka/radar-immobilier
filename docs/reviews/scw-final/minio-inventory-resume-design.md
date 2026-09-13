# Resumable whole-bucket MinIO inventory design

Date: 2026-09-13
Status: **design only — not built or released**
Scope: future extension of `deploy/ci/migrate-object-storage.sh`; no live
storage, cluster, provider, IAM, Secret, object, database, or workload operation
was performed for this design.

## Problem

The current tool calls `ListObjectsV2` at the bucket root with `MaxKeys=1000`.
Configured include and exclude prefixes classify the returned keys but do not
bound the listing. Pagination limits response size, not the MinIO metadata walk
needed to produce a page. A failed later page loses all progress because list
pages and continuation tokens live only in the temporary directory. A retry
therefore repeats the same expensive request or restarts at the bucket root.

After listing, the tool performs HEAD, full-body GET, and tag reads for every
object without durable body checkpoints. This makes a complete retry repeat
both enumeration and hashing. A prefix-only workaround is unacceptable: it
cannot prove that no root object or unknown prefix was omitted.

## Proposed CLI extension

Keep `inventory` as the operation and add only resumability controls:

```text
migrate-object-storage.sh inventory <existing coordinates and classifications>
  --checkpoint-dir DIR --page-size N --time-budget-seconds N
  [--resume] [--fence-record FILE]
```

`--prefix` and `--exclude-prefix` remain classification rules only. The index
always starts at the bucket root and must cover every current object. A bounded
run that exhausts its time budget exits non-zero with `progress.json` and
`resumeRequired:true`; it never emits final completeness or cutover readiness.

## Root index and StartAfter chain

Each successful page is validated and then committed atomically as a sorted
JSONL page plus a hash-chained receipt. Within one process, the opaque
continuation token may fetch the next page. Durable resume uses the last
committed key as `StartAfter`; continuation tokens are not persisted.

```json
{
  "schemaVersion": 1,
  "side": "source",
  "coordinate": {"endpoint": "...", "region": "...", "bucket": "...", "pathStyle": true},
  "identityFingerprint": "sha256-of-access-key-id",
  "sequence": 7,
  "startAfter": "previous-last-key",
  "firstKey": "first-key-in-page",
  "lastKey": "last-key-in-page",
  "objects": 100,
  "bytes": 12345,
  "isTruncated": true,
  "pageManifestSha256": "...",
  "previousReceiptSha256": "...",
  "fenceEvidenceDigest": null,
  "observedAt": "2026-09-13T18:00:00Z"
}
```

The first receipt has `startAfter:null` and no previous receipt. Every next
receipt must use the preceding `lastKey` as its exclusive boundary. The final
receipt must have `isTruncated:false`. This start anchor, adjacency rule,
strictly increasing key order, hash chain, and terminal receipt prove that the
index covers the whole bucket rather than selected prefixes.

## Body evidence shards

Each committed index page owns one body shard. The shard performs the existing
HEAD, bounded GET/SHA-256, metadata, and tag reads for exactly that page's keys.
Its receipt binds the index-page digest, exact key count and set, byte total,
manifest digest, failures, coordinate, identity, and fence digest. A shard is
committed only after every object succeeds; a partial shard is discarded and
retried without relisting completed pages.

Finalization requires a body receipt for every index receipt and exact equality
between indexed keys and body-manifest keys. Current object versions only are in
scope; source version history and delete markers remain explicitly unsupported.

## Fence and final rescan

Multi-page S3 listing is not a point-in-time snapshot while writers remain
active. Initial resumable inventory may produce provisional evidence, but final
`complete:true` requires an externally validated writer fence and a fresh root
rescan under that fence. The rescan must reproduce the complete ordered key,
size, ETag-diagnostic, and version-id index before final manifests are accepted.

Every page and body receipt binds the same fence artifact digest and still says
`fenceValidated:false`; the conductor validates the fence. Any inserted,
removed, reordered, or changed object invalidates finalization.

## Fail-closed invariants

- Resume refuses changed coordinates, identity fingerprint, classification,
  limits, fence digest, receipt schema, or hash chain.
- No page with duplicate, unsorted, missing, overlapping, or skipped keys is
  committed.
- An interrupted page or body shard cannot advance the durable cursor.
- Unclassified keys remain visible and prevent completeness.
- Missing terminal page, missing body shard, any read failure, or rescan drift
  keeps `complete:false` and prevents every destination PUT.
- Checkpoints contain no credentials or session tokens; report custody remains
  an operator responsibility because object keys are recorded.
- Existing no-delete, conditional-write, expected-union, and recovery gates
  remain unchanged.

## Required hermetic tests before build acceptance

1. Timeout after a committed page resumes with `StartAfter=lastKey`, without
   relisting or duplicating the page.
2. Empty bucket produces an anchored terminal receipt and complete zero count.
3. Tampered, missing, reordered, duplicated, overlapping, or foreign-coordinate
   receipts fail before any read or write continuation.
4. Absence of the terminal `isTruncated:false` receipt cannot finalize.
5. A key outside all declared classifications is indexed and blocks completion.
6. A failed body shard resumes independently and cannot publish partial proof.
7. Exact index/body key-set mismatch fails finalization.
8. Fenced rescan detects insertions, deletions, size/version changes, and tail
   additions after the prior terminal page.
9. Progress and final receipts contain no credential values or opaque tokens.
10. No copy or reconciliation PUT is possible until both whole-bucket sides are
    complete and all existing write gates pass.

## Future implementation lots

After independent design review only: (1) root index/checkpoint and resume,
(2) body shards and independent resume, then (3) fenced rescan/finalizer plus
operator documentation. Each commit must stay at or below 145 changed lines.
This document authorizes none of those changes or any live operation.
