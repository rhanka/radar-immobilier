# Rappel immédiat de la passe unique — 13 novembre 2026

100 PV exécutés. 100 réponses valides. Aucun outil invoqué. Aucun rejeu.
Le support corrigé contient **676 actes B**, dont 372 en mise au point et 304 en aveugle.
672 est le compte historique. Les 43 cas neutres restent hors du dénominateur.
Décision owner : production = **GPT-6 Astra low + P0 étendu à l’extraction**.
Cette mesure ne qualifie pas encore le passage en production.

## Rappels principaux

Appariement figé hérité de `1passe/matching.mjs`. Numéro cible, étape et preuve compatibles.
Un appariement un à un de cardinalité maximale est imposé. B conserve ses 676 actes.
Chaque classe est celle prédite par le modèle. Une classe/code incohérents donnent Non classé.
Le drapeau ambiguous ne remplace pas une classe valide, comme dans la PR #1099.
La borne est la borne basse de Wilson bilatérale à 95 %, z = 1,959963984540054.

| Moitié | Mesure sur B | Retrouvés | Manqués | Rappel | Borne basse |
|---|---|---:|---:|---:|---:|
| Mise au point, 372 | Détection | 115 | 257 | 30,91 % | 26,43 % |
| Mise au point, 372 | Visible | 50 | 322 | 13,44 % | 10,35 % |
| Mise au point, 372 | P∪S | 50 | 322 | 13,44 % | 10,35 % |
| Aveugle, 304 | Détection | 68 | 236 | 22,37 % | 18,05 % |
| Aveugle, 304 | Visible | 23 | 281 | 7,57 % | 5,09 % |
| Aveugle, 304 | P∪S | 23 | 281 | 7,57 % | 5,09 % |
| Total, 676 | Détection | 183 | 493 | 27,07 % | 23,86 % |
| Total, 676 | Visible | 73 | 603 | 10,80 % | 8,68 % |
| Total, 676 | P∪S | 73 | 603 | 10,80 % | 8,68 % |

Écarté masque 65 actes B retrouvés en mise au point et 45 en aveugle : **110 au total**.
L’inventaire produit 837 actes : 1 P, 242 S, 594 Écartés, 0 Non classé.
Un appariement neutre est compté à part. Il ne modifie aucun rappel principal.
Les manqués stricts incluent les échecs d’appariement. Ils ne prouvent pas tous une omission sémantique.

## Comparaison avec B

Source : bras `astra-medium-rejeu`, benchmark v12, sous `tools/bench-v11/full/arms`.
Les 100 textes sont identiques par SHA-256. Les sorties B validées sont lues seules.
Empreinte de leur inventaire : `966aa24bef29b75b4a6b9f63e6097687120087c57def62811f3a4c66fbbede6f`.

| Même apparieur principal | Retrouvés B | Manqués B | Rappel B | Borne basse |
|---|---:|---:|---:|---:|
| Mise au point | 46/372 | 326 | 12,37 % | 9,40 % |
| Aveugle | 21/304 | 283 | 6,91 % | 4,56 % |
| Total | 67/676 | 609 | 9,91 % | 7,88 % |

Ce résultat B est très inférieur à son score historique. Les critères ne sont pas interchangeables.
Le scoreur B historique a donc été exécuté sans modification, en diagnostic **secondaire après le run**.
Les étapes textuelles candidates sont converties mécaniquement au vocabulaire B.
Ce scoreur normalise les espaces et peut créditer plusieurs actes à un groupe. Il n’est pas un à un.
Il ne remplace ni les métriques figées ni leurs manqués. Aucun prompt n’a changé après lecture.

| Diagnostic historique | Passe unique : détection ; manqués ; borne | Visible = P∪S ; manqués ; borne | B : détection ; manqués ; borne |
|---|---|---|---|
| Mise au point | 25,27 % ; 278 ; 21,12 % | 11,02 % ; 331 ; 8,23 % | 47,31 % ; 196 ; 42,29 % |
| Aveugle | 17,43 % ; 251 ; 13,58 % | 6,25 % ; 285 ; 4,04 % | 52,63 % ; 144 ; 47,02 % |
| Total | 21,75 % ; 529 ; 18,80 % | 8,88 % ; 616 ; 6,96 % | 49,70 % ; 340 ; 45,95 % |

Le total B historique est reproduit exactement : 336 retrouvés, 340 manqués.
Classes B séparées, rappel visible B et rappel P∪S B sur ces mêmes sorties : `missing source`.

## Coût et durée

| Moitié | Passe unique : entrée / sortie / cache inclus | Détection B : entrée / sortie |
|---|---:|---:|
| Mise au point | 1 196 914 / 74 088 / 377 600 | 732 969 / 307 762 |
| Aveugle | 1 241 472 / 60 437 / 377 600 | 778 280 / 270 521 |
| Total | 2 438 386 / 134 525 / 755 200 | 1 511 249 / 578 283 |

Entrée et sortie incluent la télémétrie CLI. Le cache est inclus dans l’entrée, jamais ajouté.
La passe unique totalise 2 572 911 jetons, contre 2 089 532 pour la détection B seule.
Le coût de classification séparée B sur les mêmes sorties est `missing source`.
Le coût complet de la chaîne B ne peut donc pas être comparé.
Siège ChatGPT Pro : 100 appels, sans facture API par appel. Attribution monétaire de l’abonnement : `missing source`.
Quota hebdomadaire : **32 % avant, 34 % après**. Seuil d’arrêt : 90 %. Aucun arrêt ni rejeu.
Le delta de quota partagé ne mesure pas isolément la consommation de cette lane.
Durée modèle : **357,576 secondes**, soit **5 min 57,6 s**, concurrence plafonnée à 10.
Début : 22:42:09 UTC. Fin : 22:48:06 UTC. Run inférieur à dix minutes ; aucune échéance périodique atteinte.

## Est-ce que cela a du sens ?

La conservation du niveau de détection B n’est pas démontrée : les deux apparieurs donnent des conclusions différentes.
Le diagnostic historique est défavorable : 21,75 % contre 49,70 % ; le principal strict donne 27,07 % contre 9,91 %.
Oui, Écarté retire 110 actes B retrouvés ; cela ne prouve pas encore 110 erreurs selon C.
P∪S/B vaut 10,80 % ; avec environ 85 % de Non classés dans l’annotation C provisoire, ce n’est pas un rappel C.
Cette exécution ne suffit donc pas à valider la décision de production ; la comparaison C reste ultérieure.

## Manqués de mise au point

Liste privée, acte par acte : `/home/antoinefa/.local/share/radar-classif/1passe-recall/MISSES-TUNING.md`.
Elle contient les 322 manqués visibles et P∪S, dont les 257 manqués de détection stricte.
Diagnostic des 257 : 1 dans une liste vide, 119 à citation normalisée commune sans appariement, 15 à étape incompatible,
122 sans citation normalisée contenue. Cette dernière catégorie mêle omissions et ancres différentes.
Les causes sont probables. Aucun acte aveugle n’est listé. Aucun résultat ne retourne à un optimiseur.

## Prompt, surface et reprise

Prompt : `tools/classif/1passe/recall/prompt.md`.
SHA-256 : `7f7e6fe0bb35d5682ca38a4b65e93483077bbc93e03eca13cabd8c50c799372f`.
P0 C, série 7 : `a60713366128ae4348a45a7323d0b0984cef87ca6cb33eda15073c045235b016`.
Prompt PR #1099 : `8957bcaa146b3b83ee89000fccec3c6f393c7b801b320a158d58d2631fa3a205`.
Référence PR comparée : commit `b4ecde642f4ebce8d712ed180a630f8a6417f2c5`.
Le corps de classification est repris à l’identique. Seule la section Output change.
Elle prend le PV entier et produit des actes plats, au lieu du graphe par fragment PDF et du mode réannotation.
La mesure ne vaut donc pas validation du pipeline de production par fragments.

Modèle demandé : `gpt-6-astra`, effort `low`, transport `codex exec --json`, entrée stdin.
Configuration isolée ; cwd vide ; lecture seule ; web, MCP, skills et fonctions outils désactivés.
Le CLI peut encore exposer unified_exec. Tout événement d’outil invalide sa réponse. Aucun n’a été observé.
50 réponses aveugles REFC1. 62 résidus du siège archivés sous sceau puis retirés en clair.
Les accès sont journalisés dans le dossier privé de cette lane. `1passe-bc` n’a reçu aucune écriture.

Après finalisation de C : `rtk make -f tools/classif/1passe/recall/ops.mk score-c ENV=test-classif-1passe-recall`.
La cible recroise les réponses conservées avec `reference/{tuning,blind}-final`. Aucun appel modèle.
Elle publie le rappel visible et P∪S sur les P∪S C, puis le rappel opérationnel avec les Non classés.
Elle ne calcule pas la précision C complète des actes hors B.

Contrôles : syntaxe, trois tests ciblés, population, sceaux, absence de contenu par acte dans Git.
Incidents corrigés : format des cas neutres sans id ; garde textuelle confondant le compteur de jetons input et un texte.
Revue multi-pairs indisponible : métadonnées exactes de l’auteur non attestées et aucun outil h2a exposé.
Aucun consensus de revue revendiqué. Livraison en PR draft. Aucune fusion.
