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
