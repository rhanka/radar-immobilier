# Section prête à coller — §9.3 bis « Oracle C : premier brouillon mesuré »

> Source : `docs/reviews/oracle-c-draft/` (branche `feat/oracle-c-draft`, PR #821). Chiffres
> recalculables par les scripts du dossier (Node, sans dépendance). **FAIT** = constaté dans une
> source vérifiable par un tiers ; **CALCUL** = dérivé des données ; **JUGEMENT** = appréciation ;
> `non vérifié` = non établi.

> **Avertissement : scores du jeu de test contaminés.** La règle 1 du prompt v2 s'appuie sur un
> tableau de l'analyse de Steve (§2) qui agrège ses 73 lignes de passe 1, dont 37 lignes du jeu de
> test (6 exactement dans la catégorie sur laquelle repose la règle). C'est une fuite d'information
> du test vers le prompt, même indirecte. De plus, l'agent qui a écrit les prompts avait lu des
> documents couvrant le jeu de test (analyse complète avec ses listes, tableaux du dossier sur les
> 124 lignes, deux lignes de test pendant l'exploration). **Les scores test de v2 sont donc
> marqués « contaminés »** ; le calcul sans les 6 lignes est une atténuation, pas une preuve. Les
> chiffres de référence de C devront venir d'un **nouveau jeu de test vierge** (les 52 villes
> suivantes de Steve), scellé avant toute optimisation. Détail : `TEST-SET-PROTOCOL.md`.

### Ce qu'est le brouillon d'oracle C

Un **pilote exploratoire d'accord avec Steve** sur la question du ciblage : « fallait-il montrer ce
signal ? ». Il emprunte à l'oracle E le gel par empreinte sha256 et des mesures reproductibles,
mais **pas** sa construction (oracle E : 674 unités sur 100 documents dans 100 villes, sept passes
de trois familles de modèles, arbitrage, catégorie « non résolu »). La vérité est celle d'une seule
personne, Steve. **À ne pas utiliser comme preuve pour le seuil D13.**

- **FAIT.** 124 lignes de triage ; 121 retrouvées dans le graphe du radar (une requête SELECT en
  session forcée en lecture seule) ; 3 exclues et listées. Aucune écriture en base, sur le cluster
  ou dans un bucket.
- **CALCUL.** Le modèle ne voit que ce que le radar servait (libellé, propriétés, extraits
  verbatim), relu le 4 octobre (`non vérifié` qu'il soit identique à ce que Steve voyait).

### À quel niveau on mesure

- **Unité** : une ligne du relevé de Steve rattachée au(x) signal(aux) du radar qu'elle cite.
- **Jeu de test réservé (référence)** : 61 lignes, 25 villes. **Jeu de mise au point (optim)** :
  60 lignes, 26 villes, en annexe, diagnostic seulement. Partage par municipalité, équilibré sur
  neuf strates (écart de part maximal 6,7 points).
- **Vérité** : le verdict de Steve sur la ligne (Pertinent, À surveiller, Non pertinent).
- **Ce qu'on mesure** : la décision « montrer à Steve » ou « masquer ». B montre une ligne si elle
  était visible dans la passe de Steve avec cette combinaison de filtres ; C la montre si le modèle
  répond Pertinent ou À surveiller ; « C strict » ne montre que ce que le modèle juge Pertinent.
- **Deux définitions du positif** : Pertinent ; Pertinent ou À surveiller.
- **Précision** = positifs montrés / lignes montrées ; **rappel** = positifs montrés / positifs du
  jeu ; **F1** ; **bruit** = Non pertinent parmi les lignes montrées ; **Pertinents perdus** =
  Pertinent masqués. Intervalles à 95 % par rééchantillonnage des villes.

**Biais de sélection.** Chaque ligne existe parce qu'elle était visible dans une des trois passes.
Le rappel n'est mesuré que dans cet univers (la passe 3, sans filtre, a 100 % par construction) ; la
précision est comparable entre systèmes sur les mêmes lignes, et ce biais avantage B. Passes 1, 2, 3
**observées** ; filtres « seuls » **reconstitués** (`non vérifié` face au code de septembre) ;
« Résidentiel seul » non calculable (N-A).

### Résultats de référence — jeu de test (61 lignes : 20 P, 15 S, 26 N), en %

Une seule exécution du prompt v2 gelé. **Lignes C v2 : contaminées (règle 1 + exposition).** C v1
n'a jamais été passé sur le test. Les lignes B n'utilisent aucun prompt et ne sont pas contaminées.

| Système | Précision (P) | Rappel (P) | F1 (P) | Précision (P+S) | Rappel (P+S) | F1 (P+S) | Bruit | Pertinents perdus |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B passe 1 (5 filtres) | 45,9 | 85,0 | 59,6 | 64,9 | 68,6 | 66,7 | 35,1 | 3/20 |
| B passe 2 (sans Précoce) | 37,0 | 100,0 | 54,1 | 61,1 | 94,3 | 74,2 | 38,9 | 0/20 |
| B passe 3 (aucun filtre) | 32,8 | 100,0 | 49,4 | 57,4 | 100,0 | 72,9 | 42,6 | 0/20 |
| Précoce seul (reconstitué) | 45,9 | 85,0 | 59,6 | 64,9 | 68,6 | 66,7 | 35,1 | 3/20 |
| Zonage seul (reconstitué) | 38,3 | 90,0 | 53,7 | 66,0 | 88,6 | 75,6 | 34,0 | 2/20 |
| Exclure PIIA + dérogation seul (reconstitué) | 33,3 | 100,0 | 50,0 | 58,3 | 100,0 | 73,7 | 41,7 | 0/20 |
| C v1 (3 modèles) | N-A | N-A | N-A | N-A | N-A | N-A | N-A | non passé sur le test |
| C v2 Astra low — *contaminé* | 52,6 | 100,0 | 69,0 | 81,6 | 88,6 | 84,9 | 18,4 | 0/20 |
| C v2 Gemini low — *contaminé* | 57,1 | 100,0 | 72,7 | 88,6 | 88,6 | 88,6 | 11,4 | 0/20 |
| C v2 Opus 5.5 low — *contaminé* | 52,6 | 100,0 | 69,0 | 84,2 | 91,4 | 87,7 | 15,8 | 0/20 |
| C v2 strict Gemini low — *contaminé* | 81,0 | 85,0 | 82,9 | 90,5 | 54,3 | 67,9 | 9,5 | 3/20 |

Intervalles (précision P+S) : B passe 1 48–81 ; C v2 69–93 (Astra), 76–100 (Gemini), 72–96 (Opus).

**Atténuation, pas preuve — même jeu sans les 6 lignes « sens non donné »** (55 lignes ; ces 6
lignes sont des Pertinent de passe 1, B les perd aussi) :

| Système | Précision (P) | Rappel (P) | Précision (P+S) | Rappel (P+S) | Bruit | Pertinents perdus |
|---|---:|---:|---:|---:|---:|---:|
| B passe 1 | 35,5 | 78,6 | 58,1 | 62,1 | 41,9 | 3/14 |
| C v2 Astra low | 43,8 | 100,0 | 78,1 | 86,2 | 21,9 | 0/14 |
| C v2 Gemini low | 48,3 | 100,0 | 86,2 | 86,2 | 13,8 | 0/14 |
| C v2 Opus 5.5 low | 43,8 | 100,0 | 81,3 | 89,7 | 18,8 | 0/14 |

**Classement à trois classes sur le test (précision / rappel par classe, %) — contaminé**

| Classe | Astra low | Gemini low | Opus 5.5 low |
|---|---|---|---|
| Pertinent | 83,3 / 75,0 | 81,0 / 85,0 | 86,7 / 65,0 |
| À surveiller | 45,0 / 60,0 | 64,3 / 60,0 | 47,8 / 73,3 |
| Non pertinent | 82,6 / 73,1 | 84,6 / 84,6 | 87,0 / 76,9 |

Aucun classement entre modèles (McNemar p = 0,13 à 1,00). Latence médiane : 9,8 s (Astra), 4,9 s
(Gemini), 5,7 s (Opus). Coût : passages sur siège ; équivalent API annoncé par le CLI Claude 1,45 $
pour les 61 lignes ; Astra et Gemini `non vérifié`.

<!-- chart:oracle-c-precision-rappel — barres précision / rappel (positif = Pertinent), jeu de test ; SVG prêt : results/filter-pr-blind.svg -->

Données pour graphiques simples (barres, jeu de test, positif = Pertinent puis P+S) :

| Série | B passe 1 | B passe 2 | B passe 3 | C v2 Astra* | C v2 Gemini* | C v2 Opus* |
|---|---:|---:|---:|---:|---:|---:|
| Précision (P) | 45.9 | 37.0 | 32.8 | 52.6 | 57.1 | 52.6 |
| Rappel (P) | 85.0 | 100 | 100 | 100 | 100 | 100 |
| Précision (P+S) | 64.9 | 61.1 | 57.4 | 81.6 | 88.6 | 84.2 |
| Rappel (P+S) | 68.6 | 94.3 | 100 | 88.6 | 88.6 | 91.4 |

\* contaminé (règle 1 + exposition).

**Lecture (JUGEMENT).** Sur le test, la passe 1 montre 37 lignes pour 17 Pertinent sur 20 ; C v2
en montre 35 à 38 pour les 20, avec une précision P+S de 82 à 89 contre 65. Comme v2 est
contaminé, c'est une direction à vérifier sur un jeu vierge, pas un gain mesuré.

### Le prompt et l'audit de ses règles

- **v1** : critères généraux de Steve (trois critères, cinq exclusions, réserve d'asymétrie) et
  légende de ses codes. Sources autorisées.
- **v2** (une itération sur optim) — audit des règles selon le critère de l'owner (seuls autorisés :
  critères généraux énoncés, légende des codes, lignes optim) :

| Règle v2 | Source | Verdict |
|---|---|---|
| 1. Verdict selon les quatre catégories de l'analyse | Tableau §2 de l'analyse (agrégat incluant 37 lignes de test) | **Fuite — source interdite** |
| 2. L'étape précoce n'est jamais un déclassement | Erreurs optim + vue de travail de Steve, formulée dans le cadre de la règle 1 | **Suspecte** ; contredit aussi le code S-PLANIFIE |
| 3. Avis de motion numéroté ≠ point d'ordre du jour | Erreurs optim + code N-ODJ-SEUL | Autorisée (exposition déclarée) |
| 4. CPTAQ : exclusion municipale ≠ autorisation de lots nommés | Critère 1 + code P-PERIM-URB + erreurs optim | Autorisée ; **risque de surajustement** |
| 5. Lotissement accessoire → N-ACCESSOIRE | Code N-ACCESSOIRE + erreurs optim | Autorisée |
| 6. Vocation douteuse reste visible | Réserve d'asymétrie (critère général) + erreurs optim | Autorisée |

Toutes ces règles tranchent aussi des points que le dossier laisse à Steve (D8) : à faire
confirmer par lui.

### Garantie pour la suite : jeu de test scellé (mis en place dans le dépôt)

- **(a) Scellé** : le jeu de test est chiffré (AES-256-GCM) hors du dépôt, clé hors du dépôt ; seule
  son empreinte est visible ; l'autotest échoue si une copie en clair traîne dans l'espace de
  travail. Le jeu actuel est scellé (a posteriori, par le même agent : démonstratif ici).
- **(b) Gel avant exécution** : le lanceur refuse toute exécution sur le test si le prompt n'est pas
  le prompt final **commité et inchangé**, et refuse une seconde exécution de la même version
  (vérifié : un nouveau passage de v2 est refusé).
- **(c) Journal d'audit** horodaté de chaque accès au test (qui, quand, rôle, empreinte du prompt
  et du jeu), versionné avec les résultats (`test-access-log.jsonl`).
- **(d) Séparation des rôles** : l'optimiseur et l'exécutant du test sont deux exécutants distincts ;
  seul l'exécutant détient la clé (le lanceur exige le rôle « test-executor » et la clé). Procédure
  décrite, non vérifiable dans le dépôt seul.
- **(e) Entrées propres** : l'optimiseur ne reçoit que les critères généraux de Steve, la légende des
  codes et le jeu optim ; jamais les parties agrégées ou détaillées de l'analyse, ni les tableaux du
  dossier sur toutes les lignes, ni le classeur.
- **(f) Nouveau jeu de test vierge** : les 52 villes suivantes de Steve, triées par lui avant toute
  sortie de C, scellées par l'exécutant ; prompt refait sans la règle 1. Les chiffres de référence
  porteront sur ce jeu.

### Limites

- Scores v2 du test contaminés ; aucune mesure sur un jeu vierge à ce jour.
- Petits jeux (61 lignes de test, 25 villes) ; intervalles larges.
- Une seule personne pour la vérité, sans arbitrage ni « non résolu » ; cas D8 notés comme vrais.
- Les deux jeux ne sont pas publiés dans le dépôt (dépôt public) : décision à prendre avec D6.

### Plan d'extension (proposition, non exécutée)

- D'abord le jeu de test vierge (ci-dessus), puis environ 600 lignes dont environ 300 lignes
  réelles annotées par un humain en test ; à cette taille, un écart de 6 à 7 points entre deux
  modèles devient lisible.
- Registre unique des municipalités ; vérité = décision humaine prise avant de voir toute réponse
  de modèle ; 100 % d'annotation humaine en test ; au moins 50 lignes annotées deux fois ; Steve ne
  voit aucune sortie de C avant le gel de son relevé ; cas synthétiques dérivés d'optim seulement.

### Compatibilité avec la convergence sentropic / engram (terminologie et modèle générique)

« Oracle C » n'est qu'un nom de dossier et de document. Correspondance avec l'état de l'art :
oracle → **jeu de référence annoté** ; `optim` → **jeu de développement** ; `blind` → **jeu de
test réservé** ; verdict → **étiquette** ; motif → **code de justification**. Le format des items
(`id`, `label`, `strata`, `input`, `nodeIds`) est générique et se projette sur une annotation ancrée
à un objet métier (§6.4). Un renommage ne touche ni les jeux ni leurs empreintes.

### Revue adverse

Deux revues indépendantes : **Astra max** (rejet) et **Opus 5.5 max** (acceptation avec
modifications). Points communs : gel sans ancrage dans l'historique, règle v2 appuyée sur un
agrégat incluant des lignes de test, règles v2 qui tranchent des points D8, méthode différente de
l'oracle E, isolement affirmé plutôt que prouvé, plan d'extension incohérent. Suite donnée :
requalification en pilote exploratoire, corrections de code sans relancer de modèle, limites
déclarées, plan d'extension réécrit, puis protocole de jeu de test scellé. Réconciliation :
`review.md`.

---

### Annexe — jeu de mise au point (optim, 60 lignes) : diagnostic seulement

Ces chiffres ont servi à écrire et choisir le prompt ; ce ne sont pas des performances.

| Système | Précision (P) | Rappel (P) | Précision (P+S) | Rappel (P+S) | Bruit | Pertinents perdus |
|---|---:|---:|---:|---:|---:|---:|
| B passe 1 | 47,2 | 89,5 | 69,4 | 75,8 | 30,6 | 2/19 |
| B passe 2 | 34,6 | 94,7 | 59,6 | 93,9 | 40,4 | 1/19 |
| B passe 3 | 31,7 | 100,0 | 55,0 | 100,0 | 45,0 | 0/19 |
| C v1 Astra / Gemini / Opus | 48,1 / 60,0 / 54,5 | 68,4 / 94,7 / 94,7 | 81,5 / 86,7 / 84,8 | 66,7 / 78,8 / 84,8 | 18,5 / 13,3 / 15,2 | 6 / 1 / 1 |
| C v2 Astra / Gemini / Opus | 50,0 / 59,4 / 54,3 | 94,7 / 100 / 100 | 80,6 / 87,5 / 85,7 | 87,9 / 84,8 / 90,9 | 19,4 / 12,5 / 14,3 | 1 / 0 / 0 |
