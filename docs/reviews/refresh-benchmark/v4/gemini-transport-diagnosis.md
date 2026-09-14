# Gemini 3.8 Cloud Code transport diagnosis

Captured 2026-09-14 without API keys, secret-bearing headers, full error
bodies, or sentropic repository changes.

## Evidence

- The benchmark volume runs `@sentropic/llm-mesh` 0.19.0. Its static catalog
  contains `gemini-3.8-flash`; the enrolled account's persisted public record
  has no explicit `modelIds` allowlist.
- The 0.19.0 source retained at sentropic worktree commit
  `2f1f6a2e084b93c8a35b3bd8ac59d10e3e7ee5b9` routes that exact model to
  Cloud Code. Commit `9e0e0ee4` added the model. Its transport constant uses
  `daily-cloudcode-pa.googleapis.com`.
- The historical native AGY receipt at
  `.lanes/conductor/tmp/bench-llm/bench/v2/pings/gemini/.h2a/runs/bench-v2-ping-gemini/output.log`
  records effective model `gemini-3.8-flash`, `PING_OK`, and 1.072 s. This
  proves the model existed for the enrolled AGY path; it does not attest an
  identical Graphify request.

| Probe | Single changed variable | Result |
|---|---|---|
| `gemini-debug-01-mesh-low.json` | baseline 0.19 route | 404 `NOT_FOUND`: “Requested entity was not found.” |
| `gemini-debug-02-agy-host-low.json` | host: remove `daily-` | 429 `RESOURCE_EXHAUSTED`: “Resource has been exhausted (e.g. check quota).” |

Both probes requested `gemini-3.8-flash`, `LOW`, 64 output tokens and retained
the same llm-mesh envelope fields. Error evidence was parsed from
`response.clone().json()` and reduced to `code`, `status`, and redacted
`message`.

## Finding and boundary

The first proven cause of the original 404 is the llm-mesh 0.19
`daily-cloudcode-pa` endpoint: changing only that host reaches the provider's
quota layer instead of `NOT_FOUND`. Effort is not causal, so the frozen matrix
does not spend subscription quota on `MEDIUM`/`HIGH` variants.

There is no green comparable Gemini case yet. The corrected host currently
returns 429, so no full frozen-document run is authorized. Native AGY is not a
substitute for Candidate G because it cannot attest the same Graphify prompt,
schema, cap, and validator chain. Candidate G remains pending a supported
llm-mesh transport correction plus available enrolled-account quota; it is not
ranked as a zero or declared model-unavailable.
