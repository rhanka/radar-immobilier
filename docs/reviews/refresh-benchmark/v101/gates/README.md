# v101 launch-gate evidence

All JSON records in this directory are allowlist-redacted evidence. Campaign receipts live under
`runner-v2`; the earlier `runner` directory records pre-network failures caused by the portable
corpus transition and is retained to preserve immutable attempt history.

| Gate | Result | Evidence |
| --- | --- | --- |
| Runner, two documents | pass: 2 receipts, 2 requests, 2 accepted v9 outputs | `runner-v2/` |
| Codex 32,768-token cap | fail: llm-mesh 0.19.2 removes `max_output_tokens`; wire cap absent and the 32-token probe did not truncate | `codex-cap.json` |
| Gemini MEDIUM | pass: one 512-token generation request, exact ping | `gemini-medium-512-v2.json` |
| Gemini HIGH | pass: one 512-token generation request, exact ping | `gemini-high-512-v2.json` |
| `gpt-5.6-terra` judge | pass: one generation request, exact ping | `judge-gpt-5.6-terra.json` |
| `gpt-oss-120b-medium` judge | fail: one generation request reached the endpoint and returned HTTP 400 | `judge-gpt-oss-120b-medium.json` |

The two non-v2 Gemini records captured catalog-only attempts and are retained as immutable negative
evidence. `campaign-launch.json` records the resulting 14-arm campaign: 12 Codex arms are excluded,
while all six Cloud Code, one OpenAI, six Anthropic, and one Mistral arms remain selected.
