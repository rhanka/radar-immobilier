# llm-mesh transport incident — accepted limitation

Status: non-blocking T1 limitation accepted by the owner on 2026-09-13. The incident evidence is
retained; Immo stays on `@sentropic/llm-mesh` 0.19.0 and no local fallback is authorized.

## Evidence

- Docker recorded T1 attempt 3 as a process failure, not an infrastructure kill (`exitCode=1`,
  `OOMKilled=false`, empty Docker state error), after the model call failed with redacted message
  `terminated`; no extraction or publication was accepted.
- The installed runtime is Node 24.21.0 / Undici 7.29.1 / `@sentropic/llm-mesh` 0.19.0.
- A hermetic server that closes an active SSE stream reproduces `TypeError: terminated` with nested
  `cause.code=UND_ERR_SOCKET`.
- Installed `normalizeProviderError` ignores the nested cause code and classifies that shape as
  non-retryable `invalid-request`, although the failure occurred while reading the transport stream.

## Current decision

- Keep the existing fail-closed behavior: an interrupted provider response fails the Job and cannot
  produce or publish an extraction.
- Resume from hash-checked completed chunks and durable state on the next bounded invocation or
  scheduled cycle. No in-process retry of the interrupted provider call is required for T1.
- Keep Graphify exactly at 0.18.0. No Graphify patch or downstream mesh-version bump is required.
- A future retry evolution would require separate, prioritized llm-mesh and Graphify integration;
  it is not a refresh acceptance or deployment gate.

Immo now binds its run signal to both the public mesh request and the public Codex transport fetch,
and only records allow-listed diagnostic metadata. It does not override mesh route classification,
silently coerce output, or retry through another account/provider.

The exploratory Sentropic PR #585 was closed and its development branches removed because
cross-repository implementation was not authorized. The diagnostic was handed to `s-conductor` as
deferred evidence only.
