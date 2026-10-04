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
