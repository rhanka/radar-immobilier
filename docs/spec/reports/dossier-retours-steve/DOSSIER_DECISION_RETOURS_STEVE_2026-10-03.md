# Analyse des retours d'usage du 21 septembre 2026 : capitalisation des données annotées, vers de nouveaux critères de ciblage

- **Date** : 2026-10-03. Analyse de Steve Chaperon datée du 21 septembre 2026 (date du mail de transmission).
- **Type** : dossier de décision.
- **Nature** : dossier consolidé, issu de deux dossiers rédigés indépendamment (auteur A et auteur B), réconciliés point par point. Chaque divergence a été tranchée en revenant aux sources, ou laissée à l'owner (voir annexe A).
- **Destinataire** : Farid (Product Owner), qui décide le produit, le backlog et les priorités. **Validation technique** : Fabien (AI Builder) pour l'architecture, l'IA, le jeu de référence et le modèle de données. Consultés : Steve (client, utilisateur principal) et Mathieu (Product Manager).
- **Statut** : **PROPOSITION**. Aucune décision n'est prise. Aucun code, aucune migration, aucun import, aucune action prod ou cluster.
- **Cartes** : #783 (nouveau jeu de référence), #784 (données de Steve en annotations), #760 (tri et classement), #761 (filtres), #697 et #782 (benchmark), #703 (rafraîchissement), #786, #787 et #788 (dates et URL), #725 (jeu de référence v3).
- **Sources** :
  - `radar-triage-signaux.xlsx`, sha256 `c7e19f46feb78c245fcd04b3e64fd4ac6f174f2d30ff1d4c77aa5a2bf0dc1bb8` ;
  - `Analyse Radar 21 sept.docx`, sha256 `2dbc1d6f87a92ca128815575eb8e6830d5b552cd15b7c2b1e52a93d05ae067ff` ;
  - radar-immobilier `origin/main` `27891b10` ; branches `origin/feat/t1-model-benchmark-real` (jeu de référence v3) et `origin/lane/conductor` (dossier COLLAB du 2026-08-16, absent de `main`) ;
  - sentropic `origin/main` `7d1002505`.
- **Méthode** : lectures Node uniquement (JSZip, fast-xml-parser, exceljs, mammoth), sans Python ; recomptages reproductibles sur les lignes du classeur ; lectures de code par `git show origin/main:<fichier>`.

Conventions : **FAIT** = constaté dans une source citée · **CALCUL** = dérivé des données, méthode donnée · **JUGEMENT** = appréciation · `non vérifié`, `source manquante`, `N-A` = limites déclarées.

### Le relevé de Steve du 21 septembre 2026 : trois passes (règle R-26, période de 6 mois)

| Passe | Filtres | Signaux | But |
|---|---|---:|---|
| Passe 1 | Les cinq filtres cochés (Précoce, Résidentiel, Zonage, Exclure PIIA, Exclure dérogation) : la vue de travail par défaut | 73 | Juger ce que l’outil montre normalement |
| Passe 2 | Les mêmes, sans le filtre Précoce | 33 | Voir ce que le filtre Précoce masquait |
| Passe 3 | Aucun filtre | 17 | Repérer les faux négatifs et les faux positifs |

Passe 1 → 34 Pertinent, 15 À surveiller, 24 Non pertinent (bruit 24/73 = 32,9 %). Les 124 lignes = total des lignes de triage sur les trois passes (73 + 33 + 17, plus 1 cas hors radar), 51 villes sur 103.

## Glossaire

Les termes employés sans définition dans la suite du dossier, dans l'ordre où on les rencontre.

| Terme | Sens dans ce dossier |
|---|---|
| Signal | Un événement réglementaire détecté par le radar dans un document municipal (avis de motion, projet de règlement, résolution…), affiché sur la carte. |
| Passe 1, vue de travail | Ce que Steve voit chaque jour : ses cinq filtres cochés (Précoce, Résidentiel, Zonage, Exclure PIIA, Exclure dérogation), période de six mois. Dans son relevé du 21 septembre 2026 : **73 signaux**. Voir l'encadré du §2. |
| Passes 2 et 3 | Les mêmes vues avec moins de filtres : passe 2 sans le filtre Précoce (33 signaux de plus), passe 3 sans aucun filtre (17 de plus), pour voir ce que les filtres masquaient. |
| 124 lignes | La feuille Triage complète du classeur de Steve, toutes passes confondues : 73 + 33 + 17 + 1 hors radar. Une ligne n'est pas toujours un signal (la ligne #112 en traite deux). |
| Classement P / S / N | Le verdict de Steve sur chaque ligne : Pertinent (P), À surveiller (S), Non pertinent (N). |
| Motifs N-…, P-…, S-…, V2-… | Les 28 codes de Steve qui justifient un classement : P- pour Pertinent (ex. P-DENSITE), S- pour À surveiller, N- pour Non pertinent (ex. N-RESTRICTIF : la modification resserre), V2- pour hors de son périmètre actuel (V2-PRECEDENT : autorisation individuelle). |
| Règles R-…, constats C-… | Les 26 règles de classement (R-01 à R-26) et les 77 constats transversaux (C-01 à C-82) écrits par Steve dans son classeur. |
| Vues (profils) A, B, B′, C | Trois manières de choisir les signaux affichés. A : l'ancienne sélection, retirée de l'écran en août. B : la sélection affichée aujourd'hui ; B′ (« B prime ») est sa définition actuelle : zonage, résidentiel, étape précoce, sans les exclusions. C : la **proposition** de ce dossier, alignée sur les critères de Steve ; elle n'existe pas encore. |
| Profil A gelé | La sélection A conservée telle quelle, calculée côté serveur, comme point de référence historique : elle ne change plus et ne s'affiche plus. |
| Shadow (C en shadow) | C calculée par le serveur en parallèle de B, sur les mêmes données, sans être montrée aux utilisateurs ; on la compare à B avant de décider une bascule. |
| UAT | Recette en préproduction (« user acceptance testing ») : l'environnement où Farid valide avant mise en service. |
| Critères K1 à K9 | Les neuf critères proposés pour C (§9.2) : règlement d'urbanisme, résidentiel, sens de la modification, densification, plein droit, capacité de construire, décision et non simple point d'ordre du jour, étape, épinglage. |
| Filtre, exclusion | Case à cocher qui retire des signaux de la vue ; une exclusion retire une famille entière (par exemple les PIIA ou les dérogations). |
| PIIA | Plan d'implantation et d'intégration architecturale : règlement sur l'apparence des bâtiments, sans effet sur le nombre de logements. |
| PPCMOI | Projet particulier de construction, de modification ou d'occupation d'un immeuble : autorisation accordée à un projet précis, sur un terrain précis. |
| Dérogation (mineure) | Écart autorisé à une norme, pour un seul terrain. |
| CPTAQ | Commission de protection du territoire agricole du Québec ; le « dézonage » retire un secteur de la zone agricole. |
| ODJ | Ordre du jour d'une séance du conseil : un point inscrit n'est pas une décision. |
| PV, MRC | Procès-verbal d'une séance du conseil ; municipalité régionale de comté (regroupement de municipalités). |
| Annotation | Note ou verdict attaché à un objet du radar (ville, zone, lot, signal, règlement). |
| Ancre | La référence qui attache un retour de Steve à son objet : une ligne de la table annotation_cibles (ville + id texte du graphe, scène 2). |
| UUID, identifiant texte | UUID : identifiant aléatoire d'une ligne de base de données. Les signaux du graphe ont un identifiant texte (« signal-… ») ; l'API actuelle des notes exige un UUID, d'où le défaut corrigé par B0. |
| B0 et lots L1, L2, U1, O1, C1, C2 | Les étapes de mise en œuvre proposées (§7). B0 : petit correctif qui répare l'annotation des signaux (l'API accepte l'identifiant texte). L1 : tables et import ; L2 : API de lecture ; U1 : affichage ; O1 : jeu de référence de ciblage ; C1, C2 : sélection C puis bascule. |
| Tombstone | Marque laissée à la place d'un élément supprimé (qui, quand, pourquoi), au lieu de l'effacer physiquement ; exigée par la décision owner O1 du dossier COLLAB, à ne pas confondre avec l'objectif O1 ni le lot O1. |
| Jeu de référence (`ReferenceSet`) | Ancien nom : « oracle », abandonné (G1). Jeu de réponses de référence, vérifiées, qui sert **uniquement** à l'évaluation hors ligne du radar ou d'un modèle ; publié en **versions figées** (`ReferenceSetVersion`), partitions développement et test aveugle scellé ; porté par engram. |
| Jeu de référence E | Le jeu de référence d'extraction existant (674 unités committées, 676 en copie locale) : a-t-on bien extrait l'acte d'un procès-verbal ? `label_provenance` = `model_consensus` (« silver »). |
| Jeu de référence C | Le jeu de référence de ciblage proposé (#783), construit à partir des annotations validées de Steve : fallait-il montrer ce signal ? `label_provenance` = `human_single` pour le pilote (« gold » en construction). |
| `label_provenance`, gold, silver | Provenance des étiquettes : `human_single` (un humain), `human_adjudicated` (humains, désaccords tranchés : « gold »), `model_consensus` (consensus de modèles : « silver »), `mixed`. |
| sentropic, engram, track | Plateformes communes. sentropic porte l'humain (identités, commentaires, annotations, validations) ; engram porte la mesure (jeux de référence, runs, évaluateurs, garde de promotion) ; track porte les décisions (gel, promotion). §6.7. |
| Tags | Attributs qui expliquent un verdict (résidentiel, sens, densification, exclusions, type d'acte, motif) ; le verdict s'en dérive par une règle déterministe (§9.6). |
| κ (kappa) | Accord entre deux annotateurs corrigé du hasard (1 = accord parfait, 0 = hasard). |
| Benchmark | Campagne de mesure qui compare plusieurs modèles ou réglages sur le même jeu de référence (#782). |
| Précision, rappel, bruit | Précision : part des signaux affichés qui sont utiles. Rappel : part des signaux utiles qui sont affichés. Bruit : part des signaux affichés qui sont inutiles. |
| Seuil D13 | La règle chiffrée, à fixer par Farid (décision D13), au-delà de laquelle C remplace B à l'écran. |
| Design system (DS), composants geo | Bibliothèque commune de composants d'interface (boutons, badges, cartes) et de cartographie, partagée par les applications sentropic. |
| sentropic, contrat d'annotation | Plateforme commune ; son module de commentaires (comments) définit comment une annotation désigne sa cible. |
| MCP | Model Context Protocol : accès en lecture aux données du radar depuis un assistant (outils search_signals, query_zoning_events). |
| Cartes #nnn | Tickets GitHub du projet (#783 nouveau jeu de référence, #784 données de Steve…). |
| `non vérifié`, `source manquante`, `N-A` | Ce que le dossier n'a pas pu établir, faute d'accès ou de source. |

---

## 1. Intention du dossier, objectifs de l'owner

Reformulation de la demande de l'owner, avant toute modélisation. Chaque objectif renvoie à l'endroit du dossier qui y répond.

| # | Objectif de l'owner | Où le dossier y répond | Décisions |
|---|---|---|---|
| O1 | Stocker **tous** les retours de Steve en base (données du tableur), chacun **attaché à l'élément associé** (ville, zone, signal, lot…), selon l'annotation prévue (#784, contrat d'ancre). | §6.3 (modèle minimal : fichiers, lignes, motifs, cibles 1 à N, versions de jeu de référence), §6.4 (ancres par type d'objet), §6.5 (import idempotent, aucune ligne rejetée) ; scène `modele-donnees` | D1, D2, D3 |
| O2 | **Finaliser la modélisation** et proposer une **première mise en œuvre**, en base et dans l'interface (UI), qui respecte le **contrat sentropic d'annotation et de canevas**. | §6.1 (contrat sentropic lu dans le code), §6.3 (modèle minimal à partir des besoins de Steve), §7 (lots B0, L1, L2, U1, O1, C1, C2) ; scènes `modele-donnees` et `flux-import-oracle` | D2, D4, D5, D6, D14, D15 |
| O3 | Faire un **focus sur l'état de la migration** vers l'UI de base (composants geo et design system). | §8 (mesures sur `origin/main`, ce qui conditionne l'UI des annotations) ; scène `architecture-ui` | D14 |
| O4 | Prendre en compte l'**analyse de Steve**, qui réoriente le ciblage : remettre en place un **jeu de référence** qui détecte ses besoins et s'y aligne ; prévoir peut-être une **double annotation** (ancienne / nouvelle) et un **mécanisme d'affichage A/B étendu en C** (on était déjà sur B). | §2 (ce que veut Steve, écart avec l'existant), §9.2 (critères C), §9.3 (jeu de référence #783), §6.6 (double annotation), §9.5 (A/B/C) ; scènes `criteres-steve` et `affichage-abc` | D7, D8, D9, D10, D11, D12, D13, D16 |

Les objectifs O1 à O4 n'emploient aucun terme technique ; les termes repris ensuite sont expliqués dans le glossaire, en tête du dossier.

Contraintes de forme : 0 Python (Node/TS uniquement) ; aucune action prod ou cluster ; aucun chiffre inventé (`non vérifié`, `source manquante`, `N-A` quand la source manque).

### 1.1 Destinataires et rôles

Ce dossier s'adresse à **Farid**. Il est rédigé pour le produit ; la partie technique y figure pour validation par **Fabien**.

| Personne | Rôle | Ce qu'on attend de lui dans ce dossier |
|---|---|---|
| Steve Chaperon | Client (financeur) et utilisateur principal | Ses retours sont la matière du dossier ; il est consulté sur ses critères et les cas ambigus (D7, D8). |
| Mathieu Portier | Product Manager : oriente | Consulté sur les orientations produit (priorités, exposition de la nouvelle sélection, retour à Steve). |
| Farid | Product Owner / proxy : définit et valide le backlog | **Décide** le produit, le backlog et les priorités : 9 décisions (D5, D6, D7, D8, D12, D13, D14, D15, D16). |
| Fabien | AI Builder : propriétaire du code, garant de la livraison | **Valide** l'architecture, les algorithmes d'IA, les modèles, le jeu de référence et la modélisation technique : 15 décisions, les huit génériques G1 à G8 (§6.7) et sept décisions immo (D1, D2, D3, D4, D9, D10, D11) ; **D1 est actée par l'owner le 2026-10-04** (tout conserver). |

Chaque décision porte la mention « Décide : … · Consulté : … » (§3 et §10).

### 1.2 Termes utilisés

Tous les termes et sigles employés dans le dossier sont définis dans le **glossaire**, en tête du dossier.

---

## 2. Ce que veut Steve

Sources : `Analyse Radar 21 sept.docx` (citations entre guillemets, avec la section de l'analyse) et `radar-triage-signaux.xlsx` (recomptes sur la feuille Triage ; passe 1 = la vue de travail de Steve, cinq filtres cochés, 73 signaux).

> **Passe 1, 124 lignes : de quoi parle-t-on ?**
>
> - **Qui, quand, sur quoi.** Steve Chaperon a relevé le 21 septembre 2026 les signaux que le radar lui affichait pour la période du 15 au 21 septembre, avec une période d'affichage réglée sur six mois. Il a travaillé depuis l'interface et les outils MCP en lecture, sans accès au code, et a trié 51 municipalités sur 103 (§4, §5.1).
> - **Trois passes, selon sa règle R-26.** **Passe 1** : sa vue de travail quotidienne, ses cinq filtres cochés (Précoce, Résidentiel, Zonage, Exclure PIIA, Exclure dérogation) : **73 signaux**. Passe 2 : les mêmes sans le filtre Précoce : 33 signaux de plus. Passe 3 : aucun filtre : 17 de plus, pour repérer ce que les filtres cachaient à tort ou laissaient passer. Un cas est hors radar.
> - **« 124 lignes ».** La feuille Triage complète, toutes passes confondues : 73 + 33 + 17 + 1 = 124. Une ligne n'est pas toujours un signal : la #112 en traite deux, la #55 décrit un dossier absent du radar.
> - **Comment lire les chiffres.** « Passe 1 » mesure ce que Steve voit chaque jour : c'est là que se mesure le bruit (24 sur 73). « 124 lignes » couvre tout ce qu'il a examiné, y compris ce que ses filtres masquaient.

### 2.1 Le principe : appartenance, pas classement

> « Un signal m'intéresse quand les trois conditions suivantes sont réunies. Pas deux sur trois - les trois. » (analyse, §1)

> « Tout ce qui ne réunit pas ces trois conditions est du bruit pour moi, et je ne devrais pas le recevoir. Ce n'est pas une question de hiérarchie entre les signaux : c'est une question d'appartenance ou non au périmètre. » (analyse, §1)

### 2.2 Les trois critères de ciblage

**Critère 1 — Résidentiel.**
> « Le règlement touche l'habitation. Pas le commercial, pas l'industriel, pas l'institutionnel, pas l'agricole (sauf en cas de dézonage par la CPTAQ), pas le récréatif. » (analyse, §1)

Il inclut, en amont, que l'acte soit un règlement d'urbanisme : « Reconnaître qu'un règlement n'est pas un règlement d'urbanisme. Matières résiduelles, gestion contractuelle, règlement d'emprunt, programme de subvention - ces règlements existent dans toutes les municipalités du Québec et reviendront partout. » (analyse, §5) Règles associées : R-18 (exception CPTAQ résidentielle).

| Mesure (CALCUL, tableur) | Passe 1 | 124 lignes |
|---|---:|---:|
| Non pertinent, motif N-NON-RES (zonage non résidentiel) | 1 | 6 |
| Non pertinent, motif N-FAUX-POSITIF (pas un règlement d'urbanisme) | 2 | 4 |
| Familles de l'analyse : « pas des règlements d'urbanisme » | 4 sur 24 | — |

« Ils occupaient à eux seuls toute la vue principale de leur municipalité. » (analyse, §3, à propos de Saint-Louis-de-Gonzague, Saint-Roch-de-Richelieu, Delson, Pointe-Claire.)

**Critère 2 — Assouplissement des règles.**
> « La modification ouvre, elle ne resserre pas. Un règlement qui réduit une hauteur, restreint un usage ou impose une nouvelle contrainte ne m'intéresse pas. » (analyse, §1)

> « Déterminer le sens de la modification. Le verbe du titre suffit le plus souvent : afin de permettre, afin d'autoriser, afin d'agrandir d'un côté ; afin d'interdire, afin de limiter, afin de préserver de l'autre. » (analyse, §5)

Avec une réserve explicite : « Quand le sens d'une modification n'est pas déterminable, le signal doit rester affiché. Masquer par défaut ce qui n'a pas pu être lu transformerait une lacune en dossier manqué, et c'est le risque que je ne peux pas prendre. Même chose pour un règlement qui resserre d'un côté et ouvre de l'autre : il y en a cinq dans mon relevé, et aucun ne doit disparaître. » (analyse, §5)

| Sens de la modification (CALCUL) | Passe 1 | 124 lignes | dont Pertinent / À surveiller / Non pertinent (124) |
|---|---:|---:|---|
| Assouplissement | 35 | 55 | 27 / 5 / 23 |
| Indéterminé | 21 | 38 | 7 / 21 / 10 |
| Restriction | 6 | 10 | 0 / 3 / 7 |
| Mixte | 5 | 7 | 5 / 0 / 2 |
| Neutre | 6 | 14 | 1 / 0 / 13 |
| Motif N-RESTRICTIF (resserrement) | 4 | 7 | Non pertinent |

<!-- chart:sens-classement -->

**Critère 3 — Densification.**
> « Le résultat est plus d'unités que le règlement en permettait avant. C'est le critère qui tranche : un assouplissement résidentiel qui ne change pas le nombre d'unités possibles ne m'apporte rien. » (analyse, §1)

> « Reconnaître qu'un règlement d'urbanisme ne touche pas la capacité de construire. Clôtures, cabanons, enseignes, structures de jardin : ce sont des règlements de zonage, mais ils ne changent aucun nombre d'unités. » (analyse, §5)

| Mesure (CALCUL) | Passe 1 | 124 lignes |
|---|---:|---:|
| Pertinent, motifs P-DENSITE + P-USAGE-MULTI (hausse de densité, multilogement) | 13 | 16 |
| Non pertinent sans effet sur la capacité : N-ADMIN, N-FORME, N-UNIFAM, N-ACCESSOIRE | 6 | 13 |
| Familles de l'analyse : « urbanisme sans effet sur la capacité » | 4 sur 24 | — |
| Passe 1 où le critère n'est pas qualifiable (analyse : « sens non donné » 12 + « portée ou ampleur non identifiables » 15) | 27 | — |

**Deux règles d'exclusion transversales**, posées par Steve à côté des trois critères :
- « Distinguer une décision d'un point d'ordre du jour. Un point inscrit à l'ordre du jour n'est pas une décision du conseil. » (analyse, §5) — N-ODJ-SEUL : 3 en passe 1, 4 au total.
- « Distinguer une règle générale d'une autorisation individuelle. Un PPCMOI ou une dérogation accordés à un demandeur pour un immeuble précis ne créent de droit pour personne d'autre. » (analyse, §5) — V2-PRECEDENT : 8 en passe 1, 21 au total, tous Non pertinent (« hors de mon périmètre actuel », analyse, §3).

Bilan de la passe 1 (CALCUL, recompté par motif) : les 24 Non pertinent se répartissent en **3** hors résidentiel ou hors urbanisme, **4** resserrements, **6** sans effet sur la capacité, **11** hors portée (8 autorisations individuelles, 3 points d'ordre du jour). 22 signaux réunissent les trois critères ; 27 ne sont pas qualifiables avec l'information servie.

<!-- chart:bruit-familles -->

### 2.3 Écart avec l'existant, critère par critère

Existant lu sur `origin/main` `27891b10` : vue A retirée de l'UI depuis `f2c20573` (comptes encore calculés côté serveur) ; vue B′ = `!exclusion && zonage && residentielEligible && precoce` ; classification `vivier_v2` par axes zonage / résidentiel / étape, avec un champ d'effet (`densifie`, `reduit`, `stable`, `inconnu`) ; exclusions d'affichage PIIA et dérogation ; jeu de référence v3 (674 unités committées, 676 en copie locale) qui note l'extraction d'actes.

| Critère de Steve | Ce que fait le radar aujourd'hui | Couverture | Effet mesuré sur la vue de travail (passe 1) |
|---|---|---|---|
| 1. Résidentiel (et règlement d'urbanisme) | Filtre Résidentiel : `res=oui`, ou `res=indetermine` ∧ instrument ∈ {rezonage, refonte} ; `res` par marqueurs regex ; filtre Zonage par catégorie et étape. Aucune reconnaissance de la nature de l'acte : un règlement de matières résiduelles typé `rezonage` passe. | **Partiel** | 3 signaux hors résidentiel ou hors urbanisme affichés (codes) ; 4 selon l'analyse. Commentaire #761 : « résidentiel et zonage ne sont pas utiles pour Steve ». |
| 2. Assouplissement | Aucun champ « sens » dans `vivier_v2` ni dans B′ ; aucun filtre. | **Absent** | 6 restrictions affichées, dont 4 Non pertinent (N-RESTRICTIF) ; 21 indéterminés que le radar ne qualifie pas. |
| 3. Densification | Champ d'effet présent mais toujours `inconnu` ; `nb_unites_max` partiel ; le contrat B′ précise que l'appartenance au vivier « ne prouve pas une hausse de densité ». | **Absent** | 6 signaux sans effet sur la capacité affichés ; 27 non qualifiables (sens ou ampleur non donnés). |
| Exclusion « autorisation individuelle » | Exclusions PIIA (sans preuve résidentielle) et dérogation ; PPCMOI, usage conditionnel, Loi 31 et CPTAQ individuelle ne sont pas exclus. | **Partiel** | 8 autorisations individuelles affichées (V2-PRECEDENT). |
| Exclusion « point d'ordre du jour » | Aucune distinction ODJ / décision dans les propriétés lues. | **Absent** | 3 points d'ordre du jour affichés (Mont-Tremblant). |
| Ne rien masquer d'illisible (réserve) | B′ garde le résidentiel indéterminé pour certains instruments ; pas de notion de sens ni de mixte. | **Partiel** | 34 des 40 Pertinent sont dans la vue de travail (85 %) ; 6 n'apparaissent qu'en passe 2 ou 3 ; 7 dossiers manqués alors que « l'information existait dans la base du radar » (analyse, §4). |
| Mesure de tout cela | Le jeu de référence 674/676 note l'extraction (étape + citation) sur 100 procès-verbaux (PV) ; aucun jeu de référence ne note le ciblage ni le post-filtrage. | **Absent** | Bruit de la vue de travail : 24/73 = **32,9 %** ; précision « trois critères » : 22/73 = **30,1 %** ; précision P ∪ S : 49/73 = 67,1 %. |

**Lecture (JUGEMENT).** Le radar actuel filtre par **nature d'instrument et étape** ; Steve demande un filtre par **effet du règlement** (sens et nombre d'unités). Deux des trois critères n'ont aujourd'hui aucune donnée, ce qui explique que C demande une extraction nouvelle (§9.2) et un jeu de référence de ciblage distinct (§9.3). Scène `criteres-steve` : les critères de Steve en regard de l'existant.

---

## 3. Synthèse et décisions demandées

**Recommandation globale (JUGEMENT).** Conserver intégralement les sources de Steve, les rattacher aux objets métier par des ancres durables, afficher son verdict en lecture seule dans les panneaux existants, construire un jeu de référence de ciblage distinct du jeu de référence d'extraction, puis développer une vue C mesurée contre B. B reste le défaut jusqu'à une bascule fondée sur la mesure. Tout cela reste subordonné à la priorité n° 1 de Steve : le rafraîchissement (#703, #786, #788).

| Sujet | Constat déterminant | Recommandation |
|---|---|---|
| Ce que Steve a livré | **FAIT.** 7 feuilles : 124 lignes de triage (51 villes sur 103), 121 contrôles d'exclusion, 77 constats, 26 règles, 28 codes de motif ; une analyse qui pose trois critères cumulatifs. | Tout importer, sans supposer « une ligne = un signal ». |
| Qualité de la vue de travail | **CALCUL.** Passe 1 (73 lignes) : 34 Pertinent, 15 À surveiller, 24 Non pertinent. L'analyse en retient 22 qui réunissent les trois critères. | Le défaut principal est le bruit (24/73 = 32,9 %) ; le rappel est secondaire. |
| Annotation de signal existante | **FAIT.** L'UI envoie l'identifiant texte du graphe ; l'API (le serveur) exige un UUID, identifiant aléatoire de l'ancienne table signals (`prospect-marks.ts:107`). | Correctif B0 avant tout import. |
| Contrat sentropic | **FAIT.** Les cibles `record` conviennent sans changement du paquet ; `delete` est une suppression physique dans la 0.2.0 publiée, alors que l'owner a ratifié une suppression qui laisse une trace (tombstone) et une durée de rétention (décision O1 du dossier COLLAB). | Lecture conforme, import immuable, aucun chemin de suppression par le paquet tant qu'il n'a pas de tombstone. |
| UI | **FAIT.** 39 composants Svelte sur 69 importent le DS ; les 3 composants d'annotation n'en importent aucun ; la carte Signaux reste MapLibre local. | Afficher dans le panneau et le rail avec le DS, sans attendre la migration geo. |
| Ciblage C | **FAIT.** Aucun champ « sens » ; `effet_densifiant` toujours `inconnu` ; ni « de plein droit », ni « ODJ / décision ». | C demande une extraction nouvelle, mesurée sur un jeu de référence de Steve. |
| Jeu de référence | **FAIT.** Le jeu de référence v3 (674 unités committées, 676 en copie locale) mesure l'extraction d'actes, pas le ciblage. | Deux jeux de référence distincts : extraction (E) et ciblage (C). |

### Décisions demandées (D1 à D16)

**Ordre de décision.** Fabien décide d'abord les huit décisions génériques G1 à G8 (convergence sentropic + engram, §6.7 : terminologie, porteurs, versions, rôles, scellement, promotion, séquencement, BPMN), puis ses sept décisions techniques immo (D1, D2, D3, D4, D9, D10, D11 : conservation, architecture, données, IA, jeu de référence) ; **D1 est déjà actée par l'owner le 2026-10-04 (tout conserver)**, les autres sont prises telles quelles, sauf incohérence avec une autre décision. Farid décide ensuite ses neuf décisions produit (D5, D6, D7, D8, D12, D13, D14, D15, D16 : backlog, affichage, priorités), en connaissant les choix de Fabien. Si un choix de Farid contredit un choix de Fabien, on revient à Fabien sur ce seul point. Steve et Mathieu sont consultés là où leur avis porte. Les dépendances entre décisions sont indiquées au §10 (« Dépend de », « Conditionne »).

| Étape | # | Décision | Décide · Consulté | Option recommandée | Alternatives |
|---|---|---|---|---|---|
| 1 · Fabien (générique) | G1 | Terminologie et provenance | **Fabien** · Farid | **(c)** « jeu de référence » + `label_provenance` | (a) garder « oracle » avec une définition locale ; (b) gold / vérité terrain |
| 1 · Fabien (générique) | G2 | Porteurs et forme de l'annotation | **Fabien** · Farid | **(b)** paquet frère `@sentropic/annotations` | (a) domaine ; (c) étendre comments ; (d) h2a / track ; (e) engram en fichiers |
| 1 · Fabien (générique) | G3 | Version et effacement | **Fabien** · Farid | **(a)** révisions immuables, validation liée au hash, tombstone | (b) état modifiable + audit ; (c) journal pur |
| 1 · Fabien (générique) | G4 | Autorité de validation et rôles | **Fabien** · Farid | **(a)** attributions par (workspace, profil), agents en proposition | (b) rôles de workspace ; (c) machine seule |
| 1 · Fabien (générique) | G5 | Scellement et stockage | **Fabien** · Farid | **(a)** procédural en v1 ; (b) ou (c) pour une bascule | (b) chiffrement ; (c) service de notation |
| 1 · Fabien (générique) | G6 | Règle de promotion | **Fabien** · Farid | **(a)** gabarit préenregistré, décision track, garde engram | (b) règle libre ; (c) recette seule ; (d) seuil automatique |
| 1 · Fabien (générique) | G7 | Séquencement, tables immo, pilote C | **Fabien** · Farid | **(b)** générique d'abord, immo premier adoptant | (a) tables immo puis migration ; (c) attente sans borne |
| 1 · Fabien (générique) | G8 | BPMN | **Fabien** · Farid | **(a)** garder le producteur, adopter l'évaluation | (b) extraction par engram ; (c) reporter BPMN |
| 1 · Fabien | D1 | Périmètre de conservation | **Fabien** · Farid, Steve, Mathieu | **Tranchée, actée par l'owner le 2026-10-04 : (b)** tout le classeur et l'analyse, brut immuable | (a) Triage seul ; (c) notes libres seules |
| 1 · Fabien | D2 | Modèle de données immo : adoption du générique | **Fabien** · Farid | **(a)** immo = profil + données, aucune table immo | (b) six tables immo puis migration ; (c) table de contrôle seule ; (d) attendre sans borne |
| 1 · Fabien | D3 | Ancre signal et correctif | **Fabien** · Farid | **(a)** clé texte namespacée sans clé étrangère + instantané observé ; B0 immédiat | (b) attendre une clé métier stable ; (c) passer par l'UUID `signals` |
| 1 · Fabien | D4 | Conformité sentropic et suppression | **Fabien** · Farid | **(a)** cibles, lecture et événements conformes ; import immuable ; réponses dans `prospect_notes` v1 ; demande de tombstone à sentropic | (b) adaptateur `CommentStore` à tombstone hôte ; (c) attendre le port complet |
| 1 · Fabien | D9 | Sens de « double annotation » | **Fabien** · Farid | **Point ouvert** — lecture proposée : verdict Steve source + ancienne classification radar + adjudication C + prédiction C | ancienne / nouvelle grille de Steve ; jeu de référence 676 / jeu de référence Steve |
| 1 · Fabien | D10 | Jeu de référence #783 | **Fabien** · Steve, Farid | **Double jeu de référence E / C** ; unité signal regroupée par dossier ; développement 51 villes, test 52 villes, partition par dossier | remplacer v3 par le tableur ; campagne C entièrement nouvelle |
| 1 · Fabien | D11 | Benchmark #782 | **Fabien** · Farid | **Volet ciblage séparé** ; enrichir le contrat d'extraction = nouvelle version, décision dédiée | fusion des métriques ; statu quo |
| 2 · Farid | D5 | Auteur des retours importés | **Farid** · Steve, Fabien | **(c)** compte Steve, pour l'import et la saisie ; importateur tracé à part | (a) auteur documentaire externe + importateur tracé ; (b) importateur seul comme auteur |
| 2 · Farid | D6 | Visibilité et données personnelles | **Farid** · Steve, Mathieu, Fabien | **(c)** utilisateurs approuvés, verbatims caviardés | (a) tous les approuvés sans caviardage ; (b) administrateurs et Steve |
| 2 · Farid | D7 | Définition de C v1 | **Farid** · Steve, Mathieu, Fabien | **K1–K9 (neuf critères, §9.2) + trois états** : confirmé, à instruire, exclu prouvé | triplet strict ; tri seulement |
| 2 · Farid | D8 | Cas contradictoires | **Farid** · Steve, Mathieu | **Revue métier** par Steve et Mathieu ; abstention explicite en attendant | arbitrage par l'équipe ; statu quo |
| 2 · Farid | D12 | Exposition A/B/C | **Farid** · Steve, Mathieu, Fabien | **Point ouvert** — recommandation consolidée : C en shadow (calculée en parallèle, invisible des utilisateurs) + mode comparatif réservé à l'UAT (recette en préproduction) ; B défaut | sélecteur A/B/C visible ; incréments dans B ; application C séparée |
| 2 · Farid | D13 | Seuil de bascule B → C | **Farid** · Steve, Mathieu, Fabien | **À fixer par Farid** — proposition : aucun Pertinent masqué sur le jeu test, précision P ∪ S > B, parité des ensembles | seuil chiffré différent ; bascule sur recette seule |
| 2 · Farid | D14 | Première livraison UI | **Farid** · Mathieu, Fabien | **(a)** panneau + rail + DS ciblé ; pastilles carte plus tard | (b) pastilles sur la carte actuelle dès L3 ; (c) migration geo d'abord ; (d) tableau séparé seul |
| 2 · Farid | D15 | Séquencement | **Farid** · Mathieu, Fabien | **(a)** B0, import et jeu de référence en parallèle de la fraîcheur ; C1 après stabilisation du rafraîchissement | (b) tout après #703 |
| 2 · Farid | D16 | Retour à Steve | **Farid** · Mathieu | **Oui** : renvoyer la définition réelle des filtres et la table de dérivation, par Mathieu et Farid | ne rien renvoyer avant C |

Les options, leurs meilleurs arguments contraires et les conditions qui feraient changer la recommandation figurent au §10.

---

## 4. Contexte

- **FAIT.** Steve Chaperon (Chaperon Immobilier) a préparé le 21 septembre 2026 un relevé sur la période du 15 au 21 septembre. La transmission par Mathieu Portier, puis Farid le 27 septembre, provient du mandat de l'owner ; le courriel original est `source manquante`.
- **FAIT.** Le relevé repose sur ce qu'affiche l'interface et sur les outils MCP (Model Context Protocol) en lecture (`search_signals`, `query_zoning_events`). Steve écrit qu'il n'a pas eu accès au code et que la majorité des procès-verbaux n'ont pas été contre-vérifiés à la source.
- **FAIT.** Protocole en trois passes (règle R-26), période réglée sur 6 mois :
  1. passe 1 : les cinq filtres cochés (vue de travail) ;
  2. passe 2 : sans le filtre Précoce ;
  3. passe 3 : aucun filtre, pour repérer faux négatifs et faux positifs.
- **FAIT.** Les colonnes « Classement » (valeur pour Steve) et « Filtrage » (le filtre avait-il raison ?) sont indépendantes.
- **FAIT.** Priorités de Steve, dans l'ordre : rafraîchir les signaux ; enlever le bruit ; une interface plus simple pour archiver, classer, lier et épingler.
- **FAIT.** #783 et #784 n'ont ni corps ni commentaire : leur titre est tout le cadrage. #760 et #761 attendaient « le document d'analyse de Steve » ; il est disponible, sans que leurs autres critères soient clos pour autant.
- **FAIT.** Commentaire de `fbellame` sur #761 : « résidentiel et zonage ne sont pas utiles pour Steve. Précoce ne sera plus nécessaire lorsque la mise à jour des signaux sera quotidienne. »

### 4.1 Précédents à respecter

| Date | Source | Ce qui s'impose ici |
|---|---|---|
| 2026-06-11 | `SPEC_CONTROLE_PARITE_VILLES_STEVE.md` (main) | Un corpus de Steve va dans une table de contrôle séparée du store opérationnel : la parité « mesure le pipeline, elle ne le nourrit jamais ». Implémentation sur `main` : non trouvée. |
| 2026-08-12 | `SPEC_RAW_STEVE_MEETING_2026-08-12.md` (main) | Cibles annotables ville, signal, zone, lot, règlement. Réutiliser le modèle de commentaires sentropic, « pas de système parallèle ». |
| 2026-08-16 | `DOSSIER_DECISION_COLLAB_2026-08-16.md` (`origin/lane/conductor`, absent de `main`) | Décisions owner ratifiées : cible = objet métier ; suppression = tombstone + rétention (O1). « Le paquet porte l'intégrité » : un tombstone porté seulement par un adaptateur Radar est un piège. Tout chemin de suppression attend une version du paquet avec tombstone. Statut actuel du fichier hors `main` : `non vérifié`. |
| v1 | `SPEC_CONTRAT_ANCRE_ANNOTATIONS_v1.md` + migration 0011 (main) | Cibles `lot` et `signal` ; `signal_id` UUID `ON DELETE SET NULL` ; lecture par les approuvés, mutation par l'auteur ; suppression logique ; `tenant_id` inerte. Le §3.1 admet l'absence d'identité de signal stable à la ré-ingestion. |
| 2026-10-01 | #787, règles de partage validées par l'owner | Une URL avec un paramètre `filter.*` décrit tout l'état. Item 4 du comportement attendu : « sans réintroduire de choix entre plusieurs viviers ». |

### 4.2 Ce qui manque et ne doit pas être masqué

- Maquette de l'interface simplifiée annoncée par Steve et Mathieu : non fournie.
- Taux de résolution des identifiants de Steve contre le graphe actuel : `non vérifié` (aucune requête prod ou préprod).
- SHA déployé du 15 au 21 septembre : `non vérifié` (`30-api.yaml` utilise `:latest`).
- Classification serveur exacte au moment du relevé : non archivée (`source manquante`).

---

## 5. Retours de Steve, chiffrés

### 5.1 Inventaire du classeur

**FAIT.** 7 feuilles visibles, 433 lignes ayant au moins une valeur, 4 392 cellules non vides, 47 cellules de formule, aucun hyperlien Excel.

| Feuille | Contenu mesuré | Usage à l'import |
|---|---|---|
| Triage | 124 lignes (Excel 6–129), 20 colonnes A:T toutes renseignées, 51 municipalités | Évaluations individuelles ou groupées |
| Écartés par les filtres | 121 lignes (5–125), 8 colonnes, 46 municipalités ; certaines lignes regroupent plusieurs enregistrements | Évaluations d'exclusion, dont lignes agrégées |
| Constats transversaux | 77 constats C-01…C-82 (numéros absents : 40, 50, 62, 70, 71), 7 colonnes | Constats rattachés aux villes ou à un artefact |
| Règles de classement | 26 règles R-01…R-26 | Référentiel daté et sourcé |
| Codes de motif | 28 codes (8 P-, 8 S-, 11 N-, 1 V2-) | Dictionnaire ; 24 codes employés |
| Synthèse | 45 formules, **toutes avec une valeur mémorisée** | Conserver formule et valeur ; recalculer à part |
| Villes à couvrir | 51 traitées sur 103, 124 triés sur 146 captés ; pas de liste nominative des 52 restantes | Comptes déclarés |

« 124 signaux » est le libellé de Steve ; « 124 lignes » est la mesure reproductible. La ligne #112 traite deux signaux, la #7 nomme deux événements, la #55 décrit un dossier absent du radar.

### 5.2 Classement par passe (CALCUL, feuille Triage)

| Passe | Pertinent | À surveiller | Non pertinent | Total |
|---|---:|---:|---:|---:|
| 1 — 5 filtres | 34 | 15 | 24 | **73** |
| 2 — sans Précoce | 4 | 11 | 18 | 33 |
| 3 — reste | 2 | 3 | 12 | 17 |
| Hors radar | 0 | 0 | 1 | 1 |
| **Total** | **40** | **29** | **55** | **124** |

<!-- chart:classement-passes -->

Ce sont des distributions d'annotations, pas une précision ni un rappel du système. 34 des 40 Pertinent sont en passe 1, 38 en passe 1 ou 2.

### 5.3 Sens de la modification × classement (CALCUL)

| Sens | Pertinent | À surveiller | Non pertinent | Total | dont passe 1 |
|---|---:|---:|---:|---:|---:|
| Assouplissement | 27 | 5 | 23 | 55 | 35 |
| Indéterminé | 7 | 21 | 10 | 38 | 21 |
| Neutre | 1 | 0 | 13 | 14 | 6 |
| Restriction | 0 | 3 | 7 | 10 | 6 |
| Mixte | 5 | 0 | 2 | 7 | 5 |

Lecture (JUGEMENT) : 23 assouplissements sont Non pertinent, surtout des autorisations au cas par cas (V2-PRECEDENT). Le sens seul ne suffit pas : il faut aussi « de plein droit » (R-06). Trois restrictions sont À surveiller (S-RESTRICTIF), ce qui tempère R-21.

### 5.4 Motifs, exclusions et constats

| Motif le plus employé | Lignes | Motif | Lignes |
|---|---:|---|---:|
| V2-PRECEDENT | 21 | N-RESTRICTIF | 7 |
| P-VILLE-TERRITOIRE | 13 | N-NON-RES | 6 |
| S-PORTEE-FLOUE | 10 | N-ACCESSOIRE | 5 |
| P-USAGE-MULTI, P-DENSITE, S-INFO-MANQUANTE | 8 chacun | P-PERIM-URB, P-NOUV-ZONE, N-FAUX-POSITIF, N-ODJ-SEUL, N-FORME | 4 chacun |

Codes jamais employés : P-TYPO-INTERM, N-RETIRE, N-DOUBLON, N-HORS-TERR.

| Verdict « Écartés par les filtres » | Lignes |
|---|---:|
| Écarté à raison | 102 |
| Absent de l'UI | 6 |
| Typage fautif — hors fenêtre | 4 |
| Écarté — non vérifiable | 3 |
| Écarté à tort — faux négatif | 3 |
| Typage fautif — filtrage correct | 2 |
| Capté à tort — faux positif | 1 |
| **Total** | **121** |

102/121 n'est pas un rappel : des lignes décrivent des groupes ou des cas déjà présents dans Triage.

| Gravité des constats | Lignes | Périmètre | Lignes |
|---|---:|---|---:|
| Question | 20 | V1 | 67 |
| Confort | 19 | Info | 5 |
| Erreur vérifiée | 18 | V2 — pour mémoire | 4 |
| Exigence | 9 | V2 | 1 |
| Info | 7 | | |
| V2 | 4 | | |

Le bandeau de la feuille indique encore « 3 sur 25 » erreurs vérifiées : texte ancien, incohérent avec les 18 lignes actuelles.

**Qualité du filtrage (Synthèse, valeurs mémorisées)** : Correct 88, Fuite 25, Anomalie 7, À vérifier 3, Non évalué 0, soit 123 sur 124. Un regroupement par préfixe des 81 libellés libres de la colonne O donne 88 / 25 / 8 / 3 en rangeant ANOMALIE, ABSENT et SORTI DE LA VUE ensemble ; l'écart d'une ligne tient à ce regroupement.

### 5.5 Ce que dit l'analyse, rapprochée du tableur

| Catégorie de l'analyse (passe 1) | Analyse | Reconstitution par le tableur | Tableur |
|---|---:|---|---:|
| Trois critères réunis | 22 | Pertinent ∧ sens = Assouplissement | 22 |
| Résidentiel, portée générale, sens non donné | 12 | Pertinent ∧ sens ∈ {Indéterminé 6, Mixte 5, Neutre 1} | 12 |
| Portée ou ampleur non identifiable | 15 | À surveiller | 15 |
| Hors critères | 24 | Non pertinent | 24 |

**CALCUL, recompté.** La correspondance est exacte en effectifs. L'analyse n'énonce pas la règle de passage : le rangement des 5 « Mixte » dans « sens non donné » reste une reconstitution, à confirmer par Steve (D8).

Apports de l'analyse :
- **Trois critères cumulatifs** : résidentiel, assouplissement, densification (« pas deux sur trois — les trois ») ; la densification exige plus d'unités qu'avant.
- **Cinq exclusions** : pas un règlement d'urbanisme ; pas d'effet sur la capacité de construire ; sens restrictif ; point d'ordre du jour et non décision ; autorisation individuelle et non règle générale.
- **Réserve d'asymétrie** : un sens indéterminé reste affiché, un règlement mixte ne disparaît jamais (R-13, R-21, C-57, C-66).
- **Sept dossiers manqués** alors que « l'information existait dans la base » : Saint-Michel (36 logements, résumé tronqué), Richelieu, Deux-Montagnes 1770, Mascouche 1103-81, Sainte-Anne-des-Plaines 1079-1, Saint-Jérôme 0351-006, Saint-Gilbert U-161-2026 (affiché comme projet alors qu'il est en vigueur).
- **Interface souhaitée** : archiver sans supprimer ; classer ; lier les signaux d'un même règlement ou secteur ; garder en alerte (épingler hors période, notifier à chaque étape).
- **Suite** : 52 municipalités restent à relever selon la même méthode.

Écarts internes à ne pas lisser : la famille « autorisations individuelles » annonce six signaux puis cite sept municipalités ; l'analyse nomme 21 ou 22 cas pour 24 annoncés. **Le tableur fait foi pour l'import** ; l'analyse est conservée comme annotation distincte.

### 5.6 Exigences techniques des constats (sélection)

| Constat | Exigence | Carte |
|---|---|---|
| C-21, C-57, C-66 | Le sens devient un filtre coché par défaut qui masque le purement restrictif ; étiqueté par disposition ; « indéterminé » distinct de « neutre », toujours visible ; un restrictif masqué n'emporte pas l'étape d'un dossier visible. | C, #761 |
| C-15, C-26, R-07 | Lier les étapes d'un même règlement avec correction manuelle, sans fusion ; `reglement_number` vide ou incohérent (« 026-509 » / « 2026-509 »). | #760 |
| C-69, R-25 | Épingler un dossier et une municipalité, hors période, avec notification. | #760 |
| C-72 | Ampleur chiffrée : logements, densité, hauteur, avant et après. | extraction |
| C-82 | Le second projet est la dernière fenêtre avant le registre référendaire ; exclu de Précoce. | #761 |
| C-49, C-34 | Enregistrements servis par l'API et rendus dans aucune vue ; cause inconnue. | #761 |
| C-79 | Noms de particuliers en clair dans des résumés de signaux ; caviardage demandé. | conformité |
| C-81 | Municipalités introuvables par leur nom (slug désambiguïsé par la MRC, municipalité régionale de comté). | import, MCP |

### 5.7 Filtres reconstitués par Steve (R-16), confrontés au code

Lecture du code `27891b10` ; les causes sont des hypothèses de lecture, non exécutées, et le code peut différer de celui déployé en septembre.

| Filtre | Observé par Steve | Définition dans le code | Lecture (JUGEMENT) |
|---|---|---|---|
| Précoce | Retient avis_motion, projet_reglement, un ppcmoi mais pas un autre | `etape ∈ {avis_motion, projet_reglement}` ; étape annotée, sinon dérivée par mots-clés (`vivier-view-mode.ts`, `graph-store.ts`) | Étape dérivée différemment selon le texte ; second projet exclu par construction (C-82). |
| Résidentiel | « Se prononce sur le type et rien d'autre » ; fuites non urbanistiques | `res=oui` ou `res=indetermine` ∧ instrument ∈ {rezonage, refonte} (`radar-domain/src/vivier/counts.ts`) | Un règlement de matières résiduelles typé `rezonage` passe par l'instrument. |
| Zonage | Semble laisser tomber `densification_residentielle` | Liste contenant `densification` mais pas `densification_residentielle` (`graph-store.ts`) | Cohérent avec l'observation. |
| Exclure PIIA | Écarte tout `piia` | Masque un PIIA sans preuve de projet résidentiel (`vivier-display-exclusions.ts`) | Proche. |
| Exclure dérogation | Écarte dérogation et dérogation mineure | Masque toute dérogation | Cohérent. |
| Période | Glissante, datée par la première étape (C-56) | Depuis #793 (fusionnée le 2026-10-02) : date du document par défaut, collecte en période personnalisée (`document-date-filter.ts`) | Observations de Steve en partie périmées. |
| Jamais rendus (C-49) | Cause inconnue | `non vérifié` | À reproduire (#761). |

Steve écrit (R-16) qu'« une seule réponse des développeurs remplacerait toute cette reconstitution ». Ce tableau peut lui être renvoyé après relecture (D16).

---

## 6. Modèle de données conforme au contrat sentropic d'annotation et de canevas

### 6.0 État initial et état proposé : le modèle physique

FAIT, mesuré sur `origin/main` : `api/src/db/schema.ts`, `api/drizzle/*.sql`, `rebuild-from-s3.ts`, `graph-store.ts`, `ogc-pull.ts`, `geo-collections.ts`, `packages/radar-sources/src/municipalities.ts`. Principe en place : **S3 est la source de vérité, Postgres une projection reconstructible** (`rebuild-from-s3.ts`) ; la collecte écrit les documents sur S3, le refresh écrit le graphe d'une ville sur S3 puis le projette dans Postgres ; **l'application ne lit que Postgres** (et le service geo pour le zonage).

**État initial — Postgres d'immo (tables pertinentes).**

| Table | Ce qu'elle porte | Clés et liens réels | Écrite par | Lue par |
|---|---|---|---|---|
| `graph_nodes` | Un nœud du graphe par entité. **Les signaux sont les nœuds de type `Signal` et `DesignationEvent`.** | `id` texte (`signal-…`, `event-…`, `muni-<ville>`, `bylaw-…`), `type`, `city_slug`, `props`, `source_ref` (clé S3 du document) | refresh (`upsertGraphAtomic`), depuis `graph/<ville>/latest.json` | API `graph-signals` : carte, rail, panneau |
| `graph_edges` | Les relations entre nœuds | `src_id`, `dst_id` texte, sans clé étrangère | refresh | API graphe |
| `documents` | Les métadonnées d'un document (PV, avis) | `s3_key` (clé adressée par contenu), `sha256`, `extracted` | projection des sidecars `*.meta.json` de S3 (`rebuild-from-s3`) ; remplissage en prod : `non vérifié` | `non vérifié` |
| `signals` (+ `opportunities`, `scores`) | Table historique de signaux à UUID | `id` UUID | **aucune écriture dans le code de main** | `prospect_notes.signal_id` |
| `zone_versions`, `lot_versions` | Zones et lots bitemporels, **copiés du service geo** | `canonical_id` = `ogc:zones:<ville>:<code>` ou `ogc:lots:<ville>:<no_lot>` ; `city_slug` | pull OGC (`ogc-pull`) | carte (lots d'abord en local, zonage en secours), mapper |
| `geo_resolutions`, `geo_unresolved` | Résultat du mapper G1 : quel signal concerne quelle zone ou quel lot, ou pourquoi ce n'est pas résolu | `node_id` (Signal, DesignationEvent) + `city_slug` → `target_id` (`canonical_id` zone ou lot), score, provenance | mapper G1 | carte, cohérence |
| `regulatory_stages`, `constraint_hits` | Étapes d'un règlement ; contraintes sur un lot ou une zone | `bylaw_canonical_id` ; `target_canonical_id` | `non vérifié` | `non vérifié` |
| `account_users` (+ invitations, événements de statut) | Les comptes de l'application | `id` UUID | authentification | partout |
| `prospect_marks`, `prospect_notes` (+ contacts, journal d'accès) | Annotations de l'équipe sur les lots et les signaux (détail plus bas) | voir plus bas | fiche lot, panneau signal | idem |
| `consistency_snapshots`, `refresh_document_outcomes`, `sources`, `ingestions` | Cohérence par ville ; résultat par document d'un cycle de refresh ; sources de collecte | `city_slug` ; `document_sha` | refresh, collecte | tableaux de bord |

**Villes : aucune table.** Le registre `QC_MUNICIPALITIES` (**1 106 municipalités**, JSON dans `packages/radar-sources`) fait foi ; `city_slug` est une colonne texte dans les tables ; chaque ville est aussi un nœud `muni-<ville>` du graphe.

**État initial — S3 d'immo (préfixes vus dans le code).**

| Préfixe | Contenu | Écrit par | Projeté dans |
|---|---|---|---|
| `raw/proces-verbaux-<ville>/cas/<sha>.pdf` (aussi `raw/pv-index/cas/…`, `raw/avis-publics-<ville>/cas/…`) | Documents bruts adressés par leur sha256, chacun avec un sidecar `*.meta.json` (URL, dates, ville) | collecte | `documents` |
| `graph/<ville>/latest.json`, `graph/<ville>/history/…` | Graphe canonique d'une ville et ses versions | refresh | `graph_nodes`, `graph_edges` |
| `runs/<source>/<runId>/manifest.jsonl`, `runs/<source>/collected-urls.jsonl` | Manifestes de collecte | collecte | dates de `documents` |
| `refresh/018/<ville>/runs/…`, `refresh/018/sweep/…` | Traces et curseur du refresh | refresh | `non vérifié` |
| `state/<ville>/<source>.json`, `scrape-status/index.json` | État de collecte | collecte | état de collecte |

Volumes : 1 106 municipalités au registre (FAIT) ; nombre de documents, de nœuds et de signaux en prod : `non vérifié`. Sauvegardes : hors du code applicatif, `non vérifié`.

**Service geo (séparé).** API OGC `api.geo.sent-tech.ca`, collections `qc-zonage-<ville>`, `qc-lots-<ville>`, `qc-zoning-events-<ville>`. Immo **copie** zones et lots dans `zone_versions` / `lot_versions` (pull OGC) ; la carte lit le **zonage en direct** par le proxy `/api/geo/collections/…` (Postgres en secours) et les **lots** dans la copie Postgres d'abord ; les événements de zonage sont **seulement référencés** (proxy, aucune copie). Stockage interne du service geo (PostGIS, S3) : `non vérifié` depuis le code d'immo.

```mermaid
erDiagram
    s3_raw ||..o| documents : projection
    s3_graph ||..o{ graph_nodes : projection
    graph_nodes ||..o{ graph_edges : aretes
    registre_villes ||..o{ graph_nodes : city_slug
    graph_nodes ||..o{ geo_resolutions : node_id
    geo_resolutions }o..o| zone_versions : zone
    geo_resolutions }o..o| lot_versions : lot
    geo_ogc ||..o{ zone_versions : pull_ogc
    geo_ogc ||..o{ lot_versions : pull_ogc_lots
    prospect_notes }o--o| signals : signal_id
    prospect_notes }o--|| account_users : auteur
    s3_raw {
      text cle PK "raw/proces-verbaux-<ville>/cas/<sha>.pdf"
      text index "raw/pv-index/cas/<sha>.<ext>"
      json sidecar "*.meta.json : url, dates, ville"
    }
    s3_graph {
      text cle PK "graph/<ville>/latest.json"
      text historique "graph/<ville>/history/…"
    }
    s3_runs {
      text runs PK "runs/<source>/<runId>/manifest.jsonl"
      text refresh "refresh/018/<ville>/runs/…"
      text etat "state/<ville>/<source>.json"
    }
    registre_villes {
      text city_slug PK "1 106 municipalités, JSON du code"
      text mrc "homonymes suffixés par la MRC"
    }
    documents {
      uuid id PK
      text s3_key "clé raw/…/cas/<sha>"
      text sha256 "empreinte du PV"
      jsonb extracted
    }
    graph_nodes {
      text id PK "signal-…, event-…, muni-…"
      text type "Signal, DesignationEvent…"
      text city_slug
      text source_ref "clé S3 du document"
    }
    graph_edges {
      uuid id PK
      text src_id "→ graph_nodes.id, sans FK"
      text dst_id "→ graph_nodes.id, sans FK"
    }
    signals {
      uuid id PK "aucune écriture sur main"
    }
    zone_versions {
      uuid id PK
      text canonical_id "ogc:zones:<ville>:<code>"
      text city_slug
    }
    lot_versions {
      uuid id PK
      text canonical_id "ogc:lots:<ville>:<no_lot>"
      text no_lot
    }
    geo_resolutions {
      uuid id PK
      text node_id "Signal ou DesignationEvent"
      text target_id "canonical_id zone ou lot"
    }
    account_users {
      uuid id PK "comptes de l'équipe"
    }
    prospect_notes {
      uuid id PK
      uuid signal_id FK "UUID, cassé (B0)"
    }
    geo_ogc {
      text zonage PK "qc-zonage-<ville>"
      text lots "qc-lots-<ville>"
      text evenements "qc-zoning-events-<ville>"
    }
```

<!-- diagram:etat-actuel -->

Qui lit quoi : la collecte et le refresh écrivent S3, puis projettent dans Postgres ; l'application lit Postgres ; le mapper relie les signaux du graphe aux zones et lots copiés du service geo.

**Proposé : le même dessin, avec un statut et un propriétaire par objet.** Conformément à la convergence sentropic + engram (§6.7, G2, G7), immo ne construit pas de tables d'annotation : les annotations vivent dans les tables du paquet générique `@sentropic/annotations`, installées dans le Postgres d'immo ; le jeu de référence et les runs appartiennent à engram ; les décisions de gel et de promotion à track ; immo apporte son profil de domaine et ses données.

```mermaid
erDiagram
    s3_raw ||..o| documents : projection
    s3_graph ||..o{ graph_nodes : projection
    graph_nodes ||..o{ graph_edges : aretes
    registre_villes ||..o{ graph_nodes : city_slug
    graph_nodes ||..o{ geo_resolutions : node_id
    geo_resolutions }o..o| zone_versions : zone
    geo_resolutions }o..o| lot_versions : lot
    geo_ogc ||..o{ zone_versions : pull_ogc
    geo_ogc ||..o{ lot_versions : pull_ogc_lots
    prospect_notes }o--o| signals : signal_id
    prospect_notes }o--|| account_users : auteur
    s3_retours ||..|| annotation_sources : octets
    annotation_sources ||--o{ annotation_revisions : import
    annotation_revisions ||--o{ annotation_validations : decide
    annotation_revisions ||--o{ annotation_targets : vise
    annotation_targets }o..o| graph_nodes : signal
    annotation_targets }o..o| registre_villes : ville
    annotation_targets }o..o| documents : document
    annotation_targets }o..o| zone_versions : zone_cible
    annotation_targets }o..o| lot_versions : lot_cible
    annotation_validations }o..o{ reference_set_versions : export_hache
    profil_domaine ||..o{ reference_set_versions : schema
    reference_set_versions ||--o{ eval_runs : mesure
    eval_runs }o..o| decisions_track : preuve
    decisions_track ||..o| profil_domaine : promotion
    s3_raw {
      text cle PK "raw/proces-verbaux-<ville>/cas/<sha>.pdf"
      text index "raw/pv-index/cas/<sha>.<ext>"
      json sidecar "*.meta.json : url, dates, ville"
    }
    s3_graph {
      text cle PK "graph/<ville>/latest.json"
      text historique "graph/<ville>/history/…"
    }
    s3_runs {
      text runs PK "runs/<source>/<runId>/manifest.jsonl"
      text refresh "refresh/018/<ville>/runs/…"
      text etat "state/<ville>/<source>.json"
    }
    registre_villes {
      text city_slug PK "1 106 municipalités, JSON du code"
      text mrc "homonymes suffixés par la MRC"
    }
    documents {
      uuid id PK
      text s3_key "clé raw/…/cas/<sha>"
      text sha256 "empreinte du PV"
      jsonb extracted
    }
    graph_nodes {
      text city_slug PK "clé (city_slug, id), #812"
      text id PK "signal-…, event-…, muni-…"
      text type "Signal, DesignationEvent…"
      text source_ref "clé S3 du document"
    }
    graph_edges {
      uuid id PK
      text src_id "+ ville du nœud (#812)"
      text dst_id "+ ville du nœud (#812)"
    }
    signals {
      uuid id PK "aucune écriture sur main"
    }
    zone_versions {
      uuid id PK
      text canonical_id "ogc:zones:<ville>:<code>"
      text city_slug
    }
    lot_versions {
      uuid id PK
      text canonical_id "ogc:lots:<ville>:<no_lot>"
      text no_lot
    }
    geo_resolutions {
      uuid id PK
      text node_id "Signal ou DesignationEvent"
      text target_id "canonical_id zone ou lot"
    }
    account_users {
      uuid id PK "+ compte de Steve (D5)"
      text sub "sujet IdP sentropic"
    }
    prospect_notes {
      uuid id PK
      text signal_cle "ville + id texte (B0)"
    }
    geo_ogc {
      text zonage PK "qc-zonage-<ville>"
      text lots "qc-lots-<ville>"
      text evenements "qc-zoning-events-<ville>"
    }
    profil_domaine {
      text fichier PK "radar/ontology/ontology-profile.yaml"
      text etiquettes "+ verdicts, motifs, critères, sens"
      text promotion "+ règle D13"
    }
    s3_retours {
      text cle PK "classeur de Steve, par sha256"
      text ecrit_par "port de @sentropic/annotations"
    }
    annotation_sources {
      uuid id PK "sentropic"
      text sha256 UK "fichier importé une fois"
    }
    annotation_revisions {
      text content_hash PK "sentropic, immuable"
      text prev_content_hash "version précédente"
      text auteur "identité IdP sentropic"
      jsonb corps "schéma d'étiquettes du profil immo"
    }
    annotation_validations {
      uuid id PK "sentropic"
      text revision_hash FK "liée au hash"
      text decision "accepter, contester, rejeter…"
    }
    annotation_targets {
      uuid id PK "sentropic"
      text cible_type "signal, ville, PV, zone, lot"
      text cle "clé du domaine immo"
    }
    reference_set_versions {
      text id PK "engram : ReferenceSet@version"
      text label_provenance "E silver, C human_single"
      text partitions "dev / test scellé"
      text manifest_sha256
    }
    eval_runs {
      text run_id PK "engram, hors ligne"
      text candidat "profil + prompt + modèle"
      text resultat "métriques, garde de promotion"
    }
    decisions_track {
      text id PK "track : gel, promotion"
      text attestation "signée par h2a"
    }
```

<!-- diagram:etat-propose -->

**Où une annotation de Steve se rattache aux données existantes** (table `annotation_targets` du paquet `@sentropic/annotations`, sans clé étrangère ; la clé est fournie par immo).

| Cible | Objet physique existant | Clé utilisée | Clé existante ou nouvelle |
|---|---|---|---|
| Signal | nœud `graph_nodes` de type `Signal` ou `DesignationEvent` | `city_slug` + `id` texte | clé `(city_slug, id)` décidée pour #812 |
| Ville | registre `QC_MUNICIPALITIES` (pas de table) | `city_slug` | existante |
| PV, document | objet S3 `raw/proces-verbaux-<ville>/cas/<sha>.pdf` et ligne `documents` | `sha256` (+ page) | existante |
| Zone | `zone_versions`, copie de `qc-zonage-<ville>` du service geo | `canonical_id` `ogc:zones:<ville>:<code>` | existante |
| Lot | `lot_versions`, copie de `qc-lots-<ville>` | `canonical_id` `ogc:lots:<ville>:<no_lot>` | existante |
| Règlement | nœud `bylaw-<ville>-<numéro>`, `regulatory_stages.bylaw_canonical_id` | `bylaw_canonical_id` | existante, peu fiable (C-05, C-26) |

**Côté geo, rien ne change** : aucune table, aucune collection, aucune API nouvelle ; une annotation de zone ou de lot garde le `canonical_id` déjà utilisé par immo.

**Tableau des écarts.**

| Objet | Service | Propriétaire | Existe aujourd'hui | Proposé | Détail | Pourquoi | Décision |
|---|---|---|---|---|---|---|---|
| Classeur de Steve sur S3 (par sha256, sidecar `*.meta.json`) | immo S3 | sentropic (écrit par le port du paquet) | non | **nouveau** | Octets importés une fois, gardés tels quels | Source immuable, provenance | D1, G2 |
| `annotation_sources` | immo PG (tables du paquet) | sentropic | non | **nouveau** | Un fichier reçu : sha256 unique, importateur | Réimport sans doublon | G2, D2 |
| `annotation_revisions` | immo PG (tables du paquet) | sentropic | non | **nouveau** | Révisions immuables (`content_hash`, `prev_content_hash`), corps au schéma d'étiquettes du profil immo, auteur = identité IdP | Annotations vivantes de Steve, sans écrasement | G2, G3, D5 |
| `annotation_validations` (+ adjudications) | immo PG (tables du paquet) | sentropic | non | **nouveau** | Acte sur une révision désignée par son hash : accepter, contester, rejeter… | Boucle de validation | G3, G4 |
| `annotation_targets` | immo PG (tables du paquet) | sentropic (forme) ; clé : immo | non | **nouveau** | Cible : type + clé du tableau ci-dessus | 1 à N cibles, sans clé étrangère | G2, D3 |
| Profil de domaine (`radar/ontology/ontology-profile.yaml`) | dépôt immo | immo (contenu) ; format : engram | oui (ontologie) | **modifié** | + schéma d'étiquettes (verdicts, 28 motifs → critères K1 à K9 et exclusions, sens, tags), + règle de promotion D13, + unité de groupe (municipalité) | Les étiquettes de Steve suivent un schéma déclaré | D2, D7 |
| `ReferenceSetVersion` (manifeste, partitions, sceau) | stockage objet privé de l'hôte (S3 d'immo) + manifestes publics | engram | non (E : fichiers JSON hors main) | **nouveau** | Version figée tirée d'un instantané haché des annotations validées ; `label_provenance` | Jeu de référence C ; E converti | G1, G5, D10 |
| Runs d'évaluation, résultats | hors ligne (engram) | engram | en partie (campagnes #782) | **nouveau** | Runs par candidat, évaluateurs pluggables, statistiques, garde de promotion | Mesure hors de l'application | G6, D11 |
| Décisions de gel et de promotion | `.track` | track (attestation h2a) | oui (track) | **nouveau (usage)** | Gel d'une version, promotion d'un candidat exact | Décision humaine tracée | G6, D13 |
| `graph_nodes` | immo PG | immo | oui : signaux et entités, clé `id` | **modifié** | Clé `(city_slug, id)` au lieu de `id` seul | Correction #812, déjà décidée | #812 |
| `graph_edges` | immo PG | immo | oui : relations | **modifié** | Les références à un nœud portent la ville ; détail dans #812 (`non vérifié` ici) | Même raison | #812 |
| `prospect_notes` | immo PG | immo | oui : notes de l'équipe | **modifié** | Ancre signal en texte (`city_slug` + id) au lieu de l'UUID `signals` ; comparaison auteur corrigée | Réparer l'annotation de signal de l'équipe (B0) | D3 |
| `account_users` | immo PG | immo (comptes) ; identité : IdP sentropic | oui | **modifié (données)** | Un compte pour Steve ; `sub` porte déjà le sujet de l'IdP sentropic | Steve annote dans l'application | D5, G4 |
| `signals` (+ `opportunities`, `scores`) | immo PG | immo | oui, aucune écriture | inchangé | Orpheline ; une suppression éventuelle est hors de ce dossier | — | aucune |
| `documents`, `raw/…`, `graph/…`, `runs/…`, `refresh/…`, `state/…` | immo PG, immo S3 | immo | oui | inchangé | Lus pour rattacher un PV ou un signal | — | — |
| `zone_versions`, `lot_versions`, `geo_resolutions`, `geo_unresolved` | immo PG | immo (copie du service geo) | oui | inchangé | `canonical_id` réutilisé comme clé de cible | — | — |
| `prospect_marks` | immo PG | immo | oui | inchangé | Usage de l'équipe sur les lots | — | — |
| Collections `qc-zonage-*`, `qc-lots-*`, `qc-zoning-events-*` | geo PostGIS, geo S3 (`non vérifié`) | service geo | oui | inchangé | Aucune collection ni API nouvelle | — | — |
| Six tables immo du brouillon (`retours_fichiers`, `annotations`, `validations`, `motifs`, `annotation_cibles`, `reference_set_versions`) | — | — | non (jamais construites) | **abandonnées** | Remplacées par les objets génériques ci-dessus (§6.3) | G7 : immo ne construit pas ses tables | G2, G7, D2 |
| Supprimé de l'existant | — | — | — | **aucun** | Rien de ce qui existe n'est supprimé | — | — |

#### Annotations existantes : deux tables, aucune table de jeu de référence

**Oui, un modèle d'annotation existe déjà, mais il ne sert pas à ce dont Steve a besoin.** FAIT, lu dans `api/src/db/schema.ts` et les migrations `0005_prospect_marks.sql` et `0011_prospect_notes_annotations.sql` sur `origin/main`.

| Table | Créée par | Ce qu'elle porte | À quoi elle sert dans l'UI aujourd'hui |
|---|---|---|---|
| `prospect_marks` | migration 0005 | Le **marquage d'équipe d'un lot**, sur deux dimensions : pipeline (favori, écarté, sollicité, lettre envoyée) et marché (en vente, prix demandé, lien d'annonce). Ancre : `lot_version_id` (+ `no_lot`, `city_slug`) ; auteur : `author_id` → `account_users`, obligatoire ; chaîne append-only `supersedes` / `superseded_by` (une nouvelle marque remplace l'ancienne sans l'effacer) ; mode `real` (saisie) ou `simulation`. | Boutons de statut de la fiche lot (`LotFichePanel`) et carte d'évaluation. Ce n'est pas une annotation de signal. |
| `prospect_notes` | migration 0005, revue en 0011 | Une **note libre** sur un lot (`no_lot` + `city_slug`) ou un signal (`signal_id` → `signals.id`, UUID, `ON DELETE SET NULL`) ; auteur = compte obligatoire ; `body` limité à 10 000 caractères ; édition en place, suppression logique (`deleted_at`) ; `tenant_id` inerte. | Composants `collab/*` : notes dans la fiche lot et dans le panneau signal (`SignalAnnotations`), flux en direct `prospect:note`. |

```mermaid
erDiagram
    prospect_marks }o--|| lot_versions : lot_version_id
    prospect_marks }o--|| account_users : auteur
    prospect_notes }o--|| account_users : auteur
    prospect_notes }o--o| signals : signal_id
    prospect_notes }o..o| graph_nodes : id_texte_refuse
    prospect_marks {
      uuid id PK
      uuid lot_version_id FK "lot (bitemporel)"
      text no_lot
      text city_slug
      enum dimension "pipeline ou marche"
      enum statut "favori, ecarte, en_vente…"
      enum mode "real ou simulation"
      uuid author_id FK "compte obligatoire"
      uuid supersedes FK "chaîne append-only"
      uuid superseded_by FK
      numeric prix_demande
      text lien_annonce
    }
    prospect_notes {
      uuid id PK
      enum target_type "lot ou signal"
      text no_lot
      text city_slug
      uuid signal_id FK "UUID, ON DELETE SET NULL"
      uuid author_id FK "compte obligatoire"
      text body "10 000 caractères max"
      text tenant_id "inerte"
      timestamptz deleted_at "suppression logique"
    }
    lot_versions {
      uuid id PK
    }
    account_users {
      uuid id PK
    }
    signals {
      uuid id PK "aucune insertion sur main"
    }
    graph_nodes {
      text id PK "signal-… (texte)"
    }
```

<!-- diagram:existant -->

**Pourquoi ces tables ne suffisent pas pour les retours de Steve.**
1. **Auteur avec compte obligatoire** : Steve n'a pas de compte vérifié, et ce n'est pas lui qui importe (D5).
2. **Une seule cible par note**, alors qu'une ligne du classeur vise 1 à N objets (la ligne #7 nomme deux événements ; une ligne agrégée vise une ville).
3. **10 000 caractères au plus** : la cellule E57 des Constats en compte 17 114.
4. **Aucune provenance** (fichier, sha256, feuille, ligne, révision) **ni verdict structuré** (classement, motif, sens, filtrage) : on ne peut ni réimporter sans doublon, ni construire un jeu de référence.
5. **L'ancre signal est cassée (défaut corrigé par B0)** : l'UI envoie l'identifiant texte du graphe (`signal-…`, table `graph_nodes`), l'API exige l'UUID de la table `signals`, que plus aucun code de `main` n'alimente.

**Aucune table de jeu de référence n'existe en base aujourd'hui.** Le jeu de référence actuel (jeu de référence d'extraction v3, dit E) est un ensemble de fichiers JSON versionnés dans le dépôt, hors de `main` : `docs/reviews/refresh-benchmark/v101b/oracle-v3/` sur la branche `feat/t1-model-benchmark-real` (commit `dd0561f6`, 674 éléments sur 100 documents) ; la version 676 n'existe qu'en copie locale. Les campagnes du benchmark #782 lisent ces fichiers. Le §9.3 décrit comment le jeu de référence de ciblage C s'y ajoute.

La suite (§6.1 à §6.6 et scène 2) distingue ce qui **existe** sur `main` (en-tête ocre, bordure pleine : `graph_nodes`) de ce qui est **proposé** (en-tête bleu, bordure en tirets : les tables du paquet `@sentropic/annotations`, le profil complété, le jeu de référence engram).

### 6.1 Contraintes établies

**Identité des objets annotables (FAIT).**

| Objet | Où il vit | Clé | Stabilité |
|---|---|---|---|
| Signal `signal-…`, événement `event-…` | `graph_nodes`, projetés depuis `graph/<ville>/latest.json` | `id` texte choisi par l'extraction | **Non garantie** : `upsertGraphAtomic` supprime les nœuds orphelins d'une ville (`graph-store.ts`, vers les lignes 1134–1166). |
| `signals` (historique) | table `signals` | UUID aléatoire | Aucune insertion dans le code applicatif de `main` (seulement dans un test d'intégration). |
| Municipalité | registre `QC_MUNICIPALITIES` ; nœuds `muni-<slug>` | slug, homonymes suffixés par la MRC | Stable |
| Règlement | `bylaw-<slug>-<num>`, `regulatory_stages.bylaw_canonical_id`, `reglement_number` | texte | Peu fiable (C-05, C-26) |
| Zone | `zone_versions` bitemporel | `ogc:zones:<ville>:<codeNorm>` | Stable par code |
| Lot | `lot_versions` bitemporel | `ogc:lots:<ville>:<noLotNorm>` | Stable |
| Document | `documents` | sha256 | Stable |

**Annotations existantes (FAIT, lecture de code).**
- `prospect_notes` (0011) : cible `lot` ou `signal` (UUID `ON DELETE SET NULL`), auteur `account_users`, corps limité à 10 000 caractères, suppression logique, flux SSE (événements poussés du serveur vers le navigateur) `prospect:note`.
- **Défaut 1** : l'UI envoie `GraphSignalNode.id` (texte) alors que l'API exige `z.string().uuid()` (`prospect-marks.ts:107`). Un refus 400 est attendu ; les tests utilisent `"sig-1"` sur un fetch simulé. Effet en prod : `non vérifié`.
- **Défaut 2** : `SignalAnnotations` compare `note.authorId` (`account_users.id`) à `$authStore.user.sub` (sujet IdP) quand `currentUserId` n'est pas fourni ; ni `SignauxSelPanel` ni `LotFichePanel` ne le fournissent. Les boutons d'édition n'apparaîtraient pas. Effet : `non vérifié`.
- **Défaut 3** : le badge de comptage n'est rempli qu'à l'ouverture de la fiche.
- Une cellule du classeur atteint **17 114 caractères** (Constats, E57) : le corps de note de 10 000 ne peut pas porter la source sans troncature.

**Contrat sentropic (FAIT, `origin/main` `7d1002505`).**

| Élément | `@sentropic/comments` 0.2.0 | Conséquence pour Radar |
|---|---|---|
| Cible | `{kind:'message'\|'canvas'\|'artifact'\|'field'\|'record', id, sectionKey?, recordType?}` ; `recordType` opaque | `{kind:'record', recordType:'radar.signal'\|'radar.municipality'\|'radar.bylaw'\|'radar.zone'\|'radar.lot'\|'radar.document', id:<clé namespacée>}` sans changement du paquet. Préfixer l'`id` : `TargetQuery` ne filtre pas sur `recordType`. |
| Fil | plat (`threadId`), `open\|resolved` par fil, `assignedTo` | Une évaluation publiée = un fil ; `resolved` ne signifie pas « non pertinent ». |
| Auteur | `{id, kind?: 'human'\|'agent'\|'nhi', displayLabel?}`, identifiant opaque | Auteur externe possible sans compte (D5). |
| Provenance | `{toolCallId?, runId?}` | La provenance d'import vit dans des tables hôtes. |
| Verdict structuré, étiquettes | absents | Tables hôtes ; le port n'est pas élargi. |
| Suppression | **physique par ligne** (`store.ts:47-48`) | Écart avec O1 (tombstone) ; pas de chemin de suppression par le paquet (D4). |
| Routeur Hono | `contextType` en énumération fermée (`hono.ts:17`) | Inutilisable tel quel pour `signal`. |
| Canevas | `SPEC_VOL_INTERACTIVE_CANVAS.md` = intentions brutes | Une position sur carte n'est qu'une représentation de la cible. |
| Focus | `packages/focus` supprimé de sentropic `main` (`6ca53d11a`, « focus is owned by h2a ») | Ne pas concevoir contre ce paquet. |
| Dépendance Radar | aucune référence à `@sentropic/comments` dans `ui/`, `api/` ou à la racine | À ajouter. |

### 6.2 Exigences

| # | Exigence | Source |
|---|---|---|
| E1 | Stocker toutes les cellules de toutes les feuilles, sans perte ni troncature | brief, #784 |
| E2 | Rattacher chaque retour à 1 à N éléments (signal, événement, ville, MRC, règlement, zone, lot, document, dossier) | brief, spec 2026-08-12 |
| E3 | Être conforme au contrat `comments`, sans système parallèle | spec 2026-08-12, COLLAB |
| E4 | Ne jamais détruire une annotation lors d'une ré-ingestion de sa cible | contrat d'ancre §3.1 |
| E5 | Provenance : fichier, sha256, feuille, ligne, révision, auteur, importateur, version du parseur | jeu de référence |
| E6 | Import idempotent ; nouvelles révisions (52 villes) sans doublon, avec historique | analyse |
| E7 | Ne perdre aucune ligne non rattachable | brief |
| E8 | Coexistence de plusieurs jeux d'étiquettes (D9) | brief |
| E9 | Données personnelles (C-79) ; tombstone et rétention (O1) | Loi 25 (protection des renseignements personnels, Québec), COLLAB |

### 6.3 Besoins de Steve et modèle cible par propriétaire

On part de ce que Steve a produit et de ce qu'il demande, pas des tables existantes. Les tables `prospect_marks` et `prospect_notes` (§6.0) restent telles quelles : elles servent au travail de l'équipe sur les lots, et les étendre mélangerait deux usages sans couvrir les besoins de Steve ; elles ne sont ni étendues ni réutilisées.

**Vision de l'owner.** Steve poursuit son travail d'annotation, de validation et de triage **dans l'application**, avec son propre compte. L'application porte des **boucles de validation** : Steve annote, l'équipe ou le PO valide ou conteste, la décision est gardée et chaque changement crée une nouvelle version. Les annotations sont donc des **données d'application vivantes en Postgres**, pas seulement un import. Le jeu de référence C est **stocké** (versions gelées tirées des annotations validées), mais l'**évaluation et l'optimisation des prompts d'engram se font hors ligne**, jamais dans l'application.

**Architecture des données : cinq ensembles.** Chacun est marqué par son **propriétaire** (immo, sentropic, engram, track), **existe** ou **proposé** (titre du couloir, bordure pleine ou en tirets) et **en ligne** (zone du haut) ou **hors ligne** (bande du bas) ; les flèches disent qui alimente qui.

```mermaid
flowchart LR
  subgraph U["Utilisateurs de l'application"]
    STV["Steve · son compte"]
    EQP["Équipe et PO"]
  end
  subgraph DA["(a) Données de Steve · immo · proposé"]
    XLS["Classeur du 21 sept."]
    SRC["Import unique, tel quel"]
  end
  subgraph DB["(b) Annotations · sentropic · proposé"]
    ANN["Annotations de Steve"]
    VAL["Validations équipe / PO"]
    HIS["Historique versionné"]
  end
  subgraph DC["(c) Graphe · immo · existe"]
    S3G["S3 · latest.json"]
    GRN["graph_nodes"]
  end
  subgraph DD["(d) Jeu de référence · engram · proposé"]
    ORC["Jeu de référence C · versions gelées"]
    ORE["Jeu de référence E v3 · fichiers"]
  end
  subgraph EV["(e) Évaluation (engram) et décisions (track) · hors ligne"]
    BEN["Benchmark #782"]
    ENG["Optimisation des prompts"]
    TRK["Décisions · track"]
  end
  XLS -->|"importé une fois"| SRC
  SRC -->|"pré-remplit"| ANN
  STV -->|"annote, trie"| ANN
  EQP -->|"valide ou conteste"| VAL
  ANN -->|"à valider"| VAL
  VAL -->|"décision gardée"| HIS
  ANN -.->|"ville + id texte"| GRN
  S3G -->|"projection"| GRN
  HIS -->|"validées, gelées"| ORC
  ORC -->|"volet ciblage"| BEN
  ORE -->|"volet extraction"| BEN
  BEN -->|"résultats"| ENG
  ENG -->|"candidat figé"| TRK
  TRK -.->|"promotion du prompt"| S3G
```

<!-- lanes:architecture-donnees -->

Où chaque table nouvelle se rattache à l'existant (signal, ville, PV, zone, lot) : §6.0, diagrammes « État actuel » et « Proposé » et tableau des écarts.

**Besoins de Steve → données nécessaires.**

| # | Besoin (source) | Donnée nécessaire | Objet (propriétaire) |
|---|---|---|---|
| 1 | Garder son verdict sur chaque signal : Pertinent, À surveiller, Non pertinent, avec motif, sens, passe (feuille Triage, 124 lignes) | classement, code de motif, sens, passe | `annotation_revisions` (sentropic) |
| 2 | Garder sans perte ses 121 contrôles d'exclusion, 77 constats et 26 règles (autres feuilles) | feuille, ligne, référence (#, C-xx, R-xx), toutes les cellules brutes | `annotation_revisions` (sentropic) |
| 3 | Relier ses 28 codes de motif à ses critères et exclusions (table de dérivation relue par Steve, D7, D8) | code → critère K1 à K9 ou exclusion, règle R-xx | schéma d'étiquettes du profil (immo) |
| 4 | Une ligne vise 1 à N objets : signal, ville, règlement (la #7 nomme deux événements ; une ligne agrégée vise une ville) | type d'objet, ville, id texte, état du rattachement, ce que Steve a vu | `annotation_targets` (sentropic) |
| 5 | Savoir d'où vient chaque verdict | fichier (sha256), nom, révision, auteur, importateur ; feuille et ligne | `annotation_sources`, `annotation_revisions` (sentropic) |
| 6 | Recevoir les révisions et les 52 villes suivantes sans rien écraser | nouveau fichier ; ligne qui en remplace une autre ; statut active, retirée, remplacée | `annotation_sources`, `annotation_revisions` (sentropic) |
| 7 | Voir son avis sur le signal dans l'outil : badge, section « Avis de Steve », compteurs (U1) | lecture par ville + id du signal | `annotation_targets` → `annotation_revisions` (sentropic) |
| 8 | Archiver, classer, lier, épingler (#760) | états durables par utilisateur | hors du périmètre, voir plus bas |
| 9 | Jeu de référence C : un jeu gelé, versionné, partagé en développement (51 villes) et test (52 villes) | liste des annotations validées retenues, partition, empreinte du fichier gelé | `ReferenceSetVersion` (engram) |
| 10 | Poursuivre son annotation, sa validation et son triage dans l'application (vision owner) | saisie avec son propre compte, origine « saisie », nouvelle version à chaque changement | `annotation_revisions` (sentropic), `account_users` (immo) |
| 11 | Boucle de validation : l'équipe ou le PO valide ou conteste, la décision est gardée | décideur (compte), décision, motif, date ; statut courant de l'annotation | `annotation_validations` (sentropic) |

```mermaid
erDiagram
    annotation_sources ||--o{ annotation_revisions : import
    annotation_revisions |o--o| annotation_revisions : remplace
    annotation_revisions ||--o{ annotation_validations : decide
    annotation_revisions ||--o{ annotation_targets : vise
    annotation_targets }o..o| graph_nodes : ville_et_id_texte
    annotation_revisions }o--|| account_users : auteur
    annotation_validations }o--|| account_users : decideur
    profil_domaine ||..o{ annotation_revisions : schema_corps
    annotation_validations }o..o{ reference_set_versions : export_hache
    reference_set_versions ||--o{ eval_runs : mesure
    annotation_sources {
      uuid id PK
      text sha256 UK "classeur de Steve, une fois"
      text octets "S3 d’immo, par un port"
    }
    annotation_revisions {
      text content_hash PK "immuable"
      text prev_content_hash FK "révision précédente"
      uuid auteur FK "Steve, identité IdP"
      text origine "import ou saisie"
      jsonb corps "verdict, motif, sens, tags"
      text statut "calculé des validations"
    }
    annotation_validations {
      uuid id PK
      text revision_hash FK "révision visée"
      uuid decideur FK "équipe ou PO"
      text decision "accepter, contester, rejeter…"
      text motif "pourquoi"
    }
    annotation_targets {
      uuid id PK
      text cible_type "signal, ville, PV, zone, lot"
      text city_slug "clé du graphe (#812)"
      text cle "id, sha256 ou canonical_id"
      jsonb vu_par_steve "instantané observé"
    }
    profil_domaine {
      text fichier PK "ontology-profile.yaml"
      text etiquettes "verdicts, 28 motifs, critères"
      text promotion "règle D13"
    }
    account_users {
      uuid id PK
      text sub "sujet IdP sentropic"
    }
    graph_nodes {
      text city_slug PK "clé (city_slug, id), #812"
      text id PK "signal-… (texte)"
    }
    reference_set_versions {
      text id PK "ReferenceSet@version"
      text label_provenance "human_single pour C"
      text partitions "dev 51 villes, test 52"
      text manifest_sha256 "gel décidé dans track"
    }
    eval_runs {
      text run_id PK
      text candidat "profil + prompt + modèle"
      text resultat "métriques, garde"
    }
```

<!-- diagram:modele-minimal -->

**Sort des six tables du brouillon** (convergence 4/4 des sièges, synthèse §6.1) : immo ne les construit pas.

| Table immo du brouillon | Devient | Propriétaire |
|---|---|---|
| `retours_fichiers` | `annotation_sources` | sentropic ; parseur du classeur : immo |
| `annotations` | `annotation_revisions` (corps adressés par contenu ; `remplace_id` → `prev_content_hash`) | sentropic |
| `validations` | `annotation_validations`, liées au hash de la révision | sentropic |
| `annotation_cibles` | `annotation_targets` + résolutions ajoutées sans écraser | sentropic ; clé de la cible : immo |
| `motifs` | schéma d'étiquettes (codebook) du profil | contenu : immo ; format : engram |
| `reference_set_versions` | `ReferenceSetVersion` + décision de gel (track) + artefact privé | engram + track |

Ce qui reste propre à immo : le profil de domaine, le parseur du classeur, le résolveur d'ancres (signal, ville, PV, zone, lot), les écrans (panneau, rail, U1, U2), les décisions produit et les prompts candidats.

**Ce qui reste hors du périmètre, volontairement.**
- Pas de fil de discussion libre : la boucle de validation passe par des décisions (validée, contestée) avec un motif ; un fil de commentaires sentropic pourra s'ajouter avec le port complet (D4).
- Pas d'états archiver, classer, lier, épingler (#760) : ils attendent la maquette de Steve et Mathieu (lot L7) ; une table dédiée s'ajoutera alors sans toucher à celles-ci.
- Pas de clé étrangère vers le graphe, pas de suppression physique : un retrait est un statut.
- Pas d'évaluation dans l'application : la prédiction C, les mesures et l'optimisation des prompts vivent hors ligne (ensemble e) ; la classification du radar se recalcule.

**Clé d'une annotation importée** : fichier + feuille + référence de Steve (#, C-xx, R-xx) ; le numéro « # » peut changer d'une révision à l'autre, il reste lisible dans `ref` et la nouvelle version remplace l'ancienne. Une annotation saisie dans l'application n'a pas de fichier : son origine est « saisie ».

Les six tables immo de la version précédente restent décrites comme option b de D2, avec leur schéma au §10.

### 6.4 Ancres et rattachement

| Objet | Ancre proposée | Vérification avant confirmation |
|---|---|---|
| Signal ou événement du graphe | `radar.signal:<ville>:<id>` + génération du graphe + instantané `observed` | Id exact présent dans un snapshot, ville, type et source concordants ; un préfixe seul n'est pas une preuve. |
| Document | sha256 + page + extrait | Un préfixe d'empreinte tronqué n'identifie pas un document. |
| Municipalité | slug du registre + alias source | Homonymes et suffixes MRC (C-81) ; pas de slug fabriqué par retrait des accents. |
| Zone | ville + code canonique + millésime | Pas de réancrage silencieux d'une zone renumérotée. |
| Lot | ville + numéro cadastral normalisé | Adresse civique ≠ numéro cadastral. |
| Dossier réglementaire | identité locale + liens vers règlement et étapes | Ville + numéro ne suffit pas (C-26) ; pas de fusion automatique des étapes. |
| Retour transversal, groupe non résolu | `artifact` = source + `sectionKey` de ligne | Ne jamais fabriquer une cible métier pour éliminer un reliquat. |

**Mesures lexicales (CALCUL, candidats, pas entités vérifiées).**
- Colonne L du Triage : au moins un identifiant complet dans **121/124** lignes, **148** chaînes distinctes, plusieurs candidats dans 27 lignes.
- Toutes colonnes du Triage : 121 lignes, 150 chaînes distinctes, plusieurs candidats dans 30 lignes.
- Trois feuilles Triage, Écartés et Constats : **227 à 237** identifiants complets distincts selon la règle d'extraction.
- Identifiants abrégés (`event-…-zonage-0013`) et lignes agrégées sans identifiant (« 13 signaux PIIA ») : présents dans Triage et surtout dans Écartés ; effectif exact dépendant de la règle, à publier par le rapport d'import.
- Les lignes #55 et #58 décrivent un dossier absent ; la #112 n'utilise que des identifiants abrégés.

Ordre de résolution : id exact + ville → identité documentaire + étape → dossier, zone ou lot validé → file de revue pour les ambiguïtés. Aucun rapprochement approximatif n'est confirmé sans trace humaine ou règle déterministe.

### 6.5 Import idempotent

1. **Script Node/TS** (exceljs en dépendance de développement d'`api/`), **dry-run par défaut**, via une cible Make. Rapport : comptes par feuille et par statut de résolution, écarts avec les comptes déclarés (124/146, 51/103, 121, 77, 26, 28).
2. **Idempotence** : un sha256 déjà importé ne produit aucune écriture ; une nouvelle révision ajoute ses lignes, chacune reliée par `remplace_id` à la ligne qu'elle remplace (même fichier d'origine, feuille et référence) ; une ligne absente de la révision suivante passe au statut « retirée », jamais supprimée ; une transaction par fichier ; deux imports concurrents des mêmes octets convergent sans doublon ni double notification.
3. **Lignes non rattachables** : jamais rejetées. Une cible « ville » toujours créée depuis la colonne Ville ; id abrégé résolu par ville + suffixe, sinon « ambiguë » ou « non résolue » ; ligne agrégée → cible « ville » ; id complet absent du graphe → « disparue », instantané `vu_par_steve` affichable.
4. **Mesure de résolution avant tout affichage** : part des identifiants encore présents dans `graph_nodes` d'une préprod restaurée. C'est un critère de sortie du lot L1.
5. **Qualité à traiter dès l'import (FAIT)** : 4 dates partielles ou composites sur 124 ; 7 états `firm` hors liste de validation ; 66 « Procès-verbal » dans la colonne Type, hors liste d'étapes ; 29 initiateurs et 46 portées hors listes déroulantes ; 40 libellés de MRC non normalisés (dériver la MRC du registre) ; la Synthèse ne compte que 95 initiateurs normalisés sur 124. Toutes les cellules sont conservées ; les recomptages sont publiés avec leurs règles et une catégorie explicite pour les valeurs non reconnues.
6. **Données personnelles** : détection sur les verbatims, `pii_status` renseigné ; affichage selon D6.
7. **Retrait** : désactiver la publication d'un lot sans effacer source, évaluations ni réponses ultérieures des utilisateurs.
8. **Exécution en prod** : acte owner distinct, par un job de migration et d'import sur l'image Node existante de l'API ; aucun job Python.

### 6.6 Double annotation

**JUGEMENT, à confirmer (D9).** Plusieurs jeux d'étiquettes coexistent sans table supplémentaire : le verdict de Steve est dans `annotation_revisions` (sentropic) ; l'adjudication et la prédiction C vivent dans les versions gelées du jeu de référence (`ReferenceSetVersion`, engram) et les campagnes ; la classification du radar se recalcule.

| Jeu | Contenu | Statut |
|---|---|---|
| `steve-source-2026-09` | Verdict original de Steve (classement, motif, sens, passe, filtrage) ; faits et interprétations de l'analyse séparés | Immuable |
| `radar-bprime` | Classification calculée par le radar (axes zonage, résidentiel, étape, exclusions, B′), reconstituée à la date du relevé | Partielle : la classification serveur de septembre n'est pas archivée |
| `targeting-c-adjudication` | Adjudication par critère C, auteur nommé, preuves, motifs de changement | Une interprétation de l'équipe n'est pas un reclassement signé Steve |
| `radar-c-v1` | Prédiction machine de C, version du classifieur, traces | Une prédiction ne devient jamais label de référence |

Cela permet de mesurer B contre Steve aujourd'hui, puis C contre Steve, de tracer les désaccords ligne par ligne, et d'ajouter un second annotateur humain si Fabien veut mesurer l'accord.

---

### 6.7 Convergence sentropic + engram : qui porte quoi

FAIT pour la source : synthèse convergée de quatre sièges (engram et sentropic, deux modèles chacun), `graphify/.graphify/scratch/design/learning-loop/SYNTHESE.md`, 2026-10-04, avec revue sentropic intégrée. **Aucune décision n'y est prise** : ses huit décisions sont reprises ici en G1 à G8, décidées par Fabien.

- **Terminologie (G1)** : « oracle » est abandonné comme nom d'objet ; on dit **jeu de référence** (`ReferenceSet`), **version figée** (`ReferenceSetVersion`), **élément de référence** (`ReferenceItem`), partitions `dev` et `test` scellée ; la provenance est l'attribut `label_provenance` (`human_single`, `human_adjudicated`, `model_consensus`, `mixed`) : E = `model_consensus` (« silver ») ; le pilote C = `human_single` (un seul annotateur), « gold » en construction.
- **Répartition (G2)** : **sentropic porte l'humain** (identités par l'IdP partagé déjà utilisé par immo, commentaires, annotations versionnées, validations, adjudications, export haché) dans un paquet frère `@sentropic/annotations` ; **engram porte la mesure** (jeu de référence figé, split dev / test aveugle, sceau, runs, évaluateurs pluggables, statistiques, garde de promotion) ; **track porte les décisions** de gel et de promotion, attestées par h2a ; **le domaine** apporte un profil et des données.
- **Deux interfaces seulement** : un instantané haché des annotations validées, de sentropic vers engram (engram ne lit jamais la base vivante ; aucune partition dans l'export) ; un enregistrement de promotion qui lie la décision track aux empreintes du candidat.
- **Immo = profil + données** : profil `radar/ontology/ontology-profile.yaml` complété (schéma d'étiquettes C, évaluateurs `classification`, `span`, `typed_occurrence`, règle D13, unité de groupe = municipalité) ; données : PV, E, C, classeur de Steve, registre des municipalités. Immo ne construit pas ses six tables (G7).
- **Séquencement (G7)** : L0 contrats ; L1 parité des évaluateurs + un diagramme BPMN en recette ; L2 `@sentropic/annotations` et import, consommé dans sentropic ; L3 jeu de référence C v2 (51 villes en développement, 52 en test aveugle) ; L4 boucle BPMN. Le pilote C actuel devient `v0`, `flags: [exploratory, single-annotator]`, non admissible pour D13.
- **Rôles à désigner par l'owner** : responsable de la politique d'annotation, validateurs et arbitres, responsable du gel (Fabien proposé), gardien du test aveugle, décideur de promotion (le PRINCIPAL, sous veto de CONTROL-RECETTE).
- **Points ouverts de la synthèse** (§9 de la source) : refs lues différentes entre sièges ; port de stockage commun à décider ; consommation réelle exigée côté sentropic ; parseur de profil engram qui ignore les blocs inconnus ; profils sans registre ; petits effectifs (puissance faible) ; propriété du code BPMN d2d `non vérifié` ; chiffrage `non vérifié`.

**Articulation avec les décisions immo.** D2 devient « adoption du générique » (options revues). D4 est modifiée : les annotations relèvent de G2 et G3, D4 ne porte plus que sur les commentaires de l'équipe. D3, D5, D9, D10, D11, D13 et D15 gardent leurs options et dépendent désormais de G1 à G7. Aucune décision immo n'est sans objet.

## 7. Première mise en œuvre — base et UI

| Lot | Contenu | Sortie observable | Taille (JUGEMENT) | Dépend de |
|---|---|---|---|---|
| **B0** — réparer l'ancre signal | Ancre texte du graphe acceptée par l'API pour les notes de signal, sans clé étrangère ; correction de la comparaison auteur (`account_users.id` contre `sub`) ; tests sur un id réel `signal-…` | Une note sur un signal réel est créée, relue et éditée en préprod, preuve navigateur | S | D3 |
| **L1** — schéma et import | Migration nouvelle (tables du §6.3) ; script Node/TS dry-run puis réel en préprod ; rapport de résolution | 124 + 121 + 77 + 26 + 28 lignes stockées ; ré-import du même fichier = 0 écriture ; taux de résolution mesuré | M | D1, D2, D3 |
| **L2** — ancres et API lecture | Résolution sur snapshot ; `GET` par entité, lecture groupée par lot d'ancres (badges), lecture complète d'un retour sans limite de 10 000 ; cibles désignées selon le contrat sentropic (`kind:'record'`) ; événement SSE étendu | Contrat zod et tests ; une seule requête par vue pour les compteurs | S–M | L1, D4, D6 |
| **U1** — affichage lecture seule | Dans `SignauxSelPanel` : badge de classement (vert, jaune, rouge), sens et code, section « Avis de Steve » (analyse, suite, niveau de preuve, provenance, statut de résolution) ; compteurs P / S / N par ville dans le rail ; migration DS des 3 composants `collab/*` | Exemples réels consultables avec contenu complet ; aucun nouveau `<button>` brut | M | L2, D14 |
| **U2** — annotation et validation dans l'application | Steve annote, trie et corrige avec son compte ; l'équipe ou le PO valide ou conteste avec un motif ; chaque changement est une nouvelle version (tables `annotations`, `validations`, §6.3) | Une boucle complète en préprod : annotation de Steve, contestation, correction, validation, historique lisible | M | U1, D2, D5 |
| **O1** — jeu de référence de ciblage v1 | Export `reference-set-ciblage-steve-v1.json` depuis les évaluations et ancres ; partitions ; scoreur Node pour B (et C ensuite) | Tableau précision / rappel de B sur le jeu de référence | S–M | L1, D10 |
| **C1** — classifieur C en shadow | Extraction du sens par disposition, de la portée (plein droit / individuel), de la nature de la source (ODJ / PV), de l'effet sur les unités ; prédicat C côté serveur en parallèle de B | Précision / rappel de C contre B | L | O1, D7 |
| **C2** — comparaison et bascule | Diff B → C nommé ; parité API / rail / carte / panneau ; bascule si le seuil D13 est franchi | Décision de Farid sur mesure | S | C1, D12, D13 |
| **L7** — organisation #760 | Archiver, classer, lier, épingler hors période ; alertes seulement sur événement fiable | États durables et réversibles | N-A | maquette Steve/Mathieu, #703 |

Première valeur livrable : **B0 + L1 + L2 + U1**. O1 avance en parallèle de U1 une fois sources et ancres stabilisées. Les tailles S/M/L sont des appréciations, pas des charges mesurées.

**Parcours U1 depuis un signal.** Un badge « Retour de Steve » ouvre une section du panneau : classement original, code et sens ; analyse, niveau de preuve, suite proposée, recommandation ; fichier, feuille, numéro, ligne, révision ; état du rattachement et autres objets de la même ligne ; adjudication C distincte de la source le moment venu ; réponses des utilisateurs sous la restitution, sans édition du retour importé.

**Compteurs.** Un retour publié sur plusieurs objets ne compte qu'une fois dans le total d'import. Afficher séparément nombre de retours, nombre d'entités annotées et nombre de rattachements à confirmer. Les compteurs d'annotations ne changent pas le nombre de signaux des vues.

Tests futurs dans un environnement isolé `ENV=test-*` ou `ENV=e2e-*`, via Make, avec `down -v` après chaque stack. Cas de recette d'identité : Triage #1 (id complet), #7 (deux événements), #55 (dossier absent), #112 (ids abrégés), #110 (deux signaux proches).

---

## 8. Focus migration UI — geo et design system

**FAIT**, mesuré sur `origin/main` `27891b10`, `ui/` (application web monopage, Vite + Svelte 5). Les références sont textuelles : un import ne prouve pas une migration complète.

| Indicateur | Valeur | Lecture |
|---|---|---|
| Dépendances déclarées | design-system-svelte ^0.34.71, themes et tokens ^0.11.0, geo-core et geo-map-engine ^0.6.0, geo-ui-svelte ^0.1.1, chat-ui ^0.33.0 | Plages déclarées, pas version déployée |
| Racine | `App.svelte` dans `ThemeProvider`, thème Sent-Tech | Tokens disponibles pour les nouvelles surfaces |
| Composants `.svelte` | 69, dont **39** importent le DS (56,5 %) ; 63 hors stubs et harnais | Adoption large mais partielle, pas « 56,5 % migré » |
| Composants DS les plus utilisés | Badge (25 fichiers), Alert 19, Button 14, Card 12, EmptyState 11 | — |
| Composants DS jamais utilisés | Tabs, Modal, Table, Input, Textarea, Tooltip | — |
| Contrôles HTML bruts | **132** `<button>` dans 37 fichiers (125 dans 35 hors stubs et harnais) ; 13 `<input>` ; 7 `<textarea>` ; 6 `<select>` ; 8 `<table>` | Indice de reste, pas inventaire de violations |
| Couleurs | 1 668 classes de couleur Tailwind (49 fichiers) contre 370 `var(--st-*)` (13 fichiers) ; 481 couleurs hexadécimales | Tokens DS minoritaires |
| Carte Signaux | `SignauxMapView` → `GeoCityMapBase.svelte`, MapLibre local (2 761 lignes) ; geo-map-engine seulement pour le fond satellite | Non migrée |
| Composants geo partagés | Seule la route `#/geo` (`GeoView`) rend `GeoMap` + `GeoDetailPanel` | Pilote isolé, sans panneau d'annotations |
| Moteur geo partagé | `GEO3D_ENGINE_ENABLED = false` ; montage par défaut en attente de la « Porte 2 » | Désactivé ; l'activer exige caméra et sélection, pas seulement le booléen |
| Annotations `collab/*` | **0 sur 3** utilisent le DS (`<textarea>` ×2, `<button>` ×5, badge Tailwind) | À migrer dans U1 |
| `SignauxSelPanel` | Importe le DS, contient 16 `<button>` bruts | Point de montage des annotations |
| `@sentropic/comments`, focus | 0 référence | Adaptateurs à réaliser |
| Dernière mesure officielle | `audit-ds-realignement.md` (2026-06-14) : 5 OK, 29 à migrer | Aucune mesure plus récente : `source manquante` |

**Ce qui conditionne l'UI des annotations (JUGEMENT).**
1. On n'attend pas la migration geo : U1 vit dans le panneau et le rail, avec des composants DS déjà adoptés (Badge, Card, Alert, Popover, Drawer).
2. Les trois composants `collab/*` migrent vers le DS dans le même lot : faible coût, pas de dette ajoutée.
3. Une couche carte « annotations » (pastille par ville ou lot) attend la migration de `GeoCityMapBase` : sinon on ajoute du code à un composant local de 2 761 lignes destiné à être remplacé (D14).
4. Le badge par signal exige la lecture groupée de L2 : le comptage actuel n'affiche rien avant l'ouverture de la fiche.
5. Pas d'investissement dans l'UI de tri (#760) avant la maquette de Steve et Mathieu.

```mermaid
flowchart LR
  subgraph UI["ui · Vite + Svelte 5"]
    SMV["SignauxMapView"] --> GCB["GeoCityMapBase · MapLibre local"]
    SMV --> SR["SignauxRail · DS"]
    SMV --> SSP["SignauxSelPanel · DS partiel"]
    SSP --> COL["collab/* · non DS"]
    SSP -.-> AV["Avis de Steve · DS (U1)"]
    SR -.-> CPT["Compteurs P/S/N (U1)"]
    GV["GeoView #/geo"] --> GUI["geo-ui-svelte"]
  end
  subgraph API["api · Hono"]
    GS["/api/graph-signals · B (+C shadow)"]
    PN["/api/v1/prospects/notes"]
    AN["annotations · lecture groupée (L2)"]
  end
  SSP --> GS
  COL --> PN
  AV --> AN
  GCB -.-> GUI
```

---

## 9. Ciblage réorienté, nouveau jeu de référence, double annotation et affichage A/B/C

### 9.1 B actuel

- **FAIT.** Le contrat B′ définit son défaut par `!exclusion && zonage && residentielEligible && precoce`. Le résidentiel indéterminé est éligible pour certains instruments ; l'étape précoce est avis de motion ou projet de règlement. B′ est un vivier de découverte : son appartenance « ne prouve pas une hausse de densité ».
- **FAIT.** Le sélecteur A/B a été retiré du rail (`f2c20573`, 2026-08-22) : `SignauxRail` rend directement B, les anciennes clés A sont normalisées vers B. Les comptes A sont encore calculés côté serveur.
- **Conséquence.** Ajouter C n'est pas ajouter un troisième onglet à un sélecteur actif : toute comparaison A/B/C est un mécanisme à réexposer.

### 9.2 Critères C proposés

Un signal est **dans C** si aucune exclusion **établie** ne s'applique ; il est **confirmé** si les critères requis sont étayés, **à instruire** sinon. Les étiquettes de Steve servent de vérité par critère.

| # | Critère | Règle de Steve | Donnée disponible (FAIT) | Donnée à produire |
|---|---|---|---|---|
| K1 | Règlement d'urbanisme (pas matières résiduelles, emprunt, gestion contractuelle, subvention, éthique) | analyse ; N-FAUX-POSITIF, N-ADMIN | `category` fourre-tout (`rezonage`, C-52) | Nature de l'acte sur le titre complet |
| K2 | Résidentiel ; agricole seulement en dézonage CPTAQ résidentiel | critère 1, R-18 | `res` par regex et instrument | Usage visé, préfixe de zone (C-55) |
| K3 | Sens ≠ purement restrictif ; mixte et indéterminé restent visibles | critère 2, R-21, C-57, C-66 | aucune | `sens` par disposition, 5 valeurs |
| K4 | Densification : plus d'unités qu'avant | critère 3, R-08 | `effet_densifiant` toujours `inconnu` | `effet_unites` avant / après (C-72) |
| K5 | De plein droit, non individuel (exclut PPCMOI, dérogation, usage conditionnel, Loi 31, CPTAQ individuelle sauf R-18) | R-06, R-09, R-10 | `instrument` | Portée du droit ; finalité CPTAQ (C-53) |
| K6 | Capacité de construire (exclut PIIA, construction, clôtures ; lotissement seulement s'il agit seul, R-22) | R-06, R-15, R-22 | instrument piia | Rattachement du lotissement au dossier |
| K7 | Décision, pas simple point d'ordre du jour ; un point retiré est mort | R-01, R-02, R-23 | nature du document source : `non vérifié` | `source_nature` et état du point (C-35) |
| K8 | Étape : avis de motion, premier projet, **second projet**, mandat d'urbaniste, résolution CPTAQ | R-05, R-23, C-82, C-68 | `etape ∈ {avis_motion, projet_reglement}` | `second_projet` ; cycle par famille d'instrument |
| K9 | Épinglé ⇒ visible quelle que soit la période | R-25, C-69 | aucune | Hors C (#760), mais C le respecte |

**Règle d'asymétrie (contraignante).** Une absence de données n'est jamais une preuve négative. Si K3 ou K4 sont `indéterminé`, le signal reste dans C, état « à instruire ». On ne masque que ce qui est établi hors critères. Par construction, C ne dégrade pas le rappel sur les cas illisibles ; son gain porte sur la précision. Deux compteurs distincts, « confirmés » et « à instruire », évitent de présenter une conservation prudente comme une opportunité avérée.

**Cas à arbitrer par Steve plutôt que par regex (D8)** : Saint-Victor (resserrement des maxima de lots qui favorise la densification, R-22) ; Amos (logement sur commerce rejeté par l'analyse) ; portée exacte de l'exception CPTAQ ; seconds projets (R-19 contre C-82) ; visibilité des ODJ ; trois restrictions À surveiller (S-RESTRICTIF) contre R-21 ; ligne Mixte #41 non pertinente alors que l'analyse protège les mixtes ; rangement des 5 Mixte dans la reconstitution 22/12/15/24 ; table de dérivation code de motif → critères (S-CONTRAINTE, S-PPCMOI-SERIE, S-PREEMPTION ne se projettent pas proprement).

### 9.3 Nouveau jeu de référence (#783)

#### Ancien jeu de référence → nouveau jeu de référence : la proposition

**Rien n'est remplacé ; on ajoute un jeu de référence et un volet de mesure.** Le jeu de référence d'extraction existant (E, v3) reste tel quel et continue de noter l'extraction des actes ; le jeu de référence de ciblage (C) est construit à partir des retours de Steve et note la sélection des signaux. Le benchmark #782 publie deux volets séparés, jamais fusionnés. Ce choix est la décision **D10** (option b, recommandée) ; les options a et c en sont les alternatives, chacune avec son schéma au §10.

```mermaid
erDiagram
    consensus_modeles ||--|| jeu_ref_e_v3 : construit
    annotations ||--|| jeu_ref_c_v1 : adjugees_gelees
    jeu_ref_e_v3 ||--|| volet_extraction : note
    jeu_ref_c_v1 ||--|| volet_ciblage : note_b_puis_c
    consensus_modeles {
      text methode "7 passes, 3 familles de modèles"
      text arbitrage "vote unanime + arbitrage"
    }
    annotations {
      text source "verdicts de Steve (124 lignes)"
      text adjudication "par critère, auteur nommé"
    }
    jeu_ref_e_v3 {
      text question "a-t-on extrait l'acte ?"
      text unite "acte d'un PV : étape + citation"
      int taille "674 sur 100 documents"
      text stockage "fichiers JSON du dépôt"
    }
    jeu_ref_c_v1 {
      text question "fallait-il montrer ce signal ?"
      text unite "signal, regroupé par dossier"
      text jeux "dev 51 villes, test 52 villes"
      text stockage "reference_set_versions + JSON gelé"
    }
    volet_extraction {
      text mesure "extraction historique, inchangée"
    }
    volet_ciblage {
      text mesure "précision, rappel : B puis C"
    }
```

<!-- diagram:jeux-reference -->

| | Ancien : jeu de référence E (extraction, v3) | Nouveau : jeu de référence C (ciblage, v1) |
|---|---|---|
| Question | A-t-on extrait l'acte d'un procès-verbal (étape + citation) ? | Fallait-il montrer ce signal à Steve ? |
| Construit par | 7 passes de 3 familles de modèles, vote unanime et arbitrage (commit `dd0561f6`) | Les évaluations et ancres de Steve (lot L1), adjugées critère par critère par un auteur nommé, avec preuve |
| Stockage | Fichiers JSON du dépôt (`v101b/oracle-v3/`), hors `main` | Une `ReferenceSetVersion` engram (manifeste, partitions, sceau, sha256) tirée d'un instantané haché des annotations validées + export gelé `reference-set-ciblage-steve-v1.json` versionné dans le dépôt, à côté du jeu de référence E |
| Jeux | 100 documents | Développement : les 51 villes du relevé ; test : les 52 villes suivantes, jamais vues ; un dossier entier dans une seule partition |
| Gel et version | 674 committé ; **676 à committer et geler par empreinte avant toute campagne** | Gelé par sha256 avant la mesure ; toute correction = nouvelle version (v2…), jamais une modification en place |
| Qui valide | Fabien (D10, D11) | Fabien valide la construction et le gel (D10) ; Steve et Mathieu tranchent les cas contradictoires (D8) ; Farid fixe le seuil qui utilise la mesure (D13) |
| Ce qu'il note | Toute campagne d'extraction (modèles, prompts) | B aujourd'hui, puis C en shadow ; base de la bascule B → C |

**Étapes proposées.** 1) Committer et geler le jeu de référence E 676. 2) Importer les retours de Steve (L1). 3) Adjuger les labels C sur les 51 villes et geler `reference-set-ciblage-steve-v1` (O1). 4) Mesurer B sur ce jeu de référence. 5) Mesurer C en shadow (C1). 6) Quand Steve aura relevé les 52 villes suivantes, les annoter en jeu de test aveugle et geler v2. 7) Publier les deux volets du benchmark, chacun contre sa version gelée.

| | Jeu de référence E — extraction | Jeu de référence C — ciblage |
|---|---|---|
| Question | A-t-on extrait l'acte ? | L'aurait-on montré à raison ? |
| Unité | acte d'un PV (étape + citation) | signal (nœud du graphe), regroupé par dossier pour les jumeaux et les grappes |
| Étiquettes | étape | classement P/S/N, motif, sens, filtrage, critères K1–K8 dérivés du motif (table relue par Steve) |
| Origine | consensus de 3 familles de modèles, ancrage textuel, arbitrage ; pas d'annotation humaine | Steve (source), adjudication nommée |
| Version | 674 unités / 47 non résolus committés sur `feat/t1-model-benchmark-real` (`dd0561f6`) ; 676 / 43 en copie locale identifiée par sha256 (`consensus.json` `8e8e9cc0…`), non committée | `reference-set-ciblage-steve-v1`, à geler |

« 676 » est le nombre d'unités, pas la carte #676 (déploiement immo-mcp) ; le suivi du jeu de référence est #725. **La version 676 doit être committée et gelée par empreinte avant la campagne suivante.**

**Construction.**
1. Figer règles et unités ; séparer détection d'acte, qualification C et affichage.
2. Manifeste de corpus : documents, empreintes, millésimes, profils de filtre, liens vers les retours. L'intersection avec les 100 documents du banc est `non vérifié`, probablement faible.
3. Le jeu de Steve sert de régression et de jeu de développement ; seuls les labels rattachés et étayés entrent dans la référence notée.
4. Étendre la vérité documentaire : les retours issus de l'écran ne mesurent pas les opportunités jamais extraites (sept dossiers manqués).
5. Adjudication indépendante des sorties des modèles candidats ; désaccord métier → revue humaine ; absence de preuve → non résolu.
6. **Séparation développement / test** : les 51 villes du relevé pour régler C, les 52 suivantes annoncées par Steve comme jeu de test aveugle ; toutes les unités d'un même dossier dans la même partition.
7. Geler chaque version (sha256) ; ne jamais comparer deux bras sur deux versions différentes.

**Base B mesurée sur l'échantillon de Steve (CALCUL, passe 1 = 73).**

| Mesure | Valeur | Calcul |
|---|---:|---|
| Bruit (Non pertinent) | 32,9 % | 24/73 |
| Précision P ∪ S | 67,1 % | 49/73 |
| Précision P | 46,6 % | 34/73 |
| Précision « trois critères » | 30,1 % | 22/73 |
| Part des P en passe 1 | 85 % | 34/40 |
| Part des P en passe 1 ou 2 | 95 % | 38/40 |

<!-- chart:base-b -->

Biais : 124 signaux sur 146, 51 villes sur 103, choisies dans l'ordre du relevé ; non représentatif du parc (JUGEMENT).

### 9.4 Impacts sur le benchmark (#782)

| Mesure | Règle | Pourquoi |
|---|---|---|
| Extraction historique | Même jeu de référence E, même corpus, même méthode ; refus comptés en manqués | Comparabilité ; détecter une perte d'extraction |
| Précision et rappel post-filtrage de B, puis de C | Jeu de référence C, même snapshot | Sens concret du « rappel max post-filtrage » de #782 |
| Rappel critique | Aucun Pertinent masqué, en particulier mixtes et indéterminés | Réserve d'asymétrie de Steve |
| Couverture de qualification | Unités au verdict C étayé / unités candidates ; indéterminés publiés à part | Éviter un gain obtenu par abstention |
| Effet B → C | Entrants, sortants, conservés, nommés avec raison | Expliquer au lieu de proclamer |
| Parité d'affichage | Mêmes ensembles API / rail / carte / panneau, même profil, mêmes dates | Défaut de classe relevé dans #786 |
| Coût utile | Coût, latence, refus par opportunité C retrouvée | Aujourd'hui `N-A` |

Les tableaux extraction et ciblage restent séparés, sans fusion des F1. Pont possible : id Steve → nœud → `docRefs.docSha` → unités E, seulement pour les 100 documents du corpus. Toute modification du prompt gelé `immo-pv-extraction-v9` pour produire sens, effet et portée rompt la comparabilité v10/v11 : nouvelle version du contrat, décision dédiée (D11). Aucun changement de modèle principal n'est recommandé sur la seule base des retours de Steve.

### 9.5 Affichage A/B/C

| Profil | Rôle | Conservation |
|---|---|---|
| A | Référence historique (`z/m/p`), calculée côté serveur | Gelée ; pas de retour silencieux à A |
| B | Vivier actuel, défaut pendant la recette de C | Contrats B′ conservés ; ce que C retire ne disparaît pas de B |
| C | Ciblage Steve, versionné, calculé côté serveur sur le même inventaire | États confirmé / à instruire / exclu prouvé, chaque exclusion expliquée |

**Divergence non tranchée par les sources (D12).**
- Auteur B : C en shadow, comparée à B sur le jeu de référence, aperçu UAT par un paramètre non documenté, puis **remplacement** de B au seuil. Argument : #787 demande de ne pas réintroduire de choix entre plusieurs viviers, et Steve veut une interface plus simple.
- Auteur A : B par défaut, C expérimental, **sélecteur et mode comparatif A/B/C**, paramètre dédié du type `filter.targeting=a|b|c` (et non `mode`, déjà pris par le parcours geo).
- Vérification : la phrase de #787 figure dans l'item 4 du comportement attendu (grammaire d'URL), règles validées par l'owner le 1er octobre ; elle ne figure pas dans la liste « Décisions du propriétaire ». Le brief de ce dossier parle d'un « mécanisme A/B d'affichage étendu en C ». Les deux lectures sont défendables ; Farid tranche, après consultation de Steve, Mathieu et Fabien.
- **Recommandation consolidée** : C en shadow, comparaison A/B/C dans un mode réservé à l'UAT et aux administrateurs, B par défaut, aucun choix de vivier exposé aux utilisateurs courants ; bascule au seuil D13. Si Farid veut un sélecteur visible, la variante de l'auteur A s'applique, avec URL complète conforme à #787.

**Dates orthogonales au ciblage.** Date documentaire, de collecte, de l'acte, du retour et de l'import restent distinctes. C consomme les dates de #788 via la politique de #786, sans relancer de modèle de langage (LLM) à l'affichage. Un dossier épinglé hors période figure dans une liste de suivi, pas dans un total limité à la période. Les comparaisons A/B/C figent l'horloge des périodes relatives.

**Diagrammes** : critères de Steve en regard de l'existant (matrice), modèle de données (entité-relation), architecture de l'import à l'affichage avec le jeu de référence transversal (couloirs), architecture UI et A/B/C sont rendus en scènes Focus (annexe B).

---

### 9.6 Tags et métriques d'évaluation

**On mesure deux choses distinctes.**
1. **La classification** : le verdict de Steve sur chaque ligne, Pertinent (P), À surveiller (S) ou Non pertinent (N). La tâche évaluée est **« montrer à Steve »** : un signal doit être montré s'il est P ou S (deux classes positives) et masqué s'il est N. C'est ce que note le jeu de référence C.
2. **Les tags** : les attributs qui expliquent le verdict, posés par Steve ou tirés de son motif :
   - **résidentiel** : oui, non, indéterminé ;
   - **sens de la modification** : assouplissement, restriction, mixte, neutre, indéterminé ;
   - **densification** (plus d'unités qu'avant) : oui, non, indéterminé ;
   - **exclusions** : autorisation individuelle, point d'ordre du jour, pas un règlement d'urbanisme, sans effet sur la capacité ;
   - **type d'acte** : avis de motion, projet, second projet, adoption, autre ;
   - **motif** : l'un des 28 codes de Steve.

   **Le verdict se dérive des tags par une règle déterministe** : la table de dérivation relue par Steve (D7, D8). On mesure donc séparément ce que le modèle lit (les tags) et la règle qui en tire le verdict.

**Métriques.**

| Niveau | Métrique | Ce qu'elle dit |
|---|---|---|
| Par tag | précision, rappel et F1 par valeur ; κ (kappa de Cohen) entre Steve et le modèle, et entre deux annotateurs humains quand il y en a deux | Où le modèle se trompe sur les faits (sens, densification, exclusions) |
| Classification | précision, rappel et F1 de « montrer » (P ∪ S) ; **bruit** = part des N montrés ; **Pertinents perdus** = P masqués (contrainte critique : aucun) | Utilité pour Steve |
| Baseline | les mêmes métriques pour les filtres B actuels, passes 1, 2 et 3 (§5.2, §9.3) ; par exemple bruit de B en passe 1 = 24/73 = 32,9 % | Ce que C doit battre (D13) |

- **Unité de mesure** : la ligne de Steve rattachée à un signal, pas le signal brut ni le document. Une ligne qui vise plusieurs signaux compte une fois ; une ligne agrégée sans signal n'entre pas dans la classification. Groupe : la municipalité (split et intervalles par grappes).
- **Découpage optimisation / test** : une étape du protocole (§9.7), décidée **après** l'étiquetage des tags, par ville et équilibrée sur le verdict et les tags ; aucun effectif n'est figé à ce stade, et aucune évaluation n'est faite.
- **Biais de sélection** : Steve n'a annoté que ce que ses filtres lui montraient (passes 1 à 3). Le rappel mesuré sur ce jeu ne compte pas les opportunités jamais extraites (les sept dossiers manqués) ; les résultats portent la mention `pool-limited-to-shown-items`.

**Couverture des tags par les données de Steve** — en attente du premier jet d'étiquetage (Astra max, revue Opus 5.5 max).

| Tag | Valeurs | Lignes couvertes | Valeurs « indéterminé » | Accord avec le motif de Steve |
|---|---|---|---|---|
| Résidentiel | oui, non, indéterminé | en attente du premier jet | en attente du premier jet | en attente du premier jet |
| Sens | 5 valeurs | en attente du premier jet | en attente du premier jet | en attente du premier jet |
| Densification | oui, non, indéterminé | en attente du premier jet | en attente du premier jet | en attente du premier jet |
| Exclusions | 4 familles | en attente du premier jet | en attente du premier jet | en attente du premier jet |
| Type d'acte | 5 valeurs | en attente du premier jet | en attente du premier jet | en attente du premier jet |
| Motif | 28 codes | en attente du premier jet | en attente du premier jet | en attente du premier jet |

### 9.7 Protocole anti-contamination (résumé)

**À ce stade, aucune évaluation n'est faite.** Le protocole fixe l'ordre des étapes ; aucune n'a encore produit de mesure.

1. **Prompts v1 et v2 du pilote C éradiqués** : la v2 avait été réglée sur un agrégat qui incluait des lignes du test ; ils ne servent plus à rien, ni comme base ni comme exemple.
2. **Étiquetage des tags** (premier jet, §9.6) sur les lignes de Steve.
3. **Découpage optimisation / test, décidé après l'étiquetage**, en fonction des tags : toujours par ville (une ville ne traverse jamais le découpage), équilibre sur le verdict et sur les tags, aucune valeur de tag présente d'un seul côté. Les effectifs ne sont pas figés à ce stade.
4. **Nouvelle v1 du prompt** écrite par un auteur qui ne voit que la partie optimisation, les **3 critères** de Steve et les **catégories** (tags, motifs) : aucune ligne du test, aucun résultat antérieur.
5. **Test réservé scellé** : gelé et engagé dans track avant tout appel de modèle ; **un seul passage, après gel du prompt**. Toute modification ensuite exige des lignes neuves (les 52 villes suivantes, C v2).

Ce pilote reste `v0` exploratoire (G7) : il éclaire, il ne fonde pas la bascule D13 (G5).

## 10. Options et recommandation

**Ordre de décision.** Fabien décide d’abord les huit décisions génériques G1 à G8 (convergence sentropic + engram, §6.7), puis ses sept décisions immo (D1, D2, D3, D4, D9, D10, D11) : D1 est déjà actée par l’owner le 2026-10-04 (tout conserver) ; les autres sont prises telles quelles, sauf incohérence avec une autre décision. Farid décide ensuite ses neuf décisions (D5, D6, D7, D8, D12, D13, D14, D15, D16), en connaissant les choix de Fabien. Si un choix de Farid contredit un choix de Fabien (par exemple D1 « tout conserver » avec D2 = (c), une table de contrôle qui n’affiche rien), on revient à Fabien sur ce seul point.

Chaque décision s'ouvre sur une courte introduction (le problème, pourquoi maintenant, ce qui change selon le choix, les renvois au dossier), dit de quelles décisions elle dépend, puis détaille chaque option : une description de ce qui est proposé, ses avantages et ses inconvénients, et pour D2 et D3 un schéma de tables par option. Les coûts sont des jugements relatifs de périmètre, pas des estimations d'heures ni de budget (`N-A` jusqu'à l'inventaire des rattachements).

### Étape 1 · Fabien décide d’abord (décisions génériques G1 à G8, puis architecture, données, jeu de référence)

#### G1 — Terminologie et provenance du jeu de référence
**Étape 1 · Décide : Fabien · Consulté : Farid.** Prise telle quelle, sauf incohérence avec une autre décision.

Le mot « oracle » désigne, en génie logiciel, le mécanisme qui rend le verdict d’un test, pas un jeu de réponses ; les quatre sièges de la convergence le rejettent comme nom d’objet (§6.7). Il faut un terme commun à immo, BPMN et aux paquets génériques avant d’écrire les contrats, et une façon de dire d’où viennent les étiquettes. Ce dossier applique déjà la recommandation : « jeu de référence » partout, avec l’attribut label_provenance (E = machine, « silver » ; C = un seul annotateur humain, Steve, « gold » en construction). Le renommage ne change aucune empreinte.

**Dépend de :** aucune décision antérieure. **Conditionne :** G2 (G2 — Porteurs et forme de l’annotation), G5 (G5 — Scellement et stockage des jeux de référence), D9 (Sens de « double annotation »), D10 (Jeu de référence #783).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| (a) Garder « oracle » avec une définition locale | On garde le mot partout (glossaire, tables, scripts) et on le définit dans chaque dossier comme « jeu de réponses de référence ». | • Aucun renommage de tables, de scripts ni de textes.<br>• Terme déjà connu de l’équipe immo. | • Contredit le sens établi (verdict d’un test) : malentendus avec sentropic, engram et la littérature.<br>• Ne dit rien de la provenance (machine ou humain). |
| (b) « Gold standard » / « vérité terrain » | On nomme le jeu « gold standard » (EN) et « vérité terrain » (FR), pour E comme pour C. | • Termes usuels en évaluation.<br>• Faciles à comprendre. | • Faux pour E, construit par consensus de modèles (silver), et pour C pilote, un seul annotateur.<br>• « Vérité » unique critiquée (Aroyo et Welty 2015 ; IEEE 7014-2024). |
| **(c) « Jeu de référence » (ReferenceSet) + label_provenance** (recommandée) | Objet ReferenceSet, versions figées ReferenceSetVersion, éléments ReferenceItem ; un attribut label_provenance ∈ {human_single, human_adjudicated, model_consensus, mixed}, d’où les libellés « référence validée (gold) » et « référence machine (silver) ». | • Exact pour E (model_consensus) et pour C (human_single, puis human_adjudicated).<br>• Aligné sur HF evaluate (references), spaCy (Example.reference) et le VIM.<br>• La provenance sert directement à la règle de promotion (G6). | • Renommage dans le glossaire, les tables proposées et quelques scripts (oracle_eval.py, oracle_versions).<br>• Nouveau vocabulaire à expliquer à l’équipe. |

**Recommandation : (c) « Jeu de référence » (ReferenceSet) + label_provenance.** (c) : seul terme exact pour E comme pour C, aligné sur les usages établis (HF evaluate, spaCy, VIM) ; la provenance devient un attribut au lieu d’un mot dans le nom.

#### G2 — Porteurs et forme de l’annotation
**Étape 1 · Décide : Fabien · Consulté : Farid.** Prise telle quelle, sauf incohérence avec une autre décision.

Les retours de Steve, ses annotations futures et les validations de l’équipe doivent vivre quelque part ; la même boucle existe déjà trois fois dans les domaines (immo E, brouillon C, BPMN d2d). Le module comments de sentropic ne convient pas à la validation : il édite en place et supprime physiquement (§6.0, §6.7). Il faut décider qui porte l’annotation et sous quelle forme, avant que D2 (modèle immo) puisse être tranchée. Concrètement : soit immo écrit ses tables, soit un paquet générique les fournit, avec ses tables dans le Postgres d’immo.

**Dépend de :** G1 (G1 — Terminologie et provenance du jeu de référence). **Conditionne :** G3 (G3 — Sémantique de version et effacement), G4 (G4 — Autorité de validation et rôles), G7 (G7 — Séquencement, tables immo et pilote C), D2 (Modèle de données immo : adoption du générique), D3 (Ancre signal et correctif B0), D4 (Conformité sentropic et suppression).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| (a) Le domaine (six tables immo) | Chaque domaine écrit ses tables d’annotation : pour immo, les six tables de la version précédente du dossier. | • Livrable vite, sans attendre un paquet.<br>• Modèle sur mesure pour Steve. | • Réimplémentation : chaque domaine refait la boucle (« prevent each new app … from inventing a private model »).<br>• Pas de mise en commun avec BPMN ni avec sentropic. |
| **(b) Paquet frère @sentropic/annotations** (recommandée) | Un nouveau paquet sentropic porte annotations, révisions, validations, adjudications et cibles, avec un adaptateur Postgres (./pg) installé dans la base de l’hôte et un port vers son stockage objet ; comments reçoit seulement deux évolutions (tombstone, types ouverts déplacés vers le port hôte, sans changement d’UI). | • Une seule implémentation pour immo, BPMN et sentropic.<br>• Réemploi de CommentTarget, CommentAuthor et de l’IdP partagé.<br>• Données dans la base de l’hôte (résidence des données respectée). | • Paquet à créer, avec une consommation réelle dans sentropic exigée dès L2.<br>• Immo dépend de son calendrier (G7). |
| (c) Étendre comments | On ajoute révisions, validations et statuts au module comments existant : un commentaire devient aussi une annotation validable. | • Un seul module à connaître.<br>• Pas de nouveau paquet. | • Casse la sémantique du commentaire : « résolu » n’est pas « validé ».<br>• Les quatre sièges rejettent cette voie. |
| (d) h2a ou track | Les annotations sont portées par h2a ou par track, à côté des décisions, dans leurs propres journaux. | • Proche des outils de décision existants.<br>• Pas de nouveau paquet à publier. | • Hors de leur rôle : track porte des décisions, pas des données métier.<br>• Pas d’écran ni de cible métier dans ces outils. |
| (e) Tout dans engram, en fichiers | Annotations et validations sont des fichiers versionnés dans le dépôt, lus par engram. | • Simple pour un jeu figé.<br>• Versionnage par git. | • Pas de saisie dans l’application ni de boucle de validation pour Steve.<br>• Données personnelles dans un dépôt. |

**Recommandation : (b) Paquet frère @sentropic/annotations.** (b) : réemploi des cibles et des auteurs de comments et de l’IdP sentropic, sans casser la sémantique du commentaire ; les données restent dans la base de l’hôte. L’évaluation reste un module d’engram, indépendant du producteur.

#### G3 — Sémantique de version et effacement
**Étape 1 · Décide : Fabien · Consulté : Farid.** Prise telle quelle, sauf incohérence avec une autre décision.

Une annotation change : Steve corrige, l’équipe conteste, un retour est retiré. Il faut décider comment une modification est gardée, sur quoi porte une validation et comment on efface une donnée personnelle (Loi 25, décision O1 du dossier COLLAB : tombstone et rétention). Ce choix fixe ce que le jeu de référence peut citer : une révision précise, désignée par son empreinte. Il remplace, pour les annotations, la question posée par D4 sur la suppression (§6.7).

**Dépend de :** G2 (G2 — Porteurs et forme de l’annotation). **Conditionne :** D4 (Conformité sentropic et suppression).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| **(a) Révisions immuables chaînées, validation liée au hash, tombstone** (recommandée) | Chaque modification crée une révision immuable (content_hash, prev_content_hash) ; une validation porte sur une révision désignée par son hash ; le statut courant est calculé ; un effacement laisse un tombstone (corps purgé, hash gardé). | • Aucune modification ne se perd ; l’historique se relit.<br>• Une validation ne « glisse » jamais sur une version qu’elle n’a pas vue.<br>• Compatible Loi 25 et décision O1. | • Plus de lignes stockées.<br>• Calcul du statut à chaque lecture (ou vue matérialisée). |
| (b) État modifiable + journal d’audit | L’annotation est modifiée en place ; un journal à part garde les changements, sans lien avec les validations. | • Simple à lire : une ligne par annotation.<br>• Proche des tables existantes (prospect_notes). | • Une validation peut porter sur un état qui a changé depuis.<br>• Le journal et l’état peuvent diverger. |
| (c) Journal pur (événements) | Seuls des événements sont stockés ; tout état se reconstruit en rejouant le journal. | • Historique complet par construction.<br>• Rejouable pour reconstruire un état passé. | • Lecture coûteuse pour l’application.<br>• Effacement Loi 25 difficile dans un journal immuable. |

**Recommandation : (a) Révisions immuables chaînées, validation liée au hash, tombstone.** (a) : l’absence d’écrasement est garantie par construction, une validation reste attachée à ce qu’elle a validé, et l’effacement purge le corps en gardant l’empreinte.

#### G4 — Autorité de validation et rôles
**Étape 1 · Décide : Fabien · Consulté : Farid.** Prise telle quelle, sauf incohérence avec une autre décision.

La boucle de validation demandée par l’owner (Steve annote, l’équipe ou le PO valide ou conteste, §6.3) suppose de dire qui a le droit de faire quoi. Sentropic ne connaît aujourd’hui aucun rôle de revue : seulement des rôles de workspace, de tenant et globaux (§6.7). Il faut décider comment ces rôles s’attribuent, ce que peut faire un agent (modèle, MCP) et qui décide d’un gel ou d’une promotion. D5 (compte de Steve) et D8 (cas contradictoires) en dépendent.

**Dépend de :** G2 (G2 — Porteurs et forme de l’annotation). **Conditionne :** G6 (G6 — Règle et porteur de la promotion), D5 (Auteur des retours importés).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| **(a) Attributions par (workspace, profil), agents en proposition seulement** (recommandée) | Chaque rôle (annotateur, validateur, adjudicateur, curateur, décideur) s’attribue pour un workspace et un profil ; un agent ou un connecteur MCP lit et propose, sans valider ; gel et promotion sont des actes humains. | • Steve peut valider le ciblage sans droit sur d’autres domaines.<br>• Les agents ne signent jamais (B2B2B).<br>• Une promotion repose sur une référence humaine adjugée. | • Gestion d’attributions à construire dans sentropic.<br>• Rôles à désigner par l’owner (voir §6.7). |
| (b) Dérivées des rôles de workspace | Les rôles de workspace existants suffisent : un éditeur peut valider, un administrateur peut geler un jeu. | • Aucune nouvelle notion de rôle.<br>• Rien à construire dans sentropic. | • Mélange droit d’édition et compétence métier.<br>• Un éditeur quelconque pourrait valider le ciblage de Steve. |
| (c) Validation par la machine seule | Un modèle ou une règle valide automatiquement les annotations, sans intervention de l’équipe ni du PO. | • Rapide, sans charge humaine.<br>• Aucune attente de validation. | • Circularité : le jeu de référence noterait des modèles avec des étiquettes de modèles.<br>• Contraire à la vision owner (validation par l’équipe ou le PO). |

**Recommandation : (a) Attributions par (workspace, profil), agents en proposition seulement.** (a) : la compétence est liée au profil (Steve sur le ciblage, pas sur BPMN), les agents ne font que proposer, et seul un humain décide d’un gel ou d’une promotion ; une promotion exige une référence human_adjudicated.

#### G5 — Scellement et stockage des jeux de référence
**Étape 1 · Décide : Fabien · Consulté : Farid.** Prise telle quelle, sauf incohérence avec une autre décision.

Un jeu de référence n’a de valeur que si sa partie test n’a jamais servi à optimiser un prompt ; le pilote C l’a montré : son test aveugle est consommé et partiellement contaminé (§9.7). Il faut décider comment la partie test est protégée et où les jeux sont stockés, sachant que le dépôt radar est public et qu’un agent en ligne de commande peut lire les fichiers. D10 (jeu de référence #783) et D13 (seuil de bascule) en dépendent.

**Dépend de :** G1 (G1 — Terminologie et provenance du jeu de référence). **Conditionne :** G6 (G6 — Règle et porteur de la promotion), D10 (Jeu de référence #783).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| **(a) Procédural : garde, sceau track, journal d’exposition** (recommandée) | Le runner refuse de passer deux fois sur le test ; l’engagement de contenu est inscrit dans track avant tout appel de modèle ; chaque exposition est journalisée ; les éléments sont dans un stockage objet privé, seuls manifestes et empreintes sont publics. | • Couvre les défauts observés sur le pilote C.<br>• Réalisable tout de suite. | • Repose sur la discipline : un agent peut encore lire un fichier local.<br>• Insuffisant seul pour une bascule (D13). |
| (b) Chiffrement, clé chez un gardien | La partie test est chiffrée ; la clé est détenue par un gardien qui ne l’ouvre que pour la passe unique. | • Protection technique réelle.<br>• Résiste à la lecture des fichiers par un agent. | • Gestion de clés et de rôles à mettre en place.<br>• Passe de notation plus lourde. |
| (c) Service de notation | Le test ne quitte jamais un service qui reçoit les prédictions et ne rend que les scores. | • Aucune exposition des attendus.<br>• Une seule passe par candidat, garantie par le service. | • Service à construire et à exploiter.<br>• Diagnostic d’erreurs plus difficile. |

**Recommandation : (a) Procédural : garde, sceau track, journal d’exposition.** (a) en v1 (garde, sceau inscrit dans track avant tout appel de modèle, journal d’exposition, stockage privé) ; (b) ou (c) obligatoire pour tout jeu qui fonde une bascule (D13). Stockage : objet privé de l’hôte, derrière un port du paquet ; manifestes publics.

#### G6 — Règle et porteur de la promotion
**Étape 1 · Décide : Fabien · Consulté : Farid.** Prise telle quelle, sauf incohérence avec une autre décision.

Promouvoir un candidat (prompt, modèle, effort) en production doit reposer sur une preuve mesurée sur le jeu figé, pas sur une impression. Il faut décider si la règle est commune aux domaines, qui la décide et qui l’applique. La règle immo de bascule B → C (D13) en est une instance, et D11 (benchmark #782) en fournit les preuves (§6.7).

**Dépend de :** G4 (G4 — Autorité de validation et rôles), G5 (G5 — Scellement et stockage des jeux de référence). **Conditionne :** G8 (G8 — BPMN : producteur, code d2d, constructeur silver), D11 (Benchmark #782), D13 (Seuil de bascule B → C).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| **(a) Gabarit générique préenregistré, décision track, garde engram** (recommandée) | Critères écrits avant la passe test (contraintes critiques, non-infériorité avec marge, pas de régression par classe, coût) ; décision track à au moins deux options dont « garder la production » ; la production refuse toute empreinte sans « go ». | • Comparabilité entre domaines.<br>• Preuve liée au tuple exact promu.<br>• Retour arrière par une nouvelle décision. | • Demandes à track (preuve d’évaluation) et à h2a (voie de signature).<br>• Discipline de préenregistrement. |
| (b) Règle libre par domaine | Chaque domaine écrit sa règle de promotion et son circuit de décision, sans gabarit commun. | • Souplesse.<br>• Aucun gabarit commun à négocier. | • Pas de comparabilité ; règles réécrites après coup.<br>• Pas de garde commune en production. |
| (c) Recette seule | La promotion se décide sur une recette humaine, sans mesure chiffrée sur le jeu de référence. | • Rapide.<br>• Aucun outillage de preuve. | • Aucune garantie de non-régression.<br>• Le jeu de référence ne sert plus à décider. |
| (d) Seuil automatique | Un candidat qui dépasse un seuil fixé à l’avance est promu automatiquement, sans décision humaine. | • Aucune attente.<br>• Aucune charge de décision. | • Aucun humain responsable de la mise en production.<br>• Risque de promouvoir sur un test exposé. |

**Recommandation : (a) Gabarit générique préenregistré, décision track, garde engram.** (a) : gabarit générique préenregistré, instancié par domaine ; décision dans track, attestée par h2a et jamais par l’API sentropic ; signataire humain authentifié par l’IdP ; garde de production dans engram sur l’empreinte exacte.

#### G7 — Séquencement, tables immo et pilote C
**Étape 1 · Décide : Fabien · Consulté : Farid.** Prise telle quelle, sauf incohérence avec une autre décision.

Immo pourrait construire ses six tables tout de suite, puis migrer ; ou attendre les paquets génériques et en être le premier adoptant. La convergence recommande de ne pas construire les tables immo et d’ordonner le travail en lots L0 à L4 : contrats, parité des évaluateurs (avec un diagramme BPMN en recette), @sentropic/annotations avec une consommation réelle dans sentropic, jeu de référence C v2, boucle BPMN. Le pilote C actuel devient une version v0 exploratoire, jamais rescellée ; C v2 prend les 51 villes déjà vues en développement et les 52 suivantes en test aveugle. D2 (modèle immo) et D15 (séquencement immo) en dépendent (§6.7).

**Dépend de :** G2 (G2 — Porteurs et forme de l’annotation). **Conditionne :** D2 (Modèle de données immo : adoption du générique), D10 (Jeu de référence #783), D15 (Séquencement).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| (a) Immo construit ses tables, puis migre | Immo livre ses six tables (lot L1 immo), puis les migre vers les paquets génériques quand ils existent. | • Valeur immédiate pour Steve.<br>• Aucune dépendance aux autres dépôts. | • Double travail et migration de données.<br>• Deux modèles pendant la transition. |
| **(b) Générique d’abord, immo premier adoptant, délai borné** (recommandée) | L0 contrats ; L1 parité des évaluateurs (renotation sans appel de modèle) + un diagramme BPMN en recette ; L2 @sentropic/annotations et import, consommé dans sentropic ; L3 jeu de référence C v2 (52 villes en test) ; L4 boucle BPMN. | • Une seule implémentation.<br>• Les besoins de Steve servent de recette.<br>• Pilote C reclassé en v0 exploratoire, sans être rescellé. | • Steve attend L2 pour annoter dans l’application.<br>• Dépend de la coordination entre trois dépôts. |
| (c) Attendre sans borne | Immo n’engage rien tant que les paquets génériques ne sont pas livrés, sans date convenue. | • Aucun travail immédiat.<br>• Aucune dette de transition. | • Aucun calendrier pour Steve.<br>• La boucle reste refaite à la main dans les domaines. |

**Recommandation : (b) Générique d’abord, immo premier adoptant, délai borné.** (b) : pas de double travail, les besoins de Steve deviennent la recette du générique, et le délai est borné par les lots.

#### G8 — BPMN : producteur, code d2d, constructeur silver
**Étape 1 · Décide : Fabien · Consulté : Farid.** Prise telle quelle, sauf incohérence avec une autre décision.

BPMN est le second domaine qui doit valider le contrat générique : des diagrammes de processus produits par un outil et comparés à des diagrammes validés. Il faut décider si l’on garde le producteur actuel en n’adoptant que l’évaluation, et si le constructeur de références machine (silver) devient générique. Cette décision n’a pas d’effet direct sur immo ; elle conditionne la recette « deux profils sur la même implémentation » de G7 (§6.7).

**Dépend de :** G6 (G6 — Règle et porteur de la promotion).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| **(a) Garder le producteur actuel, adopter l’évaluation** (recommandée) | Le producteur BPMN actuel (d2d ou F0) reste ; engram apporte seulement l’évaluateur de graphe et le protocole. | • Évaluation indépendante du producteur.<br>• Peu de changement côté BPMN. | • Propriété du code d2d non vérifiée (dépôt Airbus).<br>• Le script Python oracle_eval.py est à réécrire en Node/TS. |
| (b) Extraction BPMN par engram | Engram produit lui-même les diagrammes BPMN à partir des textes source, puis les évalue. | • Une seule chaîne de production et d’évaluation.<br>• Producteur sous contrôle d’engram. | • Paires texte → BPMN encore à constituer.<br>• Gros chantier avant toute mesure. |
| (c) Reporter BPMN | Le contrat générique est qualifié sur immo seul ; BPMN viendra plus tard, sans recette commune. | • Moins de coordination.<br>• Livraison immo plus directe. | • Pas de preuve que le contrat est générique.<br>• Risque de modèle taillé pour immo. |

**Recommandation : (a) Garder le producteur actuel, adopter l’évaluation.** (a) maintenant, (b) sur mesure sur le même jeu ; constructeur silver générique seulement si BPMN le confirme comme second cas. La propriété du code d2d est à clarifier avant tout réemploi.

#### D1 — Périmètre de conservation des retours de Steve
**Étape 1 · Décide : Fabien · Consulté : Farid, Steve, Mathieu.** **Tranchée : actée par l’owner le 2026-10-04, option (b) Tout le classeur et l’analyse, brut immuable.**

Décision actée par l’owner le 2026-10-04 : on conserve tous les retours de Steve ; c’est sa décision, il en a besoin pour le jeu de référence. Steve a livré un classeur de 7 feuilles (124 lignes de triage, 121 contrôles d’exclusion, 77 constats, 26 règles, 28 codes de motif) et une analyse écrite qui pose ses trois critères (§2, §5.1). Ce choix fixe ce que l’équipe pourra montrer sur les objets du radar et ce que le jeu de référence pourra mesurer (D10). Conséquence pour D2 : « tout conserver » suppose un modèle qui garde toutes les lignes, l’option a (ou b) de D2.

**Dépend de :** aucune décision antérieure. **Conditionne :** D2 (Modèle de données immo : adoption du générique).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| (a) Triage seul | On importe seulement la feuille Triage : 124 lignes, 51 villes. Les 121 contrôles d’exclusion (dont 3 faux négatifs « écartés à tort »), les 77 constats et les 26 règles restent dans le fichier. | • Rapide : une feuille, 124 lignes.<br>• Moins de rattachements à vérifier à l’import. | • Perd les 121 contrôles d’exclusion, là où se trouvent les faux négatifs, ainsi que les constats et les règles.<br>• Jeu de référence incomplet : impossible de mesurer ce que les filtres cachent à tort. |
| **(b) Tout le classeur et l’analyse, brut immuable** (recommandée) | On importe les 7 feuilles et l’analyse du 21 septembre, sans rien modifier : 124 lignes de triage, 121 contrôles d’exclusion, 77 constats, 26 règles, 28 codes, et la Synthèse avec ses formules et leurs valeurs mémorisées. L’analyse est conservée à part, comme annotation distincte. | • Aucune perte : chaque cellule, formule et valeur mémorisée.<br>• Le jeu de référence (D10) dispose des exclusions et des règles.<br>• Les 52 villes suivantes s’importeront de la même façon. | • Plus de tables et de curation (rattachements à vérifier).<br>• Import un peu plus long à écrire et à recetter. |
| (c) Notes libres seules | Chaque ligne devient une note de texte libre sur une ville ou un signal, dans l’UI des notes actuelle. Le classement, le motif et le sens ne sont plus des champs : ils sont dans le texte. | • Surface existante : les notes des lots et des signaux.<br>• Aucun schéma nouveau : livrable vite. | • Perd la structure (classement, motif, sens), les groupes et la provenance.<br>• Inutilisable pour le jeu de référence ; une note est limitée à 10 000 caractères. |

**Recommandation : (b) Tout le classeur et l’analyse, brut immuable.** Tranchée : (b), tout conserver, actée par l’owner le 2026-10-04 ; les options a et c restent affichées pour mémoire.

#### D2 — Modèle de données immo : adoption du générique
**Étape 1 · Décide : Fabien · Consulté : Farid.** Prise telle quelle, sauf incohérence avec une autre décision.

La convergence sentropic + engram (G2, G7) attribue les annotations, révisions et validations à un paquet générique, @sentropic/annotations, et le jeu de référence à engram ; elle recommande qu’immo ne construise pas ses propres tables. Il reste à décider comment immo s’y inscrit : en premier adoptant, qui apporte un profil (schéma d’étiquettes : verdicts, 28 motifs, critères, sens) et ses données (graphe, documents, rattachements geo, classeur de Steve), ou en construisant d’abord six tables à lui. L’état initial et l’état proposé, objet par objet et par propriétaire, sont au §6.0 ; les besoins de Steve au §6.3. L’import (L1), l’affichage (U1, U2) et le jeu de référence C (O1) en dépendent.

**Dépend de :** D1 (Périmètre de conservation des retours de Steve), G2 (G2 — Porteurs et forme de l’annotation), G7 (G7 — Séquencement, tables immo et pilote C). **Conditionne :** D3 (Ancre signal et correctif B0), D4 (Conformité sentropic et suppression), D9 (Sens de « double annotation »), D10 (Jeu de référence #783), D5 (Auteur des retours importés).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| **(a) Adopter le générique : immo = profil + données** (recommandée) | Immo ne crée aucune table d’annotation. Il écrit son profil de domaine (schéma d’étiquettes : verdict Pertinent / À surveiller / Non pertinent, 28 motifs reliés aux critères K1 à K9 et aux exclusions, sens, règle de promotion D13) et branche @sentropic/annotations sur son Postgres et son S3 : le classeur de Steve est importé une fois, Steve annote et l’équipe valide dans l’application, chaque révision est immuable et liée à son hash. Les annotations validées partent, en instantané haché, vers un jeu de référence engram. | • Aucune table d’annotation propre à immo : pas de migration ultérieure.<br>• Les besoins de Steve servent de recette au paquet générique, sur le PG et le S3 d’immo.<br>• Mêmes règles de version, de validation et de jeu de référence que les autres domaines (BPMN). | • Dépend du calendrier de @sentropic/annotations (L2) et d’engram (L0, L1).<br>• Un profil de domaine à écrire et à faire valider (schéma d’étiquettes, règle D13). |
| (b) Six tables immo, puis migration | Immo construit d’abord les six tables de la version précédente du dossier (retours_fichiers, annotations, validations, motifs, annotation_cibles, reference_set_versions), les utilise, puis les migre vers @sentropic/annotations et engram quand ils seront prêts : annotations → annotation_revisions, validations → annotation_validations, annotation_cibles → annotation_targets, motifs → profil, reference_set_versions → ReferenceSetVersion. | • Livrable sans attendre le générique.<br>• Modèle déjà décrit et testé dans les versions précédentes du dossier. | • Réimplémentation que la convergence interdit (« prevent each new app … from inventing a private model »).<br>• Migration vers @sentropic/annotations à faire ensuite, avec reprise des données.<br>• Deux modèles à maintenir pendant la transition. |
| (c) Table de contrôle seule (jeu de référence) | On crée une seule table de contrôle qui recopie le classeur pour mesurer le radar, sans aucun lien vers ce qui est affiché. Le nom de table est indicatif. Rien n’apparaît dans le panneau du signal : Steve ne retrouve pas son verdict sur le signal qu’il a trié ; seul le jeu de référence lit la table. | • Rapide : une table.<br>• Respecte le précédent du 2026-06-11 : la mesure ne nourrit pas la production. | • Rien d’affichable : ne répond pas à #784 (« attaché à l’élément associé »).<br>• Steve ne peut ni annoter ni valider dans l’application.<br>• Une seconde structure sera nécessaire plus tard. |
| (d) Attendre le générique sans borne | On ne construit rien côté immo et on attend que @sentropic/annotations et engram soient livrés, sans délai convenu. En attendant, le classeur reste un fichier hors de l’outil et Steve ne peut ni annoter ni valider dans l’application. | • Aucun travail côté immo maintenant.<br>• Aucune dette de transition. | • Steve ne voit rien dans l’outil tant que le paquet n’est pas livré.<br>• Aucun délai : la recette de Steve n’est pas planifiée. |

Schéma de l'option (a) Adopter le générique : immo = profil + données :

```mermaid
erDiagram
    annotation_sources ||--o{ annotation_revisions : import
    annotation_revisions |o--o| annotation_revisions : remplace
    annotation_revisions ||--o{ annotation_validations : decide
    annotation_revisions ||--o{ annotation_targets : vise
    annotation_targets }o..o| graph_nodes : ville_et_id_texte
    annotation_revisions }o--|| account_users : auteur
    annotation_validations }o--|| account_users : decideur
    profil_domaine ||..o{ annotation_revisions : schema_corps
    annotation_validations }o..o{ reference_set_versions : export_hache
    reference_set_versions ||--o{ eval_runs : mesure
    annotation_sources {
      uuid id PK
      text sha256 UK "classeur de Steve, une fois"
      text octets "S3 d’immo, par un port"
    }
    annotation_revisions {
      text content_hash PK "immuable"
      text prev_content_hash FK "révision précédente"
      uuid auteur FK "Steve, identité IdP"
      text origine "import ou saisie"
      jsonb corps "verdict, motif, sens, tags"
      text statut "calculé des validations"
    }
    annotation_validations {
      uuid id PK
      text revision_hash FK "révision visée"
      uuid decideur FK "équipe ou PO"
      text decision "accepter, contester, rejeter…"
      text motif "pourquoi"
    }
    annotation_targets {
      uuid id PK
      text cible_type "signal, ville, PV, zone, lot"
      text city_slug "clé du graphe (#812)"
      text cle "id, sha256 ou canonical_id"
      jsonb vu_par_steve "instantané observé"
    }
    profil_domaine {
      text fichier PK "ontology-profile.yaml"
      text etiquettes "verdicts, 28 motifs, critères"
      text promotion "règle D13"
    }
    account_users {
      uuid id PK
      text sub "sujet IdP sentropic"
    }
    graph_nodes {
      text city_slug PK "clé (city_slug, id), #812"
      text id PK "signal-… (texte)"
    }
    reference_set_versions {
      text id PK "ReferenceSet@version"
      text label_provenance "human_single pour C"
      text partitions "dev 51 villes, test 52"
      text manifest_sha256 "gel décidé dans track"
    }
    eval_runs {
      text run_id PK
      text candidat "profil + prompt + modèle"
      text resultat "métriques, garde"
    }
```

Schéma de l'option (b) Six tables immo, puis migration :

```mermaid
erDiagram
    retours_fichiers ||--o{ annotations : importe
    annotations }o--o| motifs : motif
    annotations |o--o| annotations : remplace
    annotations ||--o{ annotation_cibles : vise
    annotation_cibles }o..o| graph_nodes : ville_et_id_texte
    annotations ||--o{ validations : decide
    annotations }o--|| account_users : auteur
    validations }o--|| account_users : decideur
    reference_set_versions }o..o{ annotations : fige
    retours_fichiers {
      uuid id PK
      text fichier_sha256 UK "même fichier = 0 écriture"
      text nom "radar-triage-signaux.xlsx"
      text revision "21 sept. 2026"
      uuid importe_par FK "compte de l'importateur"
    }
    annotations {
      uuid id PK
      text origine "import ou saisie"
      uuid fichier_id FK "si import : feuille, ligne"
      text ref "feuille, ligne, #7, C-79…"
      jsonb cellules "import : cellules brutes"
      uuid auteur_id FK "compte de Steve"
      text classement "P, S, N"
      text motif_code FK
      text sens "assouplissement…"
      text passe "1, 2 ou 3"
      text commentaire
      text statut "proposée, validée, contestée"
      uuid remplace_id FK "version précédente"
    }
    motifs {
      text code PK "P-DENSITE, N-RESTRICTIF…"
      text critere "K1 à K9 ou exclusion"
      text regle "R-xx qui le justifie"
    }
    validations {
      uuid id PK
      uuid annotation_id FK
      uuid decideur_id FK "équipe ou PO"
      text decision "validée ou contestée"
      text motif "pourquoi"
    }
    annotation_cibles {
      uuid id PK
      uuid annotation_id FK
      text cible_type "signal, ville, règlement…"
      text city_slug "clé du graphe (#812)"
      text cible_id "id texte, ex. signal-…"
      text resolution "résolue, ambiguë, disparue"
      jsonb vu_par_steve "ville, date, verbatim"
    }
    graph_nodes {
      text city_slug PK "clé (city_slug, id), #812"
      text id PK "signal-… (texte)"
    }
    account_users {
      uuid id PK "Steve, équipe, PO"
    }
    reference_set_versions {
      uuid id PK
      text libelle UK "reference-set-ciblage-steve-v1"
      jsonb unites "annotations validées, dev / test"
      text fichier_sha256 "export JSON gelé"
    }
```

Schéma de l'option (c) Table de contrôle seule (jeu de référence) :

```mermaid
erDiagram
    steve_control_rows {
      uuid id PK
      text sheet
      int sheet_row
      jsonb cells "toutes les cellules"
      text verdict "classement, motif, sens"
    }
    graph_nodes {
      text id PK "signal-…"
      text city_slug
    }
```

Schéma de l'option (d) Attendre le générique sans borne :

```mermaid
erDiagram
    sentropic_comments {
      text id PK
      text target_kind "record"
      text target_id
      text author_id
      text body "ni classement ni provenance"
    }
```

**Recommandation : (a) Adopter le générique : immo = profil + données.** (a) : aucun double travail, les besoins de Steve deviennent la recette du paquet générique, et immo ne garde que ce qui lui est propre (profil, données, résolveur d’ancres, écrans). (b) ne vaut que si le paquet générique prend un retard non borné.

#### D3 — Ancre signal et correctif B0
**Étape 1 · Décide : Fabien · Consulté : Farid.** Prise telle quelle, sauf incohérence avec une autre décision.

Une ancre est la référence qui attache une annotation à un objet du radar (signal, ville, zone, lot…) ; c’est une ligne de la table annotation_cibles (ville + id texte, scène 2). Aujourd’hui l’annotation d’un signal est cassée : l’UI envoie l’identifiant texte du graphe (« signal-… »), alors que l’API exige un UUID, identifiant aléatoire de l’ancienne table signals que plus aucun code n’alimente (§6.1, défaut 1). « B0 » est le petit lot correctif qui répare cela (§7). Sans ancre fiable, aucun retour de Steve ne s’affiche sur son signal. Risque connu : une ré-extraction du graphe peut supprimer ou renommer des identifiants (graph-store.ts, §6.1).

**Dépend de :** G2 (G2 — Porteurs et forme de l’annotation), D2 (Modèle de données immo : adoption du générique). **Conditionne :** D14 (Première livraison UI), D15 (Séquencement).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| **(a) Clé texte namespacée + instantané observé, B0 immédiat** (recommandée) | On stocke la cible sous forme de texte (« radar.signal:<ville>:<id> ») dans annotation_cibles (ville + id texte du graphe), sans clé étrangère vers le graphe, avec un instantané de ce que Steve a vu (ville, date, type, verbatim). B0 corrige l’API pour accepter cet identifiant texte. Si une ré-extraction supprime le signal, l’ancre passe « disparue » et le panneau montre l’instantané au lieu de perdre le retour. | • Survit à la ré-extraction : l’ancre passe « disparue » au lieu d’effacer l’annotation, et l’instantané observé (ville, date, type, verbatim) reste lisible.<br>• Répare tout de suite l’annotation existante (B0, taille S).<br>• Aucune clé étrangère vers le graphe, donc aucune suppression en cascade. | • Si l’extraction renomme un identifiant, un rapprochement est nécessaire (file de revue).<br>• La clé texte n’est pas une identité métier définitive. |
| (b) Attendre une clé métier stable | On n’ancre rien tant qu’une clé métier stable (dossier réglementaire, étape) n’existe pas dans une ontologie du radar. Aucun lot B0 : l’annotation de signal reste en échec 400 et les retours de Steve ne s’affichent sur aucun signal. | • Identité propre et stable par conception.<br>• Évite plus tard tout rapprochement d’identifiants. | • Dépend d’une ontologie qui n’existe pas : bloquant, sans date.<br>• L’annotation de signal reste cassée en attendant. |
| (c) Passer par l’UUID signals | On garde le contrat v1 : une annotation de signal pointe vers l’UUID de la table signals. Mais aucun code de main n’écrit dans signals : il n’existe aucun UUID à viser pour les 124 lignes de Steve. L’ancre ne peut pas être créée. | • Contrat v1 (migration 0011) inchangé.<br>• Aucune nouvelle colonne d’ancre à créer. | • Aucune insertion dans signals sur main : l’ancre est impossible en pratique.<br>• Maintient le défaut actuel (refus 400 attendu). |

Schéma de l'option (a) Clé texte namespacée + instantané observé, B0 immédiat :

```mermaid
erDiagram
    annotation_cibles }o..o| graph_nodes : cle_texte_sans_fk
    annotation_cibles {
      uuid id PK
      text city_slug "ville"
      text cible_id "signal-… (texte)"
      jsonb vu_par_steve "ville, date, verbatim"
      text resolution "résolue … disparue"
    }
    graph_nodes {
      text id PK "signal-… (texte)"
    }
```

Schéma de l'option (b) Attendre une clé métier stable :

```mermaid
erDiagram
    annotation_cibles }o..o| cle_metier_stable : attend
    annotation_cibles {
      uuid id PK
      text business_key "à définir"
    }
    cle_metier_stable {
      text key PK "n'existe pas encore"
    }
```

Schéma de l'option (c) Passer par l’UUID signals :

```mermaid
erDiagram
    prospect_notes }o--o| signals : signal_id
    prospect_notes {
      uuid id PK
      uuid signal_id FK "UUID exigé par l'API"
    }
    signals {
      uuid id PK "table vide sur main"
    }
```

**Recommandation : (a) Clé texte namespacée + instantané observé, B0 immédiat.** (a) avec B0 tout de suite : c’est le seul choix qui rend l’annotation de signal utilisable maintenant et qui ne perd rien à la ré-extraction. Une clé métier stable reste un suivi séparé.

#### D4 — Conformité sentropic et suppression
**Étape 1 · Décide : Fabien · Consulté : Farid.** Prise telle quelle, sauf incohérence avec une autre décision.

Modifiée par G2 et G3 : les annotations de Steve passent par @sentropic/annotations (révisions immuables, tombstone) ; D4 ne porte plus que sur les commentaires de l’équipe et la conformité de lecture. Les annotations doivent suivre le contrat du module comments de sentropic, la plateforme commune (exigence E3, §6.1). Ce module, en version 0.2.0, supprime physiquement un commentaire ; or l’owner a décidé (O1, dossier COLLAB) qu’une suppression laisse une trace (« tombstone ») et une durée de rétention. Il faut décider comment être conforme sans contredire O1, avant l’import (L1) et l’API de lecture (L2). Concrètement : peut-on supprimer un retour de Steve, et par quel chemin ? Dans la scène 2, comment_projection relie une évaluation publiée à son fil de commentaires.

**Dépend de :** G2 (G2 — Porteurs et forme de l’annotation), G3 (G3 — Sémantique de version et effacement), D2 (Modèle de données immo : adoption du générique). **Conditionne :** D5 (Auteur des retours importés), D6 (Visibilité et données personnelles), D14 (Première livraison UI).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| **(a) Cibles et lecture conformes, import immuable, demande de tombstone** (recommandée) | Les annotations utilisent les cibles et la lecture du module comments, sans modifier le paquet. Les retours importés sont immuables : aucun bouton de suppression. Les validations et contestations vivent dans les tables du radar (validations) ; un fil de commentaires sentropic pourra s’ajouter avec le port complet. On demande à sentropic une version avec tombstone, puis on adopte le port complet. | • Respecte O1 et la ligne COLLAB « le paquet porte l’intégrité ».<br>• Livrable maintenant : cibles et lecture conformes, sans modifier le paquet.<br>• Premier lot en lecture seule : aucune suppression à gérer tant que le paquet n’a pas de tombstone. | • Conformité partielle : pas encore le port complet CommentStore.<br>• Une demande à sentropic (tombstone) à suivre.<br>• Une migration vers le port complet plus tard. |
| (b) Adaptateur CommentStore à tombstone hôte | On écrit un adaptateur CommentStore côté radar dont le delete pose une marque (tombstone) au lieu d’effacer. Les retours et réponses passent tout de suite par le port complet. Mais le delete du port ne supprime plus vraiment : sa sémantique diffère de celle du paquet. | • Port complet utilisé dès maintenant.<br>• Un seul chemin d’écriture et de lecture : celui du port. | • Contredit COLLAB §2 : un tombstone porté seulement par Radar est un piège.<br>• Un delete qui ne supprime pas trahit la sémantique du port.<br>• Dette à défaire quand sentropic livrera. |
| (c) Attendre le port complet | On attend que sentropic publie un paquet avec tombstone et rétention, puis on branche tout dessus. Aucun retour de Steve n’est affiché avant cette version, sans date connue. | • Conformité intégrale, aucun écart.<br>• Aucune migration ultérieure vers le port complet. | • Bloquant tant que sentropic n’a pas livré, sans date.<br>• Rien d’affiché pour Steve en attendant. |

**Recommandation : (a) Cibles et lecture conformes, import immuable, demande de tombstone.** (a), puis adoption du port complet quand sentropic publiera la version avec tombstone. Réserve : le dossier COLLAB n’est pas sur main (non vérifié) ; s’il était abandonné, (b) redeviendrait défendable.

#### D9 — Sens de « double annotation » (point ouvert)
**Étape 1 · Décide : Fabien · Consulté : Farid.** Prise telle quelle, sauf incohérence avec une autre décision.

La demande initiale parle de « double annotation (ancienne / nouvelle) » sans dire ce qui est comparé à quoi. Le modèle retenu (D2) garde le verdict de Steve dans annotations ; les autres jeux (adjudication C, prédiction C) vivent dans les versions gelées du jeu de référence, et la classification du radar se recalcule (§6.6) : les trois lectures sont donc possibles techniquement. Mais chacune produit une mesure différente et fixe ce que le jeu de référence (D10) comparera : il faut la préciser avant de geler le jeu de référence de ciblage. Le sens de la demande appartient à Fabien.

**Dépend de :** G1 (G1 — Terminologie et provenance du jeu de référence), D2 (Modèle de données immo : adoption du générique). **Conditionne :** D10 (Jeu de référence #783), D7 (Définition de C v1).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| Steve contre classification radar | Le jeu « steve-source » (verdict de Steve) est comparé à la classification du radar : B′ reconstituée à la date du relevé, puis C. Exemple : sur la passe 1, Steve juge 24 signaux sur 73 Non pertinent alors que B les affiche ; c’est cet écart que l’on mesure ligne par ligne. | • Mesure directement l’écart entre ce que Steve juge et ce que le radar montre (B aujourd’hui, C demain).<br>• C’est la lecture qui sert la bascule B → C (D13). | • La classification serveur de septembre n’est pas archivée : la version radar sera reconstituée, en partie.<br>• Ne mesure pas l’accord entre deux humains. |
| Ancienne grille de Steve contre grille C | On compare deux grilles humaines de Steve : son classement actuel (P/S/N, motif) et un nouvel étiquetage selon les critères C. Steve repasse sur les mêmes lignes ; le jeu de référence mesure l’évolution de ses critères, pas le radar. | • Suit l’évolution des critères de Steve dans le temps.<br>• Utile si Steve réétiquette ses lignes avec les critères C. | • Exige un second passage de Steve sur les mêmes lignes.<br>• Ne dit rien de la qualité du radar. |
| Jeu de référence 676 contre jeu de référence Steve | On rapproche le jeu de référence d’extraction (676 unités sur 100 procès-verbaux) et le jeu de référence de Steve (124 lignes). Le pont passe par les documents communs, probablement peu nombreux (non vérifié). | • Relie l’extraction (jeu de référence E) et le ciblage (jeu de référence C).<br>• Réutilise deux références déjà constituées (674/676 et le tableur). | • Compare deux questions différentes : « a-t-on extrait l’acte ? » contre « fallait-il le montrer ? ».<br>• Recouvrement des deux corpus probablement faible (non vérifié). |

**Point ouvert.** Point ouvert : aucune option recommandée. La lecture (1) est celle que le dossier a modélisée (§6.6) ; les trois tiennent dans le même schéma.

#### D10 — Jeu de référence #783
**Étape 1 · Décide : Fabien · Consulté : Steve, Farid.** Prise telle quelle, sauf incohérence avec une autre décision.

Un jeu de référence est un jeu de réponses de référence qui note automatiquement le radar. Le jeu de référence actuel (674 unités committées, 676 en copie locale) note l’extraction des actes dans les procès-verbaux, pas le choix des signaux à montrer (§9.3). Les retours de Steve sont la première vérité humaine sur ce choix : dans sa vue de travail, 24 signaux sur 73 sont du bruit (32,9 %, scène 1). Il faut décider comment construire le jeu de référence de ciblage (#783) avant de développer C (D7), car c’est lui qui dira si C fait mieux que B (D13). Dans la scène 3, le jeu de référence est la bande du bas : hors ligne, alimenté par les annotations en base. La proposition complète (ancien jeu de référence → nouveau jeu de référence, construction, gel, validation) est au §9.3.

**Dépend de :** G1 (G1 — Terminologie et provenance du jeu de référence), G5 (G5 — Scellement et stockage des jeux de référence), G7 (G7 — Séquencement, tables immo et pilote C), D2 (Modèle de données immo : adoption du générique), D9 (Sens de « double annotation »). **Conditionne :** D11 (Benchmark #782), D7 (Définition de C v1), D8 (Cas contradictoires), D12 (Exposition A/B/C), D13 (Seuil de bascule B → C), D15 (Séquencement).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| Remplacer v3 par le tableur | Les 124 lignes du tableur deviennent l’unique jeu de référence, à la place de la version 674/676. Rapide à constituer, mais il ne contient que ce que l’écran montrait à Steve : les sept dossiers manqués (« l’information existait dans la base ») n’y figurent pas. | • Rapide : une seule source.<br>• Aucune adjudication supplémentaire à organiser. | • Les retours ne portent que sur ce que l’écran affichait : échantillon biaisé, les sept dossiers manqués restent invisibles.<br>• Perd l’historique de l’extraction et la comparabilité des benchmarks passés. |
| **Double jeu de référence E / C, jeu test indépendant** (recommandée) | Deux jeux de référence versionnés et gelés par empreinte. E reste le jeu de référence d’extraction (676 unités). C est construit à partir des évaluations et ancres de Steve, adjugées et étayées. Développement sur ses 51 villes, test sur les 52 suivantes, jamais vues ; toutes les unités d’un même dossier dans la même partition. | • Mesure séparément « a-t-on extrait l’acte ? » (E) et « fallait-il le montrer ? » (C).<br>• Jeu test indépendant : les 52 villes suivantes de Steve, jamais vues pendant le réglage (51 villes de développement).<br>• Partition par dossier : pas de fuite entre développement et test. | • Adjudication nommée et corpus de test coûtent du travail (Steve, l’équipe).<br>• Deux jeux de référence à versionner et geler par empreinte (sha256). |
| Campagne C entièrement nouvelle | On lance une campagne d’annotation neuve, conçue pour le ciblage C, sur un nouveau corpus. Les 124 lignes de Steve servent seulement d’exemples ; la comparaison avec l’historique se fait à part. | • Conçue pour le besoin réel, sans biais d’affichage.<br>• Peut couvrir d’emblée les 52 villes restantes avec la méthode C. | • Comparaison moins directe avec l’historique.<br>• Repart de zéro : délai et coût d’annotation les plus élevés. |

Schéma de l'option Remplacer v3 par le tableur :

```mermaid
erDiagram
    annotations ||--|| jeu_ref_tableur : remplace
    jeu_ref_tableur ||--|| benchmark : note_tout
    annotations {
      text source "124 lignes de Steve"
    }
    jeu_ref_tableur {
      text unite "ce que l'écran montrait"
      text biais "7 dossiers manqués absents"
    }
    jeu_ref_e_v3 {
      text statut "retiré, historique perdu"
    }
    benchmark {
      text tableau "un seul, extraction et ciblage"
    }
```

Schéma de l'option Double jeu de référence E / C, jeu test indépendant :

```mermaid
erDiagram
    consensus_modeles ||--|| jeu_ref_e_v3 : construit
    annotations ||--|| jeu_ref_c_v1 : adjugees_gelees
    jeu_ref_e_v3 ||--|| volet_extraction : note
    jeu_ref_c_v1 ||--|| volet_ciblage : note_b_puis_c
    consensus_modeles {
      text methode "7 passes, 3 familles"
    }
    annotations {
      text source "verdicts de Steve"
    }
    jeu_ref_e_v3 {
      int taille "674 / 100 documents"
    }
    jeu_ref_c_v1 {
      text jeux "dev 51 villes, test 52"
    }
    volet_extraction {
      text mesure "inchangée"
    }
    volet_ciblage {
      text mesure "précision, rappel"
    }
```

Schéma de l'option Campagne C entièrement nouvelle :

```mermaid
erDiagram
    campagne_c ||--|| jeu_ref_c_neuf : construit
    annotations }o..o| jeu_ref_c_neuf : exemples
    jeu_ref_c_neuf ||--|| volet_ciblage : note
    campagne_c {
      text corpus "nouveau, conçu pour C"
    }
    annotations {
      text role "124 lignes, exemples"
    }
    jeu_ref_c_neuf {
      text comparaison "historique à part"
    }
    volet_ciblage {
      text mesure "précision, rappel"
    }
```

**Recommandation : Double jeu de référence E / C, jeu test indépendant.** Double jeu de référence : c’est la seule façon de mesurer l’utilité (ciblage) sans perdre la mesure de l’extraction ; campagne nouvelle seulement pour ce que les archives ne permettent pas d’évaluer. Unité : le signal, regroupé par dossier ; une unité « dossier » serait plus fidèle mais dépend d’une clé de règlement peu fiable (C-26).

#### D11 — Benchmark #782
**Étape 1 · Décide : Fabien · Consulté : Farid.** Prise telle quelle, sauf incohérence avec une autre décision.

Le benchmark #782 compare des modèles et des réglages sur un même jeu de référence. Si on y ajoute la mesure du ciblage (B, puis C), il faut décider si elle rejoint les métriques d’extraction ou forme un volet à part (§9.4). Le choix fixe aussi le sort du prompt d’extraction gelé (immo-pv-extraction-v9) : lui faire produire sens, effet et portée romprait la comparabilité des campagnes v10 et v11. Ce que verra Farid : un tableau unique, ou deux tableaux qui ne se mélangent pas.

**Dépend de :** G6 (G6 — Règle et porteur de la promotion), D10 (Jeu de référence #783). **Conditionne :** D12 (Exposition A/B/C), D13 (Seuil de bascule B → C).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| **Volet ciblage séparé** (recommandée) | Le rapport du benchmark #782 garde son tableau d’extraction inchangé et ajoute un tableau « ciblage » : précision et rappel de l’historique, de B, puis de C, sur le jeu de référence C. Le prompt gelé immo-pv-extraction-v9 n’est pas modifié ; l’enrichir serait une nouvelle version, décidée à part. | • Extraction et ciblage restent comparables chacun dans le temps.<br>• Colonnes historique, B et C distinctes : l’effet de C se lit directement.<br>• Tout changement du contrat d’extraction devient une nouvelle version, décidée à part. | • Deux tableaux à lire.<br>• Pont entre les deux seulement sur les 100 documents du corpus commun. |
| Métriques fusionnées | Un seul tableau et un seul score mêlent l’extraction (étape et citation) et le ciblage (fallait-il montrer le signal). | • Un seul tableau, un seul score.<br>• Lecture plus simple pour un public non technique. | • Mélange deux questions différentes : un F1 fusionné ne dit plus rien.<br>• Perd la comparabilité avec les campagnes passées. |

**Recommandation : Volet ciblage séparé.** Volet ciblage séparé : c’est la condition pour comparer B et C sans casser l’historique de l’extraction.

### Étape 2 · Farid décide ensuite (produit, affichage, priorités)

#### D5 — Auteur des retours importés
**Étape 2 · Décide : Farid · Consulté : Steve, Fabien.** Décidée après les décisions de Fabien.

Steve poursuivra son annotation dans l’application (vision owner, §6.3) : ses retours importés et ses annotations futures doivent porter le même auteur. Aujourd’hui il n’a pas de compte vérifié, et ce n’est pas lui qui lance l’import. Il faut décider qui est affiché comme auteur, sans usurper son identité ni effacer celle de l’importateur (exigence E5, §6.2). Effet visible : la ligne « auteur » de chaque annotation dans le panneau du signal, et le nom de qui valide ou conteste.

**Dépend de :** G4 (G4 — Autorité de validation et rôles), D2 (Modèle de données immo : adoption du générique), D4 (Conformité sentropic et suppression). **Conditionne :** D6 (Visibilité et données personnelles).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| (a) Auteur documentaire externe + importateur tracé | Chaque retour importé affiche « Steve Chaperon — importé par <nom> ». Steve est un auteur externe (ext:chaperon:steve) sans compte ; l’importateur réel est enregistré à part. Steve ne peut pas annoter lui-même tant que cette identité externe est utilisée. | • Le contenu est attribué à son vrai auteur sans attendre la création d’un compte.<br>• L’importateur réel est tracé : on sait qui a chargé quoi. | • Steve ne peut ni annoter ni valider dans l’application sous ce nom externe.<br>• Deux identités pour la même personne le jour où il aura un compte. |
| (b) Importateur seul comme auteur | Le retour est affiché comme écrit par la personne qui a lancé l’import ; le nom de Steve n’apparaît que dans la provenance (fichier, feuille, ligne). | • Aucune identité externe à gérer.<br>• Aucun libellé spécial à afficher. | • Le texte de Steve est attribué à l’importateur : faux pour le lecteur.<br>• Perd la valeur de la parole du client et empêche la boucle de validation. |
| **(c) Compte Steve, pour l’import et la saisie** (recommandée) | On crée et vérifie un compte pour Steve. Ses retours importés sont attribués à ce compte (l’importateur est tracé dans importe_par), et ses annotations, triages et réponses aux contestations dans l’application portent le même compte. | • Une seule identité : ses retours importés et ses annotations futures portent son compte.<br>• Il annote, trie et répond aux contestations lui-même dans l’application.<br>• L’importateur reste tracé à part (importe_par). | • Compte à créer et vérifier avant l’import.<br>• Droits à cadrer : Steve annote, l’équipe ou le PO valide. |

**Recommandation : (c) Compte Steve, pour l’import et la saisie.** (c) : Steve annote et valide avec son propre compte ; ses retours importés lui sont attribués, l’importateur est tracé à part. (a) ne vaut que si la création du compte tarde.

#### D6 — Visibilité et données personnelles
**Étape 2 · Décide : Farid · Consulté : Steve, Mathieu, Fabien.** Décidée après les décisions de Fabien.

Le constat C-79 de Steve signale des noms de particuliers en clair dans des résumés de signaux (§5.6) ; les verbatims importés peuvent en contenir aussi. Règle actuelle des notes (migration 0011) : tout utilisateur approuvé lit tout. Il faut décider qui voit les retours et s’ils sont caviardés avant le premier affichage (U1), au regard de la Loi 25 (exigence E9). Le module comments de sentropic ne masque pas les données personnelles : c’est au radar de le faire (D4, D5).

**Dépend de :** D4 (Conformité sentropic et suppression), D5 (Auteur des retours importés). **Conditionne :** D14 (Première livraison UI).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| (a) Tous les approuvés, sans caviardage | Tout utilisateur approuvé voit tous les retours, verbatims compris, comme pour les notes actuelles (règle 0011). Aucun masquage. | • Règle existante, aucun travail.<br>• Toute l’équipe voit tout. | • Expose des noms de particuliers.<br>• Ne répond pas à la demande C-79 de Steve. |
| (b) Administrateurs et Steve | Seuls les administrateurs et Steve voient les retours ; le reste de l’équipe ne les voit pas dans le panneau. | • Exposition minimale.<br>• Aucun caviardage à développer. | • L’équipe produit ne voit pas les retours : on perd l’intérêt de les afficher.<br>• Gestion de droits spécifique à construire. |
| **(c) Approuvés, verbatims caviardés** (recommandée) | Tout utilisateur approuvé voit les retours, mais les noms de particuliers sont masqués avant affichage, dans les verbatims importés comme dans les résumés de signaux (demande C-79 de Steve). Une colonne pii_status trace le traitement. | • Toute l’équipe voit les retours.<br>• Noms de particuliers masqués dans les retours et dans les résumés de signaux : répond à C-79. | • Détection des données personnelles à écrire et tester (colonne pii_status).<br>• Un caviardage peut masquer un nom utile (élu, promoteur) : règles à préciser. |

**Recommandation : (c) Approuvés, verbatims caviardés.** (c) : toute l’équipe garde l’accès aux retours, et les noms de particuliers sont masqués, dans les retours comme dans les résumés de signaux.

#### D7 — Définition de C v1
**Étape 2 · Décide : Farid · Consulté : Steve, Mathieu, Fabien.** Décidée après les décisions de Fabien.

C est la nouvelle sélection de signaux proposée, alignée sur les trois critères de Steve : résidentiel, assouplissement, densification (§2.2, scène 1). Aujourd’hui, deux de ces trois critères n’ont aucune donnée au radar. Steve pose une réserve : un signal dont le sens n’est pas lisible doit rester affiché (« masquer ce qui n’a pas pu être lu transformerait une lacune en dossier manqué »). Il faut fixer la règle de C avant de la développer (lot C1) ; elle sera mesurée par le jeu de référence de ciblage (D10), sur la lecture de la double annotation retenue (D9). Les critères K1 à K9 sont détaillés au §9.2.

**Dépend de :** D9 (Sens de « double annotation »), D10 (Jeu de référence #783). **Conditionne :** D8 (Cas contradictoires), D12 (Exposition A/B/C), D16 (Retour à Steve).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| Triplet strict pour toute visibilité | C n’affiche que les signaux qui réunissent les trois critères de façon établie. Exemple : sur la passe 1, seuls 22 signaux sur 73 resteraient ; les 12 Pertinent dont le sens n’est pas donné disparaîtraient. | • Flux court et lisible : seulement ce qui réunit les trois critères (22 sur 73).<br>• Plus simple à calculer : un signal entre ou non. | • Masque les indéterminés : contredit la réserve explicite de Steve.<br>• Perte de rappel sur les dossiers mal lus. |
| **K1–K9 + trois états** (recommandée) | C applique les critères K1 à K9 (§9.2) avec trois états : confirmé (critères étayés), à instruire (sens ou effet non déterminable, reste visible), exclu prouvé (masqué, raison affichée). Deux compteurs distincts « confirmés » et « à instruire ». Aucun seuil de taille de projet ni filtre sur l’origine privée. | • Respecte les trois critères et la réserve : on ne masque que ce qui est établi hors critères.<br>• Trois états (confirmé, à instruire, exclu prouvé) et deux compteurs : un cas incertain n’est pas présenté comme une opportunité. | • Le flux garde du travail manuel (les « à instruire »).<br>• Exige des extractions nouvelles (sens, effet sur les unités, portée) : lot C1 de taille L. |
| B inchangé, critères pour trier | La sélection affichée reste B ; les critères de Steve servent seulement à trier la liste (les « trois critères » en premier). Aucun signal n’entre ni ne sort. | • Aucun changement d’appartenance, aucun risque.<br>• Aucune extraction nouvelle à développer. | • Le bruit connu (24 sur 73) persiste.<br>• Ne répond pas à Steve : « ce n’est pas une question de hiérarchie ». |

**Recommandation : K1–K9 + trois états.** K1–K9 + trois états, après relecture de la table de dérivation par Steve : c’est la seule règle qui applique ses trois critères sans masquer ce qui n’a pas pu être lu. Aucun seuil de taille de projet ni filtre sur l’origine privée.

#### D8 — Cas contradictoires (Saint-Victor, Amos, CPTAQ, seconds projets, ODJ, S-RESTRICTIF)
**Étape 2 · Décide : Farid · Consulté : Steve, Mathieu.** Décidée après les décisions de Fabien.

Certains cas ne se tranchent pas par une règle automatique : Saint-Victor (un resserrement qui favorise pourtant la densification), Amos (logement sur commerce), portée de l’exception CPTAQ, seconds projets, points d’ordre du jour, trois restrictions « À surveiller » (§9.2). Le tableur et l’analyse de Steve se contredisent parfois sur ces cas. Il faut décider qui les arbitre avant de geler le jeu de référence (D10) et la règle C (D7) ; sinon le jeu de référence sanctionnera le bon comportement.

**Dépend de :** D7 (Définition de C v1), D10 (Jeu de référence #783). **Conditionne :** D16 (Retour à Steve).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| **Revue métier, abstention en attendant** (recommandée) | Steve et Mathieu examinent les cas listés au §9.2 sur exemples et preuves (Saint-Victor, Amos, CPTAQ, seconds projets, ODJ, trois S-RESTRICTIF). Tant qu’un cas n’est pas tranché, il est marqué « abstention » dans le jeu de référence : il ne compte ni pour ni contre. | • Steve et Mathieu tranchent sur exemples et preuves : la règle reste celle du client.<br>• En attendant, abstention explicite : ces cas ne comptent ni pour ni contre. | • Demande du temps à Steve et Mathieu.<br>• Quelques cas restent ouverts plus longtemps. |
| Arbitrage par l’équipe | L’équipe tranche elle-même chaque cas à partir de l’analyse et des règles de Steve, puis lui présente le résultat. | • Plus rapide.<br>• Ne mobilise ni Steve ni Mathieu. | • Risque de prêter à Steve une règle qu’il n’a pas posée.<br>• Le jeu de référence refléterait l’avis de l’équipe, pas celui du client. |
| Statu quo | Les cas restent dans le jeu de référence avec l’étiquette du tableur, sans statut particulier, même quand le tableur et l’analyse se contredisent. | • Aucun effort.<br>• Le jeu de référence peut être gelé tout de suite. | • Cas sans statut dans le jeu de référence : mesures faussées.<br>• Désaccords invisibles. |

**Recommandation : Revue métier, abstention en attendant.** (a) : la règle reste celle du client, et les cas ouverts ne faussent pas la mesure pendant qu’ils sont arbitrés.

#### D12 — Exposition A/B/C (point ouvert)
**Étape 2 · Décide : Farid · Consulté : Steve, Mathieu, Fabien.** Décidée après les décisions de Fabien.

Aujourd’hui l’écran montre la sélection B ; le sélecteur A/B a été retiré en août (§9.1). La demande initiale parle d’un « mécanisme A/B étendu en C », mais les règles de partage validées le 1er octobre (#787, item 4) demandent de ne pas réintroduire de choix entre plusieurs viviers. Les deux lectures sont défendables (§9.5) : Farid tranche. Concrètement : Steve verra-t-il un sélecteur A/B/C, ou une seule sélection qui change le jour où C est prouvée meilleure (D13) ? La règle C (D7) et sa mesure (D10, D11) doivent être connues.

**Dépend de :** D7 (Définition de C v1), D10 (Jeu de référence #783), D11 (Benchmark #782). **Conditionne :** D13 (Seuil de bascule B → C).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| **(a) C en shadow, comparaison réservée UAT, puis remplacement de B** (recommandée) | Steve et l’équipe continuent de voir B, sans sélecteur. C est calculée en parallèle par le backend ; une page de comparaison B / C n’est accessible qu’en recette UAT et aux administrateurs. Le jour où le seuil D13 est franchi et que Farid décide, C remplace B à l’écran (scène 5). | • Conforme à #787 : aucun choix de vivier pour les utilisateurs.<br>• Interface simple, comme Steve le demande.<br>• Retour arrière simple : désactiver C. | • Steve ne voit C qu’en UAT (mode réservé) avant la bascule.<br>• La comparaison reste un outil interne. |
| (b) Sélecteur A/B/C visible + mode comparatif | Un sélecteur A / B / C apparaît dans le rail pour tous les utilisateurs, avec un mode comparatif ; le choix est porté dans l’URL (filter.targeting=a|b|c). | • Littéralement « A/B étendu en C ».<br>• L’utilisateur compare lui-même les sélections. | • Réintroduit un choix de viviers, contraire à #787 (item 4).<br>• Plus complexe à expliquer et à maintenir (paramètre filter.targeting). |
| (c) Incréments dans B | On n’expose pas C comme un tout : on ajoute à B, un par un, les critères de C (sens, plein droit, second projet), chacun livré quand il est prêt. | • Aligné avec #761 ; livrable par petits morceaux (sens, plein droit, second projet).<br>• Chaque amélioration est visible pour Steve dès sa livraison. | • Pas de mesure d’ensemble B contre C.<br>• Les filtres Résidentiel et Zonage restent. |
| (d) Application C séparée | On construit une seconde application dédiée à C, avec sa propre carte, ses filtres et ses notes ; Steve choisit l’une ou l’autre application. | • Liberté totale de simplification.<br>• Aucun risque pour l’écran actuel de Steve. | • Duplique sélection, filtres et notes.<br>• Deux applications à maintenir. |

**Recommandation : (a) C en shadow, comparaison réservée UAT, puis remplacement de B.** (a), avec des emprunts à (c) : interface simple pour Steve, conforme à #787, retour arrière immédiat. Si Farid veut un sélecteur visible, (b).

#### D13 — Seuil de bascule B → C (à fixer)
**Étape 2 · Décide : Farid · Consulté : Steve, Mathieu, Fabien.** Décidée après les décisions de Fabien.

Si C tourne en parallèle de B (D12), il faut écrire à l’avance quand C remplace B ; sans seuil écrit, la bascule se décidera à l’impression. La mesure viendra du jeu de référence de ciblage (D10), sur le jeu test des 52 villes, dans le volet ciblage du benchmark (D11). Point de départ mesuré sur l’échantillon de Steve : précision P ∪ S de B = 67,1 % (49 sur 73) ; 34 des 40 Pertinent visibles en passe 1 (§9.3). Proposition à amender par Farid dans le commentaire.

**Dépend de :** G6 (G6 — Règle et porteur de la promotion), D10 (Jeu de référence #783), D11 (Benchmark #782), D12 (Exposition A/B/C).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| **Aucun P masqué, précision P ∪ S > B, parité** (recommandée) | C remplace B seulement si, sur le jeu test des 52 villes : aucun signal que Steve juge Pertinent n’est masqué ; la précision P ∪ S de C dépasse celle de B (67,1 % sur la passe 1) ; l’API, le rail, la carte et le panneau montrent les mêmes ensembles ; Farid fait la recette. | • Protège la réserve de Steve : aucun Pertinent masqué.<br>• Exige un gain réel de précision, pas seulement un affichage plus court.<br>• Parité API, rail, carte, panneau : aucun écart entre écrans (#786). | • Demande le jeu test complet (52 villes) avant de basculer.<br>• La bascule peut tarder si un seul Pertinent est perdu. |
| Seuil chiffré différent | Farid écrit d’autres chiffres dans le commentaire (par exemple une précision minimale ou un rappel minimal), mesurés par le même jeu de référence. | • Farid fixe ses propres chiffres (à écrire dans le commentaire).<br>• Peut refléter un compromis métier que Farid connaît mieux. | • À préciser.<br>• Risque d’un seuil non mesurable par le jeu de référence. |
| Bascule sur recette seule | La bascule se décide sur la recette de Farid seule, sans mesure chiffrée par le jeu de référence. | • Rapide : recette de Farid seulement.<br>• Ne dépend pas de l’achèvement du jeu test. | • Sans mesure, aucune garantie de non-régression.<br>• Contraire à l’objet du jeu de référence de ciblage. |

**Recommandation : Aucun P masqué, précision P ∪ S > B, parité.** (a) : garantit qu’aucun dossier utile ne disparaît et que C fait réellement mieux que B, sur des écrans cohérents entre eux. Résidentiel et Zonage ne sont retirés qu’après une décision #761 fondée sur la mesure.

#### D14 — Première livraison UI
**Étape 2 · Décide : Farid · Consulté : Mathieu, Fabien.** Décidée après les décisions de Fabien.

Une fois les retours en base, il faut les montrer. L’UI est en migration : 39 composants Svelte sur 69 utilisent le design system, les 3 composants d’annotation aucun, et la carte Signaux est un composant local MapLibre de 2 761 lignes destiné à être remplacé (§8, scène 4). Il faut choisir où le retour de Steve apparaît en premier : dans le panneau du signal et le rail, ou directement sur la carte. Le choix décide si #784 avance sans attendre la migration geo. Il suppose l’ancre réparée (D3), la lecture conforme (D4) et la règle de visibilité (D6).

**Dépend de :** D3 (Ancre signal et correctif B0), D4 (Conformité sentropic et suppression), D6 (Visibilité et données personnelles). **Conditionne :** D15 (Séquencement).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| **(a) Panneau + rail + DS ciblé** (recommandée) | Dans le panneau du signal, un badge « Retour de Steve » (vert, jaune, rouge) ouvre une section « Avis de Steve » : classement, motif, sens, analyse, provenance, état du rattachement. Dans le rail, des compteurs P / S / N par ville. Les 3 composants d’annotation passent au design system. Rien sur la carte au premier lot. | • Valeur immédiate : badge et section « Avis de Steve » dans le panneau, compteurs P / S / N dans le rail.<br>• Aucun code ajouté à un composant à remplacer.<br>• Les 3 composants d’annotation migrent au design system dans le même lot. | • Pas d’indicateur sur la carte au premier lot.<br>• Les badges par signal exigent la lecture groupée du lot L2. |
| (b) Pastilles sur la carte actuelle dès L3 | En plus du panneau, des pastilles colorées sur la carte Signaux actuelle (composant local MapLibre de 2 761 lignes) dès le lot L3. | • Visibilité cartographique immédiate.<br>• L’ancre ne dépend pas du moteur de carte. | • Code ajouté à un composant de 2 761 lignes voué au remplacement.<br>• Double travail à la migration geo. |
| (c) Migration geo complète d’abord | On termine d’abord la migration de la carte vers les composants geo partagés (Porte 2), puis on affiche les retours sur la nouvelle carte et dans le panneau. | • Expérience cohérente d’emblée.<br>• Aucun code d’annotation à reprendre après la migration. | • Dépend de la « Porte 2 » (moteur geo désactivé aujourd’hui).<br>• Retarde #784 sans date. |
| (d) Tableau de retours séparé seul | Un écran séparé liste tous les retours de Steve (filtrable par ville, motif, statut de rattachement), sans rien afficher sur les objets du radar. | • Toute la donnée consultable en un seul écran.<br>• Utile comme outil de curation des rattachements. | • N’annote pas l’élément associé : ne répond pas à #784.<br>• Un écran de plus. |

**Recommandation : (a) Panneau + rail + DS ciblé.** (a) : valeur visible tout de suite, sans investir dans un composant de carte destiné à être remplacé.

#### D15 — Séquencement
**Étape 2 · Décide : Farid · Consulté : Mathieu, Fabien.** Décidée après les décisions de Fabien.

La priorité n° 1 de Steve reste la fraîcheur des signaux (#703, rafraîchissement quotidien). Le travail de ce dossier peut avancer en parallèle ou attendre. B0 (D3), l’import (L1) et le jeu de référence (O1, D10) ne touchent pas la chaîne de rafraîchissement ; le classifieur C (C1), lui, a besoin de signaux frais (§12). Le choix fixe quand Steve verra ses retours dans l’outil (D14).

**Dépend de :** G7 (G7 — Séquencement, tables immo et pilote C), D3 (Ancre signal et correctif B0), D10 (Jeu de référence #783), D14 (Première livraison UI).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| **(a) B0, import et jeu de référence en parallèle de la fraîcheur** (recommandée) | B0, l’import (L1) et le jeu de référence de ciblage (O1) démarrent maintenant, en parallèle de #703, car ils ne touchent pas la chaîne de rafraîchissement. Le classifieur C (C1) attend que le rafraîchissement soit stable. | • Valeur livrée tôt : annotation réparée, retours visibles, jeu de référence prêt.<br>• Aucune interférence avec la chaîne de rafraîchissement.<br>• C1 démarre sur des signaux stabilisés. | • Deux chantiers en parallèle à suivre.<br>• L’attention de l’équipe est partagée. |
| (b) Tout après #703 | Tout le travail de ce dossier attend la clôture de #703 (rafraîchissement quotidien en production). | • Une seule priorité à la fois.<br>• Aucun risque d’interférence, même indirecte, avec le rafraîchissement. | • Rien de visible pour Steve sur ses retours avant #703.<br>• L’annotation de signal reste cassée plus longtemps. |

**Recommandation : (a) B0, import et jeu de référence en parallèle de la fraîcheur.** (a) : livre tôt ce qui ne gêne pas le rafraîchissement, et garde C1 pour après sa stabilisation.

#### D16 — Retour à Steve
**Étape 2 · Décide : Farid · Consulté : Mathieu.** Décidée après les décisions de Fabien.

Steve a reconstitué le fonctionnement des filtres en observant l’écran, et écrit qu’« une seule réponse des développeurs remplacerait toute cette reconstitution » (R-16, §5.7). Le dossier a confronté sa reconstitution au code. Il faut décider si on lui renvoie maintenant la définition réelle des filtres et la table qui relie ses codes de motif aux critères C (D7, D8), ou si on attend C.

**Dépend de :** D7 (Définition de C v1), D8 (Cas contradictoires).

| Option | Description | Avantages | Inconvénients |
|---|---|---|---|
| **Renvoyer filtres réels et table de dérivation** (recommandée) | Mathieu et Farid envoient à Steve la définition réelle des cinq filtres (§5.7, lue dans le code) et la table qui relie ses 28 codes de motif aux critères C, pour qu’il la corrige avant le développement de C. | • Répond directement à sa demande R-16.<br>• Lui permet de corriger la table de dérivation avant le développement de C.<br>• Renforce la confiance du client. | • Un aller-retour à préparer (relecture par Mathieu et Farid).<br>• Une partie de ses observations date de septembre, en partie périmée depuis #793. |
| Ne rien renvoyer avant C | On ne répond pas à sa question R-16 avant que C soit développée ; il reçoit alors directement la nouvelle sélection. | • Évite un aller-retour intermédiaire.<br>• La réponse portera directement sur C, déjà développée. | • Steve continue à deviner le fonctionnement des filtres.<br>• Erreurs de dérivation découvertes trop tard. |

**Recommandation : Renvoyer filtres réels et table de dérivation.** Renvoyer, par Mathieu et Farid après relecture : répond à sa question et lui permet de corriger la table de dérivation avant que C soit développée.

---

## 11. Risques

| Risque | Effet | Réponse |
|---|---|---|
| Dérive des ids du graphe (ré-extraction, nœuds orphelins supprimés) | Annotations orphelines, jeu de référence inapplicable | Ancres texte + instantané `observed` + statut `vanished` ; mesure de résolution en L1 ; clé métier stable en suivi |
| Plusieurs objets par ligne, ids abrégés, alias de villes | Note attribuée au mauvais objet | Aperçu de résolution, rôles des liens, revue des ambiguïtés |
| Tableur, analyse et règles se contredisent | Jeu de référence qui sanctionne le bon comportement | Sources immuables, double annotation, adjudication nommée, désaccords publiés avant notation |
| Échantillon biaisé (51 villes, ordre du relevé ; corpus déjà filtré) | C réglée sur un sous-ensemble ; rappel surestimé | Test sur les 52 villes suivantes ; extension documentaire |
| Vue de Steve datée du 15–21 septembre | Constats de filtres périmés | §5.7 ; refaire C-49 et C-55 sur la version actuelle |
| Tension R-21 / S-RESTRICTIF ; sens par disposition | Perte d'un droit nouveau ou d'une étape utile | D8 ; sens par disposition ; un mixte reste visible |
| Données personnelles dans les verbatims | Exposition non conforme | D6 ; détection avant affichage ; export de benchmark limité |
| Paquet `comments` sans tombstone | Dette ou divergence avec sentropic | D4 ; demande à sentropic ; aucun chemin de suppression par le paquet |
| Annotation existante cassée sans que les tests le voient | Fonction morte | B0 avec test sur un id réel et preuve navigateur |
| Sur-investissement UI avant la maquette | Travail jeté | U1 en lecture seule |
| Jeu de référence 676 local contre 674 committé ; prompt gelé modifié | Benchmark non reproductible | Geler par hash ; D11 |
| Bascule geo couplée aux annotations | Livraison retardée | Ancre indépendante du moteur (D14) |

**Retour arrière.** Désactiver C et revenir à B ; désactiver la publication d'un lot sans effacer source ni réponses ; migrations additives, sans DROP. Une modification du cycle de suppression ou des droits est une décision contractuelle, pas un flag.

**Pré-mortem (hypothèse).** Six mois plus tard, l'échec viendrait d'avoir importé les classifications comme vérité définitive, attribué des groupes à un seul signal, affiché un nombre plus faible comme preuve de qualité, laissé disparaître les indéterminés, perdu les cibles à la ré-ingestion et cassé le dénominateur commun du benchmark. Garde-fous prioritaires : traçabilité des ancres, conservation des désaccords, rappel de bout en bout.

---

## 12. Plan et suites

```mermaid
flowchart LR
  subgraph P1["Priorité 1 de Steve · fraîcheur (hors dossier)"]
    F1["#703 refresh prod"]
    F2["#786 / #788 dates"]
  end
  L0["L0 ratification D1–D16"] --> B0["B0 ancre signal"]
  B0 --> L1["L1 schéma et import"]
  L1 --> L2["L2 ancres et API lecture"]
  L2 --> U1["U1 affichage DS"]
  L1 --> O1["O1 jeu de référence de ciblage"]
  O1 --> C1["C1 classifieur C shadow"]
  C1 --> C2["C2 comparaison et bascule"]
  O1 --> BM["#782 volet ciblage"]
  F1 -.-> C1
  U1 -.-> L7["L7 organisation #760"]
```

| Carte | Suite proposée | À ne pas lui attribuer |
|---|---|---|
| #784 | Sources, import, rattachement, restitution (B0, L1, L2, U1) | Importer un fichier ne clôt ni le jeu de référence ni C |
| #783 | Contrat de jeu de référence, double annotation, adjudication, version C (O1) | Aucun résultat C avant campagne ou rescoring valide |
| #760 | Parcours manuel et états utilisateur, avec la maquette (L7) | Pas d'extraction ni de benchmark |
| #761 | Rôle des filtres, second projet, sens, comparaison C | Rafraîchissement quotidien ≠ précocité réglementaire |
| #782 | Résultats post-B′ et post-C à côté de l'extraction | Ne pas appeler « v11 final » le rapport v11alpha |
| #697 | Nouvelles preuves de qualité et écarts de périmètre | Pas de choix de modèle C actuel |
| #786 / #787 / #788 | Dates et URL complète consommées par C | Aucun nouveau workflow LLM dates |
| #703 | Priorité fraîcheur ; snapshots d'évaluation traçables | Ce dossier n'arme aucun CronJob |

Les mises à jour de cartes sont des suites proposées, pas des publications effectuées.

---

## Annexe A — Convergence entre les deux auteurs

Légende : **=** convergence · **≈** convergence de fond, forme différente · **≠** divergence. Colonne « Arbitrage » : la source qui tranche, ou le décideur (Farid ou Fabien) si les sources ne suffisent pas.

### A.1 Chiffres

| Point | Auteur A | Auteur B | État | Arbitrage et preuve |
|---|---|---|---|---|
| Volumétrie (124 / 121 / 77 / 26 / 28) | identique | identique | = | Recompté sur `workbook-full.json` |
| Classement × passe (34/15/24 …) | identique | identique | = | Recompté sur `triage-rows.json` |
| Sens (55/38/14/10/7) | par passe | × classement | ≈ | Les deux tableaux sont repris (§5.3) |
| Codes employés 24/28 | = | = | = | Feuille Synthèse et Triage |
| Verdicts d'exclusion (102 …) | = | = | = | Feuille Écartés |
| Périmètre des constats | 67 V1, 5 Info, 4 « V2 — pour mémoire », 1 V2 | 67 / 5 / 5 V2 | ≈ | Auteur A plus fin, recompté colonne B |
| Valeurs mémorisées de la Synthèse | 45 formules avec valeurs | « formules sans valeur en cache » | ≠ | **Auteur A** : 45 formules sur 45 portent une valeur (`workbook-full.json`, ex. B4 = 40) |
| Qualité du filtrage | 5 comptes = 123 | 88/25/8/3 normalisé contre 88/25/7/3 | ≈ | Synthèse : 88/25/7/3/0 ; l'écart d'une ligne tient au regroupement de B |
| Identifiants candidats | colonne L : 121/124, 148 distincts, 27 multiples | 121/124, 33 multiples, 172 mentions, 227 distincts sur 3 feuilles | ≈ | Recompte : colonne L 121/148/27 ; toutes colonnes 121/150/30 ; 3 feuilles 227–237 selon la règle. Publier par le rapport d'import, avec la règle |
| Reconstitution 22/12/15/24 | « l'écart 34−22 n'établit pas quels enregistrements changent » | correspondance exacte | ≈ | **Effectifs vérifiés** (Pertinent ∧ Assouplissement = 22 en passe 1, etc.) ; règle de passage non énoncée par Steve → D8 |
| Jeu de référence 676 | 674/47 committé (`dd0561f6`) ; 676/43 copie locale par sha256 | 676 « introuvable sur les branches distantes » | ≈ | Les deux exacts ; la 676 doit être committée et gelée |
| Contrôles HTML bruts | 132 `<button>` / 37 fichiers | 125 / 35 | ≈ | 132/37 reproduit sur tous les `.svelte` hors tests ; 125/35 exclut stubs et harnais |
| Cellule la plus longue | 17 114 caractères vs corps de note 10 000 | — | = | `NOTE_BODY_MAX = 10_000` (`prospect-marks.ts:91`), cellule Constats E57 |

### A.2 Constats

| Point | Auteur A | Auteur B | État | Arbitrage et preuve |
|---|---|---|---|---|
| Défaut UUID de l'ancre signal | oui | oui | = | `prospect-marks.ts:107` `signal_id: z.string().uuid()` |
| Défaut auteur `authorId` / `sub` | — | oui | + | **Confirmé** : `SignalAnnotations.svelte:30` retombe sur `$authStore.user.sub` ; aucun panneau ne passe `currentUserId` ; l'API résout `session.sub` → `account_users.id` |
| Stabilité des ids du graphe | non mesurée | non garantie, nœuds orphelins supprimés | ≈ | **Auteur B** : suppression des orphelins dans `graph-store.ts` |
| Table `signals` | UUID volatil | aucune insertion sur `main` | ≈ | Seule insertion : test d'intégration |
| `packages/focus` sentropic | lu en local (HEAD `97fe9f53`) | supprimé de `main` | ≠ | **Auteur B** : `6ca53d11a chore: delete packages/focus (focus is owned by h2a)` |
| Suppression `comments` 0.2.0 | physique | physique, écart avec O1 | = | `store.ts:47-48` |
| Routeur Hono `contextType` fermé | — | oui | + | `hono.ts:17` `z.enum([...])` |
| Sélecteur A/B retiré | oui | oui (`f2c20573`) | = | `f2c20573` 2026-08-22 |
| « Décision owner #787 de ne pas réintroduire de choix de viviers » | — | décision du 2026-10-01 | ≠ | **Nuancé** : phrase de l'item 4 du comportement attendu (grammaire d'URL), règles validées le 1er octobre ; absente de la liste « Décisions du propriétaire » |
| Période datée par le document | écart relatif / personnalisé à réconcilier | #793 fusionnée le 2026-10-02 | ≈ | `27891b10` = merge de #793 |
| DS : 39/69 ; collab 0/3 ; carte MapLibre locale ; moteur désactivé | = | = | = | `code-audit.mjs`, `geo-engine-flag.ts` |

### A.3 Options, recommandations et décisions

| Sujet | Auteur A | Auteur B | État | Consolidation |
|---|---|---|---|---|
| Stockage | D1b sources + assertions + ancres | D1(b) + couches | = | D1 (b) ; D2 : couches devenues l'option b, recommandé désormais (a) modèle minimal (§6.3) |
| Correctif ancre | branche `entity` + `target_ref` | colonne texte `signal_node_id` + B0 | ≈ | D3 : clé texte namespacée sans FK, B0 immédiat |
| Conformité sentropic | D2b sous-contrats + mutation Radar | D3(a) adaptateur PG à tombstone hôte | ≠ | **Tranché vers A** par COLLAB §2 (« le paquet porte l'intégrité », tombstone hôte = piège) ; demande de tombstone à sentropic (B) conservée — D4 |
| Auteur Steve | pas d'identité forgée, auteur = écrivain réel | `ext:chaperon:steve` auteur du fil | ≠ | **Synthèse** : auteur documentaire externe + importateur tracé, sans droit de mutation — D5 |
| Visibilité / données personnelles | risque C-79 | D5(c) caviardage | ≈ | D6 (c) |
| Définition de C | D3b confirmés + à instruire | K1–K8 + asymétrie | ≈ | D7 : K1–K9 + trois états |
| Cas contradictoires | D3-cas | §9, §10 | = | D8 |
| Double annotation | 3 niveaux (source, référence, calcul) | `label_set` (radar B′ / Steve / prédiction) | ≈ | §6.6 ; sens laissé à Fabien (Farid consulté) — D9 |
| Jeu de référence | D4b double jeu de référence, corpus indépendant | D9 jeu de référence C, 51 / 52 villes | ≈ | D10 : les deux mécanismes cumulés |
| Benchmark | colonnes séparées | volet séparé, contrat v10 sous décision | = | D11 |
| A/B/C | D5b sélecteur + comparatif, B défaut | V2 shadow puis remplacement | ≠ | **Farid** — D12 ; recommandation consolidée : shadow + comparatif UAT |
| Seuil de bascule | non chiffré | exemple proposé | ≈ | **Farid** — D13 |
| UI première livraison | D6a panneaux + badges carte | U1 panneau + rail ; carte après migration | ≠ (partiel) | D14 (a) : pastilles carte après migration de `GeoCityMapBase` (2 761 lignes locales) ; (b) reste une option |
| Séquencement | L4 en parallèle de L3 | D11 (a) | = | D15 |
| Retour à Steve | — | D12 | + | D16 |

### A.4 Points laissés à la décision (Farid ou Fabien)

1. **D9** (Fabien, Farid consulté) : sens exact de « double annotation ».
2. **D12** (Farid, Steve, Mathieu et Fabien consultés) : C en shadow avec comparaison UAT, ou sélecteur A/B/C visible.
3. **D13** (Farid, Steve, Mathieu et Fabien consultés) : seuil chiffré de bascule.
4. **D4, réserve** (Fabien) : statut du dossier COLLAB hors `main` ; s'il n'est plus valable, l'adaptateur à tombstone hôte redevient une option.
5. **D8** (Farid) : cas métier contradictoires, à faire trancher avec Steve.

---

## Annexe B — Scènes Focus (sources canoniques)

Cinq scènes, chacune dans la forme qui convient à ce qu'elle montre. Elles ne changent rien au fond : elles rendent lisibles les critères de Steve en regard de l'existant (§2), le modèle de données (§6), l'architecture de l'import à l'affichage avec le jeu de référence (§6.5, §7, §9.3), l'architecture UI (§8) et l'affichage A/B/C (§9.5).
- Scène 1 : une **matrice** (tableau ci-dessous), un critère par ligne.
- Scène 2 : un **diagramme entité-relation** (`erDiagram`) du modèle cible par propriétaire (§6.3, §6.7) : tables, colonnes clés, relations et cardinalités.
- Scène 3 : une **architecture en couloirs verticaux** de gauche à droite (`flowchart LR`, un `subgraph` par couloir : utilisateurs, écrans UI, fonctions backend, données sur S3 et PostgreSQL), le jeu de référence en bande transversale en bas, système d'évaluation hors ligne.
- Scène 4 : des composants, en cartes A' 460 × 200 ; chaque `subgraph` est un conteneur natif `parentId`.
- Scène 5 : **deux zones explicites** (`flowchart LR`, un `subgraph` par couloir) : en haut l'**application**, ce que voient les utilisateurs et où chaque élément vit (écran, backend, base) ; en bas l'**évaluation hors ligne** (job Node sans écran) : référence gelée, diff nommé, jeu de référence C, mesure, seuil de bascule, décision de Farid.

### `criteres-steve` — Scène 1 · les trois critères de Steve en regard de l'existant

| Critère | Steve demande | Radar aujourd'hui | Couverture | Bruit passe 1 |
|---|---|---|---|---:|
| 1 · Résidentiel | Habitation seulement, et un règlement d'urbanisme | Filtre Résidentiel par marqueurs regex ; nature de l'acte non reconnue | partiel | 3 |
| 2 · Assouplissement | La modification ouvre, elle ne resserre pas | Aucun champ de sens, aucun filtre | absent | 4 |
| 3 · Densification | Plus d'unités qu'avant | Champ d'effet toujours `inconnu` ; B′ ne prouve pas la densité | absent | 6 |
| Exclusion · autorisation individuelle | Une règle générale, pas un PPCMOI ni une dérogation accordés à un demandeur | PIIA et dérogation exclus ; PPCMOI et usage conditionnel non exclus | partiel | 8 |
| Exclusion · point d'ordre du jour | Une décision du conseil, pas un point inscrit à l'ordre du jour | Aucune distinction entre ordre du jour et décision | absent | 3 |
| Vue de travail · passe 1 | 22 sur 73 réunissent les trois critères | 34 des 40 Pertinent affichés | — | 24 |

### `modele-donnees` — Scène 2 · modèle cible par propriétaire : sentropic, immo, engram

```mermaid
erDiagram
    annotation_sources ||--o{ annotation_revisions : import
    annotation_revisions |o--o| annotation_revisions : remplace
    annotation_revisions ||--o{ annotation_validations : decide
    annotation_revisions ||--o{ annotation_targets : vise
    annotation_targets }o..o| graph_nodes : ville_et_id_texte
    annotation_revisions }o--|| account_users : auteur
    annotation_validations }o--|| account_users : decideur
    profil_domaine ||..o{ annotation_revisions : schema_corps
    annotation_validations }o..o{ reference_set_versions : export_hache
    reference_set_versions ||--o{ eval_runs : mesure
    annotation_sources {
      uuid id PK
      text sha256 UK "classeur de Steve, une fois"
      text octets "S3 d’immo, par un port"
    }
    annotation_revisions {
      text content_hash PK "immuable"
      text prev_content_hash FK "révision précédente"
      uuid auteur FK "Steve, identité IdP"
      text origine "import ou saisie"
      jsonb corps "verdict, motif, sens, tags"
      text statut "calculé des validations"
    }
    annotation_validations {
      uuid id PK
      text revision_hash FK "révision visée"
      uuid decideur FK "équipe ou PO"
      text decision "accepter, contester, rejeter…"
      text motif "pourquoi"
    }
    annotation_targets {
      uuid id PK
      text cible_type "signal, ville, PV, zone, lot"
      text city_slug "clé du graphe (#812)"
      text cle "id, sha256 ou canonical_id"
      jsonb vu_par_steve "instantané observé"
    }
    profil_domaine {
      text fichier PK "ontology-profile.yaml"
      text etiquettes "verdicts, 28 motifs, critères"
      text promotion "règle D13"
    }
    account_users {
      uuid id PK
      text sub "sujet IdP sentropic"
    }
    graph_nodes {
      text city_slug PK "clé (city_slug, id), #812"
      text id PK "signal-… (texte)"
    }
    reference_set_versions {
      text id PK "ReferenceSet@version"
      text label_provenance "human_single pour C"
      text partitions "dev 51 villes, test 52"
      text manifest_sha256 "gel décidé dans track"
    }
    eval_runs {
      text run_id PK
      text candidat "profil + prompt + modèle"
      text resultat "métriques, garde"
    }
```

### `flux-import-oracle` — Scène 3 · architecture de l'import à l'affichage, jeu de référence transversal

```mermaid
flowchart LR
  subgraph L1["Utilisateurs"]
    EQP["Équipe · Farid, Mathieu"]
    STV["Steve · client"]
    OPS["Opérateur · owner"]
  end
  subgraph L2["Écrans UI"]
    MAP["Carte Signaux"]
    PAN["Panneau signal"]
    RAI["Rail · compteurs"]
    REV["File de revue des ancres"]
  end
  subgraph L3["Fonctions backend"]
    COL["Collecte des documents"]
    DET["Détection de signal"]
    IMP["Import du classeur"]
    RAT["Rattachement"]
    GSA["API graph-signals"]
    ANA["API annotations"]
  end
  subgraph L4["Données"]
    subgraph S3["S3 · stockage objet"]
      DOCS["Documents sources"]
      SNAP["Snapshots du graphe"]
      XLSB["Octets du classeur"]
    end
    subgraph PG["PostgreSQL"]
      GRA["graph_nodes · signaux"]
      ANN["annotations · verdicts"]
      PNO["prospect_notes v1"]
    end
  end
  subgraph OR["Jeu de référence · évaluation hors ligne"]
    OE["Jeu de référence E v3"]
    BEN["Benchmark #782"]
    SCO["Scoreur Node"]
    OC["Jeu de référence C gelé"]
    ADJ["Adjudication par critère"]
  end
  EQP -->|"consulte"| MAP
  STV -->|"classeur + analyse"| OPS
  OPS -->|"cible Make · dry-run"| IMP
  OPS -->|"revue"| REV
  MAP -->|"sélection"| PAN
  MAP -->|"vivier B"| GSA
  PAN -->|"lecture groupée"| ANA
  RAI -->|"compteurs"| ANA
  REV -->|"décision humaine"| RAT
  COL -->|"PV et règlements"| DOCS
  DET -->|"lit"| DOCS
  DET -->|"latest.json"| SNAP
  DET -->|"signaux"| GRA
  IMP -->|"octets · sha256"| XLSB
  IMP -->|"lignes et évaluations"| ANN
  RAT -->|"ids présents"| GRA
  RAT -->|"ancres"| ANN
  GSA -->|"lecture"| GRA
  ANA -->|"lecture conforme"| ANN
  ANA -->|"réponses v1"| PNO
  ANN -->|"export évaluations et ancres"| ADJ
  ADJ -->|"version gelée"| OC
  OC -->|"précision, rappel"| SCO
  GRA -->|"sélection B, C en shadow"| SCO
  OC -->|"volet ciblage"| BEN
  OE -->|"volet extraction"| BEN
```

### `architecture-ui` — Scène 4 · architecture UI et état de la migration

```mermaid
flowchart LR
  subgraph U1["ui · Vite + Svelte 5"]
    SMV["SignauxMapView"]
    GCB["GeoCityMapBase"]
    SSP["SignauxSelPanel"]
    RAIL["SignauxRail"]
    COL["collab/*"]
    AV["Avis de Steve"]
    GV["GeoView"]
  end
  subgraph U2["api · Hono"]
    GS["graph-signals"]
    PNA["prospects/notes"]
    ANN["annotations"]
  end
  subgraph U3["sentropic"]
    DS["design-system-svelte"]
    GEO["geo-ui-svelte"]
    CMS["comments 0.2.0"]
  end
  SMV -->|"carte locale"| GCB
  SMV -->|"panneau"| SSP
  SMV -->|"rail"| RAIL
  SSP -->|"notes v1"| COL
  SSP -.->|"U1 · lecture seule"| AV
  COL -->|"ancre à réparer"| PNA
  AV -->|"lecture groupée"| ANN
  SSP -->|"vivier B"| GS
  ANN -.->|"cibles et lecture"| CMS
  AV -->|"Badge, Card, Alert"| DS
  GV -->|"pilote #/geo"| GEO
  GCB -.->|"migration future"| GEO
```

### `affichage-abc` — Scène 5 · A, B et C : ce que voit l'application, ce que mesure l'évaluation

```mermaid
flowchart LR
  subgraph A1["Utilisateurs"]
    USR["Steve et l'équipe"]
    ADM["Farid · recette UAT"]
  end
  subgraph A2["Écrans"]
    MAPB["Carte et rail · profil B"]
    MAPC["Carte et rail · profil C"]
    UATC["Comparaison B / C · UAT"]
  end
  subgraph A3["Backend · API Hono"]
    APIB["graph-signals · profil B"]
    APIC["Calcul C · shadow"]
  end
  subgraph A4["Base · PostgreSQL"]
    GRA["graph_nodes · inventaire"]
    ANN["annotations · verdicts Steve"]
    ORR["reference_set_versions"]
  end
  subgraph EV["Évaluation hors ligne · job Node"]
    PA["Profil A gelé"]
    DIFF["Diff B → C nommé"]
    ORA["Jeu de référence C"]
    MES["Mesure B et C"]
    GATE["Seuil de bascule D13"]
    DEC["Décision de Farid"]
  end
  USR -->|"voit B par défaut"| MAPB
  USR -.->|"voit C après bascule"| MAPC
  ADM -->|"recette"| UATC
  MAPB -->|"liste B"| APIB
  MAPC -->|"liste C"| APIC
  UATC -->|"B et C côte à côte"| APIC
  APIB -->|"lit"| GRA
  APIC -->|"même snapshot"| GRA
  GRA -->|"snapshot figé"| PA
  PA -->|"référence"| DIFF
  APIB -->|"sélection B"| DIFF
  APIC -->|"sélection C"| DIFF
  ANN -->|"labels étayés"| ORA
  ORA -->|"version gelée"| ORR
  DIFF -->|"écarts nommés"| MES
  ORA -->|"noté sur"| MES
  MES -->|"au seuil D13"| GATE
  GATE -->|"proposition"| DEC
  DEC -->|"bascule B → C"| MAPC
```
