# Draft oracle C — measurement frame (Refs #797, #783)

Measurement frame for a targeting oracle ("C": should this signal be shown to Steve?) built from
Steve Chaperon's triage of 21 Sept 2026: split, sealed test set and its protocol, baseline of
today's radar filters (B), author sandbox and output schema, extension plan. **No C prompt is
measured here**; the next prompt (`v1`) is written by a new author from the author sandbox only.
Nothing here writes to a database, cluster or bucket. Owner-facing summary in French:
`dossier-section-fr.md`.

Terminology note: a sentropic + engram convergence on vocabulary and on a generic model is in
progress; "oracle" may be renamed. Mapping to standard terms: oracle → annotated reference set
(gold standard); `optim` → development set; `blind` → held-out test set; verdict → label; motif →
rationale code. Item fields (`id`, `label`, `strata`, `input`, `nodeIds`) are generic and map onto
an object-anchored annotation; a rename touches document wording only, not the sets or hashes.

## Method in one paragraph
Steve's workbook (`radar-triage-signaux.xlsx`, sha256 `c7e19f46…0dc1bb8`, sheet Triage, 124 lines)
gives a verdict (Pertinent / À surveiller / Non pertinent) and one motif code per line. Each line
is joined, read-only, with the radar records it names (`signal-…` / `event-…` nodes of
`graph_nodes`, one SELECT in a read-only session). 121 lines resolve; 3 are excluded and listed.
The 121 items are split 50/50 by municipality by a deterministic script, balanced on nine strata;
hashes in `SHA256SUMS`. The test set (61 lines) is sealed outside the repository
(`TEST-SET-PROTOCOL.md`).

## Layout
| Path | Content | In git |
|---|---|---|
| `scripts/01-extract-triage.mjs` | workbook → `work/triage.json` (labels only, no free text) | yes |
| `scripts/02-fetch-nodes.mjs` | read-only SELECT on `graph_nodes` through `kubectl exec` → `work/nodes.json` | yes |
| `scripts/03-build-items.mjs` | items = labels + radar record rendered as model input | yes |
| `scripts/04-split.mjs` | stratified split, `split-balance.md`, `SHA256SUMS`, `split-manifest.json` | yes |
| `scripts/05-run.mjs`, `run-all.mjs` | seat-only model runner with test-set guards | yes |
| `scripts/06-score.mjs` | 3-class metrics, robustness, tag coherence (verdict recomputed from tags) | yes |
| `scripts/08-filter-metrics.mjs` | show/hide task: precision, recall, F1 for B passes and reconstructed single filters (C rows with `--prompts`) | yes |
| `scripts/09-seal-test.mjs`, `scripts/lib/testset.mjs` | sealing, run guards, audit log | yes |
| `scripts/lib/derive-verdict.mjs` | transparent filter: verdict from tags (rules R1-R7) | yes |
| `scripts/selftest.mjs` | stats, sealing, guards, derived verdict, split integrity | yes |
| `TEST-SET-PROTOCOL.md`, `test-access-log.jsonl` | protocol and audit log of test-set accesses | yes |
| `results.md`, `results/filter-*` | baseline B on the same lines (test set first) | yes |
| `extension-plan.md`, `review.md`, `dossier-section-fr.md` | extension proposal, review, French section | yes |
| `SHA256SUMS`, `split-manifest.json`, `split-balance.md` | set hashes and balance (no item content) | yes |
| `optim.jsonl` | development set | no, local only |
| test set | sealed (AES-256-GCM) outside the repository; key held by the test executor | no, hash only |
| `runs/`, `work/` | model answers, intermediate prod reads | no (git-ignored) |

### Why the sets are not in git
The repository is public. The sets carry Steve's per-line codes and verbatim excerpts of municipal
minutes read from production. Publishing them is an owner decision (dossier decision D6).

## Reproduce
```sh
node docs/reviews/oracle-c-draft/scripts/01-extract-triage.mjs /path/to/radar-triage-signaux.xlsx
KUBECONFIG=<tenant kubeconfig> node docs/reviews/oracle-c-draft/scripts/02-fetch-nodes.mjs
node docs/reviews/oracle-c-draft/scripts/03-build-items.mjs
node docs/reviews/oracle-c-draft/scripts/04-split.mjs
ORACLE_C_ROLE=test-executor node docs/reviews/oracle-c-draft/scripts/09-seal-test.mjs <sealed-out> <key-file>
node docs/reviews/oracle-c-draft/scripts/08-filter-metrics.mjs --set optim
ORACLE_C_ROLE=test-executor ORACLE_C_TEST_SEALED=<sealed> ORACLE_C_TEST_KEY_FILE=<key> \
  node docs/reviews/oracle-c-draft/scripts/08-filter-metrics.mjs --set blind
node docs/reviews/oracle-c-draft/scripts/selftest.mjs
```
The graph is live: `03`/`04` reproduce the same sha256 only against the same `work/nodes.json`
(read at 2026-10-04T21:03Z).

## Model routes for the coming runs (seats only)
| Arm | Model id | Route |
|---|---|---|
| Astra low | `gpt-6-astra`, `model_reasoning_effort=low` | `codex exec` (ChatGPT seat), read-only sandbox, empty cwd |
| Gemini low | `gemini-3.8-flash-low` | `agy --print` (Antigravity seat), empty cwd |
| Claude Opus 5.5 low | `claude-opus-5-5`, `--effort low` | `claude -p` (Claude seat), tools disabled, empty cwd |

Astra and Opus use the model ids of the previous benchmarks (v101b / M1 v4, v11alpha); Gemini uses
the Antigravity id of the same family and effort. Child processes run without API keys, auth tokens
or provider-routing variables (`lib/models.mjs`). CLI versions: codex-cli 0.160.0, agy 1.2.16,
Claude Code 2.1.289.
