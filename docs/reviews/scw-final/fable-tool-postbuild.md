---
status: failed
review-author:
  host: codex
  model: gpt-5.6-sol
  effort: xhigh
reviewer-host: claude
reviewer-model: claude-fable-5
reviewer-effort: high
target-ref: a8e972865b5226615f7db4d1d5f0ab6f27f6057a
base-ref: 2fdb7db47089bb7b6e1c6d28643092d677cbdadd
lens: Non-destructive migration, trustworthy parity, recovery and fail-closed CLI
observed-failure: Launch was rejected on the exhausted Codex usage allowance before any reviewer process started; no verdict exists.
---

# Independent migration-tool post-build review

This first owner-authorized Fable launch failed before execution. It is retained
as evidence and has no verdict; the later retry uses a distinct artifact.
Declared launch metadata is not effective upstream identity attestation.
The reviewer may edit only this file, with no staging or commits.

Review the exact committed migration tool, hermetic tests, binding checker and
single CI quality invocation. Challenge source/destination coordinate isolation,
complete pagination, classification and expected-union coverage, copy race
preconditions, metadata and tag parity, no foreign overwrite, original ledger
integrity, versioned recovery and bounded failure behavior. Distinguish a false
positive `cutoverReady` receipt from the explicit external fencing/acceptance
gates. Do not infer real-cloud acceptance from the local AWS shim.

No live cluster, account, provider, Secret, data or deployment access is allowed.
No application or other repository edits, additional agents, push or merge.
Return reproducible findings and a verdict within this artifact; maximum
140 lines. Source and offline tests may be read/run through Make only, with
ENV=test-scw-final last and API_PORT=8882 UI_PORT=5382 MAILDEV_UI_PORT=1182.
