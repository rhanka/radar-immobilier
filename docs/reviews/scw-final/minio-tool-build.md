# MinIO cutover migration-tool build handoff

Date: 2026-09-13
Branch: `chore/scw-final-sweep`
Released base: `2fdb7db47089bb7b6e1c6d28643092d677cbdadd`
Contract: `minio-cutover-design.md`, amended by
`minio-cutover-reconciliation.md`

## Status and boundary

The bounded RAW/DOCS migration and proof tool is source-complete and enforced by
the offline CI quality job. This build did not query or mutate a live cluster,
provider, IAM principal, Secret, bucket, object, database, workflow run, or
deployment. No migration, cutover, rollback, source retirement, or deletion was
performed. GRAPH, Geo, TEM, MatchID, application code, overlays, runtime
manifests, root Makefile, Compose, rules, entrypoints, other plans, and `.track`
were not changed.

The conductor-owned untracked `.h2a/` state and
`docs/reviews/scw-final/minio-runtime-inventory.md` were observed and left
untouched.

## Implemented contract

- `inventory`, `copy`, `verify`, and `delta` use complete paginated listings and
  streamed body SHA-256 values; Content-Type, encoding, cache control,
  disposition, user metadata, tags, ETag diagnostics, size, and VersionId are
  recorded in sorted manifests.
- Complete source/destination coordinates, path-style modes, separate credential
  families, identity fingerprints, classified prefixes, bounded concurrency,
  retries, failure cap, and per-object temporary-file size are validated and
  recorded without credential values.
- Copy is dry-run by default. Missing keys use a bounded temporary file and
  `If-None-Match: *`; post-copy destination evidence is re-read before an
  immutable ownership ledger entry is emitted. Foreign content is never
  overwritten and no delete operation exists.
- Repeatable exclusions are disjoint from includes and produce a complete
  classified non-copied manifest. Unclassified source keys block proof.
- DOCS proof/copy operations require the complete expected union. Every physical
  source and per-key provenance is exact; multi-source observations carry
  manifest and fence digests. Different bytes or metadata for an overlapping
  source key fail closed; only union-approved destination extras are accepted.
- Owned reconciliation requires the original ledger, fence artifact, enabled
  versioning, exact unchanged destination object/version, a version-specific
  re-read of the recoverable prior body and metadata, and an `If-Match` write.
  Prior/new VersionIds and hashes are distinct and recorded. Foreign or
  independently changed objects are refused without a PUT.
- Only identical, error-free `delta` evidence with a fence digest can set
  `cutoverReady: true`; every receipt says `fenceValidated: false`.
- Every executed copy additionally requires fresh external evidence that the
  exact destination and migration identity enforce conditional creates and
  updates. Missing proof of any kind prevents both copy write phases.

## Offline verification evidence

All local commands used the assigned ports and `ENV=test-scw-final` as the final
Make argument. The combined gate was invoked through a temporary Make rule
because changing the root Makefile was forbidden:

```text
make --no-print-directory --eval '.PHONY: test-scw-storage-gate' \
  --eval 'test-scw-storage-gate: ; bash deploy/ci/check-object-storage-bindings.test.sh' \
  test-scw-storage-gate API_PORT=8882 UI_PORT=5382 MAILDEV_UI_PORT=1182 \
  ENV=test-scw-final
```

Result before post-review remediation: binding checker `PASS=11 FAIL=0`;
migration hermetic suite `PASS=36 FAIL=0`. The extended suite now has 92
checks. It uses a filesystem-backed AWS CLI shim and makes no
network calls. `make k8s-validate API_PORT=8882 UI_PORT=5382
MAILDEV_UI_PORT=1182 ENV=test-scw-final` also passed its offline render and
structural checks. Bash syntax checks passed. `shellcheck` was not installed, so
no shellcheck result is claimed.

CI adds exactly one quality-job invocation:
`bash deploy/ci/check-object-storage-bindings.test.sh`; that entrypoint runs both
the 11 binding regressions and the current 92 migration regressions.

## Review and remaining gates

Independent Fable reviews `fable-tool-postbuild-retry.md` and
`fable-tool-postbuild-redeem2.md` found that accumulated missing proof did not
prevent destination writes and that live conditional-write enforcement was
unproved. The follow-up makes both write phases require empty `missingProof`,
adds a fresh destination-bound capability artifact, compares prior-version JSON
structurally, and fixes the hermetic retry counter. No consensus is claimed.

Live inventory completion, destination/IAM provisioning, immutable
expected-union approval, real copy, writer fencing validation, final delta,
binding/deploy checks, real application reads/writes, paired DB/object recovery,
preproduction acceptance, and later production acceptance all remain outside
this build. Source retention and deletion remain separate owner-authorized acts.
