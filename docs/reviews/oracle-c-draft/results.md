# Results — draft oracle C, three models at low effort

**Status: exploratory Steve-agreement pilot** (reviews F01, F02, F10, B1, B2, M1). It measures how
well three low-effort models reproduce Steve's verdicts on the lines he triaged. It does **not**
reproduce oracle E's construction (no multi-pass consensus, no adjudication, no "non résolu"
bucket; one human annotator) and it is **not** D10's independent test set (blind v1 comes from the
51 development municipalities, not from the next 52). It must not be used as D13 evidence.

## Measurement level (read this first)

- **Unit** = one line of Steve's Triage sheet attached to the radar record(s) it names: 121 lines
  (3 of 124 excluded, no radar record), split by municipality into **optim 60 lines / 26
  municipalities** and **blind 61 lines / 25 municipalities**. It is not a document, not a
  bylaw, not a dossier.
- **Truth** = Steve's verdict on that line (Pertinent / À surveiller / Non pertinent), given on
  2026-09-15..21 from what the screen and the MCP tools showed him.
- **Task measured** = the display decision "show this line to Steve" vs "hide it". A system
  "shows" a line when:
  - B (today's radar): the line was visible in the pass Steve ran with that filter combination;
  - C (model): the model answers Pertinent or À surveiller (C hides only Non pertinent); "C strict"
    shows only lines the model calls Pertinent.
- **Two definitions of a positive**: positive = Pertinent (what Steve wants); positive =
  Pertinent or À surveiller (what Steve wants to keep in sight).
- **Precision** = shown positives / shown. **Recall** = shown positives / all positives of the
  set. **F1** = harmonic mean. **Noise** = Steve-Non pertinent among shown = 1 − precision with
  positive = P+S. **Pertinent lost** = Steve-Pertinent hidden (false negatives with positive = P).
  Intervals: municipality-clustered bootstrap (whole cities resampled), 95 %.

### Selection bias of the universe, and how it is handled
Every line exists **because it was visible in one of Steve's passes** (pass 1 = five filters,
pass 2 = without Précoce, pass 3 = no filter). Lines that today's radar never showed, and the
records his filters rightly removed (sheet "Écartés par les filtres"), are outside the universe.
Consequences:
- **Recall is measured inside the 121-line universe only.** B pass 3 ("no filter") has recall
  100 % by construction; the true recall of any system over the whole radar is not measurable here
  (Steve's seven missed dossiers are absent).
- **Precision is comparable** between systems on the same lines, but B's absolute precision is
  flattered for pass 2 and pass 3 (the noise those passes add beyond the lines Steve recorded is
  not counted) — so the comparison favours B, not C.
- B pass 1 / 2 / 3 are **observed** (what the deployed radar showed Steve). Single filters
  ("Précoce alone", "Zonage alone", "Exclude PIIA + dérogation alone") are **reconstructed** from
  the record properties read on 2026-10-04 and are approximations (`non vérifié` against the code
  deployed in September); "Résidentiel alone" is not computable from stored properties (N-A).
  Sanity check: the reconstructed Précoce matches the observed pass 1 / pass 2 split on 51 of 52
  optim lines and 53 of 54 blind lines.
- **C v1 on blind is N-A**: blind is measured once, with the frozen final prompt (v2) only. No new
  model call was made for this section; all C figures reuse the archived answers.

### Comparison table — filtering task, same lines (values in %)

**Optim (60 lines: 19 Pertinent, 14 À surveiller, 27 Non pertinent)**

| System | Precision (P) | Recall (P) | F1 (P) | Precision (P+S) | Recall (P+S) | F1 (P+S) | Noise | Pertinent lost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 47.2 | 89.5 | 61.8 | 69.4 | 75.8 | 72.5 | 30.6 | 2/19 |
| B pass 2 (no Précoce) | 34.6 | 94.7 | 50.7 | 59.6 | 93.9 | 72.9 | 40.4 | 1/19 |
| B pass 3 (no filter) | 31.7 | 100.0 | 48.1 | 55.0 | 100.0 | 71.0 | 45.0 | 0/19 |
| Précoce alone (reconstructed) | 47.4 | 94.7 | 63.2 | 68.4 | 78.8 | 73.2 | 31.6 | 1/19 |
| Zonage alone (reconstructed) | 39.6 | 100.0 | 56.7 | 68.8 | 100.0 | 81.5 | 31.3 | 0/19 |
| Exclude PIIA + dérogation alone (reconstructed) | 34.0 | 94.7 | 50.0 | 60.4 | 97.0 | 74.4 | 39.6 | 1/19 |
| C v1 Astra low | 48.1 | 68.4 | 56.5 | 81.5 | 66.7 | 73.3 | 18.5 | 6/19 |
| C v1 Gemini low | 60.0 | 94.7 | 73.5 | 86.7 | 78.8 | 82.5 | 13.3 | 1/19 |
| C v1 Opus 5.5 low | 54.5 | 94.7 | 69.2 | 84.8 | 84.8 | 84.8 | 15.2 | 1/19 |
| C v2 Astra low | 50.0 | 94.7 | 65.5 | 80.6 | 87.9 | 84.1 | 19.4 | 1/19 |
| C v2 Gemini low | 59.4 | 100.0 | 74.5 | 87.5 | 84.8 | 86.2 | 12.5 | 0/19 |
| C v2 Opus 5.5 low | 54.3 | 100.0 | 70.4 | 85.7 | 90.9 | 88.2 | 14.3 | 0/19 |
| C v2 strict Gemini low (Pertinent only) | 80.0 | 84.2 | 82.1 | 90.0 | 54.5 | 67.9 | 10.0 | 3/19 |

**Blind (61 lines: 20 Pertinent, 15 À surveiller, 26 Non pertinent) — single pass, prompt v2**

| System | Precision (P) | Recall (P) | F1 (P) | Precision (P+S) | Recall (P+S) | F1 (P+S) | Noise | Pertinent lost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B pass 1 (5 filters) | 45.9 | 85.0 | 59.6 | 64.9 | 68.6 | 66.7 | 35.1 | 3/20 |
| B pass 2 (no Précoce) | 37.0 | 100.0 | 54.1 | 61.1 | 94.3 | 74.2 | 38.9 | 0/20 |
| B pass 3 (no filter) | 32.8 | 100.0 | 49.4 | 57.4 | 100.0 | 72.9 | 42.6 | 0/20 |
| Précoce alone (reconstructed) | 45.9 | 85.0 | 59.6 | 64.9 | 68.6 | 66.7 | 35.1 | 3/20 |
| Zonage alone (reconstructed) | 38.3 | 90.0 | 53.7 | 66.0 | 88.6 | 75.6 | 34.0 | 2/20 |
| Exclude PIIA + dérogation alone (reconstructed) | 33.3 | 100.0 | 50.0 | 58.3 | 100.0 | 73.7 | 41.7 | 0/20 |
| C v1 (3 models) | N-A | N-A | N-A | N-A | N-A | N-A | N-A | not run on blind |
| C v2 Astra low | 52.6 | 100.0 | 69.0 | 81.6 | 88.6 | 84.9 | 18.4 | 0/20 |
| C v2 Gemini low | 57.1 | 100.0 | 72.7 | 88.6 | 88.6 | 88.6 | 11.4 | 0/20 |
| C v2 Opus 5.5 low | 52.6 | 100.0 | 69.0 | 84.2 | 91.4 | 87.7 | 15.8 | 0/20 |
| C v2 strict Gemini low (Pertinent only) | 81.0 | 85.0 | 82.9 | 90.5 | 54.3 | 67.9 | 9.5 | 3/20 |

Full tables with TP / FP / FN / TN, clustered intervals and the other strict variants:
`results/filter-metrics-optim.md`, `results/filter-metrics-blind.md` (JSON alongside); charts
`results/filter-pr-optim.svg`, `results/filter-pr-blind.svg`.

Reading (JUGEMENT, positive = Pertinent, blind): B pass 1 shows 37 lines for 17 of 20 Pertinent
(precision 45.9, recall 85.0); C v2 shows 35-38 lines for all 20 (precision 52.6-57.1, recall
100). C gains on both axes against pass 1, and on precision against pass 2 at equal recall. With
positive = Pertinent or À surveiller, C v2 reaches precision 81.6-88.6 at recall 88.6-91.4, against
64.9 / 68.6 for pass 1. The clustered intervals are wide and overlap: precision (positive = P) B pass 1 45.9 [28.1–62.9] vs C v2 52.6-57.1 [37.5–77.1]; the clear gains are recall at positive = P (85 → 100, 3 Pertinent no longer lost) and precision at positive = P+S (B pass 1 64.9 [48.3–80.6] vs C v2 81.6-88.6 [69.2–100], intervals still partly overlapping at n = 61). The intervals overlap between the three models. A "strict" C
(only model-Pertinent shown) buys precision (≈81-87) at the cost of recall (65-85).

![Precision and recall, blind](results/filter-pr-blind.svg)

![Precision and recall, optim](results/filter-pr-optim.svg)

## Model-level details (3-class verdict)

All figures come from `scripts/06-score.mjs` (re-run by `scripts/rescore-all.mjs`, no model call)
on the archived runs in `runs/` (not versioned); tables are copied from `results/score-*.md` and `results/filter-metrics-*.md`
without hand edits; machine-readable versions are `results/score-*.json`.

## Timeline (UTC, from commits and run receipts)
| Step | Time | Evidence |
|---|---|---|
| Split script committed (deterministic, seed 20261004) | 21:10:08 | commit `6d79793a`; set hashes reproduced byte for byte by both reviewers from `work/items.json`, but the hash files themselves were not committed then (B1) |
| Optim v1 run (3 models x 60) | 21:12:53–21:16:23 | receipts |
| Prompt v1, prompt v2, runner, scorer, selection rule committed | 21:18:03 | commit `5a13ff07` — **after** the v1 run (m1) |
| Optim v2 run | 21:18:14–21:20:36 | receipts |
| v2 frozen as final | 21:21:08 | commit `9715c72c`, `final-prompt.json` |
| Blind v2 run, single pass (3 models x 61) | 21:21:18–21:23:49 | receipts; blind guard in `05-run.mjs` |
| Rows added after the blind run | — | "B view + C post-filter", CLI cost, robustness block, sensitivity subset: computed identically for every arm and set, but post hoc |

"One run" means one **retained** response per item: the runner retries an unparsable answer once
and kept only the final attempt; the attempt count was not logged during this campaign (F05, m5;
logging added afterwards). All 543 retained receipts have exit code 0 and a parsed verdict.

## Definitions
- **Verdict accuracy**: share of items where the model's verdict equals Steve's (3 classes); 95 %
  Wilson interval in brackets (assumes independent lines; see the municipality-clustered interval
  in the robustness block).
- **Default view of C**: C hides only "Non pertinent" (an invalid answer stays visible). **Noise
  rate** = Steve-"Non pertinent" lines shown / lines shown.
- **Pertinent kept visible** = Steve-"Pertinent" lines not hidden. **Useful hidden** = Steve P or S
  hidden.
- **B (pass 1)**: the lines of the set that appeared in Steve's pass 1 (his five filters). **B view
  + C post-filter**: C applied on top of B's pass-1 view.
- **Like-for-like caveat (M2)**: the pool is B's whole pass-1 view plus the pass-2/3 lines Steve
  chose to record; what B rightly excluded (sheet "Écartés par les filtres") is outside the pool.
  Only the **post-filter rows** compare B and C on the same population; C's standalone noise does
  not.
- **Motif exact / family**; **sens** = model `criteres.sens` vs Steve's "Sens de la modification".
- **Inter-model**: Cohen's κ per pair, Fleiss' κ; McNemar exact test on correctness per pair.
- **Cost**: seat runs, no API billing. Astra and Gemini token counts include the CLI agent's own
  system prompt (~13.6 k input tokens per call). The Opus arm carries ~1.9 k unexplained input
  tokens per call, consistent with the operator's global `~/.claude/CLAUDE.md` (2 293 bytes) being
  injected by `claude -p` (`non vérifié`). The Claude CLI reports an API-equivalent cost; Astra and
  Gemini: `non vérifié`.

## Headline (blind, single pass, prompt v2) — like-for-like rows first
| | B (pass 1) | Astra low | Gemini low | Opus 5.5 low |
|---|---:|---:|---:|---:|
| **B view + C post-filter: noise** | 35.1 % (13/37) | 12.0 % (3/25) | 8.3 % (2/24) | 11.5 % (3/26) |
| **B view + C post-filter: Pertinent kept** | 17/17 | 17/17 | 17/17 | 17/17 |
| Verdict accuracy | N-A | 70.5 % | 78.7 % | 72.1 % |
| Accuracy, municipality-clustered 95 % CI | N-A | 58.0–81.4 % | 69.1–87.3 % | 60.0–81.8 % |
| Pertinent kept visible (whole set) | 17/20 | 20/20 | 20/20 | 20/20 |
| Pertinent kept, Wilson 95 % lower bound | — | 83.9 % | 83.9 % | 83.9 % |
| Sens = Steve's sens | — | 67.2 % | 72.1 % | 75.4 % |

- **Sensitivity (B2)**: v2's first rule leans on the "12 sens non donné" row of Steve's analysis,
  which is built from the whole survey (6 of those lines are in blind). Removing the lines that
  match that row (pass 1 ∧ Pertinent ∧ sens ∈ {Indéterminé, Mixte, Neutre}) leaves 55 blind lines:
  accuracy 70.9 / 78.2 / 72.7 %, Pertinent kept 14/14 for all three, post-filter noise 15.8 /
  11.1 / 15.0 %. The headline does not rest on those lines, but the blind set is not clean at the
  policy level.
- **No ranking**: McNemar on blind gives p = 0.13 (Astra vs Gemini), 0.34 (Gemini vs Opus), 1.00
  (Astra vs Opus). Optim → blind gaps (73.3 → 70.5, 76.7 → 78.7, 78.3 → 72.1) are well inside the
  ±15-point interval of a difference at this size.
- **Agreement**: Fleiss κ 0.75 on blind; unanimous on 46/61. A unanimous "Non pertinent" covered 19
  blind lines, 16 of them Steve-N, 3 Steve-S, 0 Steve-P (precision of a unanimous exclusion
  16/19 = 84 %, measured on 19 lines only). "Exclu prouvé" would need a validated rule, not this.

## Iterations (optim only)
| Prompt | Mean accuracy (3 models) | Steve-P hidden (sum of 3) | Noise shown (sum of 3) | Selected |
|---|---:|---:|---:|---|
| v1 | 60.6 % | 8 | 14 | no |
| v2 | 76.1 % | 1 | 16 | **yes** (`selection-rule.md`) |

The selection rule was written after v1 was scored and committed with v2 (m10); it selects on
3-class accuracy, while the display metric (noise shown) slightly worsened (14 → 16).

What changed v1 → v2 (`prompt-c-v2.md`): verdict follows Steve's four categories (general-scope
residential with an unstated sense is "Pertinent"); early stage is never a downgrade; numbered
procedural acts are not "agenda only"; CPTAQ exclusion vs authorisation; accessory subdivision
bylaws; a doubtful vocation stays visible. **These are the author's arbitrations of points the
dossier leaves to Steve (D8), tuned on optim lines** (M1): the CPTAQ rule flips one optim line for
all three models (3 of v1's 8 hidden Pertinent); the agenda rule contradicts Steve on another optim
line for all three models in v2. Steve must confirm rules 1, 3 and 4 before any further use. The
codebook in the prompts paraphrases or shortens 6 of Steve's 28 definitions (F09); v2 says early
stage never justifies "À surveiller" while keeping the code S-PLANIFIE (m2).

**Why no v3 (restated from the classified optim v2 errors, M4).** Each optim v2 disagreement was
classified by the author (aggregate counts only; the per-line table is not published, see README):

| Error class | Astra (16) | Gemini (14) | Opus (13) |
|---|---:|---:|---:|
| (a) record lacks what Steve used (e.g. "bylaw X amending zoning bylaw Y" only) | 4 | 4 | 4 |
| (b) Steve more lenient than his own legend | 1 | 3 | 2 |
| (c) conflict between a v2 rule or the legend and Steve's label, on a D8-type point | 5 | 4 | 6 |
| (d) plain model error | 6 | 3 | 1 |

Classes (a)–(c) are 63-92 % of the errors; (c) is the largest class for Opus and tied first for
Gemini, and it needs Steve's arbitration, not prompt tuning. Astra's plain errors (d) are the one
place a v3 could help, at the risk of fitting optim.

## What it suggests for C (JUGEMENT)
- As a post-filter of B's view, a low-effort model with Steve-derived rules removed most of the
  noise that Steve recorded in pass 1 (35 % → 8-12 %) without hiding any of his Pertinent lines, on
  25 unseen municipalities. With 17 Pertinent lines, "no loss" is bounded below at 81.6 % (Wilson).
- The P / S boundary is weak (S precision 45-64 %), motif codes agree about one time in two, and
  the "sens" of the modification agrees 67-75 %: usable as explanations, not yet as filter keys.
- The display decision (show / hide) is far more stable than the 3-class verdict.

## Limits
- Small sets, clustered by municipality (60 / 61 lines, 26 / 25 municipalities).
- Steve's labels are taken as truth, including D8 points; lines where he used MCP answers absent
  from the record are scored (no "record insufficient" tag was set before scoring).
- Records read on 2026-10-04 (`created_at` ≤ 2026-08-03 for all 162 nodes, no `updated_at`
  column): identity with what Steve saw on 2026-09-15..21 is `non vérifié`. 9 lines (5 optim /
  4 blind) are scored with one cited record missing; 10 optim / 6 blind records carry no excerpt.
- Motif family N-agenda-only exists in optim only (4 / 0): blind cannot validate it.
- Pool = what Steve's passes surfaced; one of his seven "missed dossiers" is in optim.
- Isolation is asserted, not proven (F03, M6): empty working directory, Claude tools disabled,
  Codex read-only sandbox (it can still read files), Antigravity without an explicit tool-off flag;
  event streams were not kept, so "zero tool calls" is `non vérifié`. Seat-only: `*_API_KEY` and a
  few base-URL variables were removed; auth tokens and provider-routing variables were not
  (widened afterwards); the effective auth mode was not logged.
- Model ids: `gpt-6-astra` and `claude-opus-5-5` as in v101b / v11alpha; Gemini is
  `gemini-3.8-flash-low` (Antigravity model id) where v101b used `gemini-3.8-flash` with an effort
  parameter through llm-mesh — same family and effort, different id and client.
- Inputs sent to three providers contain names from public minutes (officials and some private
  applicants); redaction before future runs is recommended (m9, D6).

## Full tables


### optim — prompt v1 (n = 60)

| Metric | B (pass 1) | Astra low | Gemini low | Claude Opus 5.5 low | Majority of 3 |
|---|---:|---:|---:|---:|---:|
| Verdict accuracy (3 classes) | N-A | 56.7 % [44.1 %–68.4 %] | 66.7 % [54.1 %–77.3 %] | 58.3 % [45.7 %–69.9 %] | 56.7 % |
| Pertinent precision / recall | N-A | 60.0 % / 15.8 % | 90.0 % / 47.4 % | 100.0 % / 15.8 % | 75.0 % / 15.8 % |
| À surveiller precision / recall | N-A | 40.9 % / 64.3 % | 40.0 % / 57.1 % | 33.3 % / 71.4 % | 32.1 % / 64.3 % |
| Non pertinent precision / recall | N-A | 66.7 % / 81.5 % | 76.7 % / 85.2 % | 81.5 % / 81.5 % | 78.6 % / 81.5 % |
| Default view: lines shown | 36 | 27 | 30 | 33 | 32 |
| Noise rate in view (Non pertinent shown / shown) | 30.6 % (11/36) | 18.5 % (5/27) | 13.3 % (4/30) | 15.2 % (5/33) | 15.6 % (5/32) |
| Pertinent kept visible | 17/19 | 13/19 | 18/19 | 18/19 | 18/19 |
| Useful (P or S) hidden | 8 | 11 | 7 | 5 | 6 |
| Noise removed | 16/27 | 22/27 | 23/27 | 22/27 | 22/27 |
| B view + C post-filter: noise kept (of pass-1 lines kept) | 30.6 % (11/36) | 10.5 % (2/19) | 12.5 % (3/24) | 12.0 % (3/25) |  |
| B view + C post-filter: Pertinent kept | 17/17 | 11/17 | 16/17 | 16/17 |  |
| Motif exact / family | N-A | 30.0 % / 40.0 % | 36.7 % / 46.7 % | 36.7 % / 46.7 % |  |
| Invalid or missing verdicts | N-A | 0 | 0 | 0 |  |
| Latency p50 / p90 (s) | N-A | 9.9 / 12.5 | 4.6 / 6.1 | 5.2 / 7.9 |  |
| Tokens in / out (total) | N-A | 937175 / 9521 | 964509 / 11234 | 298393 / 15795 |  |
| API-equivalent cost reported by the CLI (USD) | N-A | non vérifié | non vérifié | 1.45 |  |

Inter-model agreement on the verdict: astra~gemini κ = 0.55 (agreement 73.3 %); astra~opus κ = 0.65 (agreement 80.0 %); gemini~opus κ = 0.72 (agreement 83.3 %); Fleiss κ = 0.64; unanimous on 42/60.

Confusion — Astra low (rows = Steve, columns = model):

| Steve \ model | P | S | N | invalid |
|---|---:|---:|---:|---:|
| Pertinent | 3 | 10 | 6 | 0 |
| À surveiller | 0 | 9 | 5 | 0 |
| Non pertinent | 2 | 3 | 22 | 0 |

Confusion — Gemini low (rows = Steve, columns = model):

| Steve \ model | P | S | N | invalid |
|---|---:|---:|---:|---:|
| Pertinent | 9 | 9 | 1 | 0 |
| À surveiller | 0 | 8 | 6 | 0 |
| Non pertinent | 1 | 3 | 23 | 0 |

Confusion — Claude Opus 5.5 low (rows = Steve, columns = model):

| Steve \ model | P | S | N | invalid |
|---|---:|---:|---:|---:|
| Pertinent | 3 | 15 | 1 | 0 |
| À surveiller | 0 | 10 | 4 | 0 |
| Non pertinent | 0 | 5 | 22 | 0 |

Robustness (26 municipalities; bootstrap resamples whole municipalities, 2000 draws, seed 797):

| Metric | Astra low | Gemini low | Claude Opus 5.5 low |
|---|---:|---:|---:|
| Accuracy, municipality-clustered 95 % CI | 43.4 %–69.4 % | 55.7 %–79.7 % | 45.7 %–71.2 % |
| Noise in view, municipality-clustered 95 % CI | 6.3 %–33.3 % | 0.0 %–27.8 % | 3.4 %–29.5 % |
| Pertinent kept visible, Wilson 95 % lower bound | 46.0 % | 75.4 % | 75.4 % |
| Sens of the modification = Steve's sens (5 values) | 51.7 % | 55.0 % | 58.3 % |

McNemar exact test on verdict correctness: astra~gemini: 3 vs 9 discordant, p = 0.15; astra~opus: 2 vs 3 discordant, p = 1.00; gemini~opus: 7 vs 2 discordant, p = 0.18.

Unanimous "Non pertinent" (3 models): 25 lines, of which Steve N 21, Steve P 1. Split vote: 18 lines (Steve P 9 / S 4 / N 5).

### optim — prompt v2 (n = 60)

| Metric | B (pass 1) | Astra low | Gemini low | Claude Opus 5.5 low | Majority of 3 |
|---|---:|---:|---:|---:|---:|
| Verdict accuracy (3 classes) | N-A | 73.3 % [61.0 %–82.9 %] | 76.7 % [64.6 %–85.6 %] | 78.3 % [66.4 %–86.9 %] | 80.0 % |
| Pertinent precision / recall | N-A | 82.4 % / 73.7 % | 80.0 % / 84.2 % | 83.3 % / 78.9 % | 84.2 % / 84.2 % |
| À surveiller precision / recall | N-A | 52.6 % / 71.4 % | 58.3 % / 50.0 % | 58.8 % / 71.4 % | 62.5 % / 71.4 % |
| Non pertinent precision / recall | N-A | 83.3 % / 74.1 % | 82.1 % / 85.2 % | 88.0 % / 81.5 % | 88.0 % / 81.5 % |
| Default view: lines shown | 36 | 36 | 32 | 35 | 35 |
| Noise rate in view (Non pertinent shown / shown) | 30.6 % (11/36) | 19.4 % (7/36) | 12.5 % (4/32) | 14.3 % (5/35) | 14.3 % (5/35) |
| Pertinent kept visible | 17/19 | 18/19 | 19/19 | 19/19 | 19/19 |
| Useful (P or S) hidden | 8 | 4 | 5 | 3 | 3 |
| Noise removed | 16/27 | 20/27 | 23/27 | 22/27 | 22/27 |
| B view + C post-filter: noise kept (of pass-1 lines kept) | 30.6 % (11/36) | 8.0 % (2/25) | 8.0 % (2/25) | 7.7 % (2/26) |  |
| B view + C post-filter: Pertinent kept | 17/17 | 16/17 | 17/17 | 17/17 |  |
| Motif exact / family | N-A | 48.3 % / 61.7 % | 51.7 % / 65.0 % | 58.3 % / 68.3 % |  |
| Invalid or missing verdicts | N-A | 0 | 0 | 0 |  |
| Latency p50 / p90 (s) | N-A | 9.5 / 11.7 | 5.0 / 6.3 | 5.5 / 7.8 |  |
| Tokens in / out (total) | N-A | 963649 / 8953 | 901731 / 7902 | 340156 / 15169 |  |
| API-equivalent cost reported by the CLI (USD) | N-A | non vérifié | non vérifié | 1.51 |  |

Inter-model agreement on the verdict: astra~gemini κ = 0.69 (agreement 80.0 %); astra~opus κ = 0.77 (agreement 85.0 %); gemini~opus κ = 0.82 (agreement 88.3 %); Fleiss κ = 0.76; unanimous on 47/60.

Confusion — Astra low (rows = Steve, columns = model):

| Steve \ model | P | S | N | invalid |
|---|---:|---:|---:|---:|
| Pertinent | 14 | 4 | 1 | 0 |
| À surveiller | 1 | 10 | 3 | 0 |
| Non pertinent | 2 | 5 | 20 | 0 |

Confusion — Gemini low (rows = Steve, columns = model):

| Steve \ model | P | S | N | invalid |
|---|---:|---:|---:|---:|
| Pertinent | 16 | 3 | 0 | 0 |
| À surveiller | 2 | 7 | 5 | 0 |
| Non pertinent | 2 | 2 | 23 | 0 |

Confusion — Claude Opus 5.5 low (rows = Steve, columns = model):

| Steve \ model | P | S | N | invalid |
|---|---:|---:|---:|---:|
| Pertinent | 15 | 4 | 0 | 0 |
| À surveiller | 1 | 10 | 3 | 0 |
| Non pertinent | 2 | 3 | 22 | 0 |

Robustness (26 municipalities; bootstrap resamples whole municipalities, 2000 draws, seed 797):

| Metric | Astra low | Gemini low | Claude Opus 5.5 low |
|---|---:|---:|---:|
| Accuracy, municipality-clustered 95 % CI | 62.1 %–82.8 % | 67.1 %–87.8 % | 69.0 %–89.3 % |
| Noise in view, municipality-clustered 95 % CI | 6.9 %–32.4 % | 3.2 %–22.2 % | 3.3 %–27.3 % |
| Pertinent kept visible, Wilson 95 % lower bound | 75.4 % | 83.2 % | 83.2 % |
| Sens of the modification = Steve's sens (5 values) | 53.3 % | 60.0 % | 61.7 % |

McNemar exact test on verdict correctness: astra~gemini: 4 vs 6 discordant, p = 0.75; astra~opus: 3 vs 6 discordant, p = 0.51; gemini~opus: 3 vs 4 discordant, p = 1.00.

Unanimous "Non pertinent" (3 models): 22 lines, of which Steve N 20, Steve P 0. Split vote: 13 lines (Steve P 5 / S 5 / N 3).

### blind — prompt v2 (n = 61)

| Metric | B (pass 1) | Astra low | Gemini low | Claude Opus 5.5 low | Majority of 3 |
|---|---:|---:|---:|---:|---:|
| Verdict accuracy (3 classes) | N-A | 70.5 % [58.1 %–80.4 %] | 78.7 % [66.9 %–87.1 %] | 72.1 % [59.8 %–81.8 %] | 77.0 % |
| Pertinent precision / recall | N-A | 83.3 % / 75.0 % | 81.0 % / 85.0 % | 86.7 % / 65.0 % | 84.2 % / 80.0 % |
| À surveiller precision / recall | N-A | 45.0 % / 60.0 % | 64.3 % / 60.0 % | 47.8 % / 73.3 % | 56.3 % / 60.0 % |
| Non pertinent precision / recall | N-A | 82.6 % / 73.1 % | 84.6 % / 84.6 % | 87.0 % / 76.9 % | 84.6 % / 84.6 % |
| Default view: lines shown | 37 | 38 | 35 | 38 | 35 |
| Noise rate in view (Non pertinent shown / shown) | 35.1 % (13/37) | 18.4 % (7/38) | 11.4 % (4/35) | 15.8 % (6/38) | 11.4 % (4/35) |
| Pertinent kept visible | 17/20 | 20/20 | 20/20 | 20/20 | 20/20 |
| Useful (P or S) hidden | 11 | 4 | 4 | 3 | 4 |
| Noise removed | 13/26 | 19/26 | 22/26 | 20/26 | 22/26 |
| B view + C post-filter: noise kept (of pass-1 lines kept) | 35.1 % (13/37) | 12.0 % (3/25) | 8.3 % (2/24) | 11.5 % (3/26) |  |
| B view + C post-filter: Pertinent kept | 17/17 | 17/17 | 17/17 | 17/17 |  |
| Motif exact / family | N-A | 50.8 % / 65.6 % | 59.0 % / 75.4 % | 54.1 % / 67.2 % |  |
| Invalid or missing verdicts | N-A | 0 | 0 | 0 |  |
| Latency p50 / p90 (s) | N-A | 9.8 / 12.8 | 4.9 / 6.5 | 5.7 / 8.1 |  |
| Tokens in / out (total) | N-A | 980127 / 9323 | 929343 / 9517 | 345794 / 16814 |  |
| API-equivalent cost reported by the CLI (USD) | N-A | non vérifié | non vérifié | 1.45 |  |

Inter-model agreement on the verdict: astra~gemini κ = 0.80 (agreement 86.9 %); astra~opus κ = 0.73 (agreement 82.0 %); gemini~opus κ = 0.73 (agreement 82.0 %); Fleiss κ = 0.75; unanimous on 46/61.

Confusion — Astra low (rows = Steve, columns = model):

| Steve \ model | P | S | N | invalid |
|---|---:|---:|---:|---:|
| Pertinent | 15 | 5 | 0 | 0 |
| À surveiller | 2 | 9 | 4 | 0 |
| Non pertinent | 1 | 6 | 19 | 0 |

Confusion — Gemini low (rows = Steve, columns = model):

| Steve \ model | P | S | N | invalid |
|---|---:|---:|---:|---:|
| Pertinent | 17 | 3 | 0 | 0 |
| À surveiller | 2 | 9 | 4 | 0 |
| Non pertinent | 2 | 2 | 22 | 0 |

Confusion — Claude Opus 5.5 low (rows = Steve, columns = model):

| Steve \ model | P | S | N | invalid |
|---|---:|---:|---:|---:|
| Pertinent | 13 | 7 | 0 | 0 |
| À surveiller | 1 | 11 | 3 | 0 |
| Non pertinent | 1 | 5 | 20 | 0 |

Robustness (25 municipalities; bootstrap resamples whole municipalities, 2000 draws, seed 797):

| Metric | Astra low | Gemini low | Claude Opus 5.5 low |
|---|---:|---:|---:|
| Accuracy, municipality-clustered 95 % CI | 58.0 %–81.4 % | 69.1 %–87.3 % | 60.0 %–81.8 % |
| Noise in view, municipality-clustered 95 % CI | 7.1 %–31.0 % | 0.0 %–24.3 % | 5.0 %–27.3 % |
| Pertinent kept visible, Wilson 95 % lower bound | 83.9 % | 83.9 % | 83.9 % |
| Sens of the modification = Steve's sens (5 values) | 67.2 % | 72.1 % | 75.4 % |

McNemar exact test on verdict correctness: astra~gemini: 1 vs 6 discordant, p = 0.13; astra~opus: 5 vs 6 discordant, p = 1.00; gemini~opus: 7 vs 3 discordant, p = 0.34.

Unanimous "Non pertinent" (3 models): 19 lines, of which Steve N 16, Steve P 0. Split vote: 15 lines (Steve P 5 / S 2 / N 8).

### blind — prompt v2 (n = 55) — excluding sens-non-donne

| Metric | B (pass 1) | Astra low | Gemini low | Claude Opus 5.5 low | Majority of 3 |
|---|---:|---:|---:|---:|---:|
| Verdict accuracy (3 classes) | N-A | 70.9 % [57.9 %–81.2 %] | 78.2 % [65.6 %–87.1 %] | 72.7 % [59.8 %–82.7 %] | 76.4 % |
| Pertinent precision / recall | N-A | 78.6 % / 78.6 % | 75.0 % / 85.7 % | 81.8 % / 64.3 % | 78.6 % / 78.6 % |
| À surveiller precision / recall | N-A | 50.0 % / 60.0 % | 69.2 % / 60.0 % | 52.4 % / 73.3 % | 60.0 % / 60.0 % |
| Non pertinent precision / recall | N-A | 82.6 % / 73.1 % | 84.6 % / 84.6 % | 87.0 % / 76.9 % | 84.6 % / 84.6 % |
| Default view: lines shown | 31 | 32 | 29 | 32 | 29 |
| Noise rate in view (Non pertinent shown / shown) | 41.9 % (13/31) | 21.9 % (7/32) | 13.8 % (4/29) | 18.8 % (6/32) | 13.8 % (4/29) |
| Pertinent kept visible | 11/14 | 14/14 | 14/14 | 14/14 | 14/14 |
| Useful (P or S) hidden | 11 | 4 | 4 | 3 | 4 |
| Noise removed | 13/26 | 19/26 | 22/26 | 20/26 | 22/26 |
| B view + C post-filter: noise kept (of pass-1 lines kept) | 41.9 % (13/31) | 15.8 % (3/19) | 11.1 % (2/18) | 15.0 % (3/20) |  |
| B view + C post-filter: Pertinent kept | 11/11 | 11/11 | 11/11 | 11/11 |  |
| Motif exact / family | N-A | 50.9 % / 65.5 % | 58.2 % / 74.5 % | 54.5 % / 67.3 % |  |
| Invalid or missing verdicts | N-A | 0 | 0 | 0 |  |
| Latency p50 / p90 (s) | N-A | 9.5 / 12.8 | 4.9 / 6.4 | 5.7 / 8.1 |  |
| Tokens in / out (total) | N-A | 883709 / 8308 | 831519 / 8853 | 311785 / 15061 |  |
| API-equivalent cost reported by the CLI (USD) | N-A | non vérifié | non vérifié | 1.31 |  |

Inter-model agreement on the verdict: astra~gemini κ = 0.80 (agreement 87.3 %); astra~opus κ = 0.75 (agreement 83.6 %); gemini~opus κ = 0.72 (agreement 81.8 %); Fleiss κ = 0.76; unanimous on 42/55.

Confusion — Astra low (rows = Steve, columns = model):

| Steve \ model | P | S | N | invalid |
|---|---:|---:|---:|---:|
| Pertinent | 11 | 3 | 0 | 0 |
| À surveiller | 2 | 9 | 4 | 0 |
| Non pertinent | 1 | 6 | 19 | 0 |

Confusion — Gemini low (rows = Steve, columns = model):

| Steve \ model | P | S | N | invalid |
|---|---:|---:|---:|---:|
| Pertinent | 12 | 2 | 0 | 0 |
| À surveiller | 2 | 9 | 4 | 0 |
| Non pertinent | 2 | 2 | 22 | 0 |

Confusion — Claude Opus 5.5 low (rows = Steve, columns = model):

| Steve \ model | P | S | N | invalid |
|---|---:|---:|---:|---:|
| Pertinent | 9 | 5 | 0 | 0 |
| À surveiller | 1 | 11 | 3 | 0 |
| Non pertinent | 1 | 5 | 20 | 0 |

Robustness (21 municipalities; bootstrap resamples whole municipalities, 2000 draws, seed 797):

| Metric | Astra low | Gemini low | Claude Opus 5.5 low |
|---|---:|---:|---:|
| Accuracy, municipality-clustered 95 % CI | 57.4 %–82.4 % | 67.2 %–87.9 % | 59.6 %–83.9 % |
| Noise in view, municipality-clustered 95 % CI | 7.7 %–36.1 % | 0.0 %–28.6 % | 6.3 %–33.3 % |
| Pertinent kept visible, Wilson 95 % lower bound | 78.5 % | 78.5 % | 78.5 % |
| Sens of the modification = Steve's sens (5 values) | 67.3 % | 74.5 % | 76.4 % |

McNemar exact test on verdict correctness: astra~gemini: 1 vs 5 discordant, p = 0.22; astra~opus: 4 vs 5 discordant, p = 1.00; gemini~opus: 6 vs 3 discordant, p = 0.51.

Unanimous "Non pertinent" (3 models): 19 lines, of which Steve N 16, Steve P 0. Split vote: 13 lines (Steve P 3 / S 2 / N 8).
