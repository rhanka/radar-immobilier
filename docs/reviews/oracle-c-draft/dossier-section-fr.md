# Section prête à coller — §9.3 bis « Oracle C : cadre de mesure et référence d'aujourd'hui »

> Source : `docs/reviews/oracle-c-draft/` (branche `feat/oracle-c-draft`, PR #821). Chiffres
> recalculables par les scripts du dossier (Node, sans dépendance). **FAIT** = constaté dans une
> source vérifiable par un tiers ; **CALCUL** = dérivé des données ; **JUGEMENT** = appréciation ;
> `non vérifié` = non établi.

### Ce qui est livré

Le **cadre de mesure** d'un oracle de ciblage (C) : « fallait-il montrer ce signal à Steve ? ».
Il comprend le découpage des données, un jeu de test scellé et son protocole, la référence des
filtres actuels du radar (B) mesurée sur les mêmes lignes, un bac à sable pour l'auteur du prompt,
un schéma de sortie à tags, et le plan d'extension. **Aucun prompt C n'est mesuré à ce stade** : le
prochain prompt (v1) sera écrit par un nouvel auteur, à partir du bac à sable seulement.

- **FAIT.** 124 lignes de triage de Steve ; 121 retrouvées dans le graphe du radar (une requête
  SELECT en session forcée en lecture seule) ; 3 exclues et listées. Aucune écriture en base, sur
  le cluster ou dans un bucket.
- **CALCUL.** Le modèle verra uniquement ce que le radar servait (libellé, propriétés, extraits
  verbatim), relu le 4 octobre (`non vérifié` qu'il soit identique à ce que Steve voyait).

### À quel niveau on mesure

- **Unité** : une ligne du relevé de Steve rattachée au(x) signal(aux) du radar qu'elle cite.
- **Jeu de test réservé (référence)** : 61 lignes, 25 villes, scellé. **Jeu de mise au point** :
  60 lignes, 26 villes. Partage par municipalité, équilibré sur neuf strates (verdict, famille de
  motif, sens, passe, région, type de document, nature de l'enregistrement, longueur, taille de la
  ville ; écart de part maximal 6,7 points).
- **Vérité** : le verdict de Steve sur la ligne (Pertinent, À surveiller, Non pertinent).
- **Ce qu'on mesure** : la décision « montrer à Steve » ou « masquer ». B montre une ligne si elle
  était visible dans la passe de Steve avec cette combinaison de filtres.
- **Deux définitions du positif** : Pertinent ; Pertinent ou À surveiller.
- **Précision** = positifs montrés / lignes montrées ; **rappel** = positifs montrés / positifs du
  jeu ; **F1** ; **bruit** = Non pertinent parmi les lignes montrées ; **Pertinents perdus** =
  Pertinent masqués. Intervalles à 95 % par rééchantillonnage des villes.

**Biais de sélection.** Chaque ligne existe parce qu'elle était visible dans une des trois passes.
Le rappel n'est mesuré que dans cet univers (la passe 3, sans filtre, a 100 % par construction) ; la
précision est comparable entre systèmes sur les mêmes lignes, et ce biais avantage B. Passes 1, 2, 3
**observées** ; filtres « seuls » **reconstitués** (`non vérifié` face au code de septembre) ;
« Résidentiel seul » non calculable (N-A).

### Référence d'aujourd'hui — jeu de test (61 lignes : 20 P, 15 S, 26 N), en %

| Système | Précision (P) | Rappel (P) | F1 (P) | Précision (P+S) | Rappel (P+S) | F1 (P+S) | Bruit | Pertinents perdus |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B passe 1 (5 filtres) | 45,9 | 85,0 | 59,6 | 64,9 | 68,6 | 66,7 | 35,1 | 3/20 |
| B passe 2 (sans Précoce) | 37,0 | 100,0 | 54,1 | 61,1 | 94,3 | 74,2 | 38,9 | 0/20 |
| B passe 3 (aucun filtre) | 32,8 | 100,0 | 49,4 | 57,4 | 100,0 | 72,9 | 42,6 | 0/20 |
| Précoce seul (reconstitué) | 45,9 | 85,0 | 59,6 | 64,9 | 68,6 | 66,7 | 35,1 | 3/20 |
| Zonage seul (reconstitué) | 38,3 | 90,0 | 53,7 | 66,0 | 88,6 | 75,6 | 34,0 | 2/20 |
| Exclure PIIA + dérogation seul (reconstitué) | 33,3 | 100,0 | 50,0 | 58,3 | 100,0 | 73,7 | 41,7 | 0/20 |
| C v1 (nouvel auteur) | à venir | | | | | | | |

Intervalles, B passe 1 : précision (P) 28–63, rappel (P) 67–100 ; précision (P+S) 48–81.

<!-- chart:oracle-c-precision-rappel — barres précision / rappel des filtres B sur le jeu de test ; SVG prêt : results/filter-pr-blind.svg -->

Données pour graphiques simples (barres, jeu de test) :

| Série | B passe 1 | B passe 2 | B passe 3 | Zonage seul |
|---|---:|---:|---:|---:|
| Précision (P) | 45.9 | 37.0 | 32.8 | 38.3 |
| Rappel (P) | 85.0 | 100 | 100 | 90.0 |
| Précision (P+S) | 64.9 | 61.1 | 57.4 | 66.0 |
| Rappel (P+S) | 68.6 | 94.3 | 100 | 88.6 |

**Lecture (JUGEMENT).** La vue de travail (passe 1) montre 37 des 61 lignes de test : environ une
sur deux est Pertinent, une sur trois est du bruit, et 3 Pertinent sur 20 sont masqués. Retirer
Précoce (passe 2) les récupère mais porte le bruit à 39 %. C'est la barre que C devra franchir sur
les mêmes lignes : **plus de précision que la passe 1, sans perdre de Pertinent**.

### Jeu de test scellé et protocole (mis en place dans le dépôt)

- **(a) Scellé** : les 61 lignes de test (empreinte inchangée `51e32d2a…`) sont chiffrées hors du
  dépôt et hors du bac à sable de l'auteur, clé à part ; plus aucune copie en clair dans l'espace
  de travail (l'autotest échoue sinon).
- **(b) Gel avant exécution** : le lanceur refuse toute exécution sur le test si le prompt n'est pas
  le prompt final **commité et inchangé**, et refuse un second passage d'une même empreinte de
  prompt.
- **(c) Journal d'audit** horodaté de chaque accès au test (qui, quand, rôle, empreintes),
  versionné (`test-access-log.jsonl`).
- **(d) Séparation des rôles** : le préparateur / exécutant (qui a vu le test et l'analyse complète
  de Steve) n'écrit plus de prompt ; un nouvel auteur écrit le prompt, l'exécutant le passe une fois
  sur le test.
- **(e) Bac à sable de l'auteur** (local, non versionné) : uniquement les 60 lignes de mise au point
  avec les étiquettes de Steve, ses trois critères en termes généraux (avec exclusions et réserve
  d'asymétrie, sans statistique ni exemple), la liste des codes de motif avec leur définition, le
  schéma de sortie, et un manifeste avec empreintes et règle d'accès. Tout le reste est interdit à
  l'auteur (lignes de test, agrégats et exemples de l'analyse, dossier, cette branche).
- **(f) Jeu de test vierge** visé pour les chiffres de référence définitifs : les 52 villes
  suivantes de Steve, triées avant toute sortie de C.

### Schéma de sortie à tags et verdict dérivé

Pour chaque signal, le modèle rend des **tags** qui motivent la détection et permettent de
refiltrer : `residentiel` (oui / non / indéterminé), `sens` (assouplissement / restriction / mixte /
neutre / indéterminé), `densification` (oui / non / indéterminé), `exclusions` (PIIA, dérogation
mineure, PPCMOI, usage conditionnel, point d'ordre du jour, point retiré, CPTAQ individuelle, pas un
règlement d'urbanisme, sans effet sur la capacité, autre), `type_acte`, `motif`, une justification
courte et la citation de l'extrait. **Le verdict est recalculé à partir des tags par un filtre
transparent**, dans l'ordre :

| Règle | Condition | Verdict |
|---|---|---|
| R1 | une exclusion établie | Non pertinent |
| R2 | résidentiel = non | Non pertinent |
| R3 | sens = mixte | Pertinent si résidentiel et densification = oui, sinon À surveiller (un mixte ne disparaît jamais) |
| R4 | sens = restriction ou neutre | Non pertinent |
| R5 | densification = non | Non pertinent |
| R6 | résidentiel = oui, assouplissement, densification = oui | Pertinent |
| R7 | sinon (un critère indéterminé, aucun en échec établi) | À surveiller |

Origine : uniquement les trois critères cumulatifs de Steve, ses exclusions et sa réserve
d'asymétrie. À confirmer par Steve : R4 écarte une restriction alors que sa légende prévoit
S-RESTRICTIF (« à connaître »).

### Limites

- Petits jeux (61 lignes de test, 25 villes) ; intervalles larges.
- Une seule personne pour la vérité, sans arbitrage ni « non résolu » ; cas contradictoires (D8)
  notés comme vrais.
- Le jeu de test actuel est conservé par décision owner ; le préparateur l'a vu et un passage de
  modèle antérieur l'a déjà ouvert (consigné). D'où le jeu vierge visé pour la référence définitive.
- Les jeux ne sont pas publiés dans le dépôt (dépôt public) : décision à prendre avec D6.

### Plan d'extension (proposition, non exécutée)

- D'abord le jeu de test vierge, puis environ 600 lignes dont environ 300 lignes réelles annotées
  par un humain en test ; à cette taille, un écart de 6 à 7 points entre deux modèles devient
  lisible (5 points demandent environ 470 lignes).
- Registre unique des municipalités ; vérité = décision humaine prise avant de voir toute réponse
  de modèle ; 100 % d'annotation humaine en test ; au moins 50 lignes annotées deux fois ; Steve ne
  voit aucune sortie de C avant le gel de son relevé ; cas synthétiques dérivés du jeu de mise au
  point seulement.

### Compatibilité avec la convergence sentropic / engram (terminologie et modèle générique)

« Oracle C » n'est qu'un nom de dossier. Correspondance avec l'état de l'art : oracle → **jeu de
référence annoté** ; jeu de mise au point → **jeu de développement** ; jeu de test → **jeu de test
réservé** ; verdict → **étiquette** ; motif → **code de justification**. Le format des items (`id`,
`label`, `strata`, `input`, `nodeIds`) est générique et se projette sur une annotation ancrée à un
objet métier (§6.4). Un renommage ne touche ni les jeux ni leurs empreintes.

### Revue adverse

Deux revues indépendantes (Astra max, Opus 5.5 max). Pour le périmètre conservé : gel des jeux
ancré dans l'historique, équilibre du découpage présenté comme descriptif, intervalles par ville,
biais de sélection déclaré, outillage durci (sièges, lanceur, journal), plan d'extension réécrit
(registre des villes, annotation humaine avant toute réponse de modèle, dimensionnement apparié).
Réconciliation : `review.md`.

---

### Annexe — jeu de mise au point (60 lignes : 19 P, 14 S, 27 N), diagnostic seulement

| Système | Précision (P) | Rappel (P) | Précision (P+S) | Rappel (P+S) | Bruit | Pertinents perdus |
|---|---:|---:|---:|---:|---:|---:|
| B passe 1 | 47,2 | 89,5 | 69,4 | 75,8 | 30,6 | 2/19 |
| B passe 2 | 34,6 | 94,7 | 59,6 | 93,9 | 40,4 | 1/19 |
| B passe 3 | 31,7 | 100,0 | 55,0 | 100,0 | 45,0 | 0/19 |
