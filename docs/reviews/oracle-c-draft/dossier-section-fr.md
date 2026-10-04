# Section prête à coller — §9.3 bis « Oracle C : premier brouillon mesuré »

> Source : `docs/reviews/oracle-c-draft/` (branche `feat/oracle-c-draft`). Chiffres recalculables
> par les scripts du dossier (Node, sans dépendance). **FAIT** = constaté dans une source vérifiable
> par un tiers ; **CALCUL** = dérivé des données ; **JUGEMENT** = appréciation ; `non vérifié` =
> non établi.

### Ce qu'est le brouillon d'oracle C

Un **pilote exploratoire d'accord avec Steve** sur la question du ciblage : « fallait-il montrer ce
signal ? ». Il emprunte à l'oracle E le gel par empreinte sha256 et des mesures reproductibles,
mais **pas** sa construction (l'oracle E : 674 unités sur 100 documents dans 100 villes, sept passes
de trois familles de modèles, arbitrage, catégorie « non résolu »). Ici la vérité est celle d'une
seule personne, Steve : ses verdicts du 21 septembre 2026 et ses codes de motif. Ce n'est pas non
plus le jeu test indépendant de D10 (les 52 villes suivantes) : **à ne pas utiliser comme preuve
pour le seuil D13**.

- **FAIT.** 124 lignes de triage ; 121 retrouvées dans le graphe du radar par une seule requête
  SELECT en session forcée en lecture seule ; 3 exclues et listées. 9 lignes (5 + 4) sont notées
  avec un enregistrement cité manquant.
- **CALCUL.** Ce que voit le modèle : uniquement ce que le radar servait (libellé, propriétés,
  extraits verbatim du procès-verbal), relu le 4 octobre ; identité avec ce que Steve voyait du 15
  au 21 septembre : `non vérifié`.
- Aucune écriture en base, sur le cluster ou dans un bucket.

### Le partage 50/50, fait avant toute écriture de prompt

- **CALCUL.** Unité de partage : la **municipalité** (toutes les lignes d'une ville du même côté),
  plus stricte que le dossier demandé en D10.
- **CALCUL.** `optim` : 60 lignes, 26 villes. `blind` (aveugle) : 61 lignes, 25 villes.
- **CALCUL.** Écarts de répartition faibles sur neuf strates (verdict, famille de motif, sens,
  passe, région, type de document, nature de l'enregistrement, longueur, taille de la ville) :
  écart de part maximal 6,7 points. Ces écarts sont **descriptifs** : la recherche les a minimisés
  par construction. La famille « point d'ordre du jour » n'existe que côté optim (4 / 0).
- Le script de partage (déterministe) a été versionné avant le premier appel de modèle ; les
  empreintes des deux jeux (`d724ed80…`, `51e32d2a…`) n'ont été versionnées qu'ensuite.

| Verdict de Steve | optim | blind |
|---|---:|---:|
| Pertinent | 19 (31,7 %) | 20 (32,8 %) |
| À surveiller | 14 (23,3 %) | 15 (24,6 %) |
| Non pertinent | 27 (45,0 %) | 26 (42,6 %) |
| dont passe 1 | 36 | 37 |

<!-- chart:oracle-c-split -->

### L'approche du prompt

- **v1** : écrit à partir des règles générales de Steve (trois critères cumulatifs, cinq
  exclusions, réserve d'asymétrie, légende de ses codes), sans aucune ligne ni ville de son relevé.
- **v2** : une itération, sur `optim` seulement : rangement selon les quatre catégories de son
  analyse ; l'étape précoce n'est jamais un motif de déclassement ; avis de motion numéroté ≠ point
  d'ordre du jour ; CPTAQ, exclusion contre autorisation ; lotissement accessoire ; vocation
  douteuse visible. **Ce sont des arbitrages de l'auteur sur des points que le dossier laisse à
  Steve (D8)** ; la première règle s'appuie sur une catégorie de son analyse qui compte aussi des
  lignes du jeu aveugle. Steve doit les confirmer.
- v2 a été gelée avant l'unique passage sur le jeu aveugle.

### Résultats par modèle (effort bas, sièges uniquement)

Modèles : Astra low (`gpt-6-astra`, `codex exec`), Gemini low (`gemini-3.8-flash-low`, `agy`),
Claude Opus 5.5 low (`claude-opus-5-5`, `claude -p --effort low`).

**Mesure comparable à B en premier** : C posé en filtre sur la vue de travail B (passe 1).

| Mesure (jeu aveugle, v2) | B seul | Astra low | Gemini low | Opus 5.5 low |
|---|---:|---:|---:|---:|
| **Bruit de la vue B + filtre C** | 35,1 % (13/37) | 12,0 % (3/25) | 8,3 % (2/24) | 11,5 % (3/26) |
| **Pertinent gardés dans B + filtre C** | 17/17 | 17/17 | 17/17 | 17/17 |
| Exactitude du verdict (3 classes) | — | 70,5 % | 78,7 % | 72,1 % |
| Intervalle à 95 % (par ville) | — | 58–81 % | 69–87 % | 60–82 % |
| Sens de la modification = celui de Steve | — | 67,2 % | 72,1 % | 75,4 % |
| Motif identique à Steve | — | 50,8 % | 59,0 % | 54,1 % |
| Latence médiane par signal | — | 9,8 s | 4,9 s | 5,7 s |

| Exactitude du verdict | Astra low | Gemini low | Opus 5.5 low |
|---|---:|---:|---:|
| optim, v1 | 56,7 % | 66,7 % | 58,3 % |
| optim, v2 | 73,3 % | 76,7 % | 78,3 % |
| aveugle, v2 | 70,5 % | 78,7 % | 72,1 % |
| aveugle, v2, sans les 6 lignes « sens non donné » | 70,9 % | 78,2 % | 72,7 % |

<!-- chart:oracle-c-exactitude (optim v1, optim v2, aveugle v2 par modèle) -->
<!-- chart:oracle-c-bruit (B seul et B + filtre C, par modèle, sur l'aveugle) -->

- **CALCUL.** Aucun classement entre les trois modèles : test de McNemar p = 0,13 à 1,00.
- **CALCUL.** « 17 Pertinent sur 17 gardés » : borne basse à 95 % de 81,6 % ; ce n'est pas une
  garantie de zéro perte.
- **CALCUL.** Accord entre modèles : κ de Fleiss 0,75 ; unanimité sur 46 lignes sur 61. Un
  « Non pertinent » unanime touche 19 lignes, dont 16 Non pertinent selon Steve, 3 À surveiller,
  0 Pertinent.
- **CALCUL.** Coût : passages sur siège, sans facturation à l'appel ; le CLI Claude annonce un
  équivalent API de 1,45 $ pour les 61 lignes aveugles ; Astra et Gemini : `non vérifié`.

Données pour graphiques simples (barres) :

| Série | B seul | Astra low | Gemini low | Opus 5.5 low |
|---|---:|---:|---:|---:|
| Bruit de la vue B + filtre C, aveugle (%) | 35.1 | 12.0 | 8.3 | 11.5 |
| Exactitude optim v1 (%) | — | 56.7 | 66.7 | 58.3 |
| Exactitude optim v2 (%) | — | 73.3 | 76.7 | 78.3 |
| Exactitude aveugle v2 (%) | — | 70.5 | 78.7 | 72.1 |

### Ce que cela suggère pour C (JUGEMENT)

- Posé en filtre sur la vue B, un modèle à effort bas guidé par les règles de Steve retire
  l'essentiel du bruit de sa passe 1 (35 % → 8-12 %) sans masquer de Pertinent, sur 25 villes
  jamais vues pendant la mise au point.
- La décision « montrer / masquer » est bien plus stable que le verdict à trois classes : la
  frontière Pertinent / À surveiller reste fragile, le motif n'est juste qu'une fois sur deux.
- Les erreurs restantes viennent surtout de points que seul Steve peut trancher (D8) et
  d'enregistrements trop pauvres : la prochaine marche est son arbitrage, pas un prompt de plus.

### Limites

- Petits jeux (60 et 61 lignes, 26 et 25 villes) ; intervalles larges.
- Une seule personne pour la vérité, sans arbitrage ni « non résolu » ; cas contradictoires (D8)
  notés comme vrais.
- Le jeu aveugle n'est pas parfaitement propre (règle v2 issue d'un agrégat du relevé entier) ;
  l'effet mesuré de ce biais est faible (tableau ci-dessus).
- Une seule réponse retenue par ligne ; isolement des modèles et mode d'authentification
  `non vérifié` (aucune clé d'API utilisée ; journaux d'événements non conservés).
- **Les deux jeux gelés ne sont pas publiés dans le dépôt** (dépôt public ; codes de Steve ligne
  par ligne et extraits lus en production) : décision à prendre avec D6.

### Plan d'extension (proposition, non exécutée)

- Cible : environ 600 lignes, dont environ 300 lignes réelles annotées par un humain en aveugle ;
  à cette taille, un écart de 6 à 7 points entre deux modèles devient lisible (5 points demandent
  environ 470 lignes).
- Un registre unique des municipalités : les 52 villes suivantes de Steve forment le prochain jeu
  aveugle, annotées par lui seul ; les autres villes du radar sont tirées au sort une fois pour
  toutes entre optim et aveugle.
- Annotation « à la Steve » : la vérité est la décision humaine prise avant de voir toute réponse
  de modèle ; 100 % d'annotation humaine pour tout ce qui entre en aveugle ; au moins 50 lignes
  annotées deux fois (accord mesuré) ; Steve ne voit aucune sortie de C avant le gel de son relevé.
- Cas synthétiques dérivés de `optim` seulement, jamais en aveugle, comptés à part.

### Revue adverse

Deux revues indépendantes : **Astra max** (rejet) et **Opus 5.5 max** (acceptation avec
modifications). Points communs retenus : gel des jeux sans ancrage dans l'historique, règle v2
appuyée sur un agrégat incluant des lignes aveugles, règles v2 qui tranchent des points D8,
méthode différente de l'oracle E, isolement et sièges affirmés plutôt que prouvés, plan d'extension
incohérent sur le partage et la taille. Suite donnée : le brouillon est requalifié en pilote
exploratoire ; toutes les corrections de code sont faites sans relancer de modèle (mesures par
ville, McNemar, sens, bruit comparable à B, test de sensibilité) ; le reste est déclaré dans les
limites ; le plan d'extension est réécrit. Tableau de réconciliation complet : `review.md`.
