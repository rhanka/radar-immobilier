# Audit de cohérence — villes retenues par le vivier B′ × notations de Steve

**Auditeur** : Opus 5 (conducteur immo), lecture seule.
**Date de mesure** : 2026-07-25.
**Code audité** : HEAD de `docs/audit-steve-166-opus` (= `e2d1b60`, incluant `b1c1209`
« r axis keeps rezonings whose residential is unstated »).
**Donnée auditée** : base de **prod** `radar-postgres-0`, lecture seule, 7 221 nœuds
`Signal` + `DesignationEvent` porteurs d'un `city_slug`.
**Audit parallèle indépendant** : Codex 5.6-terra xhigh (non consulté ; aucun consensus recherché).

---

## 0. Méthode — ce qui est mesuré, et comment

Aucun chiffre de ce rapport n'est estimé. Tous sont produits en **rejouant le code de
production réel** sur un **dump de la base de prod**, pas sur des fixtures.

1. **Extraction prod** (lecture seule, aucune écriture, aucune action k8s hors `psql`) :
   ```
   kubectl exec -i -n radar-immobilier radar-postgres-0 -- sh -c \
     'PGPASSWORD=$POSTGRES_PASSWORD psql -U $POSTGRES_USER -d $POSTGRES_DB -tA' < dump.sql
   ```
   avec les champs métier lus **sous `props->'properties'`** (`category`, `etape`,
   `description`, `nb_unites_max`, `intensite`) — le piège `props->>'category'` (toujours
   `NULL`) a été évité ; `props` complet est conservé pour les `refs` imbriquées.
2. **Rejeu du chemin serveur** : import direct de
   `api/src/services/graph/graph-store.ts::aggregateGraphSignalProjectionRows` (la fonction
   même que `listCitiesWithSignalNodes`) et de
   `api/src/services/graph/vivier-v2.ts::classifyVivierSignal`. Pas de réplique.
3. **Rejeu du chemin client** : import direct de
   `ui/src/lib/signals/vivier-view-mode.ts::countForVivierCity` et
   `projectComposedVivierB`, avec la clé de mode servie par défaut (`vivier-v2`).

**Contrôles de fidélité du rejeu** (tous verts) :

| Contrôle | Résultat |
|---|---|
| Vivier A (`z\|m\|p`) reproduit l'axe de reporting canonique | **33 signaux / 31 villes** — conforme à `consolidation-30-2026-07.md` |
| Badge bulk (`countForVivierCity`) vs projection panneau (`projectComposedVivierB`) | **0 écart sur 724 villes** |
| Miroir de classification utilisé pour les contrefactuels vs code réel | **identique** sur la vue par défaut (170 villes / 308 signaux) ; écart de 1 ville / 1 signal sur la vue « toutes étapes » (déclaré) |

**MCP `radar-immo`** : le connecteur n'expose dans cette session **que** `authenticate` /
`complete_authentication` — **aucun verbe `search_signals` n'est disponible**. Il est donc
traité comme **indisponible** et **n'a servi à rien** dans cet audit. Aucune ligne de ce
rapport n'en dépend.

---

## 1. Le périmètre réel : 170 villes, pas 166

Le critère exact d'appartenance au vivier B′ tel que **servi par défaut** (onglet B, clé de
mode `vivier-v2`, axes `z✓ r✓ p✓` — cf. `DEFAULT_B_AXES`) est, par signal :

```
exclusion_reason === null
ET zonage.valeur === "oui"
ET isResidentialEligible(c)          // résidentiel "oui", OU "indéterminé" si instrument ∈ {rezonage, refonte}
ET etape ∈ {avis_motion, projet_reglement}
```

Une ville est **retenue** ssi elle porte ≥ 1 tel signal.

| Vue (axes) | Villes | Signaux |
|---|---:|---:|
| **B′ par défaut — `z✓ r✓ p✓`** | **170** | **308** |
| B — `z✓ r✓ p✗` (précoce décoché) | 461 | 1 243 |
| B — `z✓ r✗ p✓` (résidentiel décoché) | 255 | 786 |
| B — `z✓ r✗ p✗` | 682 | 4 989 |
| A — `z\|m\|p` (vivier de référence) | 31 | 33 |
| Univers : villes avec ≥ 1 signal | 724 | 7 221 |

**Le vrai nombre est 170, pas 166.** Les deux hypothèses d'écart ont été testées et
**écartées** : les 170 slugs ont tous un nœud `Municipality` (0 orphelin) et il n'y a
**aucune collision de nom** (170 slugs → 170 noms distincts). L'écart 166 → 170 est donc un
écart de **millésime** (mesure antérieure du propriétaire, sur une donnée ou un déploiement
plus anciens), pas un artefact de comptage. Contrefactuel utile : avec l'ancien axe `r`
strict (résidentiel `oui` seul, état d'avant `b1c1209`), la cohorte serait de
**84 villes / 134 signaux**.

> **Limite honnête** : je mesure **le code de HEAD × la donnée de prod**. Je n'ai pas
> vérifié quelle image tourne réellement dans le cluster (interdiction d'action k8s hors
> `psql`). Si le déploiement est en retard sur HEAD, l'écran du propriétaire peut afficher
> un nombre différent de 170.

La liste complète des 170 villes est en **Annexe A**.

---

## 2. Ce qui fait entrer une ville : les motifs typés et quantifiés

Sur les **308 signaux retenus** :

| Motif d'entrée | Signaux | % | Nature de la preuve |
|---|---:|---:|---|
| **M3a — rezonage dont l'objet n'est PAS dit** | **171** | **55,5 %** | `résidentiel = indéterminé`, repêché par `isResidentialEligible` parce que `instrument = rezonage` |
| M2a — texte résidentiel fort (logement/habitation/multifamilial/plex/usage mixte) | 83 | 26,9 % | marqueur lexical fort |
| M2b — texte résidentiel faible (« résidentiel(le) » ou « densification » seuls) | 45 | 14,6 % | marqueur lexical faible |
| M1b — catégorie `densification` | 6 | 1,9 % | catégorie du graphe |
| M3b — refonte dont l'objet n'est pas dit | 3 | 1,0 % | `instrument = refonte` |

**56,5 % des signaux retenus (174/308) entrent sans qu'aucune nature résidentielle ne soit
affirmée nulle part** : ils passent par la porte ouverte par `b1c1209`
(`RESIDENTIAL_ELIGIBLE_INSTRUMENTS = {rezonage, refonte}`).

Preuve de zonage : 237 par `category`, 70 par `type` (`DesignationEvent`, zonage accordé
d'office), **1** par repli sur l'`etape` annotée.

Étapes : 177 `avis_motion`, 131 `projet_reglement` (100 % précoces, par construction).

---

## 3. Confrontation aux notes de Steve — la recette STEVE-30 mesurée en prod

La table `RECETTE_VIVIER_BPRIME_STEVE30.md` est explicitement une **CIBLE**, validable
seulement « en QA prod ville par ville ». **C'est cette QA prod que la table ci-dessous
exécute**, sur la donnée réellement servie.

| # | Ville | Note Steve | B′ cible | **B′ mesuré** | Verdict |
|---:|---|---|:-:|:-:|---|
| 1 | saint-stanislas-de-kostka | 10 | ✓2 | **✓1** | présente, **compte sous la cible** |
| 2 | sutton | 10 | ✓2 | **✓1** | présente, **compte sous la cible** |
| 3 | saint-raphael | 10 | ✓2 | ✓2 | conforme |
| 4 | saint-raymond | 9 | ✓4 | ✓4 | conforme |
| 5 | saint-boniface | 8 | ✓1 | ✓1 | conforme |
| 6 | coaticook | 8 | ✓2 | ✓3 | conforme (au-dessus) |
| 7 | saint-mathieu-de-beloeil | 7 | ✓2 | ✓2 | conforme |
| 8 | saint-amable | 7 | ✓3 | ✓3 | conforme |
| 9 | mont-saint-hilaire | 0 et 7 | ✓2 | ✓2 | conforme |
| 10 | saint-gilbert | 6 | ✓2 | ✓2 | conforme |
| 11 | neuville | **4** | **✗0** | **✓1** | **cible d'exclusion violée** |
| 12 | saint-come-liniere | 3 | ✓1 | ✓1 | conforme (exception assumée) |
| 13 | rosemere | 2 | ✗0 | ✗0 | **conforme — la cible « non atteignable » l'est** |
| 14 | petite-riviere-saint-francois | 2 | ✓3 | ✓3 | conforme (exception assumée) |
| 15 | stratford | **0** | **✗0** | **✓1** | **cible d'exclusion violée** |
| 16 | mont-tremblant | non pertinent | ✓3 | ✓4 | au-dessus |
| 17 | saint-frederic | non rés. | ✓2 | ✓1 | sous la cible |
| 18 | saint-charles-borromee | non pertinent | ✗0 | ✗0 | **conforme** |
| 19 | sainte-cecile-de-milton | pas d'opp. | ✓2 | ✓2 | conforme |
| 20 | cowansville | promoteur | ✓2 | ✓2 | conforme |
| 21 | champlain | assouplissement | ✓2 | ✓2 | conforme |
| 22 | sainte-catherine | bug « indispo » | **✗0** | **✓2** | **cible d'exclusion violée** |
| 23 | hemmingford (×3 slugs) | bug | 0/0/1 | 0/0/1 | conforme |
| 24 | plaisance | bug | ✓3 | ✓3 | conforme |
| 25 | notre-dame-de-lourdes (×2) | bug | 2/2 | 2/2 | conforme |
| 26 | chelsea | bug | ✓2 | ✓2 | conforme |
| 27 | alma | bug | ✓2 | ✓2 | conforme |
| 28 | preissac | bug | **✗0** | **✓1** | **cible d'exclusion violée** |
| 29 | rimouski | bug | ✓1 | ✓1 | conforme |
| 30 | la-sarre | bug | ✓1 | ✓1 | conforme |

**Résultat mesuré, pas déclaré :**

- **Rappel : 10/10.** Les dix villes notées ≥ 6 sont **toutes** présentes dans B′, dont les
  trois 10/10-refontes. C'est l'objectif n°1 de la recette : **il est atteint en prod.**
  (Deux d'entre elles restent sous leur compte-cible : Saint-Stanislas et Sutton portent
  ✓1 au lieu de ✓2.)
- **Précision : 2/6.** Sur les six villes que la recette veut **hors** de B′, **quatre y
  sont** : Neuville (4/10), Stratford (0/10), Sainte-Catherine, Preissac. Seules Rosemère
  et Saint-Charles-Borromée sont correctement à ✗0 — et, fait notable, **elles y sont pour
  de bon en prod**, alors que la recette les déclarait « non atteignables côté immo ».
- **Les quatre violations ont exactement le même motif** : `M3a — rezonage dont l'objet
  n'est pas dit`. Aucune n'est due à une dérogation mineure ni à un marqueur commercial.

Extraits mesurés des quatre :

| Ville | Note | Signal qui la fait entrer |
|---|---|---|
| neuville | 4 | « modification zone Pa-4 — ouverture à usages **non-agricoles** » |
| stratford | 0 | « création nouvelle zone **RU-13** — modification zonage » |
| sainte-catherine | ✗0 | « règlement de **concordance** 2009-Z-94 » + « modification zonage secteur rue Centrale » |
| preissac | ✗0 | « rezonage bâtiment église — reconversion espaces locatifs » |

---

## 4. Y a-t-il une source de notation plus large que 30 lignes ?

**Non.** La recherche exhaustive du dépôt (`docs/`, fixtures, code) ne produit qu'**une
seule** source de notes de Steve :

- `docs/reports/recette/RECETTE_VIVIER_BPRIME_STEVE30.md` (30 lignes), gelée en code dans
  `api/src/services/graph/bprime-recette.fixture.ts::BPRIME_STEVE30_CONTRACT_CITIES`.

Les autres corpus Steve sont d'une **autre nature** : `docs/spec/input/carte-steve/` et
`SPEC_CONTROLE_PARITE_VILLES_STEVE.md` portent sur **4 villes de contrôle** (Delson,
Sainte-Catherine, Saint-Constant, Candiac) avec des **marques de prospection par lot**
(favori / non-retenu / sollicité / lettre / en-vente) — **pas de note /10 par ville**.
`docs/reports/analyse-vivier-b/` est une analyse de manques de données, dont le README
avertit lui-même que **ses chiffres ne sont pas fiables** (dénominateur faux, buckets
lexicaux non mesurés).

**Conséquence méthodologique assumée** : la vérité-terrain de notation se limite à
**30 lignes, dont 15 seulement portent une note numérique**. Tout classement des
170 villes est donc une **extrapolation argumentée**, jamais une note. **Aucune note n'est
inventée dans ce rapport.** Les 140 villes hors des 30 portent « — » en colonne note.

---

## 5. Stratification des 170 villes et synthèse chiffrée

### 5.1 La méthode de classement, et pourquoi elle ne peut pas être « la note de Steve »

La recette l'établit elle-même : **la note de Steve n'est pas une fonction du signal**.
Saint-Côme-Linière est notée 3/10 et Petite-Rivière-Saint-François 2/10 alors que leurs
signaux sont bons — la note basse tient au **propriétaire** (axe S17, hors signal), pas au
signal. Aucun classement dérivé de `graph_nodes` ne peut donc reproduire la note.

Ce qui est classable sur la donnée disponible, c'est **la force de la preuve de
densification résidentielle** — le critère central de Steve (« détecter tout ce qui indique
qu'une ville augmente la densité permise »). D'où cinq strates, appliquées au **meilleur
signal retenu** de chaque ville :

| Strate | Définition (déterministe, sur label + description normalisés) |
|---|---|
| **S1** | Densification résidentielle **explicite** : un compte de logements/unités/terrains ≥ 2, **ou** résidentiel `oui` + un terme d'effet densifiant (densité, étages, hauteur, superficie minimale, coefficient d'implantation, projet intégré, logement abordable/social, PPCMOI, usage conditionnel, UHA…) |
| **S2** | **Refonte complète** de la réglementation d'urbanisme (« refonte », « révision complète », « refondu », « nouveau règlement de zonage ») — l'archétype des 10/10 de Steve |
| **S4b** | Résidentiel affirmé mais **aucun effet densifiant chiffré ni nommé** |
| **S4a** | **Rezonage dont l'objet n'est écrit nulle part** — non jugeable |
| **S3** | Objet **identifiable et hors densification résidentielle** (environnement, agricole, énergie, fiscal/administratif, démolition, expropriation, institutionnel…) |

### 5.2 Validation de la méthode sur la seule vérité-terrain disponible

| Contrôle sur les 30 lignes | Résultat |
|---|---|
| Villes notées ≥ 6 tombant en **S1 ∪ S2** | **10 / 10** (7 en S1, 3 en S2) |
| Villes notées ≥ 6 tombant en S3 ou S4a | **0 / 10** |
| Villes « cible ✗0 » encore présentes, tombant en **S4a** | **4 / 4** (Neuville, Stratford, Sainte-Catherine, Preissac) |

La stratification sépare donc parfaitement le haut du bas **sur les 30 lignes connues**.
C'est un échantillon de 30 : c'est peu, et c'est dit.

### 5.3 Résultat

| Strate | Villes | % | Signaux | Lecture en termes de note de Steve |
|---|---:|---:|---:|---|
| **S1** densification résidentielle explicite | **59** | 34,7 % | 88 | **candidat 6–10** — la preuve existe |
| **S2** refonte complète | **13** | 7,6 % | 16 | **candidat 6–10** — archétype 10/10 |
| **S4b** résidentiel sans effet chiffré | 15 | 8,8 % | 31 | plus proche de 3 que de 6, indémontrable |
| **S4a** rezonage à objet non dit | **63** | 37,1 % | 142 | **indéterminable** (les 4 cas notés y sont tous ≤ 4) |
| **S3** objet hors densification résidentielle | **20** | 11,8 % | 31 | **≈ 3/10 ou moins — faux positif** |
| **Total** | **170** | 100 % | 308 | |

### 5.4 La réponse chiffrée à la question du propriétaire

> *« Sur les ~166 villes retenues, combien sont réellement des 10/10 à 6/10, et combien
> sont en réalité des ~3/10 ? »*

- **Haut du panier (10/10 → 6/10) : au plus 72 villes sur 170, soit 42 %.**
  C'est S1 + S2. Revue à la main des 61 villes S1 : **5 sont contestables** (Richmond =
  ajout d'un usage CPE ; Bouchette = garde de poules ; Cowansville = hébergement courte
  durée ; Chambly et Sainte-Séraphine = formulations spéculatives « probable
  densification »). **Fourchette défendable : 67 – 72 villes.**
- **Bas du panier (~3/10 ou moins), démontré : 20 villes, soit 12 %.**
  C'est S3. Revue à la main : **3 sont des faux positifs de mon propre lexique**
  (Hemmingford = agrandissement de périmètre urbain, qui est un bon signal ; Saguenay et
  Sainte-Angèle-de-Monnoir = ambigus). **Fourchette défendable : 17 – 20 villes.**
- **Non démontrable ni dans un sens ni dans l'autre : 78 villes, soit 46 %** (S4a 63 +
  S4b 15). Pour S4a, l'objet même du changement de zonage n'est écrit **nulle part dans la
  donnée** ; il faudra le Δ de grille de densité (geo 4a) pour trancher.
- **Si la calibration tient** — les 4 villes S4a dont on connaît l'attendu Steve sont
  **toutes** ≤ 4/10 — alors le **~3/10 attendu** est de l'ordre de **83 à 98 villes,
  soit 49 % à 58 % de la cohorte**. C'est une extrapolation depuis 4 points ; elle est
  donnée comme telle.

**Formulation courte et honnête : environ 4 villes sur 10 tiennent le haut du panier,
environ 1 sur 8 est un faux positif démontré, et près d'une sur deux n'est pas jugeable
sur la donnée actuelle — avec une présomption défavorable calibrée sur 4 cas.**

---

## 6. Les faux positifs typés et quantifiés

### 6.1 Motif n°1 — le rezonage dont l'objet n'est pas dit (63 villes, 142 signaux)

C'est la porte ouverte par `RESIDENTIAL_ELIGIBLE_INSTRUMENTS = {rezonage, refonte}`
(`packages/radar-domain/src/vivier/counts.ts:112`). Elle est **indifférenciée** : elle ne
distingue pas la refonte complète (Steve 10/10) du « règlement 026-511 modifiant le
règlement de zonage », dont personne ne sait ce qu'il contient.

Échantillon **mesuré** de ce que cette porte laisse entrer :

| Ville | Signal retenu |
|---|---|
| saint-jude | « avis de motion règlement 577-2026 **tarification municipale** » |
| saint-jude | « avis de motion règlement 578-2026 — **code d'éthique des élus** » |
| upton | « règlement 2026-404 **démolition** d'immeubles » |
| upton | « règlement 2026-406 usage **camions de cuisine** » |
| lochaber-partie-ouest | « projet **centrale solaire photovoltaïque 300 MW** » |
| nantes | « plan d'urbanisme — orientation **loisir/culture** » |
| saint-nazaire-dacton | « avis de motion **création du CCU** » |
| saint-elzear--bonaventure | « **droit de préemption** » |
| duhamel / east-angus | « **contrôle intérimaire** » (qui *gèle* le développement) |
| mont-tremblant | « **PIIA-34 bassins versants** — nouvelles exigences environnementales » |

### 6.2 Motif n°2 — l'objet hors-sujet malgré un « résidentiel = oui » (20 villes, 31 signaux)

Ici le mot « résidentiel » sert de **descripteur de localisation**, pas d'objet de l'acte :

- saint-dominique — « **garde d'animaux de ferme** en zone agricole **résidentielle** »
- richelieu — « appui CPTAQ — logement accessoire sous-sol en **zone agricole** »
- delson — « **expropriation** pour prolongement de boulevard, réserve foncière 9,5 M$ »
- richmond — « ajout usage **CPE** (garderie) en zone CV-5 »
- grand-metis — « densification zone 20 AGF — autorisation **chalets** »
- candiac — « **contrainte ferroviaire** : mitigation acoustique avant permis »
- pointe-claire — « programme d'aide **gestion des eaux pluviales** »
- tadoussac — « modification usage zone 31-C — **agriculture** sans élevage (champignons) »

### 6.3 L'hypothèse « dérogations mineures » du propriétaire : mécanisme confirmé, portée infirmée

Le propriétaire soupçonne que des dérogations mineures (une remise, une écurie, des
panneaux solaires) ressortent avec `zonage = oui`. **Le mécanisme existe et il est
massif** — mais **il ne pollue pas la cohorte des 170**.

| Fait mesuré | Valeur |
|---|---:|
| Signaux dont le `zonage = oui` est accordé **parce que** leur catégorie/étape est une dérogation | **1 630** |
| … dont via le **repli sur l'étape annotée** (`isZonageSignal:etape`) | 172 |
| … dont **précoces** | **1** |
| … dont **retenus dans les 170** | **0** |
| Dérogations retenues dans la vue B′ **par défaut** (`z✓ r✓ p✓`) | **1 / 308 (0,3 %)** |
| Dérogations retenues si **Précoce est décoché** (`z✓ r✓ p✗`) | **107 / 1 243 (8,6 %) — 73 villes** |
| … dont l'objet mineur est **identifiable** (garage, marge de recul, remise, stationnement…) | **37 — 32 villes** |
| Dérogations retenues si **Précoce et résidentiel décochés** | **1 329 / 4 989 (26,6 %) — 365 villes** |

**Explication** : une dérogation mineure est tranchée par **résolution** ; son étape est
`accordé` / `refusé` / `inconnu`, jamais `avis_motion` ni `projet_reglement`. L'axe
**Précoce coché par défaut neutralise donc toute la famille**. La pollution par dérogations
est réelle, quantifiée, mais elle vit dans les **vues relâchées**, pas dans les 170.

Quant aux panneaux solaires : le seul cas solaire retenu (Lochaber-Partie-Ouest, centrale
300 MW) n'est **pas** une dérogation — c'est un **rezonage à objet non dit** (motif n°1).

### 6.4 La preuve documentaire des 170 — état réel

| Preuve disponible | Signaux (/308) | Villes (/170) |
|---|---:|---:|
| Extrait verbatim de PV porté par le nœud (`provenance.extrait`) | 218 (71 %) | — |
| Lien de graphe vers un nœud `Source` | 76 (25 %) | — |
| **Aucune preuve** (ni extrait, ni Source) | **81 (26 %)** | **20** |
| Colonne `source_ref` renseignée | **0 / 7 221** | 0 |

**`source_ref` est NULL sur 100 % des 7 221 nœuds de signal.** La classification servie ne
porte donc **aucun pointeur de source dans ce champ** ; la traçabilité repose entièrement
sur l'extrait verbatim et sur 76 arêtes vers `Source`. **20 villes sur 170 sont retenues
sans aucune preuve documentaire attachée.** Par ailleurs 97 signaux sur 308 ont une
`description` strictement égale à leur `label` (pas d'information supplémentaire) et 13 ont
une description vide.

---

## 7. Les faux négatifs

La vérité-terrain ne signale aucun faux négatif : les 10 villes notées ≥ 6 sont présentes.
Mais la donnée en révèle un gisement **structurel** et important.

**297 signaux répartis sur 128 villes** portent une **preuve résidentielle forte** (≥ 4
logements chiffrés, ou un marqueur multilogement/multifamilial/logement social explicite).
**82 de ces villes sont absentes des 170.** Causes mesurées, sur les 183 signaux concernés :

| Cause | Signaux | Commentaire |
|---|---:|---|
| **`etape = inconnu`** (non précoce) | **94** | l'étape n'a pas pu être dérivée → l'axe Précoce, coché par défaut, les **supprime en silence** |
| `etape = adoption` | 27 | tardif, mais réel |
| `etape = second_projet` | 9 | |
| axe `r` : résidentiel indéterminé + instrument `piia` | 11 | le PIIA n'est pas dans la porte des instruments éligibles |
| axe `r` : résidentiel indéterminé + instrument `autre` | 10 | |
| **exclusion `non_residentiel_franc`** | **9** | voir §8.2 — défaut lexical |
| `zonage = indéterminé` | 8 | |
| axe `r` : résidentiel indéterminé + `ppcmoi` | 6 | |
| autres (consultation, entrée en vigueur, dérogation, PIIA non pertinent) | 9 | |

Les plus gros dossiers perdus (liste complète en **Annexe B**) :

| Ville | Logements | Cause |
|---|---:|---|
| charlemagne | 325 | `etape = inconnu` |
| joliette | 268 | axe `r` (PIIA, résidentiel indéterminé) |
| **beloeil** | **218** | **exclu `non_residentiel_franc`** |
| saint-cyrille-de-wendover | 190 | `etape = adoption` |
| lile-perrot | 168 | `etape = inconnu` |
| la-pocatiere | 244 (signal) | **exclu `non_residentiel_franc`** |

---

## 8. Correction des critères

### 8.1 C1 — Restreindre la porte « résidentiel non précisé » à la **refonte détectée**

**Constat** : `RESIDENTIAL_ELIGIBLE_INSTRUMENTS = {rezonage, refonte}`
(`counts.ts:112`) traite « refonte complète de l'urbanisme » et « modification du règlement
de zonage n° X » comme la **même** épistémologie. Le commentaire du code affirme qu'un
rezonage « réécrit la grille de zonage, donc peut être résidentiel » — c'est vrai d'une
refonte, c'est faux d'un amendement ponctuel qui peut porter sur les camions de cuisine.

**Correction** : garder l'éligibilité « non précisé » **uniquement** si le texte porte une
refonte (`refonte`, `révision complète`, `refondu`, `nouveau règlement de zonage`), qui est
déjà détectable — `classifyBPrime` porte d'ailleurs un `completeReform` inutilisé par cette
décision. Les trois 10/10 de Steve (Saint-Stanislas « révision complète », Sutton « refonte
totale », Saint-Raphaël « refonte complète ») **restent tous détectés**.

**Impact chiffré** :

| Mesure | Avant | Après C1 |
|---|---:|---:|
| Villes retenues | 170 | **98** (−72) |
| Signaux retenus | 308 | 158 |
| Villes ≥ 6/10 de Steve présentes | 10/10 | **10/10** |
| Cibles ✗0 de la recette tenues | **2/6** | **6/6** |

C1 sort **exactement** les quatre villes que la recette voulait dehors (Neuville, Stratford,
Sainte-Catherine, Preissac) **sans perdre une seule** ville bien notée. **C'est la
correction la plus rentable du lot.**

> Les 63 villes S4a ne doivent pas être *jetées* : elles doivent quitter la vue par défaut
> pour un bucket nommé **« objet du rezonage non déterminé — à qualifier par geo (Δ grille) »**.
> C'est précisément la cible geo 4a de `SPEC_EVOL_FILTRAGE_VIVIER_v2` §41.

### 8.2 C2 — Réparer le lexique résidentiel (pluriels) et la garde de preuve forte

**Deux défauts qui se composent, tous deux vérifiés sur le code de prod :**

1. `RESIDENTIEL_MARKERS_RE` (`api/src/services/graph/graph-store.ts:1226`) énumère
   `logement`, `habitation`, `condominium` **au singulier sans `s?`**, alors que
   `NON_RESIDENTIEL_MARKERS_RE` couvre bien ses pluriels. Résultat vérifié :
   `« 218 logements »` → **aucun marqueur résidentiel**, tandis que `« 1 logement »` en
   porte un.
2. `classificationFromResidentiel` (`api/src/services/graph/vivier-v2.ts:215-226`) applique
   la garde « preuve résidentielle FORTE l'emporte » **uniquement** sur la branche R3 ; sur
   la branche `pertinence === "non_residentiel"` (ligne 224) **il n'y a aucune garde**. La
   preuve forte est donc perdue.

**Trace réelle, Beloeil** (exécutée avec le code de production) :

```
label : 1er projet PPCMOI-2026-9027 — 218 logements + local commercial, zone C-512
classifyResidentielPertinence  -> non_residentiel     (le lexique rate « logements »)
classifyBPrime.residentiel     -> oui                 (B′ voit bien les 218 logements)
SERVI residentiel              -> non                 (la branche sans garde gagne)
SERVI exclusion_reason         -> non_residentiel_franc
```

Les **trois** nœuds du dossier (1er projet, signal, adoption) sont exclus. Beloeil disparaît
entièrement du vivier.

**Impact chiffré** :

| Mesure | Valeur |
|---|---:|
| Signaux où le lexique de l'axe A rate une preuve résidentielle forte présente | **112** (78 villes) |
| … rétrogradés en `indéterminé` (donc dépendants de la porte rezonage) | 90 |
| … **exclus** (`non_residentiel_franc` 12, `piia_non_pertinent` 2, `derogation_hors_sujet` 2) | 16 |
| Signaux exclus « non résidentiel » **malgré** une preuve résidentielle forte | **13** (9 villes) |
| … dont avec un compte ≥ 4 logements | 9 — Beloeil 218 (×3), La Pocatière 244, Acton Vale 12 (×3), Richelieu 12, Saint-Isidore 8 |
| Villes gagnées dans la vue par défaut | +3 (170 → 173) |
| Villes gagnées toutes étapes | +4 (461 → 464), +88 signaux |

C2 est **peu coûteux** (deux `s?` et une garde) et corrige un défaut qui fait disparaître
des projets de 200+ logements. Combiné : **C1 + C2 → 103 villes, rappel 10/10, précision
6/6.**

### 8.3 C3′ — Cesser de supprimer en silence les signaux dont l'étape est inconnue

**Constat** : `etape = inconnu` est traité comme « pas précoce » et **disparaît sans
trace** de la vue par défaut. C'est la première cause de faux négatif : **94 signaux à
preuve résidentielle forte** perdus, dont Charlemagne 325 logements et L'Île-Perrot
168 logements.

**Correction recommandée** : ne PAS fusionner l'inconnu dans le défaut — cela coûte de la
précision (mesuré : la cible ✗0 tombe de 6/6 à 3/6) — mais **exposer un bucket explicite**
« étape non déterminée » et **y afficher en priorité les signaux à preuve résidentielle
forte**, badgé « étape à confirmer ».

**Impact chiffré** :

| Scénario | Villes | Signaux | Rappel ≥6 | Cibles ✗0 |
|---|---:|---:|:-:|:-:|
| BASE (servi) | 170 | 308 | 10/10 | 2/6 |
| C1 seul | 98 | 158 | 10/10 | **6/6** |
| C2 seul | 173 | 321 | 10/10 | 2/6 |
| **C1 + C2 (recommandé pour la vue par défaut)** | **103** | **175** | **10/10** | **6/6** |
| C3′ seul (étape inconnue si preuve forte) | 268 | 629 | 10/10 | — |
| C1 + C2 + C3′ fusionnés dans le défaut | 210 | 540 | 10/10 | 3/6 |

### 8.4 Corrections secondaires (non chiffrées en cohorte, mais réelles)

- **Lexique « hors densification »** : aucun filtre ne rejette aujourd'hui `tarification`,
  `code d'éthique`, `démolition`, `expropriation`, `droit de préemption`, `contrôle
  intérimaire`, `CCU`, `solaire/photovoltaïque`. Ces objets sont explicites dans le texte —
  une raison d'exclusion **nommée** (comme R4 pour le pôle commercial) sortirait ≈ 31
  signaux / 20 villes sans aucune perte sur les 30 lignes connues.
- **`source_ref` NULL sur 7 221/7 221 nœuds** : la traçabilité documentaire du vivier repose
  sur un champ jamais renseigné. À relier à l'archive PV S3 (porteur geo).
- **Étape annotée comme preuve de zonage** : `isZonageSignal` accepte l'`etape` comme repli,
  ce qui accorde `zonage = oui` à 1 630 dérogations. Sans conséquence sur les 170 (§6.3),
  mais c'est ce qui rend les vues relâchées inexploitables.

---

## 9. Honnêteté — ce que je n'ai pas pu établir

1. **Je ne peux pas noter une ville à la place de Steve.** La vérité-terrain est de
   **30 lignes**, dont **15 notes numériques**. Les 140 autres villes portent « — ». Les
   strates S1…S4 sont une mesure de **force de preuve de densification**, pas une note.
2. **La note de Steve n'est pas reproductible sur cette donnée, par construction.** La
   recette elle-même documente que Saint-Côme-Linière (3/10) et Petite-Rivière (2/10) ont
   des notes basses **à cause du propriétaire** (axe S17), pas du signal. Tant que l'axe
   propriétaire (rôle d'évaluation + Registraire) n'est pas servi, **aucun classement
   dérivé du seul signal ne peut converger vers la note.**
3. **L'extrapolation « 83–98 villes à ~3/10 » repose sur 4 points de calibration.**
   Neuville (4), Stratford (0), Sainte-Catherine (✗0), Preissac (✗0). C'est peu. La borne
   *démontrée* est 20 villes (S3) ; le reste est une présomption, déclarée comme telle.
4. **Je n'ai pas vérifié la version déployée dans le cluster.** L'audit mesure HEAD × prod ;
   l'interdiction d'action k8s hors `psql` empêche de lire l'image servie. C'est
   l'explication la plus probable de l'écart 166 → 170, mais **elle n'est pas prouvée**.
5. **Le MCP `radar-immo` n'expose aucun verbe de recherche dans cette session** (seulement
   `authenticate`). Il est déclaré indisponible ; aucune conclusion n'en dépend.
6. **Aucune vérification sur les PV sources eux-mêmes.** Je n'ai lu aucun PDF : la preuve
   utilisée est l'extrait verbatim porté par le nœud (218/308) et les liens `Source`
   (76/308). Pour les 81 signaux sans preuve, **je ne peux pas dire si le texte du nœud est
   fidèle au PV**.
7. **Mes lexiques de stratification ont un taux d'erreur mesuré.** Revue manuelle : ~5
   erreurs sur 61 en S1, ~3 sur 20 en S3. Les fourchettes en §5.4 en tiennent compte.
   Je n'ai pas relu à la main les 63 villes S4a, car leur verdict est « indéterminable » —
   ce qui est vérifiable par lecture d'un seul champ (l'objet n'est pas écrit).
8. **`effet_densifiant` vaut `inconnu` sur 100 % des signaux retenus.** Le critère central
   de Steve — le Δ de densité autorisée — **n'existe pas dans la donnée servie**. Toute
   affirmation de « densification » dans ce rapport est lexicale, jamais mesurée sur la
   grille. C'est la limite dure de cet audit, et c'est exactement le complément geo 4a.
9. **Le contrefactuel « toutes étapes » diverge de 1 ville / 1 signal** du code réel
   (460/1242 vs 461/1243), très probablement à cause d'un repli sur un champ imbriqué de
   `props` non reproduit. Sur la vue par défaut auditée, la reproduction est **exacte**
   (170/308).

---

## Annexe A — Les 170 villes retenues, ligne par ligne

Colonnes : note Steve si connue (« — » sinon, jamais inventée) ; nombre de signaux retenus ;
motif d'entrée ; strate ; verdict ; preuve disponible ; libellé du signal le mieux classé.

| # | Ville (slug) | Note Steve | B′ | Sig. | Motif d'entrée | Strate | Verdict | Preuve | Signal le mieux classé |
|---:|---|---|:-:|---:|---|:-:|---|---|---|
| 1 | alma | bug | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV | Signal : densification résidentielle multifamiliale secteur Beauvoir / Notre-Dame Est — Al |
| 2 | amos | — | oui | 2 | texte résidentiel fort | S1 | justifié | aucune | Signal : conversion usage mixte — 304 6e Rue Ouest — zone C2-5 — Amos |
| 3 | arundel | — | oui | 1 | texte résidentiel faible | S1 | justifié | extrait PV | Signal : réduction superficie minimale lots résidentiels — Règlement 110.1-2026 Arundel |
| 4 | bolton-ouest | — | oui | 1 | texte résidentiel fort | S1 | justifié | extrait PV | Signal : logements accessoires — modification zonage 264-2008, Bolton-Ouest (juin 2026) |
| 5 | boucherville | — | oui | 1 | texte résidentiel fort | S1 | justifié | aucune | Signal : logements accessoires Vieux-Boucherville — règlement 2026-290-54 |
| 6 | chambly | — | oui | 1 | texte résidentiel faible | S1 | justifié | extrait PV | Signal : exemption stationnement édifice Joseph-Ostiguy (C-020) — probable changement d'us |
| 7 | champlain | assouplissement | oui | 2 | texte résidentiel faible | S1 | justifié | extrait PV + Source | Demande inclusion plan d'aménagement MRC des Chenaux — Projet Belvédère sur Champlain (64  |
| 8 | chelsea | bug | oui | 2 | texte résidentiel faible | S1 | justifié | extrait PV | Signal : densification Centre-Village — zones RES-CV-13/RES-CV-15 — Chelsea |
| 9 | chibougamau | — | oui | 2 | texte résidentiel faible | S1 | justifié | extrait PV + Source | Développement terrains résidentiels rue du Golf 2010 |
| 10 | coaticook | 8 | oui | 3 | texte résidentiel fort | S1 | justifié | extrait PV + Source | PPCMOI 1er projet — 12 logements 103-123 rue Saint-Marc (zone RD-104, résolution 26-02-382 |
| 11 | coteau-du-lac | — | oui | 2 | texte résidentiel faible | S1 | justifié | extrait PV + Source | PPCMOI — 25 rue des Chutes, agrandissement résidentiel, Coteau-du-Lac (fév. 2026) |
| 12 | cowansville | promoteur | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV + Source | PPCMOI 2026-032 — 245 rue Principale, lot 3 357 427 : hébergement courte durée 4 unités (R |
| 13 | disraeli--les-appalaches | — | oui | 1 | texte résidentiel fort | S1 | justifié | extrait PV | Signal : programme d'aide financière à la construction résidentielle multilogement — Disra |
| 14 | drummondville | — | oui | 2 | texte résidentiel fort | S1 | justifié | Source | PPCMOI 0349/04/26 (1er projet) — 2130 bd Lemire, 15 logements H-6 (Drummondville, 7 avril  |
| 15 | gaspe | — | oui | 1 | texte résidentiel faible | S1 | justifié | aucune | Signal : densification zones M-278/M-279 — modification coefficient d'implantation |
| 16 | la-pocatiere | — | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV + Source | Rezonage zone R-12 → trifamilial, 112 rue Bérubé (résolution 170-2025) |
| 17 | la-sarre | bug | oui | 1 | texte résidentiel fort | S1 | justifié | extrait PV | Signal : densification centre-ville zone CV-2 — augmentation max logements |
| 18 | labelle | — | oui | 1 | rezonage objet non dit | S1 | justifié | aucune | Signal : rezonage Ce-130→Ce-220 — projet intégré 7 bâtiments x 30 logements, Labelle |
| 19 | lachute | — | oui | 1 | texte résidentiel fort | S1 | justifié | Source | PPCMOI zones Hb-230/Ha-231 – 20 logements – lots 6 481 269-273, av. Hamford – Lachute |
| 20 | lavenir | — | oui | 1 | texte résidentiel fort | S1 | justifié | extrait PV + Source | Avis de motion et 1er projet règlement 797-26 — autorisation usage h3 multifamilial zone C |
| 21 | levis | — | oui | 2 | texte résidentiel faible | S1 | justifié | extrait PV + Source | Adoption projet RV3600 — Densification zone L0054 (hauteur 4 étages/18 m) |
| 22 | mascouche | — | oui | 1 | texte résidentiel fort | S1 | justifié | aucune | Signal : densification zone CM 597 — 100 logements/hectare max |
| 23 | metis-sur-mer | — | oui | 1 | texte résidentiel fort | S1 | justifié | extrait PV + Source | Modification zonage 26-196 — Réduction superficie min (60→55 m2) et marges zones MTF |
| 24 | mont-blanc | — | oui | 1 | texte résidentiel fort | S1 | justifié | aucune | Signal : création zone Hc-781 — densification habitation secteur Ha-746/Ha-768 |
| 25 | mont-saint-hilaire | 0 et 7 | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV | Signal : modification Plan d'urbanisme durable — nouvelle orientation gouvernementale habi |
| 26 | mont-tremblant | non pertinent | oui | 4 | texte résidentiel fort | S1 | justifié | extrait PV | Signal : demandes modification réglementaire densité et usages — rue Léonard et route 117 |
| 27 | notre-dame-de-lourdes--joliette | bug | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV + Source | Modification zonage zone U-41 – multifamiliale (règlement 03-2026) – séance 13 avril 2026 |
| 28 | notre-dame-de-lourdes--lerable | bug | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV | Signal : densification multifamiliale zone U-41 — augmentation nb logements et étages auto |
| 29 | notre-dame-du-bon-conseil--drummond | — | oui | 4 | texte résidentiel fort | S1 | justifié | extrait PV + Source | Changement de zonage lot 4 647 467 zone M-1 — habitations multifamiliales (Construction La |
| 30 | petite-riviere-saint-francois | 2 | oui | 3 | texte résidentiel fort | S1 | justifié | extrait PV + Source | Avis de motion — règlement 786 — densification zone U-24 — 9 juin 2026 |
| 31 | pierreville | — | oui | 1 | texte résidentiel fort | S1 | justifié | aucune | Signal — densification zone H-22, multilogement, Pierreville |
| 32 | plaisance | bug | oui | 3 | texte résidentiel fort | S1 | justifié | extrait PV + Source | Densification zone 43-Rid : ajout bi/multifamiliale (3-8 log.) — résolution 2026-04-090 |
| 33 | repentigny | — | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV + Source | Mandat évaluation immobilière projet logement social lot 6 287 867 — 111 unités (2025-08-1 |
| 34 | rimouski | bug | oui | 1 | catégorie densification | S1 | justifié | extrait PV | Signal densification — SPAR 328 logements abordables centre-ville Rimouski |
| 35 | saint-amable | 7 | oui | 3 | texte résidentiel faible | S1 | justifié | extrait PV | Signal : rezonage CEN-183/CEN-207 — densification rue Principale (projets résidentiels for |
| 36 | saint-basile-le-grand | — | oui | 3 | texte résidentiel fort | S1 | justifié | extrait PV | Signal rezonage : retrait H-2/H-3 zone 214-H (règlement U-220-67) — densification résident |
| 37 | saint-benoit-labre | — | oui | 3 | texte résidentiel faible | S1 | justifié | extrait PV + Source | Promesse de vente partie lot 6 705 278 — zonage public, future rue développement résidenti |
| 38 | saint-boniface | 8 | oui | 1 | texte résidentiel fort | S1 | justifié | extrait PV | Signal : densification zone 317 — max 4 logements (ex zone 309) |
| 39 | saint-bruno | — | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV | Signal : densification résidentielle — zones 104R/118M — Saint-Bruno 2026 |
| 40 | saint-come-liniere | 3 | oui | 1 | texte résidentiel faible | S1 | justifié | extrait PV | Signal : développement résidentiel (cession lots 3747390 + 6505757) + pétition rezonage 17 |
| 41 | saint-constant | — | oui | 1 | texte résidentiel fort | S1 | justifié | Source |  |
| 42 | saint-elie-de-caxton | — | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV + Source | Avis de motion règlement 2026-002 — Unités d'habitation accessoires (UHA) |
| 43 | saint-frederic | non rés. | oui | 1 | texte résidentiel faible | S1 | justifié | extrait PV | Signal : densification résidentielle zone Rf51 — ajout d'un étage |
| 44 | saint-gilbert | 6 | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV + Source | Modification zonage Ra/a-1 — Autorisation habitations moyenne densité (U-161-2026) |
| 45 | saint-jean-sur-richelieu | — | oui | 3 | texte résidentiel fort | S1 | justifié | Source | Avis de motion + 1er projet Règlement 2445 — zone H-5566 multifamilial |
| 46 | saint-jerome | — | oui | 1 | catégorie densification | S1 | justifié | extrait PV | Signal : rezonage 620-640 rue Castonguay — logements abordables (usages conditionnels) |
| 47 | saint-joseph-du-lac | — | oui | 3 | texte résidentiel faible | S1 | justifié | extrait PV + Source | Signal : avis de motion règlement 06-2026 — modification zonage 15-2024 projets intégrés r |
| 48 | saint-mathieu-de-beloeil | 7 | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV | Signal : encadrement logement abordable/HLM/logement social en zone résidentielle (22.14.0 |
| 49 | saint-raymond | 9 | oui | 4 | texte résidentiel faible | S1 | justifié | extrait PV | Création zone HC-13 résidentielle haute densité — côte Joyeuse (règlement 921-26, 1er proj |
| 50 | saint-victor | — | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV | Signal : encadrement densification résidentielle — superficies/largeurs maximales zones R |
| 51 | sainte-anne-de-la-rochelle | — | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV | Signal : amendement zonage — encadrement unités d'habitation accessoires (mai 2026) |
| 52 | sainte-cecile-de-milton | pas d'opp. | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV + Source | PR01-2026 — Autorisation habitation multifamiliale 4 logements lot 6 367 606, zone RE-9 —  |
| 53 | sainte-perpetue--lislet | — | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV | Signal : densification zone H-06 — ajout unifamiliale jumelée |
| 54 | sainte-perpetue--nicolet-yamaska | — | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV | Signal : Rezonage zone H-06 — Ajout unifamiliales jumelées (densification douce) |
| 55 | sainte-seraphine | — | oui | 1 | texte résidentiel faible | S1 | justifié | extrait PV | Signal : modification zonage 2026-002 — concordance régionale (densification potentielle) |
| 56 | sainte-therese | — | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV + Source | Avis de motion et 1er projet règlement 1352-1 N.S. — Logement social et abordable (2 mars  |
| 57 | stoneham-et-tewkesbury | — | oui | 2 | texte résidentiel fort | S1 | justifié | extrait PV | Signal : PPCMOI résidentiel intégré 18 logements (3 bâtiments, 102, 1re Avenue) |
| 58 | temiscaming | — | oui | 3 | catégorie densification | S1 | justifié | extrait PV | Signal — Développement résidentiel : rezonage lots 3 658 670, 3 658 657, 5 501 484 |
| 59 | waterloo | — | oui | 3 | texte résidentiel faible | S1 | justifié | extrait PV + Source | Avis de motion + adoption premier projet Règl. 26-956-1 — modification zonage omnibus (den |
| 60 | brome | — | oui | 2 | rezonage objet non dit | S2 | justifié (refonte) | extrait PV | Signal : refonte des règlements d'urbanisme — introduction de normes — Village de Brome 20 |
| 61 | godbout | — | oui | 1 | rezonage objet non dit | S2 | justifié (refonte) | aucune | Signal : refonte complète réglementation urbanisme — Godbout 2025 |
| 62 | gore | — | oui | 2 | refonte objet non dit | S2 | justifié (refonte) | extrait PV + Source | Déclaration intention modification grille zonage — lots 5 080 562 et 5 082 612 — refonte r |
| 63 | ham-sud | — | oui | 1 | rezonage objet non dit | S2 | justifié (refonte) | extrait PV | Signal : Refonte complète réglementation urbanisme Ham-Sud — 8 règlements 2025-07 à 2025-1 |
| 64 | hudson | — | oui | 1 | rezonage objet non dit | S2 | justifié (refonte) | extrait PV | Signal — vague réforme réglementaire Hudson : conformité SADR 3e génération MRC Vaudreuil- |
| 65 | la-minerve | — | oui | 1 | rezonage objet non dit | S2 | justifié (refonte) | extrait PV | Signal : Refonte réglementaire La Minerve 2026 — 6 règlements urbanisme adoptés (zonage +  |
| 66 | lac-brome | — | oui | 1 | rezonage objet non dit | S2 | justifié (refonte) | extrait PV | Signal : modification zonage 596-20 — zones riveraines lac Brome + UV-4-I12 / UV-14-J13 (s |
| 67 | lac-des-ecorces | — | oui | 1 | rezonage objet non dit | S2 | justifié (refonte) | extrait PV | Signal : retrait/report des projets de règlements d'urbanisme 308/309/310-2026 — refonte e |
| 68 | saint-etienne-de-bolton | — | oui | 1 | rezonage objet non dit | S2 | justifié (refonte) | extrait PV | Signal : refonte du cadre réglementaire urbanistique — 8 règlements simultanés 2026 |
| 69 | saint-raphael | 10 | oui | 2 | rezonage objet non dit | S2 | justifié (refonte) | extrait PV | Signal — refonte complète réglementation urbanisme Saint-Raphaël (zonage 2026-244 + 5 règl |
| 70 | saint-stanislas-de-kostka | 10 | oui | 1 | rezonage objet non dit | S2 | justifié (refonte) | extrait PV | Signal : premier projet règlement zonage 451-2025 — révision complète réglementation urban |
| 71 | sutton | 10 | oui | 1 | rezonage objet non dit | S2 | justifié (refonte) | extrait PV | Signal : refonte réglementaire complète Sutton — nouveau zonage et lotissement (2026) |
| 72 | tres-saint-redempteur | — | oui | 1 | rezonage objet non dit | S2 | justifié (refonte) | extrait PV | Signal : refonte règlementaire urbanisme — concordance SADR MRCVS 2023 (zonage, plan urban |
| 73 | baie-des-sables | — | oui | 1 | texte résidentiel faible | S4b | à confirmer | extrait PV + Source | Demande de conversion à fins résidentielles - Lot 514 - Club Raquetteur le Vaillant |
| 74 | batiscan | — | oui | 1 | texte résidentiel fort | S4b | à confirmer | extrait PV | Rezonage Zone 121-R vers 130-R pour habitations unifamiliales et bifamiliales |
| 75 | chesterville | — | oui | 2 | texte résidentiel faible | S4b | à confirmer | extrait PV | Signal : planification nouveau secteur résidentiel Chesterville — mandat La Boîte d'urbani |
| 76 | clermont--charlevoix-est | — | oui | 1 | texte résidentiel fort | S4b | à confirmer | extrait PV + Source | Adoption VC-434-25-3 : ajout usages H (Habitation) zone 033-Af — résolution 13465-01-26 |
| 77 | deux-montagnes | — | oui | 1 | texte résidentiel fort | S4b | à confirmer | extrait PV + Source | Adoption règlement n° 1767 — régularisation usage H4 zone H-204, Deux-Montagnes (9 avr. 20 |
| 78 | grande-vallee | — | oui | 2 | catégorie densification | S4b | à confirmer | extrait PV + Source | Signal : programme crédit taxes logements locatifs — pénurie de logements — Grande-Vallée |
| 79 | lawrenceville | — | oui | 2 | texte résidentiel fort | S4b | à confirmer | Source | 1er projet règlement 2026-369 — Modification zonage 2008-263 (zone MIX-2, UHAA, UHAD), avr |
| 80 | matane | — | oui | 1 | texte résidentiel fort | S4b | à confirmer | extrait PV + Source | Programme revitalisation habitations multifamiliales — Matane (VM-365-2) |
| 81 | mcmasterville | — | oui | 1 | texte résidentiel faible | S4b | à confirmer | aucune | Signal : modification zonage 382-37-2025 — projets résidentiels intégrés et garages |
| 82 | saint-jean-baptiste | — | oui | 4 | texte résidentiel fort | S4b | à confirmer | extrait PV + Source | DesignationEvent : avis de motion règlement 1011-26 — modification zonage zone R-2 (habita |
| 83 | saint-urbain-premier | — | oui | 1 | texte résidentiel fort | S4b | à confirmer | extrait PV + Source | Signal : avis motion + 1er projet R-510-26 — modification zonage H2 bifamilial lots 667128 |
| 84 | sainte-justine-de-newton | — | oui | 2 | texte résidentiel fort | S4b | à confirmer | extrait PV | Signal : modification zonage zone R-1 — autorisation habitation bifamiliale — règlement 41 |
| 85 | sayabec | — | oui | 1 | catégorie densification | S4b | à confirmer | aucune | Programme aide financière logements locatifs — Sayabec |
| 86 | scotstown | — | oui | 1 | texte résidentiel faible | S4b | à confirmer | extrait PV | Signal : rezonage ancienne église St-Paul (42 rue Albert) INS-1 → RES-2 (1er projet, harmo |
| 87 | warden | — | oui | 3 | texte résidentiel fort | S4b | à confirmer | extrait PV + Source | Avis de motion + dépôt + adoption premier projet Règl. 2026-179 — habitation multifamilial |
| 88 | auclair | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification zonage concordance MRC Témiscouata — îlot déstructuré 57A |
| 89 | barnston-ouest | — | oui | 3 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal — Modification zonage (Règlement 326-2026), Barnston-Ouest |
| 90 | cheneville | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal rezonage zone 21V — nouveau usage gestion matières résiduelles site Epursol, Chénév |
| 91 | dollard-des-ormeaux | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification zonage R-2025-199 — ajustements et corrections (R-2026-199-1, Dollar |
| 92 | dorval | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : PPU Michel-Jasmin — rezonage et concordance PIIA (RCM-60-PU.4 + RCM-1000, Dorval  |
| 93 | dudswell | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification zonage en cours — règlement 2026-300 amende 2017-226 (Dudswell 2026) |
| 94 | esprit-saint | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : permission mini maisons sur tout le territoire — Esprit-Saint 2026 |
| 95 | franklin | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal — Modification usages dans certaines zones — règlement 272-24 — Franklin |
| 96 | grande-riviere | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | aucune | Signal : modification règlement de zonage UGR-028 — Grande-Rivière |
| 97 | huberdeau | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : rezonage permettant 2 bâtiments principaux sur lots agricoles/équestres — Huberde |
| 98 | lac-etchemin | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal – amendement règlement de zonage 62-2006, projet 252-2026 – Lac-Etchemin |
| 99 | lac-saint-joseph | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal – modification règlement de zonage 2026-314 – Lac-Saint-Joseph |
| 100 | lislet | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification règlement de zonage 158-2013 — L'Islet (2026) |
| 101 | mont-laurier | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : demande rezonage zone IA-617 (9554-9002 Québec inc.) |
| 102 | montcalm | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification zonage 193-26-2026 en cours (1er projet juin 2026) — Montcalm |
| 103 | neuville | 4 | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification zone Pa-4 Neuville — ouverture à usages non-agricoles |
| 104 | notre-dame-du-rosaire | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification grille usages règlement de zonage 90-01 — territoire municipal |
| 105 | ormstown | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV + Source | Signal : modification zonage R-38 — ajout usages lot 6 338 471 (règlement 148.2-2025) |
| 106 | pont-rouge | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : rezonage nouvelle vision rues Dupont et du Collège — Pont-Rouge |
| 107 | portneuf | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification zones mixtes règlement 116 (École/Principale) — Portneuf 2026 |
| 108 | preissac | bug | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : rezonage bâtiment église — reconversion espaces locatifs |
| 109 | roxton | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification zonage — reconstruction bâtiment accessoire droits acquis |
| 110 | saint-alphonse | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : ajout usage piste de course zone 6-AF — Saint-Alphonse |
| 111 | saint-alphonse-rodriguez | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : fermeture emprise Route 343 — opportunité lot 6719331 |
| 112 | saint-ambroise-de-kildare | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification zonage 866-2026 — ajustements règlements urbanisme Saint-Ambroise-de |
| 113 | saint-aubert | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : Règlement omnibus 561-2026 — modification normes lotissement et PIIA (Saint-Auber |
| 114 | saint-blaise-sur-richelieu | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification règlement de zonage — 563-25 |
| 115 | saint-bruno-de-montarville | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification règlement de zonage URB-Z2017-086 — 2nd projet adopté fév. 2026 |
| 116 | saint-denis-de-la-bouteillerie | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification zonage (antennes télécommunications) — Saint-Denis-De La Bouteilleri |
| 117 | saint-eustache | — | oui | 49 | rezonage objet non dit | S4a | indéterminable | aucune | Signal : modification zonage règlement 1675-392 — étape projet_reglement |
| 118 | saint-felix-de-valois | — | oui | 4 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : rezonage zone M-12 superficie restauration — Règlement 554-2026 |
| 119 | saint-ferdinand | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : projet récréatif municipal — lot 6236245 zone R/C-8 |
| 120 | saint-francois-de-la-riviere-du-sud | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : rezonage périmètre urbain — agriculture artisanale autorisée |
| 121 | saint-germain-de-grantham | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification zonage omnibus 875-26 — rezonages R-47, R-54, C-4→R-5 (concordance M |
| 122 | saint-gilles | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : contrôle provisoire — suspension permis dans certaines zones (Saint-Gilles) |
| 123 | saint-louis-de-gonzague--beauharnois-salaberry | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : avis de motion règlement 26-184 gestion matières résiduelles |
| 124 | saint-marcel-de-richelieu | — | oui | 2 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : avis de motion règlement 26-485 — modification urbanisme façades orientées rue |
| 125 | saint-mathias-sur-richelieu | — | oui | 2 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal rezonage : modification grille R-0 du règlement de zonage 1026 (règlement 1065) |
| 126 | saint-michel | — | oui | 4 | rezonage objet non dit | S4a | indéterminable | aucune | Signal : modification zonage règlement 026-301 — étape avis_motion — Saint-Michel |
| 127 | saint-nazaire-dacton | — | oui | 2 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : avis de motion règlement occupation et entretien bâtiments — Saint-Nazaire-d'Acto |
| 128 | saint-odilon-de-cranbourne | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : changement de zonage multilogements rue des Cerisiers (en cours) |
| 129 | saint-ours | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : avis de motion + premier projet règlement 2026-303 — Zonage |
| 130 | saint-patrice-de-sherrington | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | aucune | Signal : modification règlements zonage/lotissement/plan urbanisme — 2026 |
| 131 | saint-paul-de-montminy | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : ajout usage hébergement-restauration zone RdM.1 — Saint-Paul-de-Montminy |
| 132 | saint-remi | — | oui | 2 | rezonage objet non dit | S4a | indéterminable | aucune | Signal : modification zonage concordance URB-18-2025 (V654-2026-33 adopté) — Saint-Rémi |
| 133 | saint-robert-bellarmin | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | aucune | Signal rezonage P-2 → M-2 lot 6 648 660 |
| 134 | saint-roch-de-richelieu | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : avis de motion règlement 478-2026 — gestion contractuelle |
| 135 | saint-sauveur | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification zonage omnibus 222-109-2026 — Saint-Sauveur |
| 136 | saint-simeon--bonaventure | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : rezonage zones érosion littorale Baie des Chaleurs — Saint-Siméon |
| 137 | saint-sylvere | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : Règlement PPCMOI + retrait Forte densité zones INST/M/R — Saint-Sylvère |
| 138 | saint-tite-des-caps | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : création zones villégiature Va-89 et Va-90 + modification zonage |
| 139 | sainte-adele | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification zonage — zone T3.1-010 — règlement 1314-2021-Z-23 — Sainte-Adèle |
| 140 | sainte-anne-de-sorel | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : rezonage règlement 605-2026 — Sainte-Anne-de-Sorel |
| 141 | sainte-anne-des-plaines | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV + Source | Signal : modification zonage règlement 860-129 — premier projet |
| 142 | sainte-brigitte-des-saults | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : amendement règlement de zonage 453/2021 (règl. 494/2026) |
| 143 | sainte-catherine | bug | oui | 2 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : règlement concordance 2009-Z-94 — modification règlement de zonage 2009-Z-00 |
| 144 | sainte-clotilde | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | aucune | Signal : avis motion règlement 471-10 — nouvelle modification zonage |
| 145 | sainte-martine | — | oui | 8 | rezonage objet non dit | S4a | indéterminable | aucune | Signal : modification zonage règlement 026-511 — étape avis_motion — Sainte-Martine |
| 146 | stratford | 0 | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : création nouvelle zone RU-13 — modification zonage Stratford |
| 147 | val-alain | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification règlement de zonage 204-2021 (règlement 272-2026, 1er projet déposé  |
| 148 | varennes | — | oui | 3 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal modification plan d'urbanisme (règlement 706-18) |
| 149 | westmount | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | extrait PV | Signal : modification zonage 1303 — bâtiments accessoires et structures de jardin |
| 150 | yamaska | — | oui | 1 | rezonage objet non dit | S4a | indéterminable | aucune | Signal : avis de motion RY-2026-133 entretien bâtiments — Yamaska |
| 151 | amherst | — | oui | 1 | rezonage objet non dit | S3 | faux positif | extrait PV | Signal : encadrement hébergement léger et usages conditionnels — nouvelles règlements 612- |
| 152 | bouchette | — | oui | 1 | texte résidentiel faible | S3 | faux positif | aucune | Signal : projet règlement 2026-384 — garde de poules zone urbaine (usage conditionnel) Bou |
| 153 | candiac | — | oui | 1 | texte résidentiel faible | S3 | faux positif | extrait PV | Signal : contrainte ferroviaire — Candiac impose mitigation acoustique/vibratoire avant pe |
| 154 | delson | — | oui | 1 | rezonage objet non dit | S3 | faux positif | extrait PV | Signal : expropriation lot 3 131 045 — prolongement boul. Georges-Gagné Nord, réserve fonc |
| 155 | duhamel | — | oui | 1 | rezonage objet non dit | S3 | faux positif | extrait PV | Signal : contrôle intérimaire en cours — règlement 2026-09 (Duhamel 2026) |
| 156 | east-angus | — | oui | 1 | rezonage objet non dit | S3 | faux positif | aucune | Signal : contrôle intérimaire East Angus — règlement 896 (réglementation transitoire) |
| 157 | grand-metis | — | oui | 1 | texte résidentiel faible | S3 | faux positif | extrait PV | Signal : densification zone 20 AGF — autorisation chalets Grand-Métis 2025 |
| 158 | hemmingford--les-jardins-de-napierville--2 | bug | oui | 1 | texte résidentiel faible | S3 | faux positif | extrait PV | Signal : agrandissement périmètre urbain — demande exclusion zone agricole CPTAQ pour lots |
| 159 | lochaber-partie-ouest | — | oui | 1 | rezonage objet non dit | S3 | faux positif | extrait PV | Signal : projet centrale solaire photovoltaïque 300 MW — Lochaber-Partie-Ouest (2026) |
| 160 | nantes | — | oui | 1 | rezonage objet non dit | S3 | faux positif | aucune | Signal : modification plan d'urbanisme secteur Laval — orientation loisir/culture (Nantes) |
| 161 | pointe-claire | — | oui | 1 | texte résidentiel faible | S3 | faux positif | extrait PV + Source | Avis de motion — programme aide financière gestion eaux pluviales domaine privé résidentie |
| 162 | richelieu | — | oui | 1 | texte résidentiel fort | S3 | faux positif | extrait PV + Source | Appui CPTAQ — logement accessoire sous-sol, 2230 ch. des Patriotes, lot 5 788 489 (zone ag |
| 163 | richmond | — | oui | 1 | texte résidentiel faible | S3 | faux positif | extrait PV | Signal : ajout usage CPE (C3.9) en zone CV-5 — Règlement 355, Richmond |
| 164 | saguenay | — | oui | 1 | texte résidentiel faible | S3 | faux positif | extrait PV | Signal : concordance PU-zonage zones riveraines Chicoutimi — potentiel densification |
| 165 | saint-dominique | — | oui | 1 | texte résidentiel faible | S3 | faux positif | extrait PV + Source | Modification règlement de zonage 2017-324 — garde d'animaux de ferme en zone agricole rési |
| 166 | saint-elzear--bonaventure | — | oui | 1 | rezonage objet non dit | S3 | faux positif | extrait PV + Source | Signal : droit de préemption — Saint-Elzéar (Bonaventure) |
| 167 | saint-jude | — | oui | 2 | rezonage objet non dit | S3 | faux positif | extrait PV | Signal : avis de motion règlement 577-2026 tarification municipal |
| 168 | sainte-angele-de-monnoir | — | oui | 1 | texte résidentiel faible | S3 | faux positif | extrait PV + Source | Avis de motion règlement 600-26 — plan urbanisme lots 1714099 et 1714135 |
| 169 | tadoussac | — | oui | 1 | rezonage objet non dit | S3 | faux positif | extrait PV | Signal : modification usage zone 31-C — agriculture sans élevage (champignons) |
| 170 | upton | — | oui | 2 | rezonage objet non dit | S3 | faux positif | extrait PV | Signal : avis de motion règlement 2026-404 démolition immeubles — Upton |

## Annexe B — Les 82 villes à preuve résidentielle forte absentes de B′

| # | Ville (slug) | Logements identifiés | Cause de l'absence | Signal |
|---:|---|---:|---|---|
| 1 | charlemagne | 325 | étape = inconnu (non précoce) | PIIA — Projet Quartier Oviv phase 2, 325 logements, 10 rue Notre-Dame, lots 6 638 149 et 6 |
| 2 | joliette | 268 | axe r : résidentiel=indetermine / instrument=piia | PIIA groupe mars 2026 — 11 PIIA approuvés (26-068), Joliette |
| 3 | beloeil | 218 | exclu : non_residentiel_franc | 1er projet PPCMOI-2026-9027 — 218 logements + local commercial, lot 4 553 167 zone C-512,  |
| 4 | saint-cyrille-de-wendover | 190 | étape = adoption (non précoce) | Signal : rezonage zones R-18/C-10 — projet intégré 190 logements |
| 5 | lile-perrot | 168 | étape = inconnu (non précoce) | DM accordées — 7e Rue, lots 5 727 972/6 338 830/6 338 831, zone H-37, multifamilial 9 étag |
| 6 | saint-hyacinthe | 142 | étape = inconnu (non précoce) | PPCMOI – 15855 av. Hubert / 3200 r. Saint-Charles / 3165 r. Saint-Pierre Ouest – Complexe  |
| 7 | saint-marc-des-carrieres | 130 | étape = adoption (non précoce) | Signal FORT : densification zone Mb-5 — 100-130 logements + services médicaux (22-32,5M$,  |
| 8 | blainville | 70 | étape = inconnu (non précoce) | Signal : résidence collective personnes aînées H4 chemin du Plan-Bouchard — Blainville (lo |
| 9 | port-cartier | 60 | axe r : résidentiel=indetermine / instrument=autre | Construction immeuble 60 logements — travaux réseau municipal — résolution 2026-05-223 |
| 10 | sainte-julienne | 60 | axe r : résidentiel=indetermine / instrument=ppcmoi | PPCMOI 2025-0043 — Retrait — 2 bâtiments 60 logements lot 6 526 683 rue Victoria |
| 11 | lavaltrie | 59 | étape = inconnu (non précoce) | Signal : densification Riva Est — 59 logements 6 étages lots 6617151/6500168, Lavaltrie |
| 12 | dunham | 56 | zonage = indetermine | Opportunité immobilière - Domaine du Centaure (56 logements + garderie) |
| 13 | saint-donat--matawinie | 54 | étape = inconnu (non précoce) | PPCMOI Projet Le Rémi — 54 logements multifamiliaux abordables, lots 5623324 et 5623330 |
| 14 | beaupre | 51 | étape = inconnu (non précoce) | Construction pavillon golf - 51 logements résidentiels |
| 15 | riviere-du-loup | 51 | étape = inconnu (non précoce) | Signal : 51 logements sociaux Office d'habitation — rue Bellevue zone HMD-301 |
| 16 | riviere-rouge | 49 | axe r : résidentiel=indetermine / instrument=autre | Plan image d'aménagement — Projet intégré récréotouristique Rouge Nord, 25 à 49 unités, lo |
| 17 | salaberry-de-valleyfield | 45 | axe r : résidentiel=indetermine / instrument=ppcmoi | PPCMOI2026-0066 — 110, chemin Larocque : résidences étudiantes et bureaux (9397-9342 Québe |
| 18 | saint-basile | 40 | étape = second_projet (non précoce) | Signal : densification haute densité Rc-9 — projet résidentiel intégré 4 immeubles (rues S |
| 19 | ham-nord | 40 | étape = inconnu (non précoce) | Signal : PPCMOI + densification périmètre urbain Ham-Nord — résolution 2026-05-79 |
| 20 | saint-augustin-de-desmaures | 39 | étape = consultation_publique (non précoce) | Signal : 39 logements lot 2 813 832 via loi 31 art. 93 — densité 67,5 logt/ha zone R-425 |
| 21 | ange-gardien | 36 | étape = inconnu (non précoce) | Signal : densification résidentielle multi-logements — rue des Colombes — Ange-Gardien |
| 22 | saint-jean-de-matha | 36 | axe r : résidentiel=indetermine / instrument=piia | PIIA projet intégré accordé — lot 6 651 580 route Louis-Cyr, 18 habitations jumelées 36 lo |
| 23 | sorel-tracy | 29 | étape = second_projet (non précoce) | Signal : densification résidentielle 29 logements zone C-03-730 (128-132 rue George, Sorel |
| 24 | contrecoeur | 28 | étape = inconnu (non précoce) | Signal : PIIA 2026-008 — immeuble 28 logements 4 étages, 4975 rue des Ormes — densificatio |
| 25 | la-prairie | 28 | étape = inconnu (non précoce) | Signal — densification multifamiliale rue du Sauvignon (4 bâtiments 7 unités), DM 2026-004 |
| 26 | sainte-marguerite | 28 | étape = inconnu (non précoce) | Signal: PPCMOI densification — 28 logements multifamiliaux (lots 6 660 450-454, zone RB-6) |
| 27 | windsor | 24 | étape = inconnu (non précoce) | Signal : projet 24 logements zone Rd-14 refusé — Windsor (PPCMOI-2026-01) |
| 28 | saint-lin-laurentides | 24 | étape = inconnu (non précoce) |  |
| 29 | saint-francois-du-lac | 24 | étape = entree_vigueur (non précoce) | Signal : densification zone C-1 — multifamiliales 24 logements 3 étages autorisés (ZO-11-2 |
| 30 | brownsburg-chatham | 18 | étape = inconnu (non précoce) | Signal : développement 18 lots rue d'Anjou — PIIA 2026-004 accepté, Brownsburg-Chatham |
| 31 | rawdon | 18 | étape = inconnu (non précoce) | Signal — Densification rue Metcalfe zone CV-7, 6 trifamiliales contiguës (18 logements, Ra |
| 32 | saint-georges | 18 | étape = adoption (non précoce) | Signal: densification haute densité 25e-30e Avenues — multifamiliales 6-18 logements |
| 33 | sainte-claire | 17 | étape = second_projet (non précoce) | PPCMOI — 17 logements/lot sur 6703090 à 6703093 (zone 191-Hc, adoption 2e projet) |
| 34 | acton-vale | 16 | étape = inconnu (non précoce) | Dérogation mineure — 998, rue Landry — thermopompes cour avant (résolution 2026-01-038) |
| 35 | farnham | 16 | étape = adoption (non précoce) | Signal : développement 16 lots unifamiliaux — Route 104/Curé-Godbout, Farnham 2026 |
| 36 | piedmont | 15 | étape = inconnu (non précoce) | Signal — intensité PIIA Piedmont (15 dossiers en une séance, juin 2026) |
| 37 | carleton-sur-mer | 14 | étape = inconnu (non précoce) | Signal : projet 14 logements abordables rue Comeau — densification résidentielle |
| 38 | hinchinbrooke | 14 | axe r : résidentiel=indetermine / instrument=autre | Adoption règlement 378-27 — augmentation densité zone Ra-9 (3,3 à 14 log/ha, résolution 26 |
| 39 | campbells-bay | 13 | étape = inconnu (non précoce) | Dérogation mineure refusée — stationnement multilogement 13 logements, 1 rue Ringrose (020 |
| 40 | lery | 12 | étape = inconnu (non précoce) | Signal multifamilial intensif — 5 immeubles 12 log. rue Madeleine-Marchand, zone H02-25 (P |
| 41 | kingsbury | 12 | exclu : non_residentiel_franc | Signal : subdivision et vente édifice industriel lot 3 510 608 (370 rue du Moulin) — Kings |
| 42 | grenville | 12 | zonage = indetermine | Projet de construction de 12 logements avec branchement sanitaire |
| 43 | sainte-barbe | 12 | étape = second_projet (non précoce) | Signal : Modification zonage CB-2/MX-3 — augmentation logements max à 12 |
| 44 | dolbeau-mistassini | 10 | étape = inconnu (non précoce) | PAE — 10 logements rue des Peupliers lots 2908980/81/82 (Construction M.G. inc.) |
| 45 | otterburn-park | 10 | axe r : résidentiel=indetermine / instrument=piia | Signal : construction en rangée 6 unités + 4 unités secteur Rosalie-Dessaulles / Dormicour |
| 46 | lassomption | 9 | étape = inconnu (non précoce) | Signal — activité PPCMOI multifamiliale soutenue dans noyau villageois et secteur résident |
| 47 | mercier | 9 | étape = inconnu (non précoce) | Signal densification — 3 habitations trifamiliales rue Lalonde (9 unités, PIIA approuvés) |
| 48 | ayers-cliff | 8 | étape = adoption (non précoce) | Signal : PPCMOI rue Laurel (Res-9) — 2 bâtiments jumelés, densification résidentielle, Aye |
| 49 | saint-andre-dargenteuil | 8 | étape = adoption (non précoce) | PIIA-002 — bâtiment multifamilial 221-223 route du Long-Sault |
| 50 | montebello | 8 | étape = inconnu (non précoce) | PIIA 2026-0042 + lotissement L2026-02 — Résidence multifamiliale 8 logements (lot proj. 6  |
| 51 | saint-isidore-de-clifton | 8 | axe r : résidentiel=indetermine / instrument=autre | Étude géotechnique terrain municipal — Projet 8 logements abordables (13 avril 2026) |
| 52 | saint-simon | 8 | étape = second_projet (non précoce) | Signal MAJEUR : Jardins Saint-Simon — développement domiciliaire 16+ lots (ancienne usine  |
| 53 | saint-theodore-dacton | 8 | étape = adoption (non précoce) | Signal : densification zone 202 — habitations multifamiliales jusqu'à 8 logements (règleme |
| 54 | carignan | 8 | étape = inconnu (non précoce) | Signal : densification rue Étienne-Provost — 4 nouvelles constructions avec studios intégr |
| 55 | degelis | 8 | étape = inconnu (non précoce) | Dérogation mineure PDM-2-2026 — Marge recul arrière lot 4 329 085 — Dégelis |
| 56 | east-broughton | 7 | étape = adoption (non précoce) | DM-2025-07 — lot 4 545 998 changement zonage 7 logements REFUSÉ (East Broughton) |
| 57 | compton | 6 | exclu : piia_non_pertinent | PIIA — immeuble 6 logements lot 1 803 697 zone H3 (résolution 045-2026-02-10) |
| 58 | bedford--brome-missisquoi | 6 | étape = inconnu (non précoce) | PIIA 104 rue Principale — Rénovation 6 logements + 2 commerces (26-05-148) |
| 59 | orford | 6 | exclu : non_residentiel_franc | Signal : agrandissement secteur de consolidation lot 3 787 898 — potentiel 4-6 bâtiments,  |
| 60 | beauceville | 6 | étape = inconnu (non précoce) | Signal densification : bâtiment 5-6 étages zone 322-CV, 9e Avenue — Beauceville |
| 61 | sept-iles | 6 | zonage = indetermine | Ajout usage multifamilial (Rj, >6 logements) — zone 819 R |
| 62 | la-redemption | 6 | étape = adoption (non précoce) | Signal : densification résidentielle multifamiliale — extension zones HBF village |
| 63 | rosemere | 5 | étape = inconnu (non précoce) | Signal : construction multifamiliale 10 unités (206 et 208, rue William) — Rosemère |
| 64 | elgin | 5 | étape = inconnu (non précoce) | Signal : lotissement résidentiel 5 lots — îlot déstructuré ID-1, chemin des Chalets — Elgi |
| 65 | austin | 4 | étape = inconnu (non précoce) | Signal : PIIA-II 4 logements lot 6 568 695 impasse du Renard — densification résidentielle |
| 66 | val-des-monts | 4 | étape = second_projet (non précoce) | Amendement zonage zone 206-P : ajout usages H1 et H2 (rés. 26-01-020) |
| 67 | saint-cuthbert | 4 | étape = adoption (non précoce) | Signal : densification zones M-2/M-3 — bâtiments 4 logements autorisés (règlement 352-2) |
| 68 | saint-valentin | 4 | axe r : résidentiel=indetermine / instrument=autre |  |
| 69 | ripon | 4 | étape = adoption (non précoce) | Signal : lotissement 4 nouveaux lots — Montée Levert, Ripon (juin 2026) |
| 70 | sainte-thecle | 4 | axe r : résidentiel=indetermine / instrument=autre | Refus d'inclusion zone 106-CA — 250-252 rue Notre-Dame (projet 4 logements refusé, terrain |
| 71 | bedford--brome-missisquoi--2 | 4 | étape = inconnu (non précoce) | PIIA — Nouveau 4 plex Lot 5 603 254 rue Leclair — Bedford (rés. 26-06-178) |
| 72 | saint-gabriel | 4 | étape = inconnu (non précoce) | Modification réglementaire 2026-014 — zone H-43 — max 4 logements (mai 2026) |
| 73 | saint-henri | — | étape = adoption (non précoce) | Signal: densification entrée Nord Saint-Henri — zones 34-C/34.1-C (multifamilial + commerc |
| 74 | chertsey | — | étape = adoption (non précoce) | Signal : densification périmètre urbain Chertsey — ajout RHD et usage multifamilial zone U |
| 75 | huntingdon | — | étape = inconnu (non précoce) | Signal : usage conditionnel h4 (multifamilial adapté) autorisé en zone CO-3 — Huntingdon |
| 76 | saint-philippe | — | étape = inconnu (non précoce) |  |
| 77 | saint-alban | — | étape = adoption (non précoce) | Signal : densification résidentielle haute densité — intersection rues Principale et Sauve |
| 78 | sainte-julie | — | étape = second_projet (non précoce) | Signal PPCMOI : bâtiment multifamilial 846, montée Sainte-Julie (2 étages, lot 5 550 698) |
| 79 | weedon | — | exclu : hors_zonage | Signal : vente terrain municipal pour construction multi-familiale — 9e Avenue Weedon |
| 80 | louiseville | — | étape = inconnu (non précoce) | Signal: usages conditionnels zones CV4 + CV1 — court séjour et multifamilial (Louiseville  |
| 81 | les-cedres | — | zonage = indetermine | Signal : acquisition municipale 724 ch. Saint-Féréol (lot 2047841) — 822 900 $, Les Cèdres |
| 82 | saint-elzear--la-nouvelle-beauce | — | étape = inconnu (non précoce) | Démolition immeuble résidentiel saisonnier 1898 — lot 3 582 489 |

---

## Reproductibilité

Scripts de rejeu (jetables, hors dépôt) : dump SQL prod → `replay-stage1.ts` (import du code
serveur réel) → `replay-stage2.ts` (import du code UI réel via `tsx --tsconfig ui/tsconfig.json`)
→ `counterfactual.mjs` / `strata.mjs` (contrefactuels et strates). Toutes les mesures de ce
rapport sont dérivées de ces sorties. Aucune écriture en prod ; aucune action k8s hors
`kubectl exec … psql` en lecture.
