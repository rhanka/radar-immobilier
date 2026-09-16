# Codex HTTP 400 root cause

## Result

The ChatGPT Codex backend rejects the `max_output_tokens` request member. The runner asked
llm-mesh 0.19.3 to materialize that member; llm-mesh did so, and the backend returned HTTP 400.
The rejected value is not model-limit dependent: both 32,768 and 4,096 fail. Reasoning effort is
not causal: `low` and `xhigh` both succeed when the member is omitted.

## Measured evidence

The diagnostic ran at `2026-09-16T00:49:03.853Z` with llm-mesh 0.19.3 and made four requests.
Its allowlisted receipt is `codex-400-diagnostic.json`.

| Case | Effort | Wire value | HTTP | Response |
| --- | --- | ---: | ---: | --- |
| no maximum | low | absent | 200 | `PING_OK` |
| maximum | low | 32,768 | 400 | `Unsupported parameter: max_output_tokens` |
| maximum | low | 4,096 | 400 | `Unsupported parameter: max_output_tokens` |
| no maximum | xhigh | absent | 200 | `PING_OK` |

Before the diagnostic, all twelve Codex arms were terminal and no Codex runner process was alive.
The stale campaign PID `600744` did not resolve to a process, so no process was signalled. Historical
v101 evidence also records HTTP 200 with llm-mesh 0.19.2 while the Codex wire maximum was absent.

## Why the provider gate admitted the queue

`gate-v101b-providers.mjs` treated any terminal refusal as a passing outcome through
`accepted || refusal`. Its Codex receipt therefore had three HTTP 400 outcomes with
`accepted: false`, yet recorded `passed: true`. `run-campaign-v101b.sh` independently checked only
that each request existed and was not `no_active_account`, so it admitted the same failures again.

Both checks now require three accepted responses. The runner also opens an arm circuit after three
consecutive failures with the same code, and the lane stops after two consecutive arm circuits.

## Replay contract

This is a runner-side capability mismatch, not a request for an llm-mesh patch. Codex replay omits
`maxOutputTokens`; every replay receipt declares `cap.enforced: false` with the measured reason.
The 32,768-token value remains the intended comparison ceiling, but it is not wire-enforced for
Codex. The replay uses a separate atomic `codex-replay/status.json` lock domain and publishes an
atomic `status-codex.json`, so it cannot race the original campaign status.
