# F1 sur 100 documents — corrigé v3

Corrigé : `docs/reviews/refresh-benchmark/v101b/oracle-v3/consensus.json` (674 unités, sha256 6889a00473c1…).
P/R/F1 nets en micro : sortie refusée ou absente = toutes les unités du document manquées (aucun faux positif).
« F1 4 doc publié » = `oracleV2AcceptedF1` de report-data.json (macro sur sorties acceptées, corrigé humain v2).
« F1 4 doc net » = même méthode nette que ce tableau, sur le corrigé humain v2 (4 documents complets).

| Rang | Bras | Acceptés | P net | R net | F1 net | F1 acceptés seuls | F1 4 doc publié | F1 4 doc net | Écart F1 net − publié |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | astra-medium | 99/100 | 0.367 | 0.533 | 0.434 | 0.436 | 0.452 | 0.400 | -0.018 |
| 2 | astra-low | 100/100 | 0.369 | 0.490 | 0.421 | 0.421 | 0.584 | 0.632 | -0.163 |
| 3 | sol-medium | 94/100 | 0.438 | 0.398 | 0.417 | 0.442 | 0.558 | 0.367 | -0.141 |
| 4 | sol-low | 90/100 | 0.459 | 0.358 | 0.402 | 0.428 | 0.583 | 0.463 | -0.181 |
| 5 | C2 (gemini-low x2 -> astra-low) | 100/100 | 0.449 | 0.358 | 0.398 | 0.398 | N-A | 0.478 | N-A |
| 6 | C3 (gemini-low x3 -> astra-low) | 100/100 | 0.453 | 0.353 | 0.397 | 0.397 | N-A | 0.478 | N-A |
| 7 | sol-xhigh | 85/100 | 0.305 | 0.487 | 0.375 | 0.419 | 0.517 | 0.507 | -0.142 |
| 8 | gemini-low | 85/100 | 0.465 | 0.298 | 0.363 | 0.413 | 0.518 | 0.346 | -0.155 |
| 9 | sol-high | 83/100 | 0.379 | 0.344 | 0.361 | 0.437 | 0.505 | 0.400 | -0.144 |
| 10 | opus5-low | 74/100 | 0.349 | 0.292 | 0.318 | 0.385 | 0.386 | 0.259 | -0.068 |
| 11 | gemini-medium | 79/100 | 0.447 | 0.224 | 0.298 | 0.369 | 0.423 | 0.269 | -0.125 |
| 12 | opus5-off | 68/100 | 0.310 | 0.258 | 0.282 | 0.388 | 0.502 | 0.321 | -0.220 |
| 13 | opus5-high | 63/100 | 0.315 | 0.251 | 0.279 | 0.384 | 0.523 | 0.333 | -0.244 |
| 14 | astra-high | 68/100 | 0.287 | 0.261 | 0.273 | 0.404 | 0.667 | 0.186 | -0.393 |
| 15 | astra-xhigh | 65/100 | 0.250 | 0.298 | 0.272 | 0.381 | 0.611 | 0.327 | -0.339 |
| 16 | luna-medium | 51/100 | 0.439 | 0.172 | 0.247 | 0.474 | 0.582 | 0.557 | -0.335 |
| 17 | luna-high | 43/100 | 0.368 | 0.185 | 0.247 | 0.434 | 0.788 | 0.375 | -0.541 |
| 18 | sonnet5-high | 70/100 | 0.328 | 0.193 | 0.243 | 0.345 | 0.396 | 0.351 | -0.153 |
| 19 | sonnet5-off | 62/100 | 0.332 | 0.185 | 0.238 | 0.350 | 0.528 | 0.320 | -0.290 |
| 20 | sonnet5-low | 58/100 | 0.388 | 0.136 | 0.202 | 0.332 | 0.512 | 0.182 | -0.310 |
| 21 | gemini-high | 53/100 | 0.373 | 0.138 | 0.202 | 0.412 | 0.518 | 0.346 | -0.317 |
| 22 | luna-xhigh | 47/100 | 0.240 | 0.147 | 0.182 | 0.307 | 0.236 | 0.247 | -0.054 |
| 23 | luna-low | 39/100 | 0.436 | 0.107 | 0.172 | 0.389 | 0.621 | 0.318 | -0.450 |
| 24 | sonnet46-cloud-off | 32/100 | 0.305 | 0.096 | 0.147 | 0.363 | N-A | 0.000 | N-A |
| 25 | sonnet46-cloud-low | 14/100 | 0.448 | 0.058 | 0.102 | 0.510 | N-A | 0.000 | N-A |
| 26 | gpt41 | 64/100 | 0.048 | 0.013 | 0.021 | 0.029 | 0.000 | 0.000 | +0.021 |
| 27 | mistral-small4 | 40/100 | 0.227 | 0.007 | 0.014 | 0.044 | 0.250 | 0.103 | -0.236 |
| 28 | sonnet46-cloud-high | 0/100 | N-A | 0.000 | 0.000 | N-A | N-A | 0.000 | N-A |
| 29 | opus5-cli-off | 0/100 | N-A | 0.000 | 0.000 | N-A | N-A | 0.000 | N-A |

Cascades (origine des sorties acceptées) :

- C2 (gemini-low x2 -> astra-low) : gemini-low 85 · gemini-low replay 1 10 · astra-low 5
- C3 (gemini-low x3 -> astra-low) : gemini-low 85 · gemini-low replay 1 10 · gemini-low replay 2 3 · astra-low 2

