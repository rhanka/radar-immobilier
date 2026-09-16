# Rapport préliminaire v101b

Snapshot hors réseau des reçus disponibles le `2026-09-16T12:33:07Z`. Aucun appel modèle n'a été
relancé pour ce rapport. Les trois bras Sonnet 4.6 Cloud Code sont clos en **partiel N-A** par décision
du conductor et ne doivent pas être repris. Aucun juge aveugle n'est inclus à ce stade.

Le F1 oracle v2 est calculé sur les sorties acceptées et uniquement sur les documents qui possèdent un
oracle complet; Waterloo est exclu parce que son oracle est partiel par construction. `N-A` signifie
qu'aucun document à oracle complet n'est mesurable dans le sous-ensemble disponible. La latence porte
sur le dernier reçu terminal par document. Les tokens sont les totaux observés; le coût est le coût
estimé par document traité lorsque le tarif API est connu, sinon `N-A`.

| Bras | Modèle | Effort | Statut | Acceptés/N | F1 v2 macro | F1 v2 micro | p50 / p95 | Tokens entrée / sortie | USD/doc | Transport | 429 | JSON | Profil | Provenance | Budget |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gemini-low | Gemini 3.8 Flash | low | terminé | 85/100 | 0,518 | 0,514 | 15,3 / 37,0 s | 1 646 755 / 674 257 | N-A | 0 | 0 | 0 | 7 | 8 | 0 |
| gemini-medium | Gemini 3.8 Flash | medium | terminé | 79/100 | 0,423 | 0,400 | 27,0 / 44,6 s | 1 646 755 / 636 023 | N-A | 0 | 0 | 0 | 12 | 9 | 0 |
| gemini-high | Gemini 3.8 Flash | high | terminé | 53/100 | 0,518 | 0,514 | 69,0 / 88,4 s | 1 646 755 / 718 689 | N-A | 0 | 0 | 44 | 2 | 1 | 0 |
| luna-low | GPT-5.6 Luna | low | terminé | 39/100 | 0,621 | 0,609 | 94,8 / 168,2 s | 1 485 731 / 527 283 | N-A | 2 | 0 | 0 | 50 | 9 | 0 |
| luna-medium | GPT-5.6 Luna | medium | terminé | 51/100 | 0,582 | 0,557 | 126,6 / 216,8 s | 1 486 766 / 709 419 | N-A | 2 | 0 | 2 | 36 | 9 | 0 |
| luna-high | GPT-5.6 Luna | high | terminé | 43/100 | **0,697** | **0,696** | 247,8 / 480,0 s | 1 213 911 / 1 242 547 | N-A | 13 | 0 | 1 | 33 | 10 | 0 |
| luna-xhigh | GPT-5.6 Luna | xhigh | en cours 22/100, disjoncteur ETIMEDOUT | 14/22 | N-A | N-A | 313,3 / 4 210,8 s | 119 398 / 244 478 | N-A | 6 | 0 | 0 | 1 | 1 | 0 |
| gpt41 | GPT-4.1 | off | terminé | 64/100 | 0,000 | 0,000 | 17,2 / 41,3 s | 1 488 852 / 285 589 | 0,0526 | 3 | 0 | 0 | 16 | 17 | 0 |
| sonnet46-cloud-off | Claude Sonnet 4.6 | off | partiel N-A 56/100 | 32/56 | N-A | N-A | 64,1 / 146,8 s | 526 599 / 431 329 | N-A | 10 | 0 | 0 | 10 | 4 | 0 |
| sonnet46-cloud-low | Claude Sonnet 4.6 | low | partiel N-A 29/100 | 14/29 | N-A | N-A | 0,7 / 93,7 s | 121 952 / 113 572 | N-A | 15 | 1 | 0 | 0 | 0 | 0 |
| sonnet46-cloud-high | Claude Sonnet 4.6 | high | partiel N-A 15/100 | 0/15 | N-A | N-A | 0,3 / 0,4 s | 0 / 0 | N-A | 15 | 0 | 0 | 0 | 0 | 0 |
| sonnet5-off | Claude Sonnet 5 | off | en cours 65/100 | 46/65 | N-A | N-A | 84,2 / 203,1 s | 1 030 343 / 849 681 | 0,1624 | 5 | 0 | 2 | 6 | 6 | 0 |
| sonnet5-low | Claude Sonnet 5 | low | en cours 60/100 | 41/60 | N-A | N-A | 33,4 / 57,3 s | 1 030 343 / 312 233 | 0,0864 | 0 | 0 | 2 | 8 | 9 | 0 |
| sonnet5-high | Claude Sonnet 5 | high | en cours 60/100 | 49/60 | N-A | N-A | 83,9 / 198,1 s | 1 030 343 / 852 558 | 0,1764 | 0 | 0 | 2 | 6 | 3 | 0 |
| opus5-off | Claude Opus 5 | off | en cours 80/100 | 57/80 | N-A | N-A | 133,6 / 271,4 s | 1 360 438 / 1 267 294 | 0,4811 | 10 | 0 | 7 | 3 | 3 | 0 |
| opus5-low | Claude Opus 5 | low | en cours 80/100 | 48/80 | N-A | N-A | 54,6 / 112,2 s | 1 030 343 / 542 344 | 0,2339 | 20 | 0 | 1 | 6 | 5 | 0 |
| opus5-high | Claude Opus 5 | high | en cours 80/100 | 49/80 | N-A | N-A | 105,2 / 236,6 s | 1 030 343 / 1 021 299 | 0,3836 | 20 | 0 | 4 | 4 | 3 | 0 |
| sol-low | GPT-5.6 Sol | low | en cours 21/100 | 20/21 | N-A | N-A | 98,0 / 149,3 s | 148 315 / 100 073 | N-A | 1 | 0 | 0 | 0 | 0 | 0 |
| sol-medium | GPT-5.6 Sol | medium | en cours 3/100 | 3/3 | N-A | N-A | 101,4 / 207,8 s | 22 148 / 19 353 | N-A | 0 | 0 | 0 | 0 | 0 | 0 |
| sol-high | GPT-5.6 Sol | high | en cours 3/100 | 3/3 | N-A | N-A | 168,2 / 411,3 s | 22 148 / 35 867 | N-A | 0 | 0 | 0 | 0 | 0 | 0 |
| sol-xhigh | GPT-5.6 Sol | xhigh | en cours 3/100 | 2/3 | N-A | N-A | 191,5 / 480,0 s | 14 209 / 18 276 | N-A | 1 | 0 | 0 | 0 | 0 | 0 |
| astra-low | GPT-6 Astra | low | en cours 3/100 | 3/3 | N-A | N-A | 138,8 / 205,9 s | 22 148 / 13 744 | N-A | 0 | 0 | 0 | 0 | 0 | 0 |
| astra-medium | GPT-6 Astra | medium | en cours 3/100 | 3/3 | N-A | N-A | 117,4 / 140,4 s | 22 148 / 10 923 | N-A | 0 | 0 | 0 | 0 | 0 | 0 |
| astra-high | GPT-6 Astra | high | en cours 3/100 | 2/3 | N-A | N-A | 192,8 / 480,0 s | 14 209 / 11 372 | N-A | 1 | 0 | 0 | 0 | 0 | 0 |
| astra-xhigh | GPT-6 Astra | xhigh | en cours 3/100 | 2/3 | N-A | N-A | 320,3 / 480,0 s | 14 209 / 17 476 | N-A | 1 | 0 | 0 | 0 | 0 | 0 |
| mistral-small4 | Mistral Small 4 | off | terminé | 40/100 | 0,125 | 0,143 | 15,9 / 63,0 s | 1 598 919 / 400 095 | 0,0048 | 4 | 0 | 0 | 28 | 28 | 0 |

## Lecture par famille

**Gemini 3.8 Flash.** LOW conserve le meilleur taux d'acceptation de la famille, 85 %, et le même
F1 mesuré que HIGH. MEDIUM, déjà retenu en production, accepte 79 % avec une latence p50 de 27,0 s.
HIGH tombe à 53 % : 44 sorties échouent dès la couche JSON.

**GPT-5.6 Luna.** HIGH obtient le meilleur F1 préliminaire mesurable, 0,697 macro, mais seulement
43/100 sorties sont acceptées et sa latence p95 atteint 480,0 s. MEDIUM accepte davantage, 51/100.
XHIGH reste incomplet après six échecs de transport, dont la série ETIMEDOUT qui a ouvert le circuit.

**GPT-4.1.** Le bras est terminé à 64/100, p50 17,2 s et 0,0526 USD/document. Son F1 oracle v2 est
0,000 sur les sorties acceptées couvertes par l'oracle; 16 refus de profil et 17 de provenance dominent.

**Claude Sonnet 4.6 Cloud Code.** Les trois bras sont des résultats partiels N-A, clos par décision du
conductor après le quota individuel Cloud Code. Les données conservées restent descriptives et ne sont
pas extrapolées à 100 documents.

**Claude Sonnet 5.** Les bras sont à 65/100 pour OFF et 60/100 pour LOW/HIGH. HIGH a le meilleur taux
d'acceptation courant de la famille, 49/60; LOW est le plus rapide et le moins coûteux à ce stade. Aucun F1 n'est mesurable
avant la réception d'une sortie acceptée sur un document à oracle complet.

**Claude Opus 5.** Les trois bras sont incomplets à 80/100; les coûts courants vont de 0,2339 à
0,4811 USD/document. Les échecs de transport observés interdisent une
comparaison de taux définitive avant clôture.

**GPT-5.6 Sol.** LOW a progressé à 21/100 et les autres efforts restent à 3/100. L'échantillon est trop
partiel pour un F1 ou une comparaison d'effort; aucun tarif unitaire n'est disponible pour le transport
par abonnement.

**GPT-6 Astra.** Chaque bras n'a que 3 documents reçus. HIGH et XHIGH ont chacun un échec de transport;
les autres indicateurs restent descriptifs et le F1 est N-A.

**Mistral Small 4.** Le bras est terminé à 40/100, avec le coût connu le plus bas, 0,0048 USD/document,
et un p50 de 15,9 s. Son F1 macro v2 est 0,125; les refus se partagent entre profil et provenance.

## Ce que cela change pour M1

La production utilise déjà **Gemini 3.8 Flash medium depuis le 2026-09-16**, par décision owner. Ce
snapshot ne change pas cette décision : il confirme 79/100 acceptations, un F1 macro oracle v2 de
0,423 et un p50 de 27,0 s, mais la campagne reste incomplète et aucun jugement aveugle n'est encore
disponible. Le benchmark est informatif pour **D′**; il ne constitue pas une nouvelle décision M1.

## Traçabilité

Les métriques sources sont `oracle-v2-comparison.json` et `report-data.json`. Les comptes d'échec
utilisent le dernier reçu terminal par document. Les dix événements 429 Codex datent de
`00:40Z–00:44Z`; le seul 429 Cloud Code appartient à `sonnet46-cloud-low`. Aucun 429 Anthropic n'est
présent au snapshot.
