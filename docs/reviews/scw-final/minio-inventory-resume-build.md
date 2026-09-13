# Resumable MinIO inventory build handoff

Date: 2026-09-13
Branch: `chore/scw-final-sweep`
Code endpoint: `ba08043c`
Status: offline build complete; independent post-build review pending

## Delivered boundary

The MinIO-to-OVH migration tool can now inventory a whole bucket through
durable, resumable root listings. This build made no live Kubernetes, MinIO,
OVH S3, IAM, Secret, database, object, workflow, deploy, copy, cutover, delete,
or recovery operation.

The implementation follows the amended design and its independent Fable 5
`GO-WITH-CHANGES` review. No consensus or post-build acceptance is claimed.

## Implemented contract

- `inventory --checkpoint-dir` binds both storage coordinates, identity
  fingerprints, normalized classifications and resource limits in a
  credential-free `configDigest`.
- Root pages are deterministic JSONL with chained receipts. The first page is
  anchored at null; resumes use the last committed key as exclusive
  `StartAfter`. Opaque continuation tokens are never persisted.
- Each index page owns one body shard with complete HEAD, streamed body hash,
  headers, metadata, tags and VersionId evidence. Completed shards are reused;
  a failed shard is retried independently.
- Every page, shard and receipt is flushed and atomically renamed. Only an
  uncommitted page/body tail may be discarded. Missing, corrupt, reordered,
  duplicated, overlapping or foreign evidence fails before storage access on
  resume.
- Empty terminal buckets produce an anchored receipt. Empty truncated pages
  retry without advancing. Objects above the configured size limit remain
  explicit completeness blockers.
- A provisional chain has no fence digest and cannot finalize. A separate,
  resumable fenced chain binds the non-empty fence digest in every receipt.
- Fenced bodies are fully re-read, so null VersionIds never rely on multipart
  ETags. Finalization requires exact stable provisional/fenced manifests for
  both sides and no unclassified source key.
- `final-inventory.json` binds all index/body roots and manifests. It says
  `toolComplete:true`, `fenceValidated:false`, and
  `providerEnforcementValidated:false`.
- `copy --execute-copy` now requires that final artifact, the matching fence,
  and the existing fresh conditional-write capability proof. It consumes the
  frozen manifests without a bucket relist and re-hashes each source body
  immediately before a conditional PUT. Post-write evidence re-reads only the
  affected destination keys.
- Checkpoint storage calls are individually bounded by the declared time
  budget; the run also stops between committed pages or body shards and emits
  `resumeRequired:true` with `cutoverReady:false`.

## Offline evidence

The combined Make-only gate used the assigned test environment and filesystem
AWS shim:

```text
make --no-print-directory --eval '.PHONY: test-scw-storage-gate' \
  --eval 'test-scw-storage-gate: ; bash deploy/ci/check-object-storage-bindings.test.sh' \
  test-scw-storage-gate API_PORT=8882 UI_PORT=5382 MAILDEV_UI_PORT=1182 \
  ENV=test-scw-final
```

Result: binding checker `PASS=11 FAIL=0`; migration suite
`PASS=88 FAIL=0`. The suite covers bounded and resumed provisional/fenced
chains, selective body resume, empty/truncated pages, uncommitted tails,
configuration and receipt tampering, hidden same-size/ETag body drift,
oversized blockers, mandatory proof consumption, zero PUT without proof, no
copy relist, and all pre-existing migration/recovery guards.

Additional gates:

- Bash syntax checks: pass.
- `make k8s-validate ... K8S_VALIDATE_WITH_CLUSTER=0`: pass, offline render.
- `harness check scope`: `PASS C2 (sentropic)`.
- `harness check branch`: `PASS C1 (sentropic)`.

No `shellcheck` result is claimed because it is not installed. No network or
live provider verification is included in these results.

## Remaining operator gates

1. Complete the real MinIO RAW/DOCS inventory using fresh report directories.
2. Approve exact DOCS multi-source provenance and provision the exact OVH
   destination buckets and least-privilege identities.
3. Validate the real OVH conditional-write probe and custody of its transcript.
4. Validate and hold the writer fence, then complete the separate fenced chain.
5. Take and verify the paired database/object recovery point.
6. Obtain independent post-build approval before executing any copy.
7. Run preproduction copy, parity, application read/write and recovery tests;
   only then change bindings. Production follows accepted preproduction.
8. Retain source objects until final zero-consumer and recovery evidence;
   deletion and MinIO resource removal remain separate owner actions.

Current object versions only are supported. Source version history and delete
markers are not inventoried or migrated. TEM remains retained until its
replacement is separately validated.
