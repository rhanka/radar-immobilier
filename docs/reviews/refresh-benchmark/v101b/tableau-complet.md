# Tableau complet — benchmark v101b

Généré depuis `report-data.json` le 2026-09-17T09:20:11.394Z. Les 26 bras de campagne sont listés; `opus5-cli-off` est hors-campagne (0/0, Claude CLI N-A). Oracle v2 : F1 macro sur les sorties acceptées; `F1 × acceptation = F1 × acceptés / 100`. Waterloo est exclue du macro-oracle partiel. Les p50/p95 couvrent les derniers reçus terminaux; docs/h est l'inverse du p50 (repère concurrence 1, pas un SLA).

| Bras | État; acceptés/N | F1 v2 macro | F1 × acceptation | Entrée/doc | Sortie/doc | USD API/doc | USD siège/doc | Sièges/1 000 | p50 | p95 | Docs/h C1 | Échecs dernière tentative |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---|
| gemini-low | complet; 85/100 | 0.518 | 0.441 | 16 468 | 6 743 | $0.0376 | AI Pro mesuré; $0,0014 | N-A | 15.3 s | 37.0 s | 235.9 | profile:7 · provenance:8 |
| gemini-medium | complet; 79/100 | 0.423 | 0.334 | 16 468 | 6 360 | $0.0539 | N-A | N-A | 27.0 s | 44.6 s | 133.4 | profile:12 · provenance:9 |
| gemini-high | complet; 53/100 | 0.518 | 0.275 | 16 468 | 7 187 | $0.1123 | N-A | N-A | 69.0 s | 88.4 s | 52.2 | json:44 · profile:2 · provenance:1 |
| luna-low | complet; 39/100 | 0.621 | 0.242 | 14 857 | 5 273 | $0.0095 | N-A | N-A | 94.8 s | 168.2 s | 38.0 | transport:2 · profile:50 · provenance:9 |
| luna-medium | complet; 51/100 | 0.582 | 0.297 | 14 868 | 7 094 | $0.0117 | N-A | N-A | 126.6 s | 216.8 s | 28.4 | transport:2 · json:2 · profile:36 · provenance:9 |
| luna-high | complet; 43/100 | 0.788 | 0.339 | 12 139 | 12 425 | $0.0199 | N-A | N-A | 247.8 s | 480.0 s | 14.5 | transport:13 · json:1 · profile:33 · provenance:10 |
| luna-xhigh | complet; 47/100 | N-A | N-A | 12 073 | 22 489 | $0.0346 | N-A | N-A | 480.0 s | 900.0 s | 7.5 | transport:15 · profile:23 · provenance:15 · budget:22 |
| gpt41 | complet; 64/100 | 0.000 | 0.000 | 14 889 | 2 856 | $0.0542 | N-A | N-A | 17.2 s | 41.3 s | 209.8 | transport:3 · profile:16 · provenance:17 |
| sonnet46-cloud-off | partiel (56/100); 32/56 | N-A | N-A | 9 404 | 7 702 | $0.1750 | N-A | N-A | 64.1 s | 146.8 s | 56.1 | transport:10 · profile:10 · provenance:4 |
| sonnet46-cloud-low | partiel (29/100); 14/29 | N-A | N-A | 4 205 | 3 916 | $0.1478 | N-A | N-A | 0.7 s | 93.7 s | 5106.4 | transport:15 · rateLimit:1 |
| sonnet46-cloud-high | partiel (15/100); 0/15 | N-A | N-A | 0 | 0 | N-A | N-A | N-A | 0.3 s | 0.4 s | 12720.8 | transport:15 |
| sonnet5-off | complet; 62/100 | 0.528 | 0.327 | 24 614 | 17 919 | $0.2307 | N-A | N-A | 113.2 s | 242.7 s | 31.8 | transport:1 · json:13 · profile:12 · provenance:12 |
| sonnet5-low | complet; 58/100 | 0.512 | 0.297 | 24 969 | 6 150 | $0.1114 | N-A | N-A | 38.0 s | 71.2 s | 94.7 | json:2 · profile:18 · provenance:22 |
| sonnet5-high | complet; 70/100 | 0.396 | 0.277 | 24 969 | 17 959 | $0.2295 | N-A | N-A | 121.4 s | 249.4 s | 29.7 | json:13 · profile:8 · provenance:9 |
| opus5-off | complet; 68/100 | 0.690 | 0.470 | 24 969 | 21 035 | $0.6507 | N-A | N-A | 167.0 s | 279.0 s | 21.6 | json:24 · profile:4 · provenance:4 |
| opus5-low | complet; 74/100 | N-A | N-A | 24 969 | 10 909 | $0.3976 | N-A | N-A | 79.3 s | 157.0 s | 45.4 | json:2 · profile:14 · provenance:10 |
| opus5-high | complet; 63/100 | N-A | N-A | 24 969 | 20 893 | $0.6472 | N-A | N-A | 158.0 s | 276.8 s | 22.8 | json:24 · profile:6 · provenance:7 |
| sol-low | complet; 90/100 | N-A | N-A | 14 823 | 6 674 | $0.1967 | N-A | N-A | 121.3 s | 205.5 s | 29.7 | transport:2 · profile:1 · provenance:7 |
| sol-medium | complet; 94/100 | 0.558 | 0.525 | 15 112 | 10 405 | $0.2686 | N-A | N-A | 187.3 s | 317.3 s | 19.2 | provenance:6 |
| sol-high | complet; 83/100 | N-A | N-A | 12 307 | 12 761 | $0.3460 | N-A | N-A | 266.9 s | 480.0 s | 13.5 | transport:12 · provenance:5 |
| sol-xhigh | complet; 85/100 | 0.517 | 0.439 | 12 970 | 22 146 | $0.5498 | N-A | N-A | 416.1 s | 878.9 s | 8.7 | transport:10 · provenance:5 · budget:20 |
| astra-low | complet; 100/100 | 0.584 | 0.584 | 15 112 | 5 122 | $0.4072 | conditionnel Pro 20x; $0,0177 | N-A | 147.8 s | 297.0 s | 24.4 | — |
| astra-medium | complet; 99/100 | 0.452 | 0.448 | 15 044 | 6 276 | $0.4689 | N-A | N-A | 189.8 s | 320.2 s | 19.0 | transport:1 |
| astra-high | complet; 68/100 | N-A | N-A | 8 333 | 6 351 | $0.5896 | N-A | N-A | 316.1 s | 480.0 s | 11.4 | transport:32 |
| astra-xhigh | complet; 65/100 | N-A | N-A | 8 221 | 11 660 | $0.9929 | N-A | N-A | 596.7 s | 900.0 s | 6.0 | transport:33 · profile:1 · provenance:1 |
| mistral-small4 | complet; 40/100 | 0.250 | 0.100 | 15 989 | 4 001 | $0.0050 | N-A | N-A | 15.9 s | 63.0 s | 226.7 | transport:4 · profile:28 · provenance:28 |

## Notes de fermeture

- Rejeu réseau Luna xhigh / Sol low : 13/13 documents initiaux ont désormais une dernière tentative terminale non réseau; aucune tentative n'écrase un reçu antérieur.
- Code 23 Codex : flux HTTP 200 terminé sans sortie exploitable sur documents lourds; classe backend définitive, distincte du transport, non rejouée.
- Sonnet 4.6 Cloud Code : partiel, quota Google; F1 N-A. Les autres F1 N-A sont des source-gaps oracle et ne sont pas assimilés à zéro.
- Sièges : Gemini AI Pro mesuré sur 260 documents; Codex passif et Claude CLI sont N-A pour une capacité publiable.

| gemini-low → astra-low | mesuré partiel; 100/100 (fallback Astra) | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| gemini-medium → astra-low | mesuré partiel; 100/100 (fallback Astra) | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |

| gemini-low → astra-low | mesuré partiel; 100/100 (fallback Astra) | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
| gemini-medium → astra-low | mesuré partiel; 100/100 (fallback Astra) | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A | N-A |
