---
status: completed
declared-identity: claude/gpt-5.6-sol/high
requested-identity: claude/gpt-5.6-sol/high
reviewer-host: claude
reviewer-model: gpt-5.6-sol
reviewer-effort: high
target-ref: 661b8571
lens: corrected runtime fallback — durable document affinity, result identity/status, enforced deadline, and selected output ownership
scope: public committed diff origin/main...661b8571
---

# Corrected runtime review

This bounded review used only public committed code in `origin/main...661b8571`. No tests or stacks were run, as requested.

## Findings

### [High] A terminal result-integrity failure becomes an allowed fallback after restart

The immediate path correctly treats a returned provider/model mismatch and a failure after successful validation as terminal: `attempt()` sets `terminalFailure`, persists a failed receipt, and the primary path throws without invoking Gemini (`api/src/services/graph/refresh-model-policy.ts:111-120,129-147`). The durable restore path does not preserve that terminal classification. `restoreDocument()` selects the first `fallbackReason`, or otherwise **any** failed receipt's `failureReason`, and turns it into the document's sticky fallback reason (`api/src/services/graph/refresh-model-policy.ts:60-63`).

This creates a restart bypass:

1. Astra returns the wrong identity. The policy persists `modelUsed: null`, `status: failed`, and `failureReason: transport`, then throws without fallback.
2. The process stops before the chunk completes (or the next scheduled invocation resumes the same durable state).
3. `runPvRefresh()` hydrates that receipt (`api/src/services/graph/refresh-run.ts:198-202`).
4. `forDocument()` sees the restored reason and calls Gemini directly (`api/src/services/graph/refresh-model-policy.ts:144-159`).

The same issue applies to a non-completed result that already supplied validated text: it is terminal in-process but is persisted with `failureReason: empty-output`, which becomes fallback affinity on resume. Thus identity/status refusal is not durable, and a restart changes a no-fallback integrity failure into transport fallback. Persist an explicit terminal/non-fallback classification (or restore only from receipts that prove fallback was actually selected, such as a durable `fallbackReason`), and ensure a terminal receipt causes the resumed chunk to fail rather than switch models.

The wrong-model/non-completed unit test checks only the same-process call (`api/src/services/graph/refresh-model-policy.test.ts:80-97`), while the restart tests restore ordinary quota fallback (`api/src/services/graph/refresh-model-policy.test.ts:176-189`; `api/tests/integration/refresh-018.spec.ts`). Add restart coverage for returned identity mismatch and terminal non-completed status.

### [Medium] A resolved non-completed result is transport-fallback eligible when the client did not invoke validation

The status check throws `REFRESH_EMPTY_OUTPUT` for every non-`completed` result (`api/src/services/graph/refresh-model-policy.ts:115-116`). It is considered terminal only when `responseValidated` is true (`api/src/services/graph/refresh-model-policy.ts:118-120`); otherwise `empty-output` becomes `selected.reason` and Gemini is invoked (`api/src/services/graph/refresh-model-policy.ts:127,144-157`). A client can legitimately return a non-completed result without ever supplying response text to `validateResponse`—for example `instructions_written`. That is a resolved runtime status, not a blank successful model stream, and the transport-only policy should refuse it rather than reinterpret it as fallback-eligible empty output.

The added `failed-status` test masks this branch by explicitly calling `request.validateResponse("{}")` before returning `instructions_written` (`api/src/services/graph/refresh-model-policy.test.ts:85-94`). Add a case where a non-completed result returns without invoking validation, and make every resolved non-completed status terminal independently of callback behavior.

## Verified corrections

- Durable receipts are hydrated before chunk processing, and the multi-chunk integration test exercises fallback affinity across a process-level policy recreation.
- Returned provider/model and `completed` status are checked before success; mismatched identity is recorded with `modelUsed: null`.
- `Promise.race` enforces the attempt deadline even when the transport ignores abort. The validator checks the attempt signal, preventing late validation from being accepted.
- The client no longer receives `outputPath`; only the policy writes the selected validated text, so a late primary cannot overwrite Gemini's selected file.
- Receipt persistence and selected output persistence remain outside the transport-fallback catch, preventing storage failures from triggering another model call.

## Verdict

**CHANGES REQUESTED.** The original three findings are substantially corrected in the normal path, but terminal identity/status failures are not represented durably and can become fallback-eligible after restart. Resolved non-completed results also remain fallback-eligible when validation was never called. These are blockers for the stated transport-only fallback contract.
