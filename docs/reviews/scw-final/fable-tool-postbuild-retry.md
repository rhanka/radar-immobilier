---
status: completed
review-author:
  host: codex
  model: gpt-5.6-sol
  effort: xhigh
reviewer-host: claude
reviewer-model: claude-fable-5
reviewer-effort: xhigh
target-ref: a8e972865b5226615f7db4d1d5f0ab6f27f6057a
base-ref: 2fdb7db47089bb7b6e1c6d28643092d677cbdadd
lens: Non-destructive migration, trustworthy parity, recovery and fail-closed CLI
verdict: approve-with-required-remediations
---

# Independent migration-tool post-build review — retry after redeem

One owner-authorized third-model review; no two-peer consensus is claimed. The
declared launch metadata above is not effective upstream identity attestation;
the effective reviewer recorded by the executing harness is `claude-fable-5`.
The prior launch failure remains recorded in `fable-tool-postbuild.md`.

## Method and evidence

- Source of the full 20-commit range read independently before any earlier
  design or review findings were consulted.
- Offline gate reproduced through Make (temporary rule, root Makefile
  untouched), ports 8882/5382/1182, `ENV=test-scw-final` last: binding checker
  chained into the hermetic suite, result `PASS=36 FAIL=0`, no network.
- Two scratch probes (under `/tmp`, repo untouched, run through Make, reusing
  the hermetic suite's own AWS shim) confirmed findings F2a and F2b below.
- No live cluster, provider, account, Secret, data or deployment access was
  used. No runtime acceptance is inferred from the local shim.

## Findings

### F1 — High — conditional-write enforcement on the real destination is assumed, never proven
`deploy/ci/migrate-object-storage.sh:457-460` relies on `put-object
--if-none-match '*'` (missing copies) and `--if-match <etag>` (owned
reconciliation) as the last-line defense against copy races and foreign
overwrite. The hermetic shim always enforces these preconditions
(`migrate-object-storage.hermetic.test.sh` put-object case), so the suite
cannot detect a real endpoint that silently ignores the header: conditional
PUT support is provider- and version-dependent (recent AWS S3/MinIO honor it;
an S3-compatible endpoint that drops the header degrades every guarded write
to an unconditional PUT). An AWS CLI too old for these flags fails hard
(safe direction); a header-ignoring provider fails open. Nothing in the tool
probes enforcement. Required remediation before any live `--execute-copy`:
a scratch-key probe at run start (second conditional put must be rejected)
recorded in `summary.json`, or an equivalent runbook capability gate.

### F2 — Medium — write phases do not gate on accumulated missingProof (CONFIRMED by probe)
- F2a: with `--reconcile-owned` and an empty/unreadable `--fence-record`, the
  missing proof `fence record is unreadable or empty` is recorded
  (`migrate-object-storage.sh:693-699`) yet `reconcile_owned_objects` still
  executes (`:700-702`). Probe: destination bytes were overwritten by the
  If-Match write, second `put-object` issued, exit 1 only after the fact.
  This contradicts the README contract ("requires a non-empty fence record").
- F2b: DOCS `copy --execute-copy` with an invalid `--expected-manifest` only
  records `expected manifest is invalid...` (`:399-405`); `TARGET_MANIFEST`
  silently falls back to the source manifest and the copy block (`:576-585`)
  still writes. Probe: object copied to destination without any approved
  union, exit 1. The `:66-67` die only checks flag presence, not validity.
Both writes are precondition-guarded and the run exits non-zero, but the
contract is evidence-before-write; the write phases must refuse to start when
`MISSING_PROOF` is non-empty. Neither case is covered by the hermetic suite.

### F3 — Medium — shim models no version history; "recoverable prior versions" is proven pre-overwrite only
The shim ignores `--version-id` on get-object/head-object/get-object-tagging
and put-object overwrites the single object/metadata file in place. The
passing test `records recoverable prior and distinct new versions and hashes`
proves the tool *requests* version-pinned reads before overwriting
(`prove_recoverable_priors`, `:659-687`), not that priors remain recoverable
after overwrite nor that real VersionId/versioned-attribute semantics match.
The plan checkbox "AWS CLI shim with version and metadata semantics"
overstates this. Post-overwrite recovery rests solely on the
`get-bucket-versioning == Enabled` gate (`:605-609`), which is fail-closed
but must be revalidated against the real destination during Lot 3h4.

### F4 — Low — inventory reads are not version-pinned; torn manifest entries possible under live writers
`build_manifest` (`:266-314`) issues head, get and tagging as three unpinned
reads; only a size change between list and head is detected
(`unstable-size`, `:295-299`). A same-size mutation between reads can produce
a torn entry. Direction is fail-closed (false conflict, never false parity in
any realistic case), and parity truth is explicitly conditional on the
external, unvalidated fence — consistent with `fenceValidated:false`.

### F5 — Low — stale failure counter weakens the retry-bound test
`reset_store` clears `$TEST_TMP/version` but not the shim's
`failure-counter`. The retry case therefore starts with a stale count from
the earlier target-identity case and succeeds on attempt 2 of 3; the
"exactly at the configured bound" property is not actually exercised, and a
retry off-by-one regression would pass.

### F6 — Low — metadata-only owned reconciliation can never complete its proof
The reconciliation ledger filter requires `new.sha256 != prior.sha256`
(`:647`). A conflict that differs only in metadata/tags (core includes them)
is eligible, is reconciled, then always ends in
`reconciliation lacks recoverable prior/new version proof` and a failed run.
Fail-closed false negative; document or key the proof on versionId only.

### Observations (no defect claimed)
- Ownership-ledger authenticity is custody-based: schema, coordinate, key,
  digest and current-state equality checks (`:593-633`) are strong against
  accident, but a forger who already knows the exact current destination
  object (including versionId) could craft an authorizing ledger. Acceptable
  only while ledger custody stays with the operator.
- Multi-source union `copy` runs exit 1 by design until the union is complete
  (other sources' keys stay missing); operators must not habituate to red
  exits or real copy failures may be masked.
- `cutoverReady` accepts any non-empty fence file as digest evidence; the
  receipt is explicitly conditional (`fenceValidated:false` everywhere) and
  the README assigns fence validation to the conductor. With F2a fixed, the
  residual false-positive risk is an operator treating the receipt as
  authorization, a documented, not technical, gap.

## Verified positives

Pagination is exhausted with continuation tokens and fails on a missing token
while truncated; unclassified source keys block proof; expected-union checks
run in both directions (observed-vs-approved and approved-current-source-vs-
observed); source bodies are re-hashed immediately before every put
(`source-changed`); no delete operation exists anywhere in the tool; source
and destination tuples, credential families and key IDs must differ; secrets
never reach reports (only SHA-256 of access-key IDs); concurrency/retries/
failure caps/object size are validated against hard ceilings (32/10/100/5e9)
and enforced (cap abort confirmed by the suite); `cutoverReady` requires a
delta run with zero failures, zero missing proof and zero
missing/extra/conflicting/expected-source conflicts; CI adds exactly one
offline quality invocation chaining the 11 binding and 36 migration checks.

## Verdict

Approve as bounded offline evidence tooling, with required remediations:
fix F2 (gate all write phases on empty `MISSING_PROOF`) before any live
`--execute-copy`, and close F1 with an enforcement probe or capability gate
before any live reconciliation. F3's real-versioning assumptions must be
revalidated on the actual destination in Lot 3h4. No runtime acceptance,
fence validity, or cutover readiness is asserted by this review.
