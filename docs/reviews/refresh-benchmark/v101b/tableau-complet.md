# Tableau complet — benchmark v101b

Oracle v2: F1 macro calculé sur les acceptés à date; `F1 × acceptation = F1 × acceptés/N`. Codex: siège Pro 20x mesuré passivement, fenêtre 7 j; granularité 1 point (±8 %). Latences sur tous les reçus terminaux, concurrence 1 équivalente.

| Bras | État; acceptés/N | F1 v2 macro | F1 × acceptation | Entrée/doc | Sortie/doc | USD API/doc | USD siège/doc | Sièges / 1 000 docs/mois | p50 | p95 | Moy. | Docs/h (C1) | Échecs |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| astra-low | complet; 100/100 | 0.584 | 0.584 | 15 112 | 5 122 | $0.4072 | $0.0177 | 1 | 147.779 s | 297.020 s | 156.124 s | 23.059 | — |
| sol-medium | complet; 94/100 | 0.558 | 0.525 | 15 112 | 10 405 | $0.2685 | $0.0223 | 1 | 187.289 s | 317.291 s | 192.067 s | 18.743 | provenance:6 |
| opus5-off | complet; 68/100 | 0.690 | 0.470 | 24 969 | 21 035 | $0.6507 | N-A (burn en cours) | N-A | 167.035 s | 278.962 s | 173.809 s | 20.712 | JSON:24/profil:4/provenance:4 |
| astra-medium | complet; 99/100 | 0.452 | 0.448 | 15 196 | 6 340 | $0.4689 | $0.0188 | 1 | 189.827 s | 320.214 s | 191.550 s | 18.794 | transport:1 |
| gemini-low | complet; 85/100 | 0.518 | 0.441 | 16 468 | 6 743 | $0.0376 | N-A (burn en cours) | N-A | 15.260 s | 36.953 s | 18.398 s | 195.676 | profil:7/provenance:8 |
| sol-xhigh | complet; 85/100 | 0.517 | 0.439 | 14 411 | 24 607 | $0.5498 | $0.0340 | 1 | 416.067 s | 878.890 s | 452.570 s | 7.955 | transport:10/provenance:5 |
| luna-high | complet; 43/100 | 0.788 | 0.339 | 13 953 | 14 282 | $0.0199 | $0.0246 | 1 | 247.785 s | 480.006 s | 275.547 s | 13.065 | transport:13/JSON:1/profil:33/provenance:10 |
| gemini-medium | complet; 79/100 | 0.423 | 0.334 | 16 468 | 11 070 | $0.0539 | N-A (burn en cours) | N-A | 26.983 s | 44.647 s | 27.967 s | 128.724 | profil:12/provenance:9 |
| sonnet5-off | complet; 62/100 | 0.528 | 0.327 | 24 862 | 18 100 | $0.2307 | N-A (burn en cours) | N-A | 113.244 s | 242.693 s | 138.296 s | 26.031 | transport:1/JSON:13/profil:12/provenance:12 |
| luna-medium | complet; 51/100 | 0.582 | 0.297 | 15 171 | 7 239 | $0.0117 | $0.0195 | 1 | 126.613 s | 216.756 s | 131.902 s | 27.293 | transport:2/JSON:2/profil:36/provenance:9 |
| sonnet5-low | complet; 58/100 | 0.512 | 0.297 | 24 969 | 6 150 | $0.1114 | N-A (burn en cours) | N-A | 38.012 s | 71.212 s | 40.569 s | 88.738 | JSON:2/profil:18/provenance:22 |
| sonnet5-high | complet; 70/100 | 0.396 | 0.277 | 24 969 | 17 959 | $0.2295 | N-A (burn en cours) | N-A | 121.408 s | 249.426 s | 131.610 s | 27.353 | JSON:13/profil:8/provenance:9 |
| gemini-high | complet; 53/100 | 0.518 | 0.275 | 16 468 | 26 658 | $0.1123 | N-A (burn en cours) | N-A | 68.997 s | 88.431 s | 67.842 s | 53.064 | JSON:44/profil:2/provenance:1 |
| luna-low | complet; 39/100 | 0.621 | 0.242 | 15 161 | 5 380 | $0.0095 | $0.0179 | 1 | 94.808 s | 168.192 s | 100.164 s | 35.941 | transport:2/profil:50/provenance:9 |
| mistral-small4 | complet; 40/100 | 0.250 | 0.100 | 16 655 | 4 168 | $0.0050 | N-A (API seule) | N-A | 15.878 s | 62.954 s | 20.416 s | 176.329 | transport:4/profil:28/provenance:28 |
| gpt41 | complet; 64/100 | 0.000 | 0.000 | 15 349 | 2 944 | $0.0543 | N-A (API seule) | N-A | 17.161 s | 41.294 s | 19.554 s | 184.108 | transport:3/profil:16/provenance:17 |
| sonnet46-cloud-off | en cours 56/100; 32/56 | N-A | N-A | 11 448 | 9 377 | $0.1750 | N-A (siège Google) | N-A | 64.119 s | 146.778 s | 67.556 s | 53.289 | transport:10/profil:10/provenance:4 |
| sonnet46-cloud-low | en cours 29/100; 14/29 | N-A | N-A | 8 711 | 8 112 | $0.1478 | N-A (siège Google) | N-A | 0.705 s | 93.724 s | 33.451 s | 107.619 | transport:15 |
| sonnet46-cloud-high | en cours 15/100; 0/15 | N-A | N-A | N-A | N-A | N-A | N-A (siège Google) | N-A | 0.283 s | 0.397 s | 0.290 s | 12419.503 | transport:15 |
| sol-low | en cours 87/100; 70/87 | N-A | N-A | 14 192 | 6 564 | $0.1880 | $0.0181 | 1 | 117.451 s | 211.393 s | 118.808 s | 30.301 | transport:9/profil:1/provenance:7 |
| sol-high | en cours 92/100; 76/92 | N-A | N-A | 13 869 | 14 346 | $0.3424 | $0.0246 | 1 | 254.674 s | 480.005 s | 277.097 s | 12.992 | transport:12/provenance:4 |
| opus5-low | complet; 74/100 | N-A | N-A | 24 969 | 10 909 | $0.3976 | N-A (burn en cours) | N-A | 79.295 s | 157.027 s | 87.669 s | 41.064 | JSON:2/profil:14/provenance:10 |
| opus5-high | complet; 63/100 | N-A | N-A | 24 969 | 20 893 | $0.6472 | N-A (burn en cours) | N-A | 157.988 s | 276.812 s | 171.983 s | 20.932 | JSON:24/profil:6/provenance:7 |
| luna-xhigh | en cours 44/100; 22/44 | N-A | N-A | 8 577 | 18 471 | $0.0239 | $0.0236 | 1 | 289.238 s | 718.760 s | 485.774 s | 7.411 | transport:12/profil:6/provenance:4 |
| astra-xhigh | en cours 23/100; 14/23 | N-A | N-A | 11 693 | 17 059 | $0.9699 | $0.0251 | 1 | 708.034 s | 900.017 s | 647.140 s | 5.563 | transport:9 |
| astra-high | en cours 73/100; 58/73 | N-A | N-A | 10 406 | 9 019 | $0.5550 | $0.0169 | 1 | 294.132 s | 480.011 s | 312.351 s | 11.525 | transport:15 |

Classes: transport hors 429; JSON; profil; provenance; code 23 = flux Codex sans sortie. Les catégories sont exclusives par reçu.
