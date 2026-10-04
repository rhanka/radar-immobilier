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
