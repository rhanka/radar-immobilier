# Draft targeting oracle C (Refs #797, #783)

**Status: exploratory Steve-agreement pilot** (see `review.md`), not a D13-grade oracle.

Files-only draft of a targeting oracle ("C": should this signal be shown to Steve?) built from
Steve Chaperon's triage of 21 Sept 2026, measured with three models at low effort. Nothing here
writes to a database, cluster or bucket. Owner-facing summary in French: `dossier-section-fr.md`.

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
The 121 items are split 50/50 by a deterministic script committed before the first model call,
by municipality, balanced on nine strata; the set hashes are in `SHA256SUMS` / `split-balance.md`
(committed later, see `results.md` timeline). A prompt prefiguring C is written from Steve's general
rules only, iterated on `optim` only, frozen, then run **once** on `blind`.

## Layout
| Path | Content | In git |
|---|---|---|
| `scripts/01-extract-triage.mjs` | workbook → `work/triage.json` (labels only, no free text) | yes |
| `scripts/02-fetch-nodes.mjs` | read-only SELECT on `graph_nodes` through `kubectl exec` → `work/nodes.json` | yes |
| `scripts/03-build-items.mjs` | items = labels + radar record rendered as model input | yes |
| `scripts/04-split.mjs` | stratified split, freeze, `split-balance.md` | yes |
| `scripts/05-run.mjs`, `run-all.mjs` | seat-only model runner (blind guard) | yes |
| `scripts/06-score.mjs`, `rescore-all.mjs` | metrics + robustness; re-scores archived runs without model calls | yes |
| `scripts/08-filter-metrics.mjs` | show/hide filtering task: precision, recall, F1 for B passes, reconstructed single filters and C v1/v2 on the same lines (archived answers, no model call) → `results/filter-metrics-*`, `results/filter-pr-*.svg` | yes |
| `scripts/07-review.mjs`, `review-brief.md` | adversarial review runner and brief | yes |
| `scripts/selftest.mjs` | stats helpers + split integrity | yes |
| `prompt-c-v*.md` | prompt iterations (optim only) | yes |
| `results.md`, `results/score-*.{md,json}` | results (aggregates only) | yes |
| `extension-plan.md`, `review.md`, `dossier-section-fr.md` | extension proposal, review + reconciliation, French section | yes |
| `selection-rule.md`, `final-prompt.json` | prompt selection rule, frozen final prompt (sha256) | yes |
| `optim.jsonl`, `blind.jsonl` | frozen sets (Steve codes + radar records) | **no** (see below) |
| `SHA256SUMS`, `split-manifest.json`, `split-balance.md` | set hashes and balance (no item content) | yes (`cbc1185d`) |
| `runs/`, `work/` | raw model answers, intermediate prod reads | no (git-ignored) |

### Why the frozen sets may not be in git
The repository is public. The frozen sets carry Steve's per-line codes and verbatim excerpts of
municipal minutes as served by the radar, read from production. Publishing them is an owner
decision (dossier decision D6 is still open). Their sha256 are recorded in `split-balance.md`, so a
copy kept elsewhere can be verified byte for byte.

## Reproduce
```sh
node docs/reviews/oracle-c-draft/scripts/01-extract-triage.mjs /path/to/radar-triage-signaux.xlsx
KUBECONFIG=<tenant kubeconfig> node docs/reviews/oracle-c-draft/scripts/02-fetch-nodes.mjs
node docs/reviews/oracle-c-draft/scripts/03-build-items.mjs
node docs/reviews/oracle-c-draft/scripts/04-split.mjs
node docs/reviews/oracle-c-draft/scripts/run-all.mjs --set optim --prompt v1
node docs/reviews/oracle-c-draft/scripts/06-score.mjs --set optim --prompt v1
```
The graph is live: a later read can return different records, so `03`/`04` reproduce the same
sha256 only against the same `work/nodes.json` (read at 2026-10-04T21:03Z).

## Model routes (seats only)
| Arm | Model id | Route |
|---|---|---|
| Astra low | `gpt-6-astra`, `model_reasoning_effort=low` | `codex exec` (ChatGPT seat), read-only sandbox, empty cwd |
| Gemini low | `gemini-3.8-flash-low` | `agy --print` (Antigravity seat), empty cwd |
| Claude Opus 5.5 low | `claude-opus-5-5`, `--effort low` | `claude -p` (Claude seat), tools disabled, empty cwd |

Astra and Opus use the same model ids as the previous benchmarks (v101b / M1 v4: `gpt-6-astra`;
v11alpha: `claude-opus-5-5` through `claude -p --effort`). Gemini uses the Antigravity id
`gemini-3.8-flash-low`, where v101b used `gemini-3.8-flash` with an effort parameter: same family
and effort, different id and client. v101b reached Astra and Gemini through llm-mesh (Codex /
Cloud Code runtime clients) rather than the `codex` / `agy` CLIs used here. During this campaign
every child process ran without `*_API_KEY` and a few base-URL variables; the scrub was widened
after review (auth tokens, routing, cloud variables). The effective auth mode was not logged
(`non vérifié`). CLI versions: codex-cli 0.160.0, agy 1.2.16, Claude Code 2.1.289.
