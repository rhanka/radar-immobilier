# Prompt unique × Astra low — jeux C

État : mise au point terminée. Aveugle en attente de la clé injectée par i-cond.

| Jeu | Mode | Rappel de détection des signaux C | Manqués P ∪ S | Rappel P ∪ S | Wilson 95 % | Précision sur unités C |
|---|---|---:|---:|---:|---|---:|
| Mise au point | A | 105/191 (54.97 %) | 40/95 | 57.89 % | [47.85 % ; 67.33 %] | 74.32 % |
| Mise au point | B | Sans objet | 3/95 | 96.84 % | [91.12 % ; 98.92 %] | 69.17 % |
| Aveugle | A | Non mesuré | Non mesuré | — | — | — |
| Aveugle | B | Sans objet | Non mesuré | — | — | — |

A : passe complète. B : réannotation. Les 252 unités incluent 191 signaux et 61 PV. Le rappel de détection porte sur les 191 signaux identifiés. Les PV sont des unités documentaires, sans inventaire exhaustif de leurs actes.

Dix signaux n'ont aucun extrait source figé. Sept sont P ∪ S. Ils comptent comme absents en A. Sur les seules unités avec source, A a 33/88 manqués et un rappel de 62.50 %.

La précision porte sur les prédictions P ∪ S des unités C. Elle ne mesure pas la précision globale des actes extraits. A retourne 382 nœuds d'acte ; 63 nœuds des entrées signal restent non appariés. Ces ajouts ne sont pas présumés faux.

Diagnostic séparé : 166 entrées signal contiennent au moins un acte extrait. 61 actes retrouvent le même site cité avec une étape différente ou absente ; 25 sont P ∪ S. Le critère principal garde l'étape et ne récupère aucun de ces cas.

Sur les seuls signaux appariés en A : 105 unités, 0/50 manqué P ∪ S. Les deux références P ne sont pas appariées. En B, les 191 signaux ont zéro manqué sur 87 références P ∪ S ; les trois manqués sont des PV annotés « Non classé ».

## P0 seul × Astra low, série 7

| Jeu | Manqués | Rappel P ∪ S | Précision | Wilson 95 % du rappel recalculé |
|---|---:|---:|---:|---|
| Mise au point | 0/95 | 100.00 % | 69.34 % | [96.11 % ; 100.00 %] |
| Aveugle | 0/94 | 100.00 % | 75.20 % | [96.07 % ; 100.00 %] |

Le baseline ne mesure pas la détection. Ses bornes historiques sont des bornes exactes unilatérales de Clopper–Pearson. Elles ne sont pas présentées comme des bornes de Wilson. La référence de C porte le nom technique D. Sa provenance est consensus de modèles ou mixte.

## Matrices à quatre classes

Les absences et sorties invalides sont regroupées dans « Non classé ». Les compteurs d'absence et d'invalidité restent séparés dans les agrégats.

### Mise au point — A

Lignes : référence C. Colonnes : prédiction.

| Référence | P | S | Écarté | Non classé |
|---|---:|---:|---:|---:|
| P | 0 | 0 | 0 | 2 |
| S | 0 | 55 | 0 | 38 |
| Écarté | 0 | 19 | 68 | 70 |
| Non classé | 0 | 0 | 0 | 0 |

### Mise au point — B

Lignes : référence C. Colonnes : prédiction.

| Référence | P | S | Écarté | Non classé |
|---|---:|---:|---:|---:|
| P | 0 | 2 | 0 | 0 |
| S | 0 | 90 | 0 | 3 |
| Écarté | 0 | 41 | 111 | 5 |
| Non classé | 0 | 0 | 0 | 0 |

### Mise au point — A — signaux appariés seulement

Lignes : référence C. Colonnes : prédiction.

| Référence | P | S | Écarté | Non classé |
|---|---:|---:|---:|---:|
| P | 0 | 0 | 0 | 0 |
| S | 0 | 50 | 0 | 0 |
| Écarté | 0 | 13 | 42 | 0 |
| Non classé | 0 | 0 | 0 | 0 |

## Surface, quotas et durée

GPT-6 Astra, low, siège Codex ChatGPT. Prompt inchangé : `8957bcaa146b3b83ee89000fccec3c6f393c7b801b320a158d58d2631fa3a205`. Composition et schéma importés de la PR #1099. Chaque requête A est revérifiée octet pour octet avec le code de production. Validation native sans reprise ni modèle de secours. Aucun outil ni web accepté.

Concurrence de reprise : 10. Quota hebdomadaire : 34 % → 45 %. Arrêt des lancements à 90 %. Réinitialisation : 2026-11-20T12:05:04.000Z. Durée des mesures : 16.88 min. 494 réponses mesurées, plus un appel de quota et 5 tentatives initiales sans reçu.

Un fichier de composition créé par Docker appartenait à root. Le refus d'accès a interrompu cinq appels B initiaux avant leur reçu. Ils ne sont pas scorés. La reprise conserve les mêmes entrées. Le pic de concurrence au démarrage interrompu n'est pas attesté. Le précontrôle de toutes les requêtes et l'exécution Docker avec l'UID local corrigent cette cause.

Le jeu aveugle reste scellé. Aucun résultat par unité n'a été ouvert. Aucun optimiseur n'est alimenté. La clé n'est ni lue dans un fichier d'environnement ni recherchée ailleurs. L'inventaire et les manqués de mise au point sont privés : `/home/antoinefa/.local/share/radar-classif/1passe-csets/tuning-inventory.json` et `/home/antoinefa/.local/share/radar-classif/1passe-csets/tuning-misses.md`.

## Conséquence pour la production — cinq lignes

1. La passe complète obtient 40 manqués : D4 échoué sur la mise au point.
2. La réannotation obtient 3 manqués, tous des PV « Non classé » ; les 87 signaux P ∪ S restent affichés.
3. P0 seul avait zéro manqué sur les deux jeux ; son avantage en aveugle reste le baseline mesuré.
4. Les sources absentes et les extraits limitent la portée du test A ; ce résultat ne démontre pas le rappel sur des PV complets.
5. Le prompt unique n'est pas qualifié pour la production : la mesure aveugle demandée reste à exécuter.
