# Rapport d'étude — Radar Immobilier

Date : 2026-08-09  
Statut : premier jet de rapport de période, soumis à validation de l'orientation.  
Périmètre de mesure : livraisons et événements du 13 juillet au 9 août 2026 inclus ; état
Track lu au 9 août ; production IMMO et catalogue OGC GEO vérifiés le 9 août ; photographie
qualité GEO du 25 juillet. Les métriques antérieures non remesurables sans accès authentifié sont
conservées uniquement comme baselines datées.

> **Note de lecture — effectif vs projeté.** Chaque chiffre est qualifié :
> **[effectif]** = mesuré réellement sur les données ou le code à une date donnée ;
> **[projeté]** = extrapolation crédible mais non encore réalisée ;
> **[en attente]** = dépend d'une donnée ou d'une livraison externe identifiée et demandée.
> Aucune métrique n'est présentée comme acquise si elle ne l'est pas. Les mesures reposent sur des
> commandes bornées et reproductibles, documentées en annexe.

---

## Résumé exécutif

La période ferme une classe de problème visible pour le client : le radar ne se contente plus de
montrer des couches superposées, il permet de parcourir **ville → zone → lot en deux clics**, en
gardant la zone active pour préserver le contexte de décision. Le même palier retire un score de
« potentiel » qui n'était pas fondé sur les caractéristiques du lot et rend la carte Signaux
utilisable sur mobile. Les trois changements ont été fusionnés, leurs chaînes CI/CD ont réussi et
le bundle servi par `immo.sent-tech.ca` porte le SHA de la dernière livraison le 9 août
**[effectif]**.

Cette capacité client s'appuie sur un travail GEO et de preuve plus profond. La couverture
canonique mesurée le 9 août atteint **29/30** villes focus et **868/1104** villes provinciales en
zonage, **30/30** et **1102/1104** en lots, ainsi que **29/30** et **596/1104** pour la présence
d'une collection de normes **[effectif]**. Ces nombres mesurent une **présence servie**, pas une
complétude réglementaire. La photographie qualité du 25 juillet rend précisément visible l'écart
restant entre disponibilité, réconciliation et preuve exacte.

Le passage de l'extraction v2.3 à la fondation v3.4 doit se lire par sa finalité : préserver les
propriétés métier, produire des candidats déterministes et auditables, transporter la provenance
et empêcher une publication silencieusement appauvrie. Il ne signifie pas que v3.4 est généralisée
à toute la province. Le Track le reflète : au 9 août, l'ensemble du programme est à **92/176
(52 %) [effectif]** ; l'extraction est à **9/19 (47 %)** et la recette à **1/9 (11 %)**.

### Les deux axes indissociables

- L'axe **de couverture** compare toujours le **Focus 30** — banc de démonstration E2E des
  banlieues de la région de Montréal — à la **Province ≈1104**, hors Montréal et Laval. Un même
  indicateur porte deux valeurs qui ne sont **jamais additionnées**.
- L'axe **de profondeur de preuve** compare les **~33 opportunités témoins [effectif — banc de
  référence]** suivies signal → document → zone → grille → lot à la cible **>5000 couples
  ville×signal [projeté]**. La présence d'une collection géographique ne démontre ni une citation,
  ni une norme exacte, ni une réconciliation complète.

> **Attention au vocabulaire GEO.** Certains artefacts du dépôt GEO emploient aussi le nom
> `focus30` pour une cohorte de recette différente. Tous les chiffres « Focus 30 » de ce rapport
> utilisent exclusivement la cohorte canonique Radar : `priorityRank <= 30`, villes non exclues.

### Acquis effectifs

1. **Une navigation client continue de la zone au lot.** La PR #499 impose le parcours strict
   ville → zone → lot, garde la zone sélectionnée lors du clic sur un lot et conserve ses détails
   à côté de ceux du lot **[effectif — code fusionné et production vérifiée le 2026-08-09]**.
2. **Une décision plus honnête.** La PR #500 supprime le score « Potentiel x.x/10 » des fiches
   lots faute de fondement parcellaire démontré ; les livraisons antérieures ont aussi renforcé
   l'affichage de la preuve et des limites **[effectif — code fusionné]**.
3. **Une carte Signaux adaptée au terrain.** La PR #501 réorganise fil d'Ariane, légendes et
   outils de mesure pour les petits écrans **[effectif — bundle `e27baeb` servi le 2026-08-09]**.
4. **Un substrat GEO largement servi.** Zonage et lots sont présents sur la quasi-totalité du
   banc focus ; les lots sont présents sur 1102 des 1104 municipalités cibles **[effectif — API
   OGC, 2026-08-09]**.
5. **Une extraction mieux bornée.** Les contrats v3.4, le contrôle de perte de propriétés, les
   sorties candidates déterministes et les canaux d'émission/application ferment le risque de
   transformer silencieusement un signal au cours de la chaîne **[effectif — code et tests
   fusionnés dans la fenêtre]**.
6. **Une parité de données entre application et assistant mieux définie.** Le connecteur MCP lit
   le même flux de signaux réels que l'application sous le jeton de l'utilisateur, et sa
   configuration CD est durable **[effectif — PR #371 et #372 fusionnées]**.

### Limites assumées

- **Présence n'est pas complétude.** Une collection canonique de zonage, de lots ou de normes peut
  être vide, partielle, d'un millésime inadéquat ou insuffisamment prouvée. La mesure de présence
  du 9 août ne remplace pas la recette qualité.
- **La preuve exacte reste le goulot.** Dans la photographie GEO du 25 juillet, la preuve exacte
  v2 est classée complète pour **0/1106** municipalités et non évaluée pour l'ensemble du
  portefeuille **[effectif — dénominateur opérationnel GEO, distinct du périmètre Radar 1104]**.
  Ce zéro qualifie un contrôle non encore satisfait ; il ne signifie pas « aucune donnée utile ».
- **La réconciliation n'est pas encore généralisée.** Le dernier rappel signal↔zone comparable
  demeure **~60 %** sur le proxy focus et **71/120 = 59,2 %** sur 55 villes
  **[effectif — dernière mesure 2026-06-29, hors fenêtre]**. Il n'est pas présenté comme un gain
  de la période.
- **PV, signaux et citations n'ont pas été remesurés sur la production authentifiée.** Les
  baselines de juillet sont conservées comme points de départ datés ; les valeurs actuelles sont à
  mesurer avant publication finale.
- **Les données nominatives restent hors périmètre livré** faute de base légale, de gouvernance et
  de source approuvée **[en attente]**. Pour les aires TOD, le snapshot GEO mesure **4/39** cas
  applicables complets **[effectif — 2026-07-25]** ; le reliquat et l'identité des villes de
  référence couvertes restent **[en attente]** de qualification.
- **La généralisation dépasse encore les témoins.** Les ~33 parcours E2E **[effectif — banc de
  référence]** ne démontrent pas encore une preuve complète à l'échelle >5000 ville×signal
  **[projeté]**.

### Chiffres clés — deux périmètres : **Focus 30** vs **Province ≈1104**

Les couches restent distinctes : le PV est le substrat documentaire ; un signal est une
extraction ; le zonage et les lots sont des géométries servies ; la grille porte les normes ; la
réconciliation et la preuve relient ces couches. Le tableau ne les additionne jamais.

| Couche (finalité) | **Focus 30** | **Province ≈1104** | Statut |
|---|---:|---:|---|
| **PV scrapés** — substrat documentaire | **27/30** | **~1007/1104** | **[effectif — baseline 2026-07-02, hors fenêtre]** ; à remesurer |
| **Signaux extraits** — faits réglementaires | **25/30** | **978/1104** | **[effectif — baseline 2026-07-02, hors fenêtre]** ; à remesurer |
| **Signaux à citation vérifiable** | **56/70** | — | **[effectif — baseline 2026-07-02, hors fenêtre]** ; à remesurer, cible 100 % |
| **Zonage servi** — collection canonique présente | **29/30** | **868/1104** | **[effectif — API GEO 2026-08-09]** ; présence, pas complétude |
| **Grilles/normes servies** — collection canonique présente | **29/30** | **596/1104** | **[effectif — API GEO 2026-08-09]** ; qualité et millésime à qualifier |
| **Lots servis** — collection canonique présente | **30/30** | **1102/1104** | **[effectif — API GEO 2026-08-09]** ; `austin` et `saint-marc-du-lac-long` absents |
| **Signaux désignant une zone** | **14/30** | — | **[effectif — baseline 2026-07-02, hors fenêtre]** ; à remesurer |
| **Consistance signal↔zone — rappel** | **~60 %** (28/47) | **59,2 %** (71/120, 55 villes) | **[effectif — dernière mesure 2026-06-29, hors fenêtre]** ; à remesurer |
| **Données nominatives** | — | — | **[en attente]** — acquisition et gouvernance non livrées |
| **Aires TOD** | à mesurer sur la cohorte canonique | **4/39** cas applicables complets | **[effectif — snapshot GEO 2026-07-25]** ; reliquat **[en attente]** |

TODO — à mesurer avant consolidation : PV, signaux, citations et références de zone depuis la
production authentifiée, avec un jeton de rapport non consigné dans le dépôt :

```bash
curl -fsS -H "Authorization: Bearer <jeton-rapport>" \
  https://immo.sent-tech.ca/api/source/coverage | jq .
curl -fsS -H "Authorization: Bearer <jeton-rapport>" \
  https://immo.sent-tech.ca/api/graph-signals/by-city | jq .
```

TODO — à mesurer : rappel et précision signal↔zone sur le même snapshot servi, avec la commande
de recette Track/Make qui sera ratifiée pour WP5. Aucun target `make` canonique n'est exposé dans
la baseline courante ; ne pas substituer un script ad hoc à cette recette.

### Les deux bancs E2E

1. **Banc couverture — Focus 30.** Il vérifie que la chaîne de démonstration dispose du substrat
   nécessaire pour aller du signal au lot. Au 9 août, les collections canoniques servent le
   zonage pour **29/30** villes et les lots pour **30/30 [effectif]**. La ville manquante en
   zonage et normes est `lile-dorval`. Le volume de signaux réellement cités et réconciliés doit
   encore être remesuré.
2. **Banc profondeur — ~33 témoins [effectif — banc de référence].** Il vérifie la chaîne
   signal → document → zone → grille → lot, tandis que le banc des quatre villes de référence
   mesure la parité fonctionnelle. La dernière référence disponible pour « 4+ logements » reste
   **97,5 % sur 3171 lots [effectif — mesure du 2026-07-02, hors fenêtre]**. La cible de
   généralisation demeure **>5000 ville×signal [projeté]**.

---

# 1 — GEO : données, extraction et preuve

La période ne se résume pas à davantage de collections. Sa contribution est d'avoir rendu plus
explicites trois états auparavant faciles à confondre : **servi**, **réconcilié** et **prouvé**.

## 1.1 — Couverture servie : zonage, lots et normes

La mesure exacte par slug canonique sur l'API GEO donne :

| Couche (finalité) | **Focus 30** | **Province ≈1104** | Statut |
|---|---:|---:|---|
| Zonage — trouver la géométrie d'une zone | **29/30** | **868/1104** | **[effectif — 2026-08-09]** |
| Lots — localiser la parcelle | **30/30** | **1102/1104** | **[effectif — 2026-08-09]** |
| Normes — disposer d'une collection canonique | **29/30** | **596/1104** | **[effectif — 2026-08-09]** ; contenu à recetter |

Cette couverture permet au produit de demander des couches cohérentes par ville. Elle ne permet
pas encore d'affirmer qu'une norme est la bonne norme en vigueur pour chaque lot. Le bon niveau de
lecture est donc : **capacité de service acquise**, **qualité réglementaire encore hétérogène**.

La photographie portefeuille GEO du 25 juillet complète la présence par une mesure de qualité,
sur son univers opérationnel de **1106 municipalités** :

- zonage classé complet pour **868/1106**, incomplet pour **195/1106** et inconnu pour
  **43/1106 [effectif]** ;
- consistance lot↔zone classée complète pour **713/1106**, incomplète pour **121/1106** et
  inconnue pour **272/1106 [effectif]** ; sur **864** municipalités auditables, le taux pondéré
  d'incohérence est **4,34 % [effectif]** ;
- normes classées complètes pour **502/1106**, incomplètes pour **290/1106** et inconnues pour
  **314/1106 [effectif]** ;
- provenance zone avec jointure exacte pour **868/1106 [effectif]**, mais preuve exacte v2
  complète pour **0/1106 [effectif]**.

Le dénominateur 1106 appartient à ce snapshot GEO et n'est pas additionné ni substitué au
périmètre client ≈1104. Il sert à qualifier la profondeur de la donnée.

## 1.2 — Extraction : de v2.3 à la fondation v3.4

La v2.3 avait instauré une règle essentielle : un signal publiable doit être relié à une citation
vérifiable. La fondation v3.4 ajoute des garanties de transformation et d'exploitation :

- contrat d'entrée versionné et cas de référence hérités, pour pouvoir rejouer l'extraction ;
- enrichissement déterministe et gate de perte de propriétés, pour qu'une transformation ne
  supprime pas silencieusement une information métier ;
- émissions candidates fidèles et sorties en lecture seule, pour séparer proposition,
  validation et application ;
- jobs d'émission/application et contrôle du SHA servi, pour relier le résultat exposé au code qui
  l'a produit.

Ces capacités sont **[effectif — code et tests fusionnés]**. Leur déploiement exhaustif sur les
1104 villes et la migration complète des anciens graphes sont **[projeté]**. La livraison Brossard
a, elle, produit un graphe `MATCHED` vérifié avec **23 événements** stockés dans S3
**[effectif — livraison du 2026-08-07]**, sans que ce cas isolé suffise à réviser les totaux de
signaux non remesurés.

## 1.3 — Réconciliation et preuve : le chantier qui reste déterminant

La chaîne de valeur n'est complète que si elle peut répondre à cinq questions : quel signal,
dans quel document et à quel passage, pour quelle zone, avec quelle grille, et sur quel lot ? La
période a renforcé les contrats de provenance, les événements de désignation et les contrôles de
publication. Elle n'a pas encore produit une nouvelle mesure comparable du rappel/précision à
l'échelle provinciale.

La dernière référence signal↔zone reste donc datée du 29 juin : **71/120 = 59,2 %** sur 55 villes
et **~60 %** sur le proxy focus **[effectif — hors fenêtre]**. La photographie du 25 juillet
montre en parallèle que la preuve exacte v2 n'est encore complète pour aucune municipalité du
portefeuille GEO. Ces deux constats orientent la suite : le volume servi n'est plus le seul
goulot ; la priorité est la preuve réglementaire et temporelle exacte.

## 1.4 — Limites GEO et livraisons attendues

- `lile-dorval` ne possède pas de collection canonique de zonage ni de normes au 9 août
  **[effectif]**.
- `austin` et `saint-marc-du-lac-long` ne possèdent pas de collection canonique de lots au 9 août
  **[effectif]**.
- Les normes présentes doivent encore être qualifiées par source, millésime, zone et verbatim ;
  leur généralisation prouvée est **[projeté]**.
- Les propriétaires ne sont ni collectés ni affichés **[en attente]**.
- Le snapshot GEO classe **39** municipalités comme applicables au TOD et **4/39** comme complètes
  **[effectif — 2026-07-25]**. La correspondance avec les quatre villes de référence et le
  reliquat demandé au partenaire restent **[en attente]**.

---

# 2 — IMMO : capacité produit atteinte

## 2.A — De la carte de couches au parcours de décision

La PR #499 ferme un problème d'usage central : lorsqu'un utilisateur choisit une zone puis un
lot, la zone ne disparaît plus du contexte. Le parcours impose maintenant deux gestes lisibles —
sélectionner la zone, puis le lot — et le panneau de droite conserve les deux niveaux
d'information. La carte devient ainsi le point de jonction visible entre zonage GEO et objet
parcellaire **[effectif — production vérifiée]**.

Cette livraison complète les travaux de la fenêtre sur les quatre surfaces du radar :

- **Signaux** : carte et liste reliées aux signaux réels, filtres simplifiés, responsive mobile ;
- **Sources** : console et matrice de couverture, décompte des restrictions préservé même lorsque
  l'axe de filtrage client correspondant a été retiré ;
- **Évaluation** : navigation zone/lot, fiches de preuve et affichage plus fidèle des données
  réellement disponibles ;
- **Opportunités** : vivier et filtre B′ séparant mieux classification, validation et usage
  client.

Les changements fonctionnels sont **[effectif — code fusionné dans la fenêtre]**. Leur couverture
fonctionnelle exhaustive et leur recette de parité utilisateur restent **[projeté]**, le WP5
Recette étant à **1/9 (11 %) [effectif]**.

## 2.B — Honnêteté produit : montrer la preuve, retirer le faux signal

Le retrait du score « Potentiel x.x/10 » ferme une dette de confiance : un nombre précis ne doit
pas suggérer une évaluation parcellaire lorsque ses composantes ne sont pas établies. La période a
également durci les états de preuve et de provenance présentés dans l'interface. Le produit gagne
donc moins par un nouvel indicateur que par une règle : **ce qui n'est pas fondé n'est pas affiché
comme décision**.

Cette règle rejoint directement la méthode du rapport : une donnée présente reste distincte d'une
donnée complète ; une projection reste `[projeté]`; une dépendance externe reste `[en attente]`.

## 2.C — Assistant et parité du flux de données

Le connecteur MCP interroge désormais `GET /api/graph-signals/:city`, le même flux que
l'application, sous l'identité de l'utilisateur. Cette livraison ferme le risque de démontrer dans
l'assistant un jeu de signaux différent de celui vu dans le radar **[effectif — code et tests
fusionnés]**. La durabilité de sa configuration CD a été livrée dans la même fenêtre.

TODO — à mesurer : valider en production, avec un compte de recette, qu'une même ville retourne le
même ensemble d'identifiants de signaux dans l'application et par `search_signals`. Cette mesure
requiert un jeton utilisateur et ne doit pas être simulée avec des fixtures.

## 2.D — Production et exploitation client-facing

Le 9 août constitue un **palier produit vérifié**, pas le premier go-live :

- PR #499 fusionnée à `56bb850f` ;
- PR #500 fusionnée à `f47d9354` ;
- PR #501 fusionnée à `e27baeb8` ;
- contrôles CI, construction/push d'images et publication Pages réussis pour les trois merges ;
- `https://immo.sent-tech.ca/build.json` retourne `{"sha":"e27baeb"}`
  **[effectif — 2026-08-09]**.

La vérification du SHA servi relie le comportement visible à une révision précise. Elle ne
remplace pas une recette E2E authentifiée sur toutes les vues.

---

# 3 — Avancement Track et lecture de la période

Le Track est la colonne vertébrale du décompte. Au 9 août, le programme porte **92 éléments faits
sur 176, soit 52 % [effectif]**, répartis en neuf workpackages :

| Workpackage | Finalité | Avancement cumulé au 2026-08-09 |
|---|---|---:|
| WP1 — DATA | Sources et substrat | **17/22 (77 %) [effectif]** |
| WP2 — EXTRACTION | Signaux et ontologie | **9/19 (47 %) [effectif]** |
| WP3 — VIVIER | Classification et filtre B′ | **2/7 (29 %) [effectif]** |
| WP4 — RÉCONCILIATION & PREUVE | Signal, zone, citation, lot | **14/21 (67 %) [effectif]** |
| WP5 — RECETTE | Mesure et parité avec la référence | **1/9 (11 %) [effectif]** |
| WP6 — PRODUIT | Application radar client | **21/44 (48 %) [effectif]** |
| WP7 — PLATEFORME & DÉPLOIEMENT | Service et CD | **16/25 (64 %) [effectif]** |
| WP8 — SPEC & CONTRATS | Contrats partagés | **1/6 (17 %) [effectif]** |
| WP9 — GOUVERNANCE | Pilotage et décisions | **4/7 (57 %) [effectif]** |

Ces ratios sont **cumulés**, pas un débit de la période. La fenêtre 13 juillet → 9 août contient
**256 des 800 événements Track [effectif]**. Le rapport borné fait ressortir explicitement trois
finalités enregistrées : navigation ville→zone→lot, retrait d'un axe de filtre client avec
préservation des décomptes restrictifs, et baseline/contraintes du Vivier. Git et les preuves de
production complètent ce journal sans remplacer son décompte.

La fenêtre compte par ailleurs **95 PR fusionnées dans Radar [effectif]** et **1668 commits sur
`geo/origin/main` [effectif]**. Ces volumes attestent l'activité mais ne mesurent pas la valeur ;
ils restent des éléments de provenance, tandis que le récit est structuré par finalité.

---

# 4 — Acquis, limites et feuille de route

## 4.1 — Ce que la période permet d'affirmer

- Le client peut parcourir une ville, une zone puis un lot en conservant le contexte de zone, et
  cette capacité est servie en production **[effectif]**.
- Le produit retire un score non fondé et rend plus visibles les états de preuve **[effectif]**.
- Le banc Focus 30 dispose des lots pour 30 villes et du zonage pour 29 villes
  **[effectif — présence canonique]**.
- La fondation d'extraction protège mieux les propriétés métier et rend les sorties candidates
  plus auditables **[effectif — code/tests]**.
- La qualité GEO peut désormais être décrite sans confondre couverture, complétude,
  réconciliation et preuve **[effectif — snapshot du 2026-07-25]**.

## 4.2 — Ce que la période ne permet pas encore d'affirmer

- que 868 collections de zonage sont toutes complètes, du bon millésime et juridiquement prouvées ;
- que les baselines PV/signaux/citations de juillet ont progressé d'un nombre donné ;
- que le rappel signal↔zone a dépassé 59,2 % à périmètre comparable ;
- que les ~33 témoins **[effectif — banc de référence]** sont généralisés à >5000 ville×signal
  **[projeté]** ;
- que propriétaires ou TOD sont disponibles ;
- que la parité fonctionnelle et de données est recettée sur toute la surface client.

## 4.3 — Priorités proposées pour la période suivante

1. **Recetter la chaîne de preuve.** Définir la commande Track/Make reproductible de rappel et de
   précision, puis mesurer Focus 30 et Province séparément **[projeté]**.
2. **Requalifier les couches servies.** Pour zonage et normes : source, millésime, complétude,
   code de zone et preuve exacte v2 **[projeté]**.
3. **Remesurer PV, signaux et citations sous authentification.** Publier une photographie datée et
   faire de 100 % de citations vérifiables un gate, non une moyenne **[projeté]**.
4. **Recetter le palier produit.** Parcours mobile et bureau, zone persistante, lot, Sources,
   Évaluation, Opportunités et parité MCP **[projeté]**.
5. **Conserver les dépendances externes explicites.** Les propriétaires restent **[en attente]** ;
   pour le TOD, qualifier les **4/39** cas complets puis maintenir le reliquat **[en attente]** tant
   que source et livraison ne sont pas acquises.

---

# Conclusion

Entre le 13 juillet et le 9 août, Radar Immobilier a surtout gagné en **crédibilité d'usage** :
la donnée GEO est servie beaucoup plus largement qu'elle n'est encore prouvée, mais cette limite
est maintenant mesurable ; l'extraction protège mieux le sens métier ; et le produit transforme
ces couches en un parcours client concret, sans conserver un score parcellaire non justifié.

Le résultat le plus visible est la navigation ville → zone → lot servie le 9 août. Le résultat le
plus structurant est la séparation désormais assumée entre **couverture**, **qualité** et
**profondeur de preuve**. La prochaine étape n'est donc pas de présenter le volume comme une fin :
elle consiste à fermer la recette sur les ~33 témoins **[effectif — banc de référence]**, puis à
démontrer la généralisation vers >5000 ville×signal **[projeté]** avec les mêmes exigences de
citation, de zone, de grille, de lot et de millésime.

---

# Annexes — métriques citées, provenance et commandes

## A. Track

Commandes exécutées depuis le repo racine afin de lire le journal partagé :

```bash
track report
track report --wp
track report --decisions
track report --since 2026-07-13 --until 2026-08-09 \
  --wp --decisions --format json
```

Résultats cités : baseline `43c873e0d2cf`, **92/176**, neuf workpackages,
**256/800** événements dans la fenêtre et aucune décision structurée en attente
**[effectif — 2026-08-09]**.

## B. Livraisons Radar et production

```bash
git log --since=2026-07-13 --until=2026-08-09 --oneline
gh pr list --repo rhanka/radar-immobilier --state merged \
  --search 'merged:2026-07-12..2026-08-10' --limit 200 \
  --json number,mergedAt,mergeCommit,title \
  | jq '[.[] | select(.mergedAt >= "2026-07-13T04:00:00Z" and \
      .mergedAt <= "2026-08-10T03:59:59.999Z")] | length'
gh pr view 499 --repo rhanka/radar-immobilier --json number,title,mergedAt,mergeCommit
gh pr view 500 --repo rhanka/radar-immobilier --json number,title,mergedAt,mergeCommit
gh pr view 501 --repo rhanka/radar-immobilier --json number,title,mergedAt,mergeCommit
curl -fsSL https://immo.sent-tech.ca/build.json
```

Le décompte de **95 PR [effectif]** utilise les timestamps `mergedAt` bornés à la journée de Toronto ; le
résultat brut de recherche doit être filtré entre `2026-07-13T04:00:00Z` et
`2026-08-10T03:59:59.999Z` avant publication automatisée.

## C. Couverture GEO

Source de la cohorte :
`packages/radar-sources/src/geo/municipalities.qc.json`. Mesure effectuée par correspondance
exacte entre le slug canonique et les collections `qc-zonage-<slug>`, `qc-lots-<slug>` et
`qc-zonage-norms-<slug>` :

```bash
curl -fsSL 'https://api.geo.sent-tech.ca/collections?f=json' \
  | jq --slurpfile m packages/radar-sources/src/geo/municipalities.qc.json '
    ($m[0] | map(select(.excluded != true))) as $p |
    ($p | map(select(.priorityRank != null and .priorityRank <= 30))) as $f |
    ([.collections[].id]) as $ids |
    def n($cities; $prefix):
      [$cities[] | .slug as $slug | select($ids | index($prefix + $slug))] | length;
    {collections: ($ids | length), focus_denominator: ($f | length),
     province_denominator: ($p | length),
     zonage: {focus: n($f; "qc-zonage-"), province: n($p; "qc-zonage-")},
     lots: {focus: n($f; "qc-lots-"), province: n($p; "qc-lots-")},
     normes: {focus: n($f; "qc-zonage-norms-"),
              province: n($p; "qc-zonage-norms-")}}'
```

Le filtre Focus doit impérativement être :

```jq
select(.excluded != true and .priorityRank != null and .priorityRank <= 30)
```

Le test explicite de `null` évite d'inclure Montréal et Laval par coercition `jq`. Résultats du
2026-08-09 : **3883 collections** au total ; zonage **29/30** et **868/1104** ; lots **30/30** et
**1102/1104** ; normes canoniques présentes **29/30** et **596/1104 [effectif]**.

## D. Qualité GEO et historique

Photographie qualité citée :

```bash
git -C /home/antoinefa/src/geo show \
  origin/main:work/coverage/portfolio-report-history/20260725.json | jq .
git -C /home/antoinefa/src/geo rev-list --count \
  --since='2026-07-13 00:00:00 -0400' \
  --until='2026-08-10 00:00:00 -0400' origin/main
```

Le snapshot qualité utilise un univers GEO de 1106 municipalités. Ses ratios sont présentés avec
ce dénominateur et ne sont jamais additionnés aux valeurs du périmètre Radar ≈1104.

## E. Baselines conservées hors fenêtre

Les valeurs PV, signaux, citations, signal↔zone et parité 4+ proviennent du rapport du 2 juillet :
`docs/spec/reports/study-2026-07/report.md`. Elles servent uniquement de comparaison datée et ne
constituent pas des livraisons acquises entre le 13 juillet et le 9 août.
