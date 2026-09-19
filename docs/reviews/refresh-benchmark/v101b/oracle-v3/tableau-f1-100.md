# F1 sur 100 documents — corrigé v3

Corrigé : `docs/reviews/refresh-benchmark/v101b/oracle-v3/consensus.json` (674 unités, sha256 e70d4dea604e…).
P/R/F1 nets en micro : sortie refusée ou absente = toutes les unités du document manquées (aucun faux positif).
« F1 4 doc publié » = `oracleV2AcceptedF1` de report-data.json (macro sur sorties acceptées, corrigé humain v2).

Bornes : 47 éléments non résolus ; stricte = neutralisés (ni attendus, ni fausses détections), large = attendus. 2 bras changent de rang entre stricte et large.
Colonnes séparées, jamais mélangées à la stricte : tolérante à l'étape (même site ancré, toute étape, une unité par détection ; +1169 correspondances au total) et souple par intervalles (même page, même étape, identifiant exact, recouvrement ≥ 12 caractères normalisés, une unité par détection ; +101 au total).
Diagnostic ROUGE-L ≥ 0.5 (mêmes conditions, ne crédite rien) : +117 au total ; unités rapprochées par les deux méthodes 66, par les intervalles seuls 35, par ROUGE-L seul 51 — ces dernières sont celles que l'avis Fable décrit comme majoritairement fausses (numéros voisins), raison pour laquelle ROUGE-L ne crédite rien.

| Rang | Bras | Acceptés | P stricte | R stricte | F1 stricte | P large | R large | F1 large | Δ F1 large − stricte | Rang large | F1 tolérante étape (+corr.) | F1 souple intervalles (+corr.) | ROUGE-L diag. (+corr.) | F1 4 doc publié |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | CP (astra-medium → vérification gemini-3.8 low, cascade de précision) | 99/100 | 0.483 | 0.531 | 0.506 | 0.488 | 0.508 | 0.498 | -0.008 | 1 | 0.618 (+80) | 0.514 (+6) | 0.516 (+7) | N-A |
| 2 | astra-medium | 99/100 | 0.370 | 0.533 | 0.437 | 0.375 | 0.509 | 0.432 | -0.005 | 2 | 0.543 (+88) | 0.444 (+6) | 0.445 (+7) | 0.452 |
| 3 | astra-low | 100/100 | 0.372 | 0.490 | 0.423 | 0.375 | 0.465 | 0.415 | -0.008 | 3 | 0.543 (+94) | 0.435 (+10) | 0.440 (+14) | 0.584 |
| 4 | sol-medium | 94/100 | 0.444 | 0.398 | 0.420 | 0.449 | 0.381 | 0.413 | -0.007 | 4 | 0.499 (+51) | 0.420 (+0) | 0.424 (+3) | 0.558 |
| 5 | sol-low | 90/100 | 0.465 | 0.358 | 0.404 | 0.469 | 0.341 | 0.395 | -0.009 | 5 | 0.462 (+35) | 0.404 (+0) | 0.411 (+4) | 0.583 |
| 6 | C2 (gemini-low x2 -> astra-low) | 100/100 | 0.456 | 0.358 | 0.401 | 0.460 | 0.343 | 0.393 | -0.008 | 6 | 0.468 (+41) | 0.408 (+4) | 0.408 (+4) | N-A |
| 7 | C3 (gemini-low x3 -> astra-low) | 100/100 | 0.461 | 0.353 | 0.400 | 0.465 | 0.338 | 0.392 | -0.008 | 7 | 0.468 (+41) | 0.405 (+3) | 0.405 (+3) | N-A |
| 8 | sol-xhigh | 85/100 | 0.307 | 0.487 | 0.377 | 0.312 | 0.466 | 0.374 | -0.003 | 8 | 0.447 (+62) | 0.377 (+0) | 0.378 (+1) | 0.517 |
| 9 | gemini-low | 85/100 | 0.475 | 0.298 | 0.366 | 0.479 | 0.287 | 0.359 | -0.007 | 9 | 0.422 (+31) | 0.372 (+3) | 0.372 (+3) | 0.518 |
| 10 | sol-high | 83/100 | 0.380 | 0.344 | 0.361 | 0.382 | 0.325 | 0.351 | -0.010 | 10 | 0.464 (+66) | 0.363 (+1) | 0.368 (+4) | 0.505 |
| 11 | opus5-low | 74/100 | 0.350 | 0.292 | 0.319 | 0.352 | 0.276 | 0.309 | -0.009 | 11 | 0.418 (+62) | 0.322 (+2) | 0.331 (+8) | 0.386 |
| 12 | gemini-medium | 79/100 | 0.449 | 0.224 | 0.299 | 0.453 | 0.212 | 0.289 | -0.010 | 12 | 0.368 (+35) | 0.311 (+6) | 0.309 (+5) | 0.423 |
| 13 | opus5-off | 68/100 | 0.314 | 0.258 | 0.283 | 0.322 | 0.251 | 0.282 | -0.001 | 13 | 0.340 (+35) | 0.293 (+6) | 0.288 (+3) | 0.502 |
| 14 | opus5-high | 63/100 | 0.318 | 0.251 | 0.280 | 0.320 | 0.239 | 0.273 | -0.007 | 14 | 0.360 (+48) | 0.287 (+4) | 0.282 (+1) | 0.523 |
| 15 | astra-high | 68/100 | 0.289 | 0.261 | 0.274 | 0.292 | 0.248 | 0.268 | -0.006 | 16 | 0.349 (+48) | 0.276 (+1) | 0.277 (+2) | 0.667 |
| 16 | astra-xhigh | 65/100 | 0.252 | 0.298 | 0.273 | 0.255 | 0.284 | 0.269 | -0.004 | 15 | 0.319 (+34) | 0.273 (+0) | 0.273 (+0) | 0.611 |
| 17 | luna-medium | 51/100 | 0.453 | 0.172 | 0.249 | 0.462 | 0.169 | 0.248 | -0.002 | 17 | 0.279 (+14) | 0.252 (+1) | 0.254 (+2) | 0.582 |
| 18 | luna-high | 43/100 | 0.371 | 0.185 | 0.247 | 0.376 | 0.178 | 0.241 | -0.006 | 18 | 0.283 (+18) | 0.253 (+3) | 0.253 (+3) | 0.788 |
| 19 | sonnet5-high | 70/100 | 0.330 | 0.193 | 0.243 | 0.333 | 0.183 | 0.236 | -0.007 | 19 | 0.324 (+43) | 0.255 (+6) | 0.258 (+8) | 0.396 |
| 20 | sonnet5-off | 62/100 | 0.333 | 0.185 | 0.238 | 0.335 | 0.175 | 0.230 | -0.009 | 20 | 0.299 (+32) | 0.252 (+7) | 0.246 (+4) | 0.528 |
| 21 | gemini-high | 53/100 | 0.384 | 0.138 | 0.203 | 0.390 | 0.135 | 0.200 | -0.003 | 21 | 0.240 (+17) | 0.216 (+6) | 0.214 (+5) | 0.518 |
| 22 | sonnet5-low | 58/100 | 0.393 | 0.136 | 0.203 | 0.401 | 0.132 | 0.198 | -0.004 | 22 | 0.258 (+25) | 0.227 (+11) | 0.231 (+13) | 0.512 |
| 23 | luna-xhigh | 47/100 | 0.240 | 0.147 | 0.182 | 0.242 | 0.139 | 0.176 | -0.006 | 23 | 0.250 (+37) | 0.193 (+6) | 0.193 (+6) | 0.236 |
| 24 | luna-low | 39/100 | 0.447 | 0.107 | 0.172 | 0.448 | 0.103 | 0.167 | -0.005 | 24 | 0.210 (+16) | 0.177 (+2) | 0.180 (+3) | 0.621 |
| 25 | sonnet46-cloud-off | 32/100 | 0.307 | 0.096 | 0.147 | 0.310 | 0.092 | 0.141 | -0.005 | 25 | 0.212 (+29) | 0.160 (+6) | 0.153 (+3) | N-A |
| 26 | sonnet46-cloud-low | 14/100 | 0.453 | 0.058 | 0.103 | 0.460 | 0.055 | 0.099 | -0.004 | 26 | 0.118 (+6) | 0.105 (+1) | 0.105 (+1) | N-A |
| 27 | gpt41 | 64/100 | 0.048 | 0.013 | 0.021 | 0.048 | 0.012 | 0.020 | -0.001 | 27 | 0.193 (+74) | 0.021 (+0) | 0.021 (+0) | 0.000 |
| 28 | mistral-small4 | 40/100 | 0.227 | 0.007 | 0.014 | 0.227 | 0.007 | 0.013 | -0.001 | 28 | 0.034 (+7) | 0.014 (+0) | 0.014 (+0) | 0.250 |
| 29 | sonnet46-cloud-high | 0/100 | N-A | 0.000 | 0.000 | N-A | 0.000 | 0.000 | +0.000 | 29 | 0.000 (+0) | 0.000 (+0) | 0.000 (+0) | N-A |
| 30 | opus5-cli-off | 0/100 | N-A | 0.000 | 0.000 | N-A | 0.000 | 0.000 | +0.000 | 30 | 0.000 (+0) | 0.000 (+0) | 0.000 (+0) | N-A |

Cascades (origine des sorties acceptées) :

- C2 (gemini-low x2 -> astra-low) : gemini-low 85 · gemini-low replay 1 10 · astra-low 5
- C3 (gemini-low x3 -> astra-low) : gemini-low 85 · gemini-low replay 1 10 · gemini-low replay 2 3 · astra-low 2

