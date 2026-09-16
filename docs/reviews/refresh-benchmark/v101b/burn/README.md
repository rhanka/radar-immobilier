# Gemini weekly-quota burn assessment

Status: **N-A — stopped before burn**. Quota consumed by this experiment: **0%**; requests sent: **0**.

## Required observable

The authorized protocol requires a numeric quota state before and after known-token requests. That state must support a measurable delta so tokens per quota unit and a weekly token reserve can be estimated without reaching exhaustion.

## Evidence checked

- The installed `@sentropic/llm-mesh` 0.19.3 package exposes a generic optional `quota` outcome type, but its Cloud Code transport does not populate it. The transport reads only `Retry-After`, and only after HTTP 429.
- `gemini-catalogue-probe.mjs`, `gemini-preflight.mjs`, and `v101-probe-lib.mjs` expose model/catalogue, response usage, and sanitized diagnostics; none exposes a numeric subscription quota balance.
- All 300 completed Gemini v101b receipts have HTTP 200 and zero captured rate-limit headers.
- The one recorded Cloud Code 429 in `limits/cloud.jsonl` has empty headers and `resetAt: null`.
- Public Google plan material describes relative compute access and refresh behavior, not a token-denominated weekly reserve or a queryable remaining-quota endpoint.

## Decision

There is no measurable before/after quota observable. Sending corpus requests would therefore consume quota without producing the denominator required by the experiment. Per the owner protocol, the lane stopped before the first burn request.

Tokens per quota unit, weekly Gemini token reserve, and subscription-equivalent USD/token remain **N-A**. The calculator accepts `--gemini-weekly-tokens <tokens>` when a measured or independently estimated reserve becomes available.

The remaining empirical alternative is controlled exhaustion until HTTP 429 and inference from total tokens consumed. That exceeds the authorized protocol and requires explicit owner GO.
