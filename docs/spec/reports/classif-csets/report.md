# Classification seule × Astra low — jeux C

Décision du 13 novembre : détection B conservée, puis classification de chaque acte. La passe complète est abandonnée.
Le mode B de cette étude désigne la réannotation. Il conserve les entrées figées de C.

| Jeu | Prompt | Mode | Manqués P ∪ S | Rappel | Wilson 95 % du rappel | Précision | D4 |
|---|---|---|---:|---:|---|---:|---|
| Mise au point | v1 | B | 3/95 | 96.84 % | [91.12 % ; 98.92 %] | 69.17 % | échoué |
| Aveugle | v1 | B | 1/94 | 98.94 % | [94.22 % ; 99.81 %] | 73.81 % | échoué |
| Mise au point | v2 | B | 0/95 | 100.00 % | [96.11 % ; 100.00 %] | 67.38 % | réussi |
| Aveugle | v2 | B | 0/94 | 100.00 % | [96.07 % ; 100.00 %] | 71.76 % | réussi |

D4 exige zéro manqué P ∪ S. Verdict v1 : **échoué**. Verdict v2 : **réussi**.
La comparaison v2 porte sur les agrégats. Aucun rapprochement par unité aveugle ne sort de l’exécuteur.
Sur les 3 manqués v1 de mise au point, la v2 en récupère 3 et en conserve 0.
Elle introduit 0 nouveau manqué sur les références P ∪ S auparavant affichées.

## Comparaison avec P0 seul

| Jeu | Manqués P ∪ S | Rappel | Wilson 95 % du rappel | Précision |
|---|---:|---:|---|---:|
| Mise au point | 0/95 | 100.00 % | [96.11 % ; 100.00 %] | 69.34 % |
| Aveugle | 0/94 | 100.00 % | [96.07 % ; 100.00 %] | 75.20 % |

P0 seul est le baseline Astra low de la série 7. Il a zéro manqué sur les deux jeux.
Les bornes ci-dessus sont recalculées selon Wilson. Les bornes historiques de C étaient exactes et unilatérales.

## Matrices 4×4

Lignes : référence C. Colonnes : prédiction. Les sorties absentes ou invalides comptent comme « Non classé ».

### Mise au point — v1 — B

| Référence | P | S | Écarté | Non classé |
|---|---:|---:|---:|---:|
| P | 0 | 2 | 0 | 0 |
| S | 0 | 90 | 0 | 3 |
| Écarté | 0 | 41 | 111 | 5 |
| Non classé | 0 | 0 | 0 | 0 |

### Aveugle — v1 — B

| Référence | P | S | Écarté | Non classé |
|---|---:|---:|---:|---:|
| P | 1 | 0 | 0 | 0 |
| S | 0 | 92 | 0 | 1 |
| Écarté | 0 | 33 | 120 | 5 |
| Non classé | 0 | 0 | 0 | 0 |

### Mise au point — v2 — B

| Référence | P | S | Écarté | Non classé |
|---|---:|---:|---:|---:|
| P | 1 | 1 | 0 | 0 |
| S | 0 | 93 | 0 | 0 |
| Écarté | 0 | 46 | 111 | 0 |
| Non classé | 0 | 0 | 0 | 0 |

### Aveugle — v2 — B

| Référence | P | S | Écarté | Non classé |
|---|---:|---:|---:|---:|
| P | 1 | 0 | 0 | 0 |
| S | 0 | 93 | 0 | 0 |
| Écarté | 0 | 37 | 121 | 0 |
| Non classé | 0 | 0 | 0 | 0 |

## Quotas et durée

GPT-6 Astra, low, siège Codex ChatGPT. Concurrence : 10. Arrêt des nouveaux appels à 90 %.
Aucun outil ni web accepté. Aucun modèle de secours. Aucune reprise selon la prédiction.

| Jeu | Prompt | Quota hebdomadaire | Durée | Réponses B | Sorties invalides |
|---|---|---|---:|---:|---:|
| Mise au point | v1 | 34 % → 45 % | 16.88 min | 252 | 0 |
| Aveugle | v1 | 48 % → 50 % | 3.92 min | 252 | 0 |
| Mise au point | v2 | 50 % → 52 % | 3.37 min | 252 | 0 |
| Aveugle | v2 | 52 % → 55 % | 3.98 min | 252 | 0 |

La durée v1 de mise au point inclut les anciens modes A et B. Les nouvelles durées portent sur B seul.
Le run historique avait cinq tentatives initiales sans reçu, hors mesure. Il avait 494 réponses A et B mesurées.
Chaque nouvelle mesure ajoute une sonde de quota. Réinitialisation : 2026-11-20T12:05:04.000Z.
Les trois nouvelles mesures totalisent 11.27 min d’exécution, sur une fenêtre de 11.93 min.
Elles comptent 756 réponses B. Quota : 48 % → 55 %.

## Traçabilité et portée

Prompt v1 : `8957bcaa146b3b83ee89000fccec3c6f393c7b801b320a158d58d2631fa3a205` (#1099). Prompt v2 : `34df2dd7da379699ed8cefcc1dac07010f5618519fbdd7eb9c33d3d77e0ddc50` (commit 6c7cc36c0165253c11e89f41edfe67108dbbd0f9).
Les octets des prompts sont vérifiés avant les appels. Les caches sont séparés par version.
La cible make charge le fichier d’environnement. La clé n’est jamais affichée ni transmise au modèle.
Les références et sorties par unité aveugle restent scellées. Seuls les agrégats sont publiés.

Chaque jeu compte 252 unités. Les PV restent des unités documentaires. La précision et le rappel portent sur ces unités C.
Cette mesure de classification ne mesure pas le rappel de la détection B conservée. La référence technique D provient du consensus de modèles ou d’une provenance mixte.
Les anciennes mesures A restent dans les agrégats historiques. Elles ne sont pas relancées.
