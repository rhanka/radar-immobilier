# T1 real-model benchmark protocol (frozen before execution)

Frozen on 2026-09-13 before any v4 candidate request.

## Inputs and extraction contract

The campaign reuses these immutable v3 artifacts by content hash:

| Artifact | SHA-256 |
|---|---|
| `../v3/manifest.json` | `a9310deb5589aebb10502a40caf651af0f60db98cc7a818bec56f7a6b56c29f1` |
| `../v3/prompt-freeze.json` | `0685fc9e08408d3a88248493d29ed471a944ce8ac932d1022e82f7b24c32b5b0` |
| `../v3/manual-oracle.json` | `b45d984118e04eff9e5472b1c595b600514c70716a1c3f255ec0b169c977f64c` |

The five cases are `lac-des-seize-iles-2026-09-agenda`,
`saint-etienne-de-bolton-2026-08-04`, `valcourt-2026-06-01-agenda`,
`saint-barthelemy-2026-09-08`, and `waterloo-2026-08-18`. Each runner must
verify PDF, extracted text, per-document prompt, schema, profile-module, and
corpus-module hashes before contacting a provider. The maximum output is the
frozen 16,384 tokens. One retry is allowed only after a transport failure.

## Systems under comparison

- Baseline: the already-produced Graphify CAS artifacts from
  `run-dryrun2-final-20260911T215911Z`, model receipt
  `claude-sonnet-4-6`; no baseline rerun. Its installed Graphify 0.10.0,
  historical prompt path, and separately reported `--effort low` context are
  provenance caveats rather than claims of byte-identical runtime parity.
- Candidate L: `openai/gpt-5.6-luna`, explicit reasoning effort `low`, Codex
  account transport, through llm-mesh.
- Candidate G: `gemini/gemini-3.8-flash`, explicit reasoning effort `low`,
  Cloud Code account transport, through llm-mesh. The installed adapter maps
  this to Cloud Code `thinkingLevel: LOW`.
- Comparable S: `anthropic/claude-sonnet-4-6`, same frozen Graphify request,
  schema, prompt, and 16,384-token cap. `ANTHROPIC_API_KEY` may only enter the
  isolated runtime from `/home/antoinefa/src/sentropic/.env`; its value must
  never be read into logs, copied, or committed. This is distinct from the
  historical baseline.

Comparable S is blocked before provider contact in the installed runtime:
llm-mesh exports `AnthropicAdapter`, but no `AnthropicRuntimeClient` or Claude
Code runtime client, and the benchmark volume has no Anthropic SDK. A custom
HTTP client would be an unfrozen transport implementation, so the campaign
waits for a supported path from s-conductor rather than fabricating one.

## Amended Gemini gateway diagnosis

The five initial Candidate G requests returned HTTP 404 without preserving the
provider body. This is not evidence that Gemini 3.8 or `LOW` is unavailable:
an earlier native AGY run produced `PING_OK` with effective model
`gemini-3.8-flash`. Before ranking Candidate G, run one small transport probe at
a time and retain only whitelisted Google error `code`, `status`, and redacted
`message` fields.

The original runner instantiated `CloudCodeRuntimeClient` directly; it did not
prove use of the already-operational gateway. The two direct-host probes are
retained as diagnostics only. A manual host substitution is not a supported
solution and makes no claim about gateway correctness.

The corrected diagnostic order is:

1. identify the official enrolled-gateway call contract without modifying
   llm-mesh or sentropic;
2. obtain a gateway `gemini-3.8-flash` ping with identity, effort, usage, and
   sanitized transport evidence;
3. adapt only the radar runner to that gateway contract;
4. run one frozen Lac case, then all five cases only if it is green.

Only a green full Lac case authorizes the five-document Candidate G campaign. The
installed package version/static model profile, account public model allowlist
(or its absence), endpoint, envelope shape, requested/effective model, and
provider error whitelist are recorded without credentials or response headers.

Accounts are identified only by one-way pseudonyms. No secret or auth material
may enter an artifact. Quota snapshots are retained before and after when the
account transport exposes them; otherwise the report says unavailable.

## Frozen deterministic measurements

For every document/system record status, accepted extraction, elapsed time,
provider/model/effort observed on the outgoing request, input/output/reasoning
tokens when exposed, and response/output hashes. Fail closed on absent or
mismatched observed model/effort. The installed Codex transport does not
project `maxOutputTokens` onto its provider request; retain a `null` observed
cap and report this asymmetry. Cloud Code must expose the frozen 16,384 cap.

Validate output against the frozen T1 validator. Separately measure citation
identity (`source_file`, `rawRef`, `docSha`, `sourceUrl`, modality), physical PDF
page, verbatim excerpt containment, DesignationEvent/Signal grouping, and
oracle stage. Report TP/FP/FN and recall/precision per document and aggregate;
keep Waterloo's oracle classification as partial. Do not silently coerce
schema-invalid output into a success.

## Frozen blind judgment

After deterministic scoring, randomize stable system labels and submit the
same bundle and rubric independently to `gpt-5.6-sol` xhigh and `gpt-6-astra`
xhigh through H2A MCP. Judges rank signal equivalence, omissions, false
positives, citation support, and operational usefulness without model names or
latency/token data. Preserve signed session identities and raw judgments.

Requested Fable 5 is not a second independent judge: the installed h2a catalog
resolves its nickname to the same Sol family. It is therefore recorded as an
identity collision and replaced by Astra; no duplicate judgment is fabricated.
