---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-sol
reviewer-effort: high
target-ref: d77f6132c4ce9cca30268adf507ee1061b86b2b7
lens: runtime correctness and regression coverage
---

# Runtime correctness review

## Verdict

**Changes requested.** The dependency bump, Gemini medium catalogue mapping, 32,768-token forwarding, durable model-policy identity, production-only PV activation, 768 MiB production limit, and digest-based CD pin are internally consistent. However, switching the scheduled workload to Gemini exposes an unbounded catalogue request that the refresh timeout cannot cancel.

## Findings

### [MEDIUM] Gemini catalogue discovery is not bound to the refresh abort signal

**Path:** `api/src/services/graph/refresh-mesh.ts:115-117`

The default Gemini client is constructed as `new CloudCodeRuntimeClient()` with the global `fetch`, while only the Codex/OpenAI transport is wrapped by `bindRefreshFetchSignal` (`api/src/services/graph/refresh-mesh.ts:118-121`). In llm-mesh 0.19.2, every Cloud Code generation first calls `fetchAvailableModels` through the constructor-provided fetch before starting the provider request. That catalogue fetch does not receive `GenerateRequest.signal`; the signal is applied only to the subsequent transport execution.

This becomes a production-path issue in this diff because `deploy/k8s/34-refresh-cronjob.yaml:301-303` changes the active refresh from OpenAI to Gemini. If catalogue discovery stalls, the 900-second `REFRESH_TIMEOUT_MS` abort in `api/src/scripts/refresh-pv.ts` cannot stop it. The process can continue until Kubernetes enforces the later 1,200-second job deadline, violating the script's timeout contract and retaining the CronJob slot/resources longer than intended.

Construct the default Cloud Code client with a fetch bound to `options.signal` (or add an equivalent signal-aware catalogue API). Add a regression test that leaves catalogue discovery pending, aborts the run controller, and asserts prompt rejection with `AbortError`. The current abort test at `api/src/services/graph/refresh-mesh.test.ts:178-203` covers only the generic/OpenAI fetch wrapper, while the new catalogue test at `api/src/services/graph/refresh-mesh.test.ts:93-120` always resolves discovery immediately and therefore cannot detect this production-path gap.

## Validation performed

- Reviewed committed diff `4e3a4db8f71fe4824bf9aa9f166d1d47b95211c4..d77f6132c4ce9cca30268adf507ee1061b86b2b7`.
- Ran scoped API tests: `refresh-mesh.test.ts` and `refresh-state.test.ts` — **19/19 passed**.
- Inspected llm-mesh 0.19.2 Cloud Code runtime implementation to verify catalogue resolution order and signal propagation.
