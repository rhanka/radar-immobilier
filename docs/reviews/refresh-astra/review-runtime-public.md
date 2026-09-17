---
status: completed
declared-identity: claude/gpt-5.6-sol/high
requested-identity: claude/gpt-5.6-sol/high
reviewer-host: claude
reviewer-model: gpt-5.6-sol
reviewer-effort: high
target-ref: 5f26f219
lens: runtime correctness — transport-only fallback, quality no retry, timeout, per-document circuit, real model receipts
scope: public committed diff origin/main...5f26f219
---

# Runtime review

Repository visibility was verified as public (`isPrivate=false`), and the target commit is present on `origin/feat/refresh-prod-astra-low`. This review used only publicly committed content at `5f26f219` and its diff from `origin/main`.

## Findings

### [High] Document fallback affinity is lost across a durable resume

`createRefreshModelPolicy` keeps the selected fallback reason only in its process-local `documents` map (`api/src/services/graph/refresh-model-policy.ts:45-63,107-120`). Although each attempt is persisted in `state.documentModels`, a new scheduled process creates a fresh policy and never hydrates that map from the durable receipts. In `runPvRefresh`, completed chunks are skipped before `forDocument` is called (`api/src/services/graph/refresh-run.ts:201-212`).

Consequently, for a multi-chunk PDF, this sequence violates the documented per-document contract:

1. chunk 1 gets Astra quota/transport failure and succeeds on Gemini;
2. the Job ends before a later chunk (for example at the Job deadline);
3. the next cycle resumes and skips chunk 1;
4. the fresh policy calls Astra again for the next chunk instead of retaining Gemini for the document.

The added real-store integration test covers a fully completed one-chunk document and therefore does not exercise continuation of an incomplete multi-chunk document. Persist and restore the document's selected fallback state (or derive it from validated durable receipts) before processing its first incomplete chunk, and add a restart test with at least two chunks.

### [High] Receipts report requested identity and inferred completion, not the actual generation result

After `generateJson` resolves, the policy records `modelUsed: model` from configuration and unconditionally assigns receipt status `completed` when no exception was thrown (`api/src/services/graph/refresh-model-policy.ts:81-103`). It does not inspect the returned generation's `provider`, `model`, or `status`. The downstream extractor explicitly checks `generation.status === "completed"` (`api/src/services/graph/refresh-profile.ts:380-383`), showing that a resolved generation is not itself proof of completion.

Disabling equivalent-model routing is a useful fence, but it does not turn requested metadata into a measured receipt. A transport returning a non-completed result can therefore produce a durable `completed` receipt immediately before the extraction fails, and any mismatch in returned provider/model is not detected or reported. Build the receipt from the returned generation metadata, require it to match the exact requested route, and preserve the returned status (or record a redacted failure) before treating the attempt as completed. Add tests for a resolved non-completed result and for returned identity mismatch.

### [Medium] The per-attempt timeout is cooperative rather than an enforced deadline

The timer only aborts an `AbortController`; the code still awaits `createClient(...).generateJson(...)` directly (`api/src/services/graph/refresh-model-policy.ts:71-96`). If a client, adapter, validation path, or post-response operation does not settle on abort, the attempt can run indefinitely until Kubernetes kills the Job. If it eventually resolves after the timer, the current logic can even record it as `completed`, because `controller.signal.aborted` affects only the derived reason while `failed` remains false (`api/src/services/graph/refresh-model-policy.ts:99-105`).

The existing timeout test uses a cooperative fake that rejects on `abort`, so it does not cover this case. Enforce the deadline at the policy boundary (while still aborting transport cleanup), reject late success, and attach handling to the underlying promise to avoid an unhandled late rejection. Add a non-cooperative-client test and a late-resolution test.

## Positive observations

- Mesh route attempts are constrained to one and equivalent-model substitution is disabled.
- Validation/provenance exceptions raised by `validateResponse` are classified as `quality-refused` and do not invoke fallback in the reviewed path.
- Primary and fallback attempts receive separate controllers, so a cooperative primary timeout does not pass an already-aborted signal to Gemini.
- Attempt receipts are persisted before the safe receipt log callback, and raw provider messages or response bodies are not included.
- Quota circuit counting is document-keyed within one process and opens after three distinct quota-failing documents; a wholly primary-successful completed document resets the consecutive count.

## Verdict

**CHANGES REQUESTED.** The in-process transport-only/quality-refusal separation is directionally correct, but durable per-document fallback, truthful result-based receipts, and an enforced timeout boundary are not yet satisfied at `5f26f219`.
