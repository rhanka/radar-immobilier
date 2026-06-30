# WP3 — Réconciliation E2E & preuve : anomalies à l'atome (opportunités prioritaires z∩m∩p)

> **Date** : 2026-06-28 · **Auteur** : WP3 (lecture seule Track) · **Nature** : audit DATA + ALGO, **pas UAT**.
> **Source de preuve** : graph S3 `s3://radar-immobilier-docs-pocs/graph/<ville>/latest.json` (10 villes téléchargées et inspectées via `jq`) + code API/UI.
> **Stack** : API (`:8803`) **non démarrée** → tout ce qui nécessite le rendu live est marqué **DÉDUIT (stack requise)** ; tout le reste est **MESURÉ** sur le graph ou le code.

---

## 0. Mesures globales (MESURÉ sur le graph)

| Mesure | Valeur |
|---|---|
| Villes inspectées | 10 (9 en ontology **2.3**, hemmingford en **2.2**) |
| Signaux totaux | **27** |
| Signaux avec `zone_ref` **structuré** | **5 / 27** (I93, A16, C-18, I-4, I-2) |
| Signaux avec citation **ABSENTE** | **8 / 27** (rosemere 2, saint-mathieu 4, hemmingford 2) |
| Signaux sans `page` | **8 / 27** |
| Signaux avec **bbox** | **0 / 27** |
| Nœuds Zone dans le graph | **15** |
| Nœuds Zone portant une **géométrie** | **0 / 15** |

**Trois faits structurants** qui expliquent la quasi-totalité des cas du principal :

1. **L'extracteur UI ne lit que les champs structurés.** `extractSignalZoneRefs()` (`ui/src/lib/maps/signaux-map-geo.ts:176`) lit `zone_ref/zoneRef/zone/zones/targets_zone` **du nœud Signal**, jamais le label ni la citation. Or graphify ne structure `zone_ref` que sur **5/27** signaux → **22/27** zones citées en texte ne sont ni mappées, ni filtrées, ni highlightées. *(ALGO)*
2. **Le graph ne porte aucune géométrie de zone** (0/15) ; elle dépend de la couche cadastrale `/api/geo/zones`, non vérifiable stack down. *(DATA)*
3. **Le mapping graph est « dark ».** Les edges `targets_zone / assigned_zone / rezones→Zone` + les nœuds Zone existent (NDM 388/138, saint-charles C-16/17…), mais la route `/api/graph-signals` ne renvoie que Signal/DesignationEvent (pas les edges, pas les Zone). L'UI re-dérive le mapping depuis `signal.zone_ref` seul → l'information de jointure du graph n'arrive jamais à l'écran. *(DATA+ALGO)*

---

## 1. Tableau atomique des anomalies

| ID | Ville | Signal / objet | Zone citée | Source (extrait) | Problème | Type | Cause probable | DATA/ALGO | Résolution | Statut |
|----|-------|----------------|-----------|------------------|----------|------|----------------|-----------|------------|--------|
| **A-T1** | TOUTES | 22/27 signaux | PIIA-34, Z-94/84, IDC-1/4, CEN-183/207, H-59, RX-122, C-17… | label/citation du Signal | `extractSignalZoneRefs` ne lit que les champs structurés ; 22/27 zones citées en texte non mappées/filtrées/highlightées | 2.1.3 | extracteur ignore le texte + graphify ne structure pas `zone_ref` | **ALGO** | scan regex zone sur label+citation **et** peupler `zone_ref` à la source | MESURÉ (code+graph) |
| **A-T2** | TOUTES | — | toutes | nœuds Zone | 0/15 nœuds Zone n'ont de géométrie ; couche `/api/geo/zones` séparée, couverture non vérifiée | 2.1.2 | séparation graph/PostGIS, géo non peuplée | **DATA** | peupler `zones.geom` ou fallback lot-union ; sinon badge honnête | MESURÉ (graph) / DÉDUIT (géo live) |
| **A-T3** | TOUTES | events→zone | 388/138, C-16/17, A16/I93/Rf51, C-18 | edges `targets_zone/assigned_zone/rezones` | mapping graph riche **non exposé** par la couche de service | 2.1.3 | route graph-signals ne traverse pas les edges | **DATA+ALGO** | exposer Zone+edges via `/api/geo/zones` | MESURÉ (route+graph) |
| **A-T4** | TOUTES | 27/27 | — | `mapGraphSignalNodeToSignal` | type **codé en dur** `residential-rezoning` (même pour acquisition/CPTAQ/lotissement) ; gate `hasEvaluationData` dépend de `signal.zone` → grille éval vide pour 22/27 | 2.1.1 | type hardcodé + gate sur `zone_ref` absent | **ALGO** | dériver `type` de `category` ; relâcher le gate | MESURÉ (code) |
| **A-T5** | TOUTES | 27/27 (bbox), 8/27 (citation) | — | props citation/page/bbox | **0/27 bbox** → pas de highlight au pixel ; **8/27** citations absentes, 8/27 sans page → dépliage vide | 2.1.1 | graphify n'émet ni bbox ni (parfois) citation/page | **DATA** | backfill citation verbatim + page + bbox (grounding) | MESURÉ (graph) |
| **A-T6** | villes non-pilotes | liste vs panneau zonage | — | EvaluationMapView | panneau « Changements de zonage » lit `/api/signals/:city/detail` (project-state ~9 villes) vs liste qui lit `/api/graph-signals` (~197) → signaux à gauche, panneau vide à droite | 2.1.4 | deux pipelines non unifiés | **ALGO** | unifier EvaluationMapView sur graph-signals | MESURÉ (code) |
| **A-MT1** | mont-tremblant | signal-piia-bassins-versants | PIIA-34 (label) | « PIIA-34 bassins versants » | zone citée au label, `zone_ref` absent, 0 nœud Zone → **pas de lien signal↔zone** | 2.1.3 | zone en texte, non structurée, sans entité | **DATA+ALGO** | créer/relier Zone PIIA-34 + scan label | MESURÉ (graph) ✅ confirme principal |
| **A-MT2** | mont-tremblant | 3 signaux rezonage | — | graph | aucune zone géométrique ; les 2 lots sont reliés à des events PIIA, pas aux signaux | 2.1.2 | pas d'entité/géométrie zone | **DATA** | acquisition zonage ou fallback | MESURÉ (graph) |
| **A-SF1** | saint-frederic | I93/Rf51/A16 | A16, I93, Rf51 | nœuds Zone | **3** zones (pas 2) reliées par `rezones`, **0 géométrie** | 2.1.2 | zones créées par règl. 419-26, hors cadastre | **DATA** | fallback lot-union/géocodage (mergeDesignatedZones gère le badge) | MESURÉ (graph) ✅ confirme (count=3) |
| **A-SF2** | saint-frederic | signal-densification-Rf51 | Rf51 (label) | label « zone Rf51 » | cite Rf51 au label mais `zone_ref` absent (I93/A16 l'ont) → seul non mappé des 3 | 2.1.3 | graphify a structuré 2/3 | **ALGO** | scan label + backfill `zone_ref` | MESURÉ (graph) |
| **A-SC1** | sainte-catherine | 4 signaux | aucune zone réelle | graph | 4 signaux gauche, **0 zone droite** : 0 nœud Zone, 0 `zone_ref` ; Z-94/Z-84 = n° règlement de concordance, pas des zones | 2.1.3 | pas d'entité zone ; mapping lots seulement | **DATA+ALGO** | résoudre zones touchées par 2009-Z-84/94 | MESURÉ (graph) ✅ confirme « rien à droite » |
| **A-SC2** | sainte-catherine | signaux concordance | Z-94, Z-84 | label | faux positif possible si un scan lit Z-94/Z-84 (règlement) comme zones → invention | 2.1.1 | ambiguïté code-règlement/code-zone | **DATA+ALGO** | garde-fou regex (lookback « règlement », déjà côté signals-detail) | MESURÉ (code+graph) |
| **A-RO1** | rosemere | rezonage-lot-3005325 + pole-regional | C-18 | props (**citation=null**) | 2/3 citations absentes ; rezonage-3005325 porte `zone_ref=C-18`+`no_lot=3005325` **sans extrait verbatim** → « citation peut-être inventée » | 2.1.1 | champs structurés synthétisés sans grounding | **DATA** | backfill citation prouvant C-18/3005325 sinon marquer non-groundé | MESURÉ (graph) ✅ confirme |
| **A-RO2** | rosemere | rezonage-lot-3005325 | C-18 | Zone node + edges | C-18 **existe** dans le graph (Zone + assigned_zone + rezones + targets_lot) mais **sans géométrie** → non filtrable/highlightable. « non mappée » exact au sens géo, inexact au sens graph | 2.1.2 | mapping graph OK, géométrie absente | **DATA** | géométrie C-18 via lot 3005325 déjà relié | MESURÉ (graph) ✅ nuance |
| **A-RO3** | rosemere | pole-regional-densification | — | props (citation=null, zone_ref=null) | signal de rezonage sans citation/zone/page → vide au dépliage, rien à droite | 2.1.1 | grounding incomplet | **DATA** | backfill citation+zone | MESURÉ (graph) ✅ confirme |
| **A-SM1** | saint-mathieu-de-beloeil | 4 signaux | I-4, I-2, IDC-1/4 | props (citation=null, page=null) | **4/4** citations absentes + page absente → dépliage vide | 2.1.1 | grounding manquant sur toute la ville | **DATA** | backfill citation+page (PV 22.10.x) | MESURÉ (graph) |
| **A-SM2** | saint-mathieu-de-beloeil | 4 signaux | I-4, I-2, IDC-1/IDC-4 | label/zone_ref | 0 nœud Zone, 0 géométrie ; I-4/I-2 ont `zone_ref` sans Zone ; IDC-* au label sans `zone_ref` → **pas de mapping + géo manquante** | 2.1.3 | zones non instanciées + géo absente + scan non fait | **DATA+ALGO** | instancier zones + scan label + géométrie | MESURÉ (graph) ✅ confirme |
| **A-SA1** | saint-amable | zonage-cen + zonage-h59 | CEN-183/207, H-59, RX-122 | label + citation | 4 codes zone cités, 0 `zone_ref`, 0 Zone, 0 géo → **zone non mappée** | 2.1.3 | scan texte non fait + zones non instanciées | **ALGO** | scan label/citation + instanciation | MESURÉ (graph) ✅ confirme |
| **A-SA2** | saint-amable | 2 signaux | rue Principale | citation « CONSIDÉRANT… annexe 2 plan de zonage » | citation présente mais ancrage par rue **sans bbox/page-anchor** → **citation par rue non highlightée** | 2.1.1 | absence bbox/anchor | **DATA** | backfill bbox/anchor | MESURÉ (graph) ✅ confirme |
| **A-MSH1** | mont-saint-hilaire | 2 signaux rezonage | A-16/AF-18/AF-19/H-42-1 (orphelines) | label « quatre zones » | 4 Zone **orphelines** : aucun edge ne les relie aux 2 signaux (labels génériques, 0 `zone_ref`) → **pas de mapping** | 2.1.3 | label générique, zones non nommées | **DATA+ALGO** | extraire les 4 codes du PV 1235-34 + relier | MESURÉ (graph) ✅ confirme |
| **A-MSH2** | mont-saint-hilaire | 2 signaux + 3 lots | 4 zones | graph | 4 zones sans géométrie ; 3 lots (adresses) reliés via dérogations (events) non rattachés aux signaux | 2.1.2 | géométrie absente | **DATA** | géométrie/fallback ; relier lots↔signaux | MESURÉ (graph) |
| **A-HM1** | hemmingford | cptaq-exclusion + lotissement-refuse | — | props (citation=null, category=null, page=null) | **2/2** : citation absente, category null, page null → **1 signal mais dépliage vide** | 2.1.1 | grounding + catégorisation manquants | **DATA** | backfill + re-graphify | MESURÉ (graph) ✅ confirme |
| **A-HM2** | hemmingford | graph entier | — | ontology_version | **2.2** (vs 2.3) → schéma plus ancien, grounding incomplet | 2.1.4 | non re-graphifié à 2.3 | **DATA** | re-graphify 2.3 | MESURÉ (graph) |
| **A-ND1** | notre-dame-du-mont-carmel | 2 signaux | 388, 138 | edges targets_zone/assigned_zone | zones 388/138 **mappées** dans le graph mais 0 `zone_ref` signal + 0 géométrie → **dark** pour l'UI | 2.1.3 | mapping event/edge non exposé ; UI lit le signal | **DATA+ALGO** | exposer/propager edges event→zone | MESURÉ (graph) ✅ nuance |
| **A-ND2** | notre-dame-du-mont-carmel | zones 388/138 | 388, 138 | nœuds Zone | codes numériques sans géométrie + `evidenceCompleteness=missing-grounded-evidence` | 2.1.2 | géométrie + grounding zone absents | **DATA** | géométrie + grounding | MESURÉ (graph) |
| **A-ND3** | notre-dame-du-mont-carmel | — | règlement 330-2018 | grep graph | **330-2018 ABSENT** du graph (seuls 644/864/800/870/871-873). Réf principal **infirmée** : n'existe pas → si l'UI l'affiche = invention | 2.1.1 | règlement inexistant (ou mal lu) | **DATA** | vérifier source ; ne jamais afficher un règlement absent | MESURÉ (grep) ⚠️ infirme principal |
| **A-CB1** | saint-charles-borromee | rezonage-c17 | C-16/17, H-27/30, C-8 | nœuds Zone | 5 Zone mappées (targets_zone/rezones/applies_to) mais **0 géométrie** → **géo manquante** | 2.1.2 | géométrie cadastrale absente | **DATA** | acquisition zonage / fallback | MESURÉ (graph) ✅ confirme |
| **A-CB2** | saint-charles-borromee | rezonage-c17 | C-17 (label) | label + edges | cite C-17 au label, `zone_ref` absent ; zones mappées au niveau **event** non surfacées par le signal → dark | 2.1.3 | mapping event non propagé + pas de scan label | **ALGO** | propager event→zone + scan label | MESURÉ (graph) |

Légende statut : ✅ confirme le cas signalé par le principal · ⚠️ infirme/corrige · (nuance) = vrai partiellement.

---

## 2. Synthèse regroupée par type

| Type | Intitulé | Anomalies | Compte | DATA | ALGO | DATA+ALGO |
|------|----------|-----------|:------:|:----:|:----:|:---------:|
| **2.1.1** | data — signaux manquants / inexacts / citation absente / inventée / dépliage vide | A-T4, A-T5, A-SC2, A-RO1, A-RO3, A-SM1, A-SA2, A-HM1, A-ND3 | **9** | 7 | 1 | 1 |
| **2.1.2** | data — zones géométriques manquantes | A-T2, A-MT2, A-SF1, A-RO2, A-MSH2, A-ND2, A-CB1 | **7** | 7 | 0 | 0 |
| **2.1.3** | data+algo — mapping signal↔zone incomplet | A-T1, A-T3, A-MT1, A-SF2, A-SC1, A-SM2, A-SA1, A-MSH1, A-ND1, A-CB2 | **10** | 0 | 4 | 6 |
| **2.1.4** | UI/geo — cohérence gauche/droite, état vide | A-T6, A-HM2 | **2** | 1 | 1 | 0 |
| | **TOTAL** | | **28** | **15** | **6** | **7** |

**Part DATA vs ALGO** (28 anomalies) : **DATA pur 15 (54 %)** · **ALGO pur 6 (21 %)** · **mixte DATA+ALGO 7 (25 %)**.
En comptant le mixte des deux côtés : la **DATA** est en cause dans **22/28 (79 %)**, l'**ALGO** dans **13/28 (46 %)**.

**Lecture** : le gros volume est du **grounding/extraction manquant à la source** (citations, bbox, `zone_ref`, géométrie) — DATA. Le point de levier le plus rentable est **algo** : un seul correctif (scanner label/citation + exposer les edges Zone) débloque la majorité des cas 2.1.3 sans re-graphify.

### Couverture des cas du principal (preuve)

| Cas principal | Verdict | Anomalies |
|---|---|---|
| mont-tremblant — pas de lien signal↔zone | **CONFIRMÉ** | A-MT1, A-MT2 |
| saint-frederic — 2 zones, géométrie manquante | **CONFIRMÉ** (en réalité **3** zones) | A-SF1, A-SF2 |
| sainte-catherine — 1 signal gauche, 0 droite | **CONFIRMÉ** (4 signaux gauche, 0 zone droite) | A-SC1, A-SC2 |
| rosemere — rezonage absent, citation inventée, zone non mappée | **CONFIRMÉ** (citation null + zone_ref/lot non groundés ; C-18 mappé graph mais sans géo) | A-RO1, A-RO2, A-RO3 |
| saint-mathieu-de-beloeil — pas de mapping, géo manquante | **CONFIRMÉ** | A-SM1, A-SM2 |
| saint-amable — citation par rue non highlightée, zone non mappée | **CONFIRMÉ** | A-SA1, A-SA2 |
| mont-saint-hilaire — citation par rue, pas de mapping | **CONFIRMÉ** (4 zones orphelines) | A-MSH1, A-MSH2 |
| hemmingford — 1 signal droite, 0 au dépliage | **CONFIRMÉ** (citation/category/page null ; ontology 2.2) | A-HM1, A-HM2 |
| NDM — zone non mappée ; règlement 330-2018 absent | **NUANCÉ** (zones 388/138 mappées graph mais dark+sans géo) / **INFIRMÉ** (330-2018 inexistant) | A-ND1, A-ND2, A-ND3 |
| saint-charles-borromee — géo manquante | **CONFIRMÉ** | A-CB1, A-CB2 |

---

## 3. Deux lots de correction recommandés (sentiment de progrès)

### Lot A — DATA / Citation & grounding à la source
**Cible** : signaux complets et groundés, fin de l'« inventé ». Couvre ~11/28 anomalies (surtout 2.1.1).
- Peupler `zone_ref` / `no_lot` / `reglement_number` **structurés à la source** (hints graphify dans le profil ontologie).
- **Backfill** citation verbatim + page + **bbox** sur les **8** signaux sans citation et les **27** sans bbox (anti-invention si introuvable).
- **Dériver `signal.type` de `props.category`** (supprimer le `residential-rezoning` codé en dur).
- **Re-graphify hemmingford** 2.2 → 2.3.
- Vérifier/supprimer les règlements **non présents** (ex. 330-2018 NDM).
Anomalies : A-T4, A-T5, A-RO1, A-RO3, A-SM1, A-SA2, A-HM1, A-HM2, A-ND3, A-SF2.

### Lot B — GEO / Mapping & exposition zone
**Cible** : chaque zone citée mappée + highlightée, gauche = droite. Couvre ~17/28 anomalies (2.1.2/2.1.3/2.1.4).
- **Étendre `extractSignalZoneRefs`** : scan regex zone sur **label + citation** (garde-fou code-règlement).
- **Exposer les nœuds Zone + edges** signal/event→zone via `/api/geo/zones` (fusion cadastre + zones désignées du graph).
- **Propager** le mapping event→zone jusqu'au signal.
- **Géométrie des zones désignées** via fallback **lot-union** (A16, C-18, 388/138, C-16/17…) ; sinon badge honnête « géométrie geo manquante » (déjà supporté par `mergeDesignatedZones`).
- **Unifier EvaluationMapView** sur graph-signals (supprimer la dépendance project-state ~9 villes).
Anomalies : A-T1, A-T2, A-T3, A-T6, A-MT1, A-MT2, A-SC1, A-SM2, A-SA1, A-MSH1, A-MSH2, A-RO2, A-ND1, A-ND2, A-CB1, A-CB2, A-SF1.

---

## 4. Limites de l'audit (honnêteté)
- **Stack down** : la couverture **géo live** (`/api/geo/zones` renvoie-t-il un polygone pour telle ville ?) et les **comptes gauche/droite rendus** ne sont pas mesurés ici — marqués DÉDUIT. Le graph prouve l'absence de géométrie *côté graph* (0/15) et les edges de mapping ; il ne prouve pas la couche cadastrale PostGIS.
- L'audit porte sur **10 villes** (les cas du principal). Les ratios globaux (5/27 zone_ref, 8/27 citation, 0/27 bbox) sont représentatifs mais à confirmer sur les ~197 villes.
- Aucune écriture Track, aucun commit, aucune branche (périmètre WP3).
