# Cadrage — Acquisition des données intra-ville : ZONES (zonage) + LOTS (cadastre)

> **Statut** : cadrage stratégique (spec). Aucun scraper ici — ce document chiffre le chantier
> et arbitre le découpage `geo` ↔ `immo`. À valider avant ouverture des lots d'implémentation.
> **Date** : 2026-06-14. **Auteur** : rhanka.
> **Périmètre** : c'est le **« Phase 2 géo data »** du radar (acquisition des couches zones+lots
> pour les 1104 villes du registre) — **PAS** le composant carto WebGL (ça, c'est `geo` /
> `@sentropic/geo-ui-svelte`, issue #56, hors périmètre ici).
> **Loi 25** : zonage + cadastre = **données publiques**, jamais de PII. Le rôle d'évaluation
> ouvert (MAMH) est **caviardé** (ni nom de propriétaire, ni adresse, ni n° de lot) → la
> jointure se fait par géométrie, sans toucher à la PII. Le nom du propriétaire (rôle complet /
> Infolot) reste **hors périmètre de ce chantier**.

---

## 0. TL;DR (décisions proposées)

1. **Les LOTS sont un problème résolu, province-entière, par UN seul scraper.** La couche
   ArcGIS REST « Cadastre allégé » du MELCC/MRNF couvre les **1104 villes** d'un coup
   (4,64 M lots, polygone + `NO_LOT`, GeoJSON, gratuit). Effort : **1–2 j-h**. → **`geo`**.
2. **Les ZONES sont le vrai chantier : dispersé, hétérogène, 80 % non vectorisé.** Estimation :
   **~150–250 villes** ont une carte web exploitable (surtout **ArcGIS REST**), dont **~50 datasets
   zonage** packagés en open data sur Données Québec. **~600–800 petites villes** n'ont que des
   **PDF scannés** (non scrapables sans OCR+géoréférencement manuel).
3. **Stratégie : un scraper PAR TYPE de plateforme**, pas par ville. Un crawler **ArcGIS REST
   générique** est le levier d'échelle n°1 (couvre Esri + GeoCentralis + hubs open-data). Puis
   CKAN Données Québec. JMap au cas par cas. GOnet/PG et PDF en dernier (rendement faible).
4. **Découpage `geo` ↔ `immo`** : **`geo` possède l'acquisition des couches géo génériques**
   (cadastre allégé, scrapers de plateformes zonage, registre municipalités, contraintes). **`immo`
   consomme** ces couches et possède la **résolution métier temporelle** (Zone/Lot/Designation/
   Valuation as-of-date) + la jointure rôle↔lot.
5. **Séquencement** : (S1) lots province + CKAN zonage → couverture immédiate ~15 villes zonage +
   1104 villes lots ; (S2) crawler ArcGIS générique → +150–250 villes zonage ; (S3) recensement
   exhaustif rejouable des 1104 villes ; (S4) JMap/GOnet/PDF opportunistes.

---

## 1. Recensement des villes en format ouvert

### 1.1 Le registre

Registre canonique : `packages/radar-sources/src/geo/municipalities.qc.json` → **1104 entrées**
exploitables (le fichier en compte 1106 ; 2 sont des marqueurs hors-périmètre). Chaque entrée
porte `slug`, `name`, `mrc`, `lat`/`lon`, `population`, `priorityRank`, flags `excluded`/
`deprioritized`. C'est la clé de jointure de tout l'inventaire.

Le repo porte déjà le **schéma d'inventaire** à étendre :
`packages/radar-sources/src/geo/geo-source-inventory.ts` (`GeoSourceInventory` Zod : `citySlug`,
`zonage{availability,quality,url}`, `lots{…}`, `notes`) + données seed pour 6 villes pilotes dans
`geo-source-inventory.data.ts`. **Ce schéma est le réceptacle du recensement** ; il faut juste
l'enrichir d'un champ `platform` (voir §2) et le peupler à grande échelle.

### 1.2 LOTS — couverture province-entière confirmée

| Source | Couverture | Format | Licence | Statut |
|---|---|---|---|---|
| **Cadastre allégé** (REST MELCC/MRNF) | **1104/1104 villes** (couche unique province-entière) | ArcGIS REST `query` → GeoJSON/JSON/PBF ; polygone + `NO_LOT` | © Gouv. QC, **accès public** (pas CC-BY estampillé), attribution | **Vérifié** : 4 642 815 lots (`where=1=1&returnCountOnly=true`), `maxRecordCount=2000`, `supportsPagination=true`, WKID natif 3857 (`outSR=4326` OK) |

Endpoint : `https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0/query`
(miroir AGOL : `services3.arcgis.com/0lL78GhXbg1Po7WO/.../cadastre_bd_allegee/FeatureServer`).

→ **Pour les LOTS, le recensement est trivial : 100 % des villes sont couvertes par une seule
couche.** La rénovation cadastrale du QC est complétée. La couche allégée ne porte **pas** la
superficie (à dériver par calcul d'aire, ou à reprendre du rôle d'évaluation). La superficie/mesures
officielles ne sont disponibles que via **Infolot** (payant, extraits sur commande DXF/SHP/FGDB,
seuil 20 000 lots / 625 km²) → **hors périmètre** (on n'en a pas besoin : géométrie + `NO_LOT`
suffisent au matching).

### 1.3 ZONES — dispersé, à recenser

Contrairement aux lots, **il n'existe aucune couche zonage provinciale**. Le zonage est municipal,
publié par chaque ville dans un format de son choix. Estimation de couverture (extrapolée, voir
§1.4 pour la méthode de fiabilisation) :

| Strate | ~Nb villes | Format dominant | Scrapable |
|---|---:|---|---|
| Zonage en **open data structuré** (Données Québec / hub Esri) | **~10–15** | GeoJSON/SHP/KML + EsriREST | **Oui, direct** |
| Carte web **ArcGIS REST** publique (sans dataset CKAN) | **~140–235** | `FeatureServer`/`MapServer` query → JSON/GeoJSON | **Oui** (crawler générique) |
| Carte **JMap** (K2 Geospatial) | **~10–30** | API JSON propriétaire | Partiel (rétro-ingénierie réseau) |
| Visualiseur **GOnet/Azimut** (PG Solutions) | plusieurs centaines en évaluation, **zonage public minoritaire** | viewer propriétaire, souvent **login** | Difficile (auth + obscura) |
| **PDF scanné / aucune carte** | **~600–800** | PDF dans le règlement d'urbanisme | Non sans OCR+géoréf manuel |

**Total « format ouvert exploitable » pour le zonage : estimé ~150–250 villes** (open data +
ArcGIS REST public), soit **~14–23 % des 1104**. Le reste exige soit une rétro-ingénierie au cas
par cas (JMap/GOnet), soit une **numérisation semi-manuelle** (le fallback humain de Steve :
dessiner les polygones dans un éditeur — cf. `editeur-zones.html`, 193 zones de Sainte-Catherine
faites ainsi). **Cette estimation est le point le plus incertain du cadrage** (voir §6).

Comptages vérifiés (Données Québec, API CKAN, 2026-06-14) :
- `package_search?q=zonage&rows=0` → **`count: 50`** datasets (toutes organisations confondues).
- Organisations municipales avec zonage + géométrie téléchargeable observées : Longueuil,
  Gatineau, Saguenay, Lévis, Trois-Rivières, Sherbrooke, Québec, Repentigny, Rimouski,
  Rouyn-Noranda → **~10–15 villes** publient le zonage en open data structuré (presque toutes via
  stack Esri).

### 1.4 Méthode de recensement exhaustif REJOUABLE

Le recensement des 1104 villes ne peut pas être fait à la main. Méthode automatisable, idempotente,
réexécutable (à coder dans un script `geo`, alimentant `geo-source-inventory.data.ts`) :

1. **Lots** : aucun recensement nécessaire — `availability: cadastre-allege` pour les 1104 villes
   par défaut. Vérification d'échantillon : query bbox autour du centroïde (`lat`/`lon` du registre)
   → compter les features ≥ 1.
2. **Zonage open data (CKAN)** : pour chaque ville, requêter l'API CKAN Données Québec
   (`package_search?q=<nom_ville> zonage`, puis `package_show` pour résoudre les ressources et
   formats). Filtrer sur `format ∈ {GeoJSON, SHP, KML, EsriREST, GPKG}`. **Rejouable** : c'est une
   API stable, déjà spike-ée (`donnees-quebec-catalog`).
3. **Détection de plateforme par sondage du domaine municipal** : à partir du site officiel de
   chaque ville (déductible du `slug`/`name` ou d'un annuaire MAMH des municipalités), sonder des
   **patterns d'URL signature** :
   - ArcGIS : présence de `/arcgis/rest/services`, `/server/rest/services`, `*.maps.arcgis.com`,
     `FeatureServer`, `MapServer` → tester `?f=json` (métadonnées) sans auth.
   - JMap : signatures `jmap`, `k2geospatial`, endpoints `/services/rest` JMap.
   - GOnet/Azimut : signatures `gonet`, `azimut`, `pgsolutions`, présence d'un mur de login.
   - PDF : lien « plan de zonage » / « règlement d'urbanisme » pointant un `.pdf`.
4. **Sortie** : un enregistrement `GeoSourceInventory` par ville, avec `platform`, `availability`,
   `quality`, `url`, `lastChecked`. Le script est **idempotent** (re-sonde, met à jour `lastChecked`,
   ne casse pas l'existant) et produit un **rapport de couverture chiffré** (`N villes ArcGIS / N
   CKAN / N PDF / N inconnu`).

> Honnêteté : l'étape 3 (sondage de domaine) est la plus fragile — il faut un **annuaire fiable
> des sites web municipaux** (à dériver d'un dataset MAMH ou d'un crawl ciblé). Sans lui, le
> recensement reste partiel. C'est un **lot à part entière** (≈ 3–5 j-h pour un premier passage
> exploitable sur les villes prioritaires, puis extension).

---

## 2. Typologie des plateformes (identifiées par recherche réelle)

Recherche web menée en direct (2026-06-14), endpoints ArcGIS « vérifié » = JSON exploitable sans
auth. Le marché QC est structuré par **3 éditeurs** : **Esri** (ArcGIS, grandes/moyennes villes +
MRC), **PG Solutions/Azimut** (GOnet — leader évaluation/matrice graphique, surtout petites
municipalités), **K2 Geospatial/JMap** (grandes villes, Montréal).

| # | Plateforme | Éditeur | ~Parc QC (zonage web public) | Format réel | Scrapabilité | Effort scraper |
|---|---|---|---:|---|---|---|
| **T1** | **ArcGIS REST** (FeatureServer / MapServer ; ArcGIS Online Hub ; Experience/Instant apps) | Esri | **~150–250** (dominant sur les villes qui ONT une carte) | REST `query` → **JSON + geoJSON + PBF**, polygones + grille d'usage en attributs. Souvent doublé d'un hub open-data | **Oui — le plus facile.** Pas d'auth, `allowOthersToQuery:true`, pagination standard `?where=1=1&outFields=*&returnGeometry=true&f=geojson` | **Faible** : 1 crawler générique réutilisable sur tout le parc (~3–5 j-h), puis 0–1 j/ville |
| **T2** | **Données Québec CKAN** (open data packagé) | Gouv. QC + villes | **~10–15** | Téléchargement direct **GeoJSON/SHP/KML/GPKG** + parfois `EsriREST` | **Oui — direct.** API CKAN stable | **Faible** : 1 adapter CKAN (~1,5–2,5 j-h, déjà spike-é) |
| **T3** | **JMap / JMap NG** | K2 Geospatial (Montréal) | **~10–30** (grandes villes ; Montréal) | **API JSON propriétaire** + tuiles raster/vecteur ; pas de standard REST ; varie par déploiement | **Partiel.** Rétro-ingénierie de l'API réseau (onglet réseau), non documentée | **Moyen-élevé** : 3–8 j/déploiement |
| **T4** | **GOnet / Azimut** (matrice graphique) | Azimut → **PG Solutions** (Harris) | Centaines en évaluation, **zonage public minoritaire** | Viewer propriétaire, **souvent derrière login** côté citoyen ; export GML côté ville seulement | **Non / difficile** (« obscura » de fait : auth + viewer fermé) | **Élevé** : 8–15+ j, session authentifiée, fragile et risqué (ToS) |
| **T5** | **PDF statiques / Google My Maps** | divers | **~600–800** (majorité des petites villes) | Plans **scannés** (PDF) dans les règlements ; aucune géométrie vectorielle | **Non** sans OCR + géoréférencement + vectorisation (manuel) | Très élevé / non automatisable — **fallback : éditeur de zones semi-manuel** (cf. Steve) |

Notes annexes : **Voilà!** (PG Solutions) est un **portail citoyen** (permis/taxes), **pas** une
carte de zonage → hors périmètre. **GeoCentralis** est un intégrateur Esri → retombe sur **T1**
quand le service est public. Les couches d'environnement de la carte de Steve (milieux humides
MELCC, BDZI inondables, CPTAQ agricole — `servicesgeo.enviroweb.gouv.qc.ca`, `carto.cptaq.gouv.qc.ca`)
sont des **T1/WMS provinciaux** réutilisables tels quels (cf. `ARCHITECTURE.md` de la carte Steve).

---

## 3. Stratégie de scrapers ad-hoc PAR TYPE (levier d'échelle)

Principe : **un scraper par plateforme**, paramétré par l'inventaire (`GeoSourceInventory`), donc
**réutilisable sur toutes les villes du même type**. Ordonné par **couverture × facilité** :

| Prio | Scraper | Type couvert | Couverture (villes) | Facilité | Effort | Réutilise |
|---|---|---|---:|---|---|---|
| **P0** | **Cadastre allégé** (lots, province) | — (lots) | **1104** | Très élevée | **1–2 j-h** | pattern ESRI REST déjà au repo |
| **P0** | **Crawler ArcGIS REST générique** (zonage) | T1 | **~150–250** | Élevée | **3–5 j-h** | détection `/rest/services` + `query?f=geojson` |
| **P1** | **Adapter CKAN Données Québec** (zonage) | T2 | **~10–15** (+ découverte) | Élevée | **1,5–2,5 j-h** | spike `donnees-quebec-catalog` |
| **P2** | **Adapter JMap** | T3 | **~10–30** | Moyenne | **3–8 j-h** (1er déploiement) + N/ville | rétro-ingénierie réseau |
| **P3** | **Recensement/sondage de plateforme** (inventaire) | tous | **1104** | Moyenne | **3–5 j-h** (1er passage) | annuaire sites municipaux |
| **P4** | **Éditeur de zones semi-manuel** (fallback) | T5 / GOnet | au cas par cas | Manuelle | variable | `editeur-zones.html` (Steve) en inspiration |
| **P5** | **Adapter GOnet/Azimut** | T4 | minoritaire | Faible (auth/obscura) | **8–15+ j-h**, risqué | — (à éviter au 1er tour) |

**Logique commune réutilisable** (à mutualiser entre scrapers, dans `geo`) :
- **Pagination ESRI** par bbox (plus robuste que `resultOffset` pur sur gros volumes), throttling
  poli + backoff (pas de rate-limit documenté sur l'endpoint MELCC → mesurer empiriquement).
- **Normalisation GeoJSON WGS84** (`outSR=4326`) en sortie.
- **Provenance** (`source`, `url`, `fetchedAt`, `lastChecked`) portée de bout en bout (cohérent
  avec le mode réel/simulation existant et l'intention `SPEC_INTENT_DATA_MODEL_ZONING_LOTS`).

**Anti-patterns à éviter** (leçons de la carte Steve, cf. README §Anti-features) : pas de JSON
monolithique 24 Mo/ville (→ tuiles vectorielles/PMTiles ou API paginée côté `geo`) ; pas de
hardcode des codes de zones « 4+ » par ville (les critères doivent venir des **grilles**, à la
demande) ; pas de scraping live de l'UI Infolot ni des viewers authentifiés (ToS/robots).

---

## 4. Articulation `geo` ↔ `immo` (mutualisation, issue #56)

Rappel du périmètre `geo` (`@sentropic/geo` / `@sentropic/geo-ui-svelte`) : couche **données géo
générique** (registre des municipalités, cadastre allégé, contraintes) + **composants carto WebGL**
(`GeoMap`, `Legend`, `MapPopup` — backlog DS, cf. `docs/spec/audit-ds-realignement.md` Phase 2).
`immo` = **radar immobilier métier** (signaux, opportunités, scoring, ontologie temporelle).

### Découpage proposé (frontière d'API claire)

| Capacité | Propriétaire | Justification |
|---|---|---|
| Registre municipalités (`municipalities.qc.json`) | **`geo`** (source de vérité) ; `immo` consomme | Donnée géo pure, déjà extraite ; #56 owne le registre |
| **Acquisition LOTS** (scraper cadastre allégé) | **`geo`** | Couche provinciale générique, aucune sémantique immo |
| **Acquisition ZONES** (crawler ArcGIS + CKAN + JMap…) | **`geo`** | Scrapers de plateformes géo génériques, réutilisables hors immo |
| Inventaire des sources géo (`GeoSourceInventory`) | **`geo`** (le schéma vit déjà dans `radar-sources/geo`, à migrer) | Catalogue d'acquisition générique |
| Contraintes géo (CPTAQ, BDZI, milieux humides) | **`geo`** | Couches WMS/REST provinciales partagées |
| **Jointure rôle↔lot** (point géoréf ∩ polygone), enrichissement valeurs/usage | **`immo`** | Sémantique métier (axes potentiel/marché du scoring) |
| **Résolution temporelle** Zone/Lot/Designation/Valuation (as-of-date, filiation) | **`immo`** | Cœur du modèle `SPEC_INTENT_DATA_MODEL_ZONING_LOTS` ; spécifique radar |
| Détection de changement de zonage (avis de motion → n° règlement) | **`immo`** | Signal métier (« grand filet ») |
| Composants carto (`GeoMap`, `Legend`…) | **`geo`** (DS) | Hors périmètre de ce cadrage (Phase 2 UI) |

**Règle de découpage** : `geo` livre des **GeoJSON normalisés + provenance** (zones, lots,
contraintes) via une API/un format de couche stable. `immo` ne scrape jamais lui-même la géo ; il
**consomme** la couche `geo` et y applique la sémantique temporelle + le scoring. Cette frontière
évite la duplication et permet à `geo` de servir d'autres verticales.

### Coordination h2a (qui fait quoi)

- **Décision à prendre avec `geo` (#56)** : confirmer que `geo` accepte d'**owner l'acquisition**
  zones+lots (et pas seulement le rendu carto). **Préco : oui** — l'acquisition est générique et
  sans valeur métier propre ; la mutualiser dans `geo` évite que `immo` re-scrape. Si `geo` refuse
  (capacité/calendrier), **repli** : `immo` héberge temporairement les scrapers dans
  `radar-sources/geo/` (où le schéma vit déjà) et `geo` les absorbe plus tard.
- **Interface de livraison** : se mettre d'accord sur le **format de couche** (GeoJSON paginé vs
  tuiles vectorielles/PMTiles) et la **clé de jointure** (`NO_LOT` normalisé, sans espaces — cf.
  caveat « 2 181 127 » du schéma Steve).
- **Séquence h2a** : `immo` rédige ce cadrage → `geo` review/contre-propose le découpage →
  ouverture des lots d'acquisition côté `geo` avec `immo` comme premier consommateur (vertical
  pilote).

---

## 5. Séquencement + estimation d'effort

| Étape | Contenu | Couverture obtenue | Effort | Dépendances |
|---|---|---|---|---|
| **S1 — Socle ouvert** | Scraper **cadastre allégé** (lots, province) + adapter **CKAN** (zonage open data) | **1104 villes lots** + **~10–15 villes zonage** | **3–5 j-h** | aucune (spikes existants) |
| **S2 — Levier ArcGIS** | **Crawler ArcGIS REST générique** (zonage T1) | **+~150–250 villes zonage** | **3–5 j-h** | S1 (norme GeoJSON/provenance) |
| **S3 — Recensement rejouable** | Script de sondage de plateforme → peuple `GeoSourceInventory` 1104 villes + rapport de couverture chiffré | **inventaire complet** (savoir QUI est scrapable) | **3–5 j-h** (1er passage prioritaires) | annuaire sites municipaux |
| **S4 — Opportuniste** | Adapter **JMap** (grandes villes) ; **éditeur semi-manuel** (villes pilotes PDF) ; GOnet **différé** | **+~10–30 villes** (JMap) + pilotes manuels | **3–8 j-h** (JMap) + variable | S3 (savoir où c'est rentable) |
| **S5 — Intégration immo** | Jointure rôle↔lot, modèle temporel Zone/Lot/Designation, branchement scoring | exploitation métier | (chantier `SPEC_INTENT_DATA_MODEL_ZONING_LOTS`, hors-effort ici) | S1–S2 |

**Effort total acquisition (S1–S4, hors modèle métier S5) : ~12–23 j-h** pour atteindre
**100 % des villes en lots** et **~170–290 villes en zonage** (open data + ArcGIS + JMap). Le reste
(~600–800 villes PDF/GOnet) relève du **fallback semi-manuel à la demande**, pas d'un scraper.

**Reco d'ordonnancement** : S1 et S2 d'abord (ROI maximal, débloquent la vertical pilote multi-
villes du « grand filet »), S3 en parallèle dès que l'annuaire municipal est disponible, S4
opportuniste piloté par les chiffres de S3.

---

## 6. Inconnues / honnêteté

- **L'estimation 150–250 villes ArcGIS est extrapolée**, pas issue d'un recensement complet. C'est
  le chiffre le plus incertain ; S3 le fiabilisera. Fourchette assumée large.
- **Aucune part de marché QC chiffrée publiée** par les éditeurs (Esri/PG/K2 communiquent des
  totaux mondiaux mêlant évaluation/finance/loisirs, pas le zonage cartographié). Les répartitions
  du §2 sont qualitatives.
- **Query GeoJSON live non démontrée de bout en bout** sur tous les endpoints (certains `/query`
  ont renvoyé 400 sur des paramètres de pagination ; les métadonnées `?f=json` confirment polygones
  + geoJSON sans auth). Syntaxe exacte à valider couche par couche.
- **GOnet** : impossible de confirmer un endpoint cartographique public **sans login** pour le
  zonage. À investiguer sur un déploiement réel avant tout chiffrage ferme.
- **Débit/quota ESRI** non documenté sur l'endpoint MELCC (`maxRecordCount=2000` confirmé, pas de
  rate-limit annoncé) → throttling + backoff obligatoires ; full crawl province ≈ **2 322 requêtes**.
- **Licence cadastre allégé** : publique mais sous **droit d'auteur Gouv. QC** (≠ CC-BY du rôle
  d'évaluation). Réutilisation/rediffusion commerciale → vérifier les conditions du géoportail MELCC.
- **Annuaire des sites web municipaux** : prérequis de S3, non encore disponible — à dériver d'un
  dataset MAMH ou d'un crawl ciblé. Risque sur la complétude du recensement tant qu'il manque.
- **Jointure rôle↔lot par géométrie** (rôle ouvert caviardé : pas de `NO_LOT`) : taux de match à
  mesurer sur échantillon (points hors polygone, lots multi-bâtiments).

---

## 7. Annexes — références

- Registre : `packages/radar-sources/src/geo/municipalities.qc.json` (1104 villes).
- Schéma inventaire (à étendre + migrer vers `geo`) :
  `packages/radar-sources/src/geo/geo-source-inventory.ts` + `.data.ts`.
- Carte de Steve (méthode d'acquisition zones/lots semi-manuelle, schéma lot, grilles PDF) :
  `docs/spec/input/carte-steve/README.md` + `tech/ARCHITECTURE.md`.
- Modèle métier temporel cible : `docs/spec/SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md`.
- Réorientation « grand filet » (cadre stratégique zonage-centrique) :
  `docs/spec/SPEC_REORIENTATION_GRAND_FILET.md`.
- Feasibility des sources (matrice existante) : `docs/spec/SPEC_EVOL_SOURCE_FEASIBILITY.md`.
- Spikes : `_spikes/cadastre-infolot`, `_spikes/zonage-municipal-open-data`,
  `_spikes/donnees-quebec-catalog`, `_spikes/role-cadastre-valleyfield.md`.
- Frontière carto/DS (issue #56) : `docs/spec/audit-ds-realignement.md` (Phase 2 `GeoMap`/`Legend`).
