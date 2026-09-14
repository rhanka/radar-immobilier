v9 LOW rejeu : 3/5 acceptés (v7 : 3/5) · variance F1 par PDF : Lac 0,000 ; Saint-Étienne +0,364 ; Valcourt 0,000 ; Saint-Barthélemy N-A ; Waterloo N-A · recommandation : B

# Dossier de décision M1 — modèle du CronJob `radar-refresh-pv`

## 1. Décision demandée

[JUGEMENT] Choisir A, B, C ou D pour déterminer si le réglage Gemini LOW v5 est promu dans le CronJob `radar-refresh-pv` de la PR #682, ou si la promotion attend une preuve supplémentaire.

## 2. Contexte mesuré

[FAIT] Les trois campagnes emploient Gemini `gemini-3.8-flash-tiered`, le profil v5 `f96356e9` et un plafond de 65 536 tokens; v7 et v9 sont LOW, v8 est HIGH. Dans le tableau, les tokens sont `entrée / sortie visible / pensée / total fournisseur`; `N-A` désigne une mesure indisponible ou non classable.

| PDF | Campagne | Accepté | F1 | Latence | Tokens |
| --- | --- | --- | ---: | ---: | ---: |
| Lac-des-Seize-Îles | v7 LOW | oui | 0,400 | 14 352 ms | 6 811 / 4 731 / N-A / 11 542 |
| Lac-des-Seize-Îles | v8 HIGH | oui | 0,400 | 40 221 ms | 6 811 / 6 592 / 8 411 / 21 814 |
| Lac-des-Seize-Îles | v9 LOW | oui | 0,400 | 13 844 ms | 6 811 / 4 920 / N-A / 11 731 |
| Saint-Étienne-de-Bolton | v7 LOW | oui | 0,000 | 31 902 ms | 19 346 / 10 875 / N-A / 30 221 |
| Saint-Étienne-de-Bolton | v8 HIGH | non | N-A | 95 327 ms | 19 346 / 17 068 / 10 769 / 47 183 |
| Saint-Étienne-de-Bolton | v9 LOW | oui | 0,364 | 25 959 ms | 19 346 / 9 488 / N-A / 28 834 |
| Valcourt | v7 LOW | oui | 0,909 | 26 763 ms | 7 263 / 8 423 / N-A / 15 686 |
| Valcourt | v8 HIGH | oui | 0,000 | 51 533 ms | 7 263 / 8 248 / 11 688 / 27 199 |
| Valcourt | v9 LOW | oui | 0,909 | 25 533 ms | 7 263 / 9 449 / N-A / 16 712 |
| Saint-Barthélemy | v7 LOW | non | N-A | 26 458 ms | 14 493 / 8 417 / N-A / 22 910 |
| Saint-Barthélemy | v8 HIGH | non | N-A | 91 032 ms | 14 493 / 13 848 / 20 090 / 48 431 |
| Saint-Barthélemy | v9 LOW | non | N-A | 47 135 ms | 14 493 / 14 000 / N-A / 28 493 |
| Waterloo | v7 LOW | non | N-A | 29 258 ms | 19 017 / 9 594 / N-A / 28 611 |
| Waterloo | v8 HIGH | oui | N-A¹ | 130 652 ms | 19 017 / 17 682 / 25 875 / 62 574 |
| Waterloo | v9 LOW | non | N-A | 41 042 ms | 19 017 / 12 218 / N-A / 31 235 |

[FAIT] ¹ L'oracle Waterloo est marqué partiel; aucun F1 classable n'est donc publié. Sources structurées : [v7](v7/comparison.json), [v8](v8/comparison.json), [v9](v9/comparison.json) et [rapport v9](v9/report.md).

| Mesure consolidée | v7 LOW | v8 HIGH | v9 LOW |
| --- | ---: | ---: | ---: |
| Acceptation | 3/5 | 3/5 | 3/5 |
| Latence moyenne | 25,747 s | 81,753 s | 30,703 s |
| Tokens entrée | 66 930 | 66 930 | 66 930 |
| Tokens sortie visible | 42 040 | 63 438 | 50 075 |
| Tokens pensée exposés | N-A | 76 833 | N-A |
| Tokens fournisseur totaux | 108 970 | 207 201 | 117 005 |
| F1 macro classable | 0,436 (3 PDF) | 0,200 (2 PDF) | 0,558 (3 PDF) |

[FAIT] HIGH conserve 3/5 acceptations, mais remplace Saint-Étienne par Waterloo, multiplie la latence moyenne par 3,18 et les tokens totaux par 1,90 par rapport à v7. Les `thoughtsTokenCount` sont exposés dans 5/5 reçus HIGH et dans 0/5 reçus LOW v9.

[FAIT] Les deux juges aveugles indépendants A (Terra) et B (Luna) désignent Gemini LOW gagnant global contre Sonnet 4.6 historique. Sur Lac et Valcourt, chacun note Gemini 4/5 et Sonnet 3/5. Sur Saint-Étienne, A note Sonnet 5/5 contre Gemini 4/5; B note les deux 4/5 et classe Sonnet premier. Les verdicts et le décodage sont archivés dans [juge A](v7/judges/verdict-judge-a.json), [juge B](v7/judges/verdict-judge-b.json) et [blind-map](v7/blind-map.json).

[FAIT] Entre v7 et v9, l'acceptation varie sur 0/5 PDF. Le F1 varie sur 1/3 sorties acceptées : Lac 0,000, Saint-Étienne +0,364, Valcourt 0,000; il reste N-A pour les deux refus. Deux observations par PDF ne permettent pas d'estimer une variance statistique ni une probabilité d'acceptation; « variance F1 » désigne ici les écarts observés demandés.

[FAIT] Réconciliation Saint-Étienne : l'oracle comporte 17 unités. Gemini v7 matérialise neuf adoptions en `Bylaw`, cinq décisions en `DesignationEvent` et omet trois avis; chacun des juges crédite 14/17 unités. Le scoreur n'admet que `Signal`/`DesignationEvent` et apparie étape, page et ancre exacte, sans utiliser les identifiants : les neuf `Bylaw` sont hors numérateur, quatre extraits v7 tronquent les ancres, et B158 cite une occurrence valide page 14 alors que l'oracle ne conserve que la page 2. Le 0,000 automatique mesure ce contrat d'appariement, pas les 14 unités sémantiques reconnues. En v9, quatre extraits plus longs passent les ancres et donnent 4 TP, 1 FP, 13 FN, F1 0,364; cela ne démontre pas une meilleure couverture sémantique.

[FAIT] Réconciliation Valcourt : HIGH produit les mêmes cinq unités admissibles V71 à V75 que LOW, aux mêmes étapes et à la même page, sans unité admissible supplémentaire; comme LOW, il omet V132. HIGH retire des extraits les préfixes `7.1` à `7.5` exigés par les ancres et obtient 0 TP, 5 FP, F1 0,000; LOW les conserve et obtient 5 TP, 0 FP, 1 FN, F1 0,909.

[FAIT] Réconciliation `unknown_status` : `actif` et `projet` figurent dans les descriptions textuelles respectives de `Constraint.status` et `Bylaw.status`, mais le même contrat transmet une liste générique distincte pour le statut de nœud. HIGH place ces valeurs au niveau générique, où le validateur les refuse. Les valeurs ne sont pas absentes; leur espace de noms et leur emplacement sont ambigus dans le prompt fourni.

[FAIT] Réconciliation Waterloo LOW : les extraits visent les bonnes pages 11 et 12 et les bonnes décisions. Ils changent toutefois la chaîne PDF `YvesMalouin` en `Yves-Malouin`; le validateur ne normalise que les espaces puis exige une sous-chaîne. Il s'agit d'une correction typographique refusée, pas d'une autre page ni d'une paraphrase de fond; v9 reproduit les deux écarts.

## 3. Enjeux

[FAIT] Le job est sans surveillance et traite les PV séparément; un PV refusé ne produit aucun signal pour ce PV lors de ce run, tout en laissant l'échec journalisable par `recordOutcome`.

[FAIT] LOW a refusé les mêmes 2/5 PDF lors des deux exécutions. HIGH n'améliore pas le total accepté et consomme davantage de latence et de tokens. Le coût monétaire, la limite de quota causale et le débit réel du CronJob sont `N-A` dans ces campagnes.

[JUGEMENT] L'enjeu owner est d'arbitrer une couverture immédiate mais incomplète contre le délai nécessaire pour rendre le contrat plus robuste, sans confondre F1 d'ancre exacte et utilité sémantique.

## 4. Options

| id | choix | pour | contre | coût | réversibilité | ce qui le ferait gagner |
| --- | --- | --- | --- | --- | --- | --- |
| A | [JUGEMENT] Promouvoir Gemini LOW v5, cap 65 536, maintenant, avec retry qualité pour deux tentatives maximum et échec par PV journalisé via `recordOutcome`. | [FAIT] Deux runs donnent 3/5; les deux juges préfèrent globalement LOW à Sonnet historique. [JUGEMENT] Valeur disponible plus tôt sur les PV acceptés. | [FAIT] Les mêmes deux PV échouent deux fois; l'effet du retry qualité n'est pas mesuré. | [FAIT] Jusqu'à deux appels par PV retenté; coût monétaire et quota causal N-A. | [JUGEMENT] Forte : retour au réglage antérieur ou arrêt du retry. | [JUGEMENT] Si l'owner accepte explicitement jusqu'à 2/5 PV sans signal par run et privilégie la mise en service immédiate. |
| B | [JUGEMENT] Attendre; clarifier l'énumération de statut et les `evidence_refs` dans le prompt, puis exiger au moins 4/5 acceptés sur deux runs. | [FAIT] Cible les deux classes de refus LOW et le contrat ambigu mesuré. [JUGEMENT] Pose un seuil reproductible avant le job sans surveillance. | [JUGEMENT] Retarde la valeur et ne garantit pas qu'une correction de prompt suffise. | [FAIT] Travail de prompt hors de cette lane, puis au moins 10 appels de qualification; montant N-A. | [JUGEMENT] Forte : le seuil et le prompt peuvent être remplacés dans une décision suivante. | [JUGEMENT] Si la priorité est de limiter les PV silencieusement sans signaux et d'obtenir une preuve répétée. |
| C | [JUGEMENT] Mesurer Sonnet comparable avant de choisir; l'owner fournit la clé Anthropic dans l'environnement ou le keyring llm-mesh. | [FAIT] Élimine la comparaison historique non homogène. | [FAIT] Sonnet comparable est N-A aujourd'hui; aucun résultat, coût, latence ni quota n'est mesuré. | [FAIT] Au moins cinq appels comparables; secret fourni hors dépôt; montant N-A. | [JUGEMENT] Forte : campagne isolée sans promotion. | [JUGEMENT] Si une comparaison fournisseur homogène est obligatoire avant toute promotion. |
| D | [JUGEMENT] Exécuter deux autres runs LOW inchangés en shadow, sans promotion ni correction intermédiaire. | [FAIT] Ajoute deux observations par PDF et sépare mieux la variabilité du modèle des effets futurs du prompt. | [FAIT] Ne corrige aucune cause connue et ne suffit pas à estimer une probabilité robuste. | [FAIT] Dix appels supplémentaires; montant et quota causal N-A. | [JUGEMENT] Totale : collecte seule, sans acte produit. | [JUGEMENT] Si la variance stochastique est l'inconnue prioritaire avant de modifier le contrat. |

## 5. Recommandation

[JUGEMENT] **Recommandation B.** La raison décisive est opérationnelle : les deux runs LOW refusent les mêmes 2/5 PV, donc le risque observé est une perte répétée de signaux sur 40 % du corpus à chaque run; ni le retry qualité proposé en A ni une amélioration par HIGH ne sont démontrés.

[JUGEMENT] **Cas le plus fort contre B.** Les deux juges aveugles préfèrent déjà Gemini LOW à Sonnet historique, LOW accepte 3/5 avec 83/83 citations acceptées valides en v9, et un déploiement A borné à deux tentatives avec `recordOutcome` pourrait livrer plus tôt une valeur réelle sur la majorité du corpus. Attendre sacrifie cette valeur immédiate pour un seuil qui reste conventionnel.

[JUGEMENT] **Ce qui renverserait la recommandation.** B bascule vers une promotion si le contrat corrigé atteint au moins 4/5 acceptés lors de deux runs complets sans nouvelle classe de refus; A devient défendable sans attendre ce seuil si l'owner accepte explicitement la perte observée et si un essai hors production montre que la seconde tentative récupère les refus; C gagne si Sonnet comparable franchit le même seuil avec coût et latence acceptés; D gagne si l'owner veut isoler la variabilité avant toute correction.

[JUGEMENT] **Pré-mortem.** Supposons B choisi et M1 encore bloqué après la correction : le prompt a déplacé les erreurs plutôt que supprimé les ambiguïtés, l'oracle exact continue de sous-évaluer des sorties utiles, et le seuil 4/5 retarde le CronJob sans borne. Les premiers signaux seraient une nouvelle classe de refus, un désaccord persistant entre F1 et juges, ou deux runs à 3/5. La parade est de geler chaque correction, conserver `recordOutcome`, publier à la fois acceptation et jugement sémantique, puis ramener immédiatement une nouvelle décision owner au lieu d'élargir le changement.

[JUGEMENT] **Intérêt déclaré du présentateur.** B réduit mon risque de recommander un comportement non testé et privilégie une preuve reproductible; ce biais peut me faire sous-pondérer la valeur d'une mise en service partielle rapide.

[JUGEMENT] **Intérêt owner.** Obtenir des signaux municipaux exploitables et traçables avec une continuité suffisante, un coût maîtrisable et une option de retour, selon sa tolérance explicite aux PV sans résultat.

## 6. Ce qu'on demande à l'owner

[JUGEMENT] Répondre par la plus petite décision valide — **A**, **B**, **C** ou **D** — sans autoriser par cette réponse un acte produit, un merge ou une modification de contrat dans la présente lane.
