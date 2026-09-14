# Gemini 3.8 runner-path diagnosis

Captured 2026-09-14 without API keys, secret-bearing headers, full error
bodies, or sentropic repository changes.

## Evidence

- The benchmark volume runs `@sentropic/llm-mesh` 0.19.0. Its static catalog
  contains `gemini-3.8-flash`; the enrolled account's persisted public record
  has no explicit `modelIds` allowlist.
- The 0.19.0 source retained at sentropic worktree commit
  `2f1f6a2e084b93c8a35b3bd8ac59d10e3e7ee5b9` routes that exact model to
  Cloud Code. Commit `9e0e0ee4` added the model. The v4 runner instantiated
  that direct runtime client rather than the operational gateway.
- The historical native AGY receipt at
  `.lanes/conductor/tmp/bench-llm/bench/v2/pings/gemini/.h2a/runs/bench-v2-ping-gemini/output.log`
  records effective model `gemini-3.8-flash`, `PING_OK`, and 1.072 s. This
  proves the model existed for the enrolled AGY path; it does not attest an
  identical Graphify request.

| Probe | Single changed variable | Result |
|---|---|---|
| `gemini-debug-01-mesh-low.json` | baseline 0.19 route | 404 `NOT_FOUND`: “Requested entity was not found.” |
| `gemini-debug-02-agy-host-low.json` | host: remove `daily-` | 429 `RESOURCE_EXHAUSTED`: “Resource has been exhausted (e.g. check quota).” |
| `gemini-debug-03-agy-host-low-retry.json` | transport retry, no setting change | 429 `RESOURCE_EXHAUSTED` again |

Both probes requested `gemini-3.8-flash`, `LOW`, 64 output tokens and retained
the same llm-mesh envelope fields. Error evidence was parsed from
`response.clone().json()` and reduced to `code`, `status`, and redacted
`message`.

## Corrected finding and boundary

The original 404 characterizes only the v4 runner's direct-client path.
Changing its host manually and reaching a different response is a differential
diagnostic, not a supported fix and not evidence of a gateway defect. The
operational gateway must be called through its official contract; effort was
therefore not varied on the bypass path.

There is no green comparable Gemini case yet. The manual-host probe returned
429, so no full frozen-document run is authorized. Native AGY is not a
substitute for Candidate G because it cannot attest the same Graphify prompt,
schema, cap, and validator chain. Candidate G remains pending an official
gateway ping and radar-runner integration; it is not ranked as a zero or
declared model-unavailable.
