# Results — draft oracle C, three models at low effort

All figures are produced by `scripts/06-score.mjs` from the runs in `runs/` (not versioned) and
are copied, without hand edits, from its output; the machine-readable versions are in `results/`.
Metrics were defined in the scorer before the first full run (commit `5a13ff07`; two view rows,
"B view + C post-filter" and the CLI cost line, were added after the blind run and are recomputed
identically for every arm and every set). Blind was run **once**, after `final-prompt.json` froze
v2 (commit `9715c72c`).

## Definitions
- **Verdict accuracy**: share of items where the model's verdict equals Steve's (3 classes); 95 %
  Wilson interval in brackets.
- **Default view of C**: C hides only "Non pertinent" (a missing or invalid answer stays visible,
  asymmetry reserve). **Noise rate** = Steve-"Non pertinent" lines shown / lines shown.
- **Pertinent kept visible** = Steve-"Pertinent" lines that the model does not hide (recall of
  Pertinent in the view, the critical metric of D13). **Useful hidden** = Steve P or S hidden.
- **B (pass 1)**: the filters Steve used daily, i.e. the lines of the set that appeared in his
  pass 1. Not a model; only view metrics apply. **B view + C post-filter**: C applied on top of
  B's pass-1 view (the shadow-mode question of the dossier).
- **Motif exact / family**: same code as Steve / same family (criterion or exclusion expressed by
  the code, see `scripts/lib/common.mjs`).
- **Inter-model**: Cohen's κ per pair and Fleiss' κ on the verdict.
- **Cost**: these are seat runs (no API billing). Tokens are reported as measured; Astra and
  Gemini counts include the CLI agent's own system prompt (~13.6 k input tokens per call), so they
  overstate the prompt's size. The Claude CLI reports an API-equivalent cost; for Astra and Gemini
  no cost is reported (`non vérifié`).

## Headline (blind, measured once, prompt v2)
| | B (pass 1) | Astra low | Gemini low | Opus 5.5 low | Majority of 3 |
|---|---:|---:|---:|---:|---:|
| Verdict accuracy | N-A | 70.5 % | 78.7 % | 72.1 % | 77.0 % |
| Noise in default view | 35.1 % (13/37) | 18.4 % (7/38) | 11.4 % (4/35) | 15.8 % (6/38) | 11.4 % (4/35) |
| Pertinent kept visible | 17/20 | 20/20 | 20/20 | 20/20 | 20/20 |
| B view + C post-filter: noise | 35.1 % (13/37) | 12.0 % (3/25) | 8.3 % (2/24) | 11.5 % (3/26) | — |
| B view + C post-filter: Pertinent kept | 17/17 | 17/17 | 17/17 | 17/17 | — |

Optim → blind: accuracy 73.3 → 70.5 (Astra), 76.7 → 78.7 (Gemini), 78.3 → 72.1 (Opus). The gaps
are inside the ±11-point intervals of n ≈ 60: no sign of a collapse on unseen municipalities, and
no ranking between the three models can be claimed at this size.

## Iterations (optim only)
| Prompt | Mean accuracy (3 models) | Steve-P hidden (sum of 3) | Noise shown (sum of 3) | Selected |
|---|---:|---:|---:|---|
| v1 | 60.6 % | 8 | 14 | no |
| v2 | 76.1 % | 1 | 16 | **yes** (rule in `selection-rule.md`) |

What changed v1 → v2 (details in `prompt-c-v2.md`): the verdict follows Steve's four categories
(general-scope residential with an unstated sense is "Pertinent"); early stage is never a
downgrade; numbered procedural acts are not "agenda only"; CPTAQ exclusion vs authorisation;
accessory subdivision bylaws; a doubtful vocation stays visible. v1 under-called "Pertinent"
(recall 16-47 %); v2 lifts it to 74-84 % on optim and 65-85 % on blind.

No v3: the remaining optim disagreements are mostly (a) lines where the served record says only
"bylaw X amending zoning bylaw Y" while Steve marked them Pertinent with a precise motif, i.e. he
used information that the record given to the models does not carry (MCP answers, wider reading),
and (b) lines where Steve is more lenient than his own legend (non-residential zone kept
"À surveiller"). A rule for (a) would contradict his S-PORTEE-FLOUE definition and fit optim only.

## What it suggests for C (JUGEMENT)
- A low-effort model with a prompt written from Steve's own rules reproduces his
  show / hide decision well: on blind, every Steve-"Pertinent" stays visible for all three models
  and the noise of the view drops from 35 % (B) to 11-18 %.
- The three-class verdict is weaker on "À surveiller" (precision 45-64 %): the P/S boundary is
  where the served information is thinnest. For C's display (shown / hidden) this matters less
  than for a ranked list.
- Motif codes agree less (exact 51-59 %, family 66-75 %): usable as an explanation, not yet as a
  filter key.
- Agreement between models is substantial on blind (Fleiss κ 0.75); a unanimous "Non pertinent"
  is a natural candidate for "exclu prouvé", and a split vote for "à instruire".

## Limits
- Small sets (60 / 61): ±11 points on accuracy. Differences between models are not significant.
- The labels are Steve's verdicts on what the screen and the MCP answers showed him on
  2026-09-15..21; the records given to the models were read on 2026-10-04 from `graph_nodes`
  (`non vérifié` that they are identical to what he saw; some carry only the minutes header as
  excerpt).
- The sample is what Steve's three passes surfaced in 51 municipalities (his choice of order); it
  does not contain the dossiers the radar never showed (his seven missed dossiers).
- One run per model (no repeated sampling); low effort only; stochastic variation not measured.
- Steve's labels are taken as truth, including cases the dossier flags as contradictory (D8).
- B (pass 1) is a reconstruction from the pass column, not a re-run of the filters.

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
