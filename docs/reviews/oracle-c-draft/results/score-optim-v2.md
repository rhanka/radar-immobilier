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
