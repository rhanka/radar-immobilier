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
JSONL page plus a hash-chained receipt. Serialization and comparisons use
UTF-8 byte order with `LC_ALL=C`; locale-dependent ordering is forbidden. An
empty truncated page is retried and never committed. An empty terminal page is
the anchored proof for an empty bucket. Within one process, the opaque
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
  "configDigest": "sha256-of-canonical-run-configuration",
  "observedAt": "2026-09-13T18:00:00Z"
}
```

The first receipt has `startAfter:null` and no previous receipt. Every next
receipt must use the preceding `lastKey` as its exclusive boundary. The final
receipt must have `isTruncated:false`. This start anchor, adjacency rule,
strictly increasing key order, hash chain, and terminal receipt prove that the
index covers the whole bucket rather than selected prefixes.

`configDigest` binds canonical source and destination coordinates, both
identity fingerprints, normalized include/exclude classifications, page size,
retries, concurrency, maximum failures, and maximum object bytes. Every index
and body receipt carries it. Resume rejects a mismatch before any storage call.
The time budget is a run-only stop condition and may change between resumes; it
does not alter evidence semantics.

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

An oversized object is a permanent blocker for that configuration, not a
retryable shard failure. Raising the object limit requires a new checkpoint
because it changes `configDigest`.

## Fence and final rescan

Multi-page S3 listing is not a point-in-time snapshot while writers remain
active. Checkpoints therefore contain two distinct chains per side:

- `provisional/` binds `fenceEvidenceDigest:null` and can never finalize;
- `fenced/` requires the same non-null fence digest in every receipt and uses
  the same resumable, hash-chained `StartAfter` mechanism. A validated fence
  makes its multi-request traversal snapshot-consistent.

Both chains use the same page size and deterministic serialization. The fenced
chain must reproduce the complete ordered key, size, diagnostic ETag, and
VersionId index. A provisional body SHA-256 may be reused only when a non-null
VersionId is exactly equal in both chains. With a null or changed VersionId,
the full body, headers, metadata, and tags are re-read under the fence; ETag
equality alone never re-binds body evidence. Insertions, deletions, reordering,
tail additions, or changes invalidate finalization.

The final artifact binds both chain roots, both manifests, `configDigest`, and
the fence digest. It may say `toolComplete:true` only after every fenced page
and required fenced body shard is complete, but always says
`fenceValidated:false`; external fence validation remains the conductor's
responsibility and is never inferred from the artifact.

## Copy consumption contract

A later executed `copy` must consume the immutable final inventory artifact
through a dedicated proof argument; it must not repeat the old monolithic
listing. The tool validates the artifact against the invocation's exact
coordinates, identities, classifications, limits, manifests, chain roots, and
fence digest. It refuses every PUT unless both sides are `toolComplete:true`,
all existing expected-union, conditional-write, no-conflict, and recovery gates
pass, and the supplied fence record matches the artifact. `copy_one` still
re-hashes the source body immediately before its conditional PUT. Receipts
continue to report `fenceValidated:false` and
`providerEnforcementValidated:false`.

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
- The checkpoint directory is the sole cross-run state. Every bounded attempt
  uses a fresh report directory and emits `summary.json` with
  `resumeRequired:true`, `cutoverReady:false` when its time budget expires.
- Page/body data and receipts are written to same-directory temporary files,
  flushed, and atomically renamed. Resume may discard only a temp/uncommitted
  tail; missing or corrupt committed chain members fail closed.

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
11. Truncated empty pages retry without advancing; UTF-8 byte-order edge keys
    preserve strict ordering across page boundaries.
12. Resume accepts a different time budget but rejects every `configDigest`
    input change before a storage call; each run requires a fresh report dir.
13. Null-VersionId provisional objects are re-hashed under the fence, while an
    exact non-null VersionId permits deterministic body-shard reuse.
14. Executed copy consumes the finalized proof, never monolithic inventory, and
    still re-hashes each source body before any conditional PUT.

## Future implementation lots

After independent design review only: (1) provisional root index/checkpoint and
resume, (2) body shards and independent resume, (3) resumable fenced chains and
finalizer, then (4) immutable proof consumption by copy plus operator
documentation. Each commit must stay at or below 145 changed lines.
This document authorizes none of those changes or any live operation.
