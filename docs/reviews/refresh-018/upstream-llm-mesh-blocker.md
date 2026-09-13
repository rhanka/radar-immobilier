# llm-mesh upstream blocker — abrupt Codex SSE termination

Status: blocking safe retry/classification of a real T1 transport failure; no Immo fallback or
`node_modules` patch is authorized.

## Evidence

- Docker recorded T1 attempt 3 as a process failure, not an infrastructure kill (`exitCode=1`,
  `OOMKilled=false`, empty Docker state error), after the model call failed with redacted message
  `terminated`; no extraction or publication was accepted.
- The installed runtime is Node 24.21.0 / Undici 7.29.1 / `@sentropic/llm-mesh` 0.19.0.
- A hermetic server that closes an active SSE stream reproduces `TypeError: terminated` with nested
  `cause.code=UND_ERR_SOCKET`.
- Installed `normalizeProviderError` ignores the nested cause code and classifies that shape as
  non-retryable `invalid-request`, although the failure occurred while reading the transport stream.

## Required upstream contract

`@sentropic/llm-mesh` must preserve allow-listed nested transport codes and classify
`UND_ERR_SOCKET` during response streaming as a retryable network failure. Acceptance requires a
hermetic abrupt-SSE-close regression test proving the route outcome is `network`/retryable and that
no response body, credential or arbitrary error message enters logs.

Immo now binds its run signal to both the public mesh request and the public Codex transport fetch,
and only records allow-listed diagnostic metadata. It does not override mesh route classification,
silently coerce output, or retry through another account/provider.
