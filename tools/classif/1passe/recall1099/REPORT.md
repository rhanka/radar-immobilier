# Rappel du prompt exact de la PR #1099

100 PV exécutés, concurrence 10. 100 réponses acceptées. 0 échecs. 0 événement d’outil. Aucun rejeu.

Les dénominateurs sont les 676 actes B corrigés. Les 43 cas neutres sont exclus.
Visible signifie détecté et non Écarté. P∪S/B ne mesure pas le rappel sur les références C.
Appariement strict gelé, un à un. Les manqués incluent les échecs de rapprochement.

| Moitié | Mesure | Retrouvés/support | Manqués | Rappel | Wilson bas 95 % |
|---|---|---:|---:|---:|---:|
| Mise au point | (a) Détection | 44/372 | 328 | 11,83 % | 8,93 % |
| Mise au point | (b) Visible | 4/372 | 368 | 1,08 % | 0,42 % |
| Mise au point | (c) P∪S | 4/372 | 368 | 1,08 % | 0,42 % |
| Aveugle | (a) Détection | 21/304 | 283 | 6,91 % | 4,56 % |
| Aveugle | (b) Visible | 2/304 | 302 | 0,66 % | 0,18 % |
| Aveugle | (c) P∪S | 2/304 | 302 | 0,66 % | 0,18 % |
| Total | (a) Détection | 65/676 | 611 | 9,62 % | 7,62 % |
| Total | (b) Visible | 6/676 | 670 | 0,89 % | 0,41 % |
| Total | (c) P∪S | 6/676 | 670 | 0,89 % | 0,41 % |

## Comparaison avec B et la variante voisine

B = détection Astra medium sans P0, sorties natives validées du bras astra-medium-rejeu, benchmark v12. Même corpus et même apparieur strict.
Les classes C de ce témoin ne sont pas disponibles. Ses rappels (b) et (c) restent inconnus.

| Moitié | PR #1099 : détection | B : détection | Variante : détection | PR #1099 : visible / P∪S | Variante : visible / P∪S |
|---|---:|---:|---:|---:|---:|
| Mise au point | 11,83 % | 12,37 % | 30,91 % | 1,08 % / 1,08 % | 13,44 % / 13,44 % |
| Aveugle | 6,91 % | 6,91 % | 22,37 % | 0,66 % / 0,66 % | 7,57 % / 7,57 % |
| Total | 9,62 % | 9,91 % | 27,07 % | 0,89 % / 0,89 % | 10,80 % / 10,80 % |

La variante lit le PV entier et rend des actes plats. Elle ne contient pas le prompt de détection B.
Les deux lanes utilisent Astra low. Cette comparaison est descriptive ; aucun test de supériorité n’est revendiqué.

59 actes B détectés sont ensuite classés Écarté. Cela ne prouve pas autant d’erreurs selon C.
Le rappel visible est faible sur B. Ce support contient aussi des actes qui peuvent être exclus selon C.

## Diagnostic secondaire avec le scoreur historique B

Scoreur importé sans changement. Il normalise les espaces et peut créditer plusieurs actes par groupe.
Il ne remplace pas l’appariement strict. Les étapes natives restent inchangées.

| Moitié | PR #1099 : retrouvés ; rappel ; Wilson bas | B : retrouvés ; rappel ; Wilson bas | Variante : retrouvés ; rappel ; Wilson bas |
|---|---:|---:|---:|
| Mise au point | 176/372 ; 47,31 % ; 42,29 % | 176/372 ; 47,31 % ; 42,29 % | 94/372 ; 25,27 % ; 21,12 % |
| Aveugle | 122/304 ; 40,13 % ; 34,78 % | 160/304 ; 52,63 % ; 47,02 % | 53/304 ; 17,43 % ; 13,58 % |
| Total | 298/676 ; 44,08 % ; 40,38 % | 336/676 ; 49,70 % ; 45,95 % | 147/676 ; 21,75 % ; 18,80 % |

Le témoin historique reproduit 336/676. Les critères des deux apparieurs ne sont pas interchangeables.

La conservation de la détection B n’est pas démontrée. Le diagnostic historique se dégrade surtout en aveugle.

La comparaison avec la variante s’inverse selon l’apparieur. Aucune supériorité globale ne peut être conclue.

## Identité du prompt et surface

Code importé depuis le worktree de la PR #1099. Contenu vérifié contre le commit 80249515bbe9992e29bdcac18779ee96ebcd82f8.
`extractRefreshProfile` compose P0, le prompt de détection B et `singlePassSchema(schemaFor(...))`.
Aucun fichier de prompt n’est recopié dans le code de la lane. Les entrées exactes sont conservées en privé. Le prompt reste inchangé.
Le découpeur de production est exposé par un ajout d’export privé.
Les textes PDF sont vérifiés contre v101b. La date utilise l’extracteur natif d’en-tête ; aucun sidecar distant n’est fourni.
Prompt P0/PR #1099 : 8957bcaa146b3b83ee89000fccec3c6f393c7b801b320a158d58d2631fa3a205.
Morceau témoin : 0131f51cce9f89da09118ce6b0076d220ba53753d582429526579984deb27344.1 (amherst-2026-06-08).
Prompt composé : d26312d75e7f618f2130b5eae6160716fa229a8d86fa777b750b27c315eb5f3f.
Schéma annoté : 340e0d1d803c12323dd9304a0c07b4039ba65bd33adb65571b121bb971648247.
Entrée CLI complète : 0c8ad480bdac477a72ddf81737bb6da3beb900f5c47934bad1de132246298db6.
Manifeste des 100 requêtes : 85545349f5ca4b31bd6fc661df0f1ae4a6e09e0c488a4fa7a5b4b36ec915a0aa.
Les requêtes sont capturées au port `generateJson`. Le siège reçoit le prompt puis `Schema: ...`.
Modèle choisi par `singlePassPrimary` : `REFRESH_SINGLE_PASS_MODEL=gpt-6-astra`, effort `low`.
Surface : `codex exec`, siège ChatGPT isolé, cwd vide, stdin, lecture seule. Web, MCP, skills et fonctions désactivés.
Le CLI peut encore exposer unified_exec. Toute invocation invalide la réponse. Aucun repli Gemini.
Le transport CLI remplace le mesh au port injecté. Le plafond de 32768 est celui demandé au port ; son application au fil CLI n’est pas attestée.
Validation native : 100/100 ; validation v9 supplémentaire : 100/100.
La PR annonce v10. Son validateur et `validateSinglePassCoverage` tournent sans modification.
Le contrôle v9 utilise le validateur gelé du benchmark et Graphify 0.18.0 sur le graphe natif accepté, sans annotations.

## Coût, durée et quotas

| Moitié | PR #1099 : entrée / sortie / cache inclus | Détection B : entrée / sortie |
|---|---:|---:|
| Mise au point | 1508096 / 323702 / 377600 | 732969 / 307762 |
| Aveugle | 1553524 / 259113 / 377600 | 778280 / 270521 |
| Total | 3061620 / 582815 / 755200 | 1511249 / 578283 |

Variante voisine : 2438386 jetons d’entrée, 134525 de sortie, 755200 en cache inclus ; durée 357.576 s.

Durée : 1384.515 s, soit 23.08 min.
Début : 2026-11-13T22:49:30.318Z. Fin : 2026-11-13T23:12:34.833Z.
Quota hebdomadaire partagé : 35 % avant ; 47 % après ; seuil 90 %. Arrêt : aucun.
Le quota est vérifié au départ, toutes les dix minutes, à réception des appels et à la fin.
Le cache est inclus dans l’entrée. La télémétrie CLI est conservée. Aucun tarif API n’est attribué au siège Pro.
Télémétrie de jetons disponible pour 100/100 réponses.
Le coût de classification séparée du témoin B manque. Son coût complet ne peut donc pas être comparé.
Le delta du quota partagé inclut les autres usages du compte.

## Manqués de mise au point

368 actes détaillés un par un dans /home/antoinefa/.local/share/radar-classif/1passe-recall1099/MISSES-TUNING.md.
Détection manquée : 328. Visible manqué : 368. P∪S manqué : 368.
Diagnostic agrégé : {"absent_or_different_anchor":102,"evidence_mismatch":178,"stage_mismatch":48,"classification":40}.
Empreinte de la liste privée : f6a50af0614b80478f3d55bc0f403b98d3d2a708a677fcae5858f07c00981386.
Les causes sont diagnostiques. Un échec de preuve stricte ne démontre pas toujours une omission sémantique.
Aucun acte aveugle n’est publié. Aucun résultat n’est renvoyé à un optimiseur.

## Vérifications et livraison

100 requêtes vérifiées par empreinte ; 50 réponses aveugles REFC1 ; 62 résidus du siège archivés sous sceau puis retirés en clair.
Contrôles : syntaxe, quatre tests de l’apparieur, sources importées, supports, arithmétique des métriques, ordre P∪S ≤ visible ≤ détection et absence de labels aveugles dans Git.
Revue multi-pairs indisponible : métadonnées exactes de l’auteur non attestées et aucun outil h2a exposé. Aucun consensus de revue revendiqué.
Aucun .env lu. Aucune écriture dans les données B+C ou la lane voisine. Aucun appel Python.
Livraison en PR draft. Aucune fusion.
