# T1 real-model benchmark report

## Outcome

No current candidate is qualified for T1. The effective historical Sonnet 4.6
artifacts retain materially more municipal signal than the real Luna-low
outputs, but they were produced through an older Graphify/prompt path. Luna
failed the frozen extraction validator on all five PDFs. Gemini 3.8 is not yet
included in the quality ranking: llm-mesh 0.19's `daily` Cloud Code endpoint
returns 404, while the standard host reaches the quota layer and returns 429.
A byte-comparable Sonnet 4.6 run is also still blocked
before contact by the absence of a supported Anthropic runtime client.

## Executed systems

| System | Real calls | Effective identity | Result |
|---|---:|---|---|
| Historical Sonnet | 0 reruns; 5 retained outputs | `claude-sonnet-4-6` receipt | historical reference only |
| Luna low | 5 | `gpt-5.6-luna`, `low`, Codex account | 5 responses; 0/5 validator acceptance |
| Gemini low | 5 initial + 3 small probes | `gemini-3.8-flash`, `LOW`, Cloud Code account | endpoint fix and quota pending; no full output |
| Comparable Sonnet | 0 | requested `claude-sonnet-4-6` | supported client unavailable |

The five immutable inputs and frozen prompt/schema/oracle hashes are listed in
`protocol.md`. Candidate requests verified those hashes before provider
contact. The historical Graphify 0.10.0 baseline is not claimed to have the
same prompt, schema, chain, cap, or effort semantics.

## Quality and citations

Both independent blind judges rank the historical output first. Sol xhigh
finds 32/36 oracle subjects identifiable versus 21/36 for Luna; Astra finds
32/36 versus 22/36. Mean operational usefulness is 3.1/5 for historical
Sonnet and 2.9/5 for Luna across the two judgments.

Luna's strength is provenance: 56/64 citation records contain full source
identity plus a physical page, and 49/64 excerpts are contained on that page.
Its major weakness is omission and procedural certainty; all five raw outputs
failed the current validator. The strict automated anchor diagnostic finds
3/36 anchors for Luna versus 11/36 for the legacy baseline. These strict
figures are diagnostics, not substitutes for the judges' semantic coverage.

The historical output has 35 citation records and generally broader signal,
but no current full-identity fields. Several physical pages are wrong or are
resolution suffixes, and some agenda items are overstated as completed.

## Velocity and subscription use

Historical retained timing totals 496,883 ms (mean 99,376.6 ms). Luna totals
600,797 ms (mean 120,159.4 ms), 20.9% slower. Luna reports 61,537 input,
32,247 output, and 710 reasoning tokens. Codex subscription usage moved from
60% to 61% over the campaign; no metered API key was used. Cloud Code exposes
no comparable quota snapshot in the benchmark path; unsupported manual-host
probes returned 429 `RESOURCE_EXHAUSTED` twice.

## Gemini transport finding

The exact llm-mesh 0.19 probe to `daily-cloudcode-pa` returned whitelisted 404
`NOT_FOUND` / “Requested entity was not found.” Changing only the hostname to
the AGY-compatible `cloudcode-pa` route changed the result to 429
`RESOURCE_EXHAUSTED`; model, `LOW`, cap, and envelope fields stayed fixed.
This proves the 0.19 `daily` endpoint causes the 404 and that effort is not
causal. The 429 is a distinct quota boundary. The runner already injects
`CloudCodeRuntimeClient` through `GeminiAdapter`; Graphify 0.18 owns no
endpoint. See `gemini-transport-diagnosis.md` and its three redacted receipts.
No PDF output from the manual-host probes is included in the comparison.

## Judge identity boundary

The Sol session self-reported `gpt-5.6-sol` xhigh. Astra was launched by H2A
MCP as `gpt-6-astra` xhigh, but the runtime self-reported only `gpt-6` and did
not expose effort; its exact runtime identity is therefore unverified. The
requested Fable judgment was not duplicated after the catalog collision was
identified; Astra supplied the second independent path.

## Reproduction gates

- `make -C tools/refresh-benchmark test-v4 ENV=test-t1-model-benchmark` — 10/10.
- `make -C tools/refresh-benchmark test-score-v4 ENV=test-t1-model-benchmark` — 2/2.
- Provider calls use only `run-v4`, `preflight-v3`, or `gemini-diagnostic`
  Make targets with the enrolled keyring mounted read-only and copied into an
  ephemeral `/run` filesystem.

The decision boundary is: consume the exact published llm-mesh correction,
then require available quota and a green one-PDF preflight before the five
Gemini cases. No external gateway is required. Obtain a supported comparable
Anthropic client before the five Sonnet cases. Keep Graphify 0.18 unless an
ABI or lock incompatibility is demonstrated. Re-freeze a three-system blind
bundle only after those real outputs exist; do not assign failed transports a
quality score of zero.
