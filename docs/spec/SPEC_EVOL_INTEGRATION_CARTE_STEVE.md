# SPEC — Intégration 100 % des features de la carte de Steve dans les écrans radar existants

> Statut : **intention / cadrage d'intégration**. Ne crée **aucun nouvel écran** : chaque feature
> de l'outil de Steve est rattachée à l'**une des quatre vues déjà prévues** du radar
> (**Signaux** / **Opportunités** / **Évaluation** / **Sources**) et à leurs couches/contrôles
> cartographiques. Travail de SPEC + PLAN uniquement (aucun code applicatif).
>
> Entrées :
> - Rétrodoc exhaustive de l'outil de Steve : [`input/carte-steve/README.md`](input/carte-steve/README.md)
>   + archi [`input/carte-steve/tech/ARCHITECTURE.md`](input/carte-steve/tech/ARCHITECTURE.md)
>   + schéma data [`input/carte-steve/tech/analyse-donnees.json`](input/carte-steve/tech/analyse-donnees.json)
>   + index villes [`input/carte-steve/tech/cities.json`](input/carte-steve/tech/cities.json).
> - Cadrage radar : [`SPEC_REORIENTATION_GRAND_FILET.md`](SPEC_REORIENTATION_GRAND_FILET.md) (vues WP A.1).
> - Modèle de données : [`SPEC_DESIGN_DATA_MODEL.md`](SPEC_DESIGN_DATA_MODEL.md),
>   [`SPEC_ONTOLOGY_DATA_MODEL.md`](SPEC_ONTOLOGY_DATA_MODEL.md),
>   [`SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md`](SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md).
> - Scoring / états / pipeline : [`SPEC_EVOL_SOCLE_STATES_SCORING.md`](SPEC_EVOL_SOCLE_STATES_SCORING.md),
>   [`SPEC_EVOL_OPPORTUNITES_T2.md`](SPEC_EVOL_OPPORTUNITES_T2.md),
>   [`SPEC_EVOL_RADAR_T1.md`](SPEC_EVOL_RADAR_T1.md), [`SPEC_PLAN_SCRAPING.md`](SPEC_PLAN_SCRAPING.md),
>   [`SPEC_PERSISTENCE_S3_FIRST.md`](SPEC_PERSISTENCE_S3_FIRST.md).

## 0. Thèse d'intégration en une phrase

L'outil de Steve est une **prospection foncière manuelle** (un humain pose à la main les pastilles
réglementaires, trie les lots, exporte les CSV de sollicitation) sur **4 villes hardcodées** ;
le radar **automatise ce même geste** sur ~150 villes : les pastilles deviennent nos **Signaux**
(générés depuis les PV), le tri manuel devient un **scoring data-driven** plus des **statuts de
pipeline** sur les **Opportunités**, et la fiche lot + l'export de sollicitation s'incarnent dans
l'**Évaluation**. **Tout** ce que fait Steve trouve sa place dans **Signaux / Opportunités /
Évaluation / Sources** — sans nouvel écran.

## 1. Rappel de l'existant radar (cible d'intégration)

Les quatre vues existent déjà (WP A.1, `SPEC_REORIENTATION_GRAND_FILET.md` §4) et sont câblées sur
l'API réelle. Carto = **SVG pur + projection équirectangulaire** (pas de Leaflet/MapLibre côté
radar aujourd'hui — voir §8 décision carto). Endpoints et types actuels :

| Vue radar | Fichier | Endpoints | Maille | Rôle actuel |
|---|---|---|---|---|
| **Signaux** | `ui/src/lib/components/maps/SignauxMapView.svelte` | `GET /api/signals/by-city`, `GET /api/signals/:city/detail` | Québec / villes | nb d'opportunités (changements de zonage) / ville sur 6 mois ; clic ville → liste des `DesignationEvent` |
| **Opportunités** | `ui/src/lib/components/maps/OpportunitesMapView.svelte` | `GET /api/opportunites` | ville / zones / lots | *(legacy)* classement /100 (facteurs proximité 40 / zoneType 40 / récence 20) — **SUPERSÉDÉ** : `SPEC_EVOL_OPPORTUNITES_T2.md` §2/D5 abandonne l'affichage du `/100` ; le radar n'expose plus ce score (T1 /10 + T2 0-5 + score de potentiel par lot, jamais un /100) |
| **Évaluation** | `ui/src/lib/components/maps/EvaluationMapView.svelte` | `GET /api/geo/:city/lots`, `GET /api/signals/:city/detail` | zone / lots | carte SVG des lots cadastraux (MRNF) + grille d'évaluation 5 axes (potentiel/risque/timing/faisabilité/marché) ; aujourd'hui partielle (rôle non extrait) |
| **Sources** | `ui/src/lib/components/sources-map/SourcesMapView.svelte` (+ `CityDetailPanel.svelte`) | `GET /api/scrape-status`, `GET /api/signals/by-city` | Québec | villes coloriées par maturité de recueil ; matrice source × statut |

Modèle de données radar (rappel des entités load-bearing, `SPEC_DESIGN_DATA_MODEL.md` §1) :
`Lot{id, citySlug, noLot, matricule, parentLotIds}` / `LotVersion{superficieM2, usageCode,
adresseCivique, geom, geomSource}` ; `Zone{id, kind}` / `ZoneVersion{codeAffiche, densiteLogHa,
etagesMax, hauteurMaxM, usages, normes, geom, geomSource}` ; `DesignationEvent{type, bylaw,
bylawStage, validFrom, effectKind}` (append-only) ; `Valuation{kind, rolYear, valeurTerrain,
valeurBatiment, valeurTotale, source}` ; `lot_zone_resolution{method, confirmed, coveragePct}` ;
`Signal{type, value/10, confidence, status, mode}` ; `OpportunityDossier{lots[], scores{5 axes
0-5}, recommendation}` (le `scoreGlobal` /100 legacy existe au type mais **n'est plus affiché** —
`SPEC_EVOL_OPPORTUNITES_T2.md` §2/D5 — et **n'existe qu'à la maille dossier**, jamais lot). Tout
porte `EvidenceItem[]` + `mode: real|simulation` + `verification: fait|hypothese|non-disponible|simulé`.

---

## 2. Mapping EXHAUSTIF feature de Steve → écran radar (P0 → P2)

Pour chaque feature : la vue radar cible, le **COMMENT** (geste équivalent côté radar), les
**données nécessaires** (entités/sources radar), et le **gain vs Steve**.

### P0 — cœur de valeur

#### S-1. Carte lots + zonage + TOD avec scoring visuel (« priorité = 4+ ∩ TOD »)
- **Écran : Opportunités** (couche lots) + **Évaluation** (qualification fine).
- **Comment** : la palette de couleurs de Steve (jaune favori / vert 4+ / bleu TOD / orange
  priorité / gris autres — README §B2) devient une **couche lots coloriée par un *score de
  potentiel par lot*** sur la carte Opportunités. Le « 4+ ∩ TOD » de Steve est un **cas
  particulier hardcodé** que le radar remplace par un score dérivé, data-driven, **calculable
  pour 100 % des lots**. Le radar **ne hardcode pas** un ensemble de codes de zones par ville :
  il dérive le potentiel de la `ZoneVersion` (`densiteLogHa`, usages permis) **∩** la couche
  TOD **∩** les pré-filtres physiques (`minLotAreaM2`, ratio bâti/terrain —
  `SPEC_EVOL_SOCLE_STATES_SCORING.md` §2.1).
- **⚠️ Distinction load-bearing (amendée revue Fable5) — *score de potentiel par lot* ≠ *score
  T2 de dossier*** :
  - **Score de potentiel par lot** (ce que colorie CS-L1) = un indicateur **dérivé à la maille
    lot**, fonction de `ZoneVersion.densiteLogHa`/usages ∩ TOD ∩ pré-filtres. **Calculable pour
    100 % des lots** (tout lot a une zone résolue + une géométrie), donc **affichable sur toute
    la couche**. Il n'est **pas** le score T2.
  - **Score T2 de dossier** = le composite multi-axes **0-5** de `OpportunityDossier`
    (`SPEC_EVOL_SOCLE_STATES_SCORING.md` §3.3/§3.4), qui **n'existe qu'à la maille dossier** :
    un dossier **naît d'un signal** (un changement de zonage capté dans un PV), et **la plupart
    des lots n'auront jamais de dossier**. On **ne peut donc pas** colorier la couche lots par
    `OpportunityDossier.scoreGlobal` (il n'existe pas à la maille lot pour la quasi-totalité des
    lots). Quand un lot **est** rattaché à un dossier, le score T2 0-5 de ce dossier s'affiche
    **dans la fiche** (CS-L2/§S-2), pas comme couleur de la couche.
  - **Bannir le score 0-100 legacy** : aucune référence au score `/100` (facteurs proximité 40 /
    zoneType 40 / récence 20 du `OpportunityFunnel` historique). Il est **superséde** par le
    socle (`SPEC_EVOL_OPPORTUNITES_T2.md` §2/D5 abandonne l'affichage du `scoreGlobal` brut ;
    `SPEC_EVOL_SOCLE_STATES_SCORING.md` §3.1 : deux mesures, T1 /10 et T2 0-5, jamais un /100).
- **Prérequis CS-L1** : le **score de potentiel par lot** est le vrai prérequis de CS-L1 (la
  couleur de la couche), **pas** le score T2 de dossier.
- **Données** : `Lot`/`LotVersion.geom` (source A6 cadastre-allégé), `ZoneVersion.densiteLogHa`
  + `usages` (A2 règlements), `lot_zone_resolution` (rattachement lot↔zone), périmètre TOD
  (source A13 `aires-tod-pmad-cmm`, voir §4) ∩ pré-filtres physiques (§2.1). **Pas** de
  `OpportunityDossier.scoreGlobal` à la maille lot.
- **Gain** : un **score de potentiel par lot continu et data-driven**, calculable sur **100 %
  des lots**, au lieu d'un booléen `4plus && tod` ; pas de hardcode par ville ; honnêteté
  `partial`/`non-disponible` quand la zone ou la couche TOD manque (ex. ville hors CMM → TOD
  `non-disponible`, score de potentiel calculé sans l'axe TOD).

#### S-1b. Panneau de stats ville + légende (compteurs Lots / 4+ / TOD / priorité max)
- **Écran : Opportunités** (panneau latéral de la couche lots) — pendant carto de la vue Sources
  pour le compte agrégé.
- **Comment** : reproduire le **panneau droit B1 de Steve** (README §B1, captures 10/30/40/50) :
  titre ville + règlement de zonage, et **4 compteurs** — *Lots total*, *Zones 4+ logements*,
  *Dans périmètre TOD*, *⭐ Priorité max (4+ ∩ TOD)* — fermable (✕), lien retour. Côté radar ces
  compteurs sont des **agrégats data-driven** : `count(lots)`, `count(score potentiel ≥ seuil)`,
  `count(∩ couche requalification-tod)`, `count(priorité = 4+ ∩ TOD)` — recalculés, pas des flags
  importés. Accompagné de la **légende** (README §B4.6 / §B2) : palette de la couche lots (favori
  / 4+ / TOD / priorité / autres) + toggles des couches env, avec la mention d'honnêteté du genre
  « Règlement 901 · à valider avec la Ville » → côté radar = badge `verification` (`fait` /
  `hypothese` / `simulé`).
- **Données** : agrégats sur le **score de potentiel par lot** (§S-1, dérivé `ZoneVersion` ∩ TOD
  ∩ pré-filtres) + couche TOD (A13) + `LotVersion`, par ville chargée — **pas**
  `OpportunityDossier.scoreGlobal` (qui n'existe pas à la maille lot, §S-1). En maquette CS-L6,
  ces compteurs servent de **contrôle de calibration** face aux totaux de Steve (Delson : 278
  lots 4+, 1 443 TOD, **130 priorité max** — `analyse-donnees.json`).
- **Gain** : compteurs **reproductibles** (recalcul vs flags figés) ; honnêteté `partial` affichée.

#### S-2. Fiche lot complète (cadastre + rôle + zone + grille PDF + Google Maps + notes)
- **Écran : Évaluation** (panneau de détail au clic sur un lot).
- **Comment** : reproduire le panneau de Steve (README §B3, capture 13) comme **fiche lot** de la
  vue Évaluation : n° de lot, adresse, **code postal**, zone (badge), catégorie, périmètre TOD,
  superficie m²/ha, **façade & profondeur estimées**, utilisation actuelle, année de construction,
  nb logements au rôle, nb étages, **valeur totale/bâtiment/terrain (rôle)**, lien grille de
  zonage PDF, lien Google Maps/Street View, **notes libres**. Champs masqués si vides (comme Steve).
  La fiche porte aussi les **5 boutons de marquage** (toggle favori / non retenu / sollicité /
  lettre / en vente — détail dans S-3) ; et **lorsque le lot est marqué « en vente »**, un
  **mini-formulaire « en vente »** apparaît (README §B3, capture 13) : champ **prix demandé** +
  champ **lien Centris/Realtor** (rendu en lien cliquable). **Côté radar, ces deux champs sont
  une saisie humaine brute portée par le `ProspectMark{status:"en-vente"}`** (`prixDemande` +
  `lienAnnonce`, §4.1) — **c'est la *source de vérité* du prix et du lien affichés**, jamais une
  `Valuation`. L'enrichissement « annonce » du dossier (S-12) — `Valuation{kind:"market-estimate"}`
  — est une **valeur dérivée** (estimation marché : `pricePerM2`, comparables) qui peut **citer**
  le `prixDemande` du `ProspectMark` mais **ne le porte ni ne le remplace** ; le flux est
  **`ProspectMark` (brut, vérité) → `Valuation` (dérivée)**, jamais l'inverse. Et **non** un
  scrape Centris (Centris = DO NOT SCRAPE, voir S-12).
- **Données** : `LotVersion{superficieM2, adresseCivique, usageCode}`,
  `Valuation{valeurTotale, valeurTerrain, valeurBatiment, rolYear}` (A5 rôle MAMH),
  `ZoneVersion{codeAffiche, densiteLogHa, etagesMax}`, lien grille = artefact source (A2/B2),
  façade/profondeur = champs estimés du rôle (RL). Notes = nouvel objet utilisateur (voir S-3).
  Mini-formulaire « en vente » = `prixDemande` + `lienAnnonce` portés **exclusivement** par le
  `ProspectMark{status:"en-vente"}` (§4.1, source de vérité) ; la `Valuation{market-estimate}`
  du dossier (S-12) en est une **dérivée** et ne stocke pas ces deux champs. **Code postal** =
  lookup S-13 ; **note maquette
  (CS-L6)** : le **JSON Netlify de Steve ne contient pas les codes postaux** (ils sont dans le
  **cache Firestore geocoder.ca non exporté** ; le JSON ne porte qu'un `postal_prefix` au niveau
  ville, ex. « J5B ») → en maquette, le **champ code postal de la fiche est vide** et la **colonne
  code postal de l'export CSV (S-4) reste blanche** tant que S-13 n'est pas branché — à assumer.
- **Gain** : alimenté par le **rôle MAMH standardisé** (universel QC via code MAMH) au lieu d'un
  JSON figé ; bitemporel (valeur as-of-date) ; pas de PII (NO_LOT seul, Loi 25).

#### S-3. Workflow de prospection : marques d'équipe + notes + filtres par marque (compteurs)
- **Écran : Opportunités** (statuts de pipeline) + **Évaluation** (notes par lot).
- **Comment** : les 5 marques de Steve (favori / non retenu / sollicité / lettre / en vente —
  README §B3) deviennent des **statuts de pipeline** sur les Opportunités, alignés sur nos
  `Signal.status` (`nouveau|à-approfondir|écarté|surveillance`) **étendus côté lot/dossier** avec
  un statut de prospection (`favori|écarté|sollicité|lettre-envoyée|en-vente`). Filtres par marque
  **avec compteurs** = filtres sur Opportunités (déjà la mécanique de tri existante). Les notes par
  lot = champ texte de la fiche Évaluation. **Persistance = pas Firestore** : table radar +
  `JournalEntry` append-only (`SPEC_EVOL_SOCLE_STATES_SCORING.md` §2.4), `mode: real|simulation`.
- **Données** : nouvelle entité `ProspectMark{lotId|dossierId, status, note, who, at, mode}`
  (append-only, journalisée) ; compteurs = agrégat par `status`.
- **Gain** : multi-utilisateur **avec auth** (backend radar), historique/traçabilité (au lieu du
  last-write-wins Firestore ouvert), export/import JSON de secours conservé.

#### S-4. Export CSV « lettres de sollicitation » + export de sélection
- **Écran : Opportunités** (action sur la liste filtrée) — l'export retient les colonnes fiche
  lot, donc s'appuie sur les données d'**Évaluation**.
- **Comment** : bouton « Exporter → CSV » sur la liste d'opportunités filtrée (par statut/zone),
  20 colonnes comme Steve (README §B4 : lot, adresse, code postal, zone, rôle, valeurs, flags
  potentiel/usage, notes, lien Google Maps), **BOM UTF-8** pour Excel. Export de la sélection
  multiple (voir S-9) = sous-ensemble.
- **Données** : fiche lot (S-2) + statut (S-3) + code postal (S-13).
- **Gain** : généré depuis l'état radar (reproductible, traçable) ; pas de dépendance à un
  localStorage par poste.

#### S-5. Filtres combinés : potentiel (exclusif) × usage actuel (additif) × superficie min
- **Écran : Opportunités** (filtres) + **Évaluation** (slider superficie à la maille lot).
- **Comment** : reprendre le modèle simple et efficace de Steve (README §B4.3/§B4.4) :
  - **Potentiel** (exclusif) : Tous / 4+ / TOD / Priorité / + nos statuts (favori, écarté, …) →
    devient un filtre sur le **score de potentiel par lot** (§S-1, seuils sur la valeur dérivée
    `ZoneVersion` ∩ TOD ∩ pré-filtres) + statut de marque. **Pas** `OpportunityDossier.scoreGlobal`
    (inexistant à la maille lot, §S-1).
  - **Usage actuel** (additif) : Résidentiel / Multi-logements (CUBF 5xxx) / Commercial /
    Industriel / Mixte / Public / Vacant → filtre sur `LotVersion.usageCode` / `cubf`.
  - **Superficie min** (slider 0–10 000 m²) avec compteur « n / total » → filtre
    `LotVersion.superficieM2` (cf. pré-filtre physique `minLotAreaM2` déjà spécifié,
    `SPEC_EVOL_SOCLE_STATES_SCORING.md` §2.1).
- **Données** : `usageCode`/`cubf`, `superficieM2`, **score de potentiel par lot** (§S-1), statut.
- **Gain** : les filtres deviennent **partageables via l'état d'URL** (anti-feature de Steve
  corrigée, §7).

### P1 — différenciateurs rapides

#### S-6. Pastilles / annotations réglementaires par catégorie (PPCMOI, dérogation, changement de zonage…)
- **Écran : Signaux** (génération auto) → **Opportunités** → **Évaluation**.
- **Comment** : **C'est exactement nos Signaux.** Les pastilles que Steve pose **à la main**
  (modal catégorie ⚡ PPCMOI / 📋 Dérogation / 🗺️ Changement de zonage / ⭐ Opportunité / 🔍 À
  analyser — README §B4.2) sont **générées automatiquement** par le pipeline radar depuis les PV
  de conseil (sources `proces-verbaux-*`, `avis-publics-*`) : un avis de motion → `DesignationEvent`
  → `Signal{type}`. Les catégories de Steve mappent 1-1 sur nos `Signal.type` :
  - ⚡ PPCMOI → `ppcmoi` ; 📋 Dérogation mineure → `derogation-relevant`/`derogation-irrelevant` ;
    🗺️ Changement de zonage → `residential-rezoning` (ou `grid-cos-modification`) ;
    ⭐ Opportunité → dossier T2 ; 🔍 À analyser → `Signal.status = à-approfondir`.
  - Le rendu marqueur+popup de Steve (`ev-popup`/`ev-marker`, mentionné README §P1.6 — popup
    résumé + gains + analyse) sert d'**inspiration UI** pour le pin de Signal sur la carte.
  - **Pastilles manuelles conservées** : un opérateur peut toujours poser une pastille à la main
    (= `Signal{mode:"real", verification:"hypothese"}` ou note), mais c'est le cas dégradé, pas
    le défaut.
- **Données** : `Signal{type, value, confidence, status, sourceRefs, detectedAt, bylaw, zone}`,
  `DesignationEvent`, géolocalisation via `zone`/`lot` rattachés.
- **Gain** : le travail manuel de Steve (1 pastille PPCMOI posée à la main à Sainte-Catherine)
  devient un **flux automatique 6 mois glissants** sur ~150 villes.

#### S-7. Couches environnementales (milieux humides MELCC, BDZI inondables, CPTAQ agricole, satellite)
- **Écran : couches des vues carto (Opportunités / Évaluation principalement, Signaux/Sources en option).**
- **Comment** : ajouter ces couches **publiques** comme toggles de couches sur les cartes
  (README §B4.5). Elles sont déjà des **sources radar prévues** : BDZI (A9 `bdzi-flood-zones`),
  CPTAQ (A8 `cptaq-zone-agricole`), hydrographie GRHQ (A10), milieux humides MELCC (à ajouter
  comme couche tuilée/WMS — même endpoint ArcGIS que Steve : `servicesgeo.enviroweb.gouv.qc.ca`
  couche 2). Satellite = fond Esri World Imagery. **Ces couches alimentent aussi le scoring**
  `risque` (axe 20 %, `SPEC_EVOL_SOCLE_STATES_SCORING.md` §3.2 : inondation 0-20 ans = blocker,
  agricole sans dézonage = bas risque).
- **Données** : WMS/ArcGIS publics (pas de stockage lourd) ; intersections déjà prévues pour le
  scoring risque.
- **Gain** : double usage (affichage **et** scoring) ; mêmes sources que Steve mais branchées au
  pipeline.

#### S-8. Recherche adresse / n° lot / zone (dropdown + zoom + ouverture fiche)
- **Écran : contrôle commun aux vues carto (Opportunités / Évaluation).**
- **Comment** : barre de recherche en mémoire (adresse / NO_LOT / code de zone) avec dropdown
  10 résultats, navigation clavier (↑↓ Enter Esc), zoom + ouverture de la fiche lot — comme Steve
  (README §B4.1). Côté radar, la recherche tape sur l'index `Lot.noLot` /
  `LotVersion.adresseCivique` / `ZoneVersion.codeAffiche` de la ville chargée.
- **Données** : index lots/zones de la ville (déjà chargés par `/api/geo/:city/lots`).
- **Gain** : la sélection (lot/zone) **est reflétée dans l'URL** (§7).

#### S-9. Sélection multiple + actions batch (marquage, export)
- **Écran : Opportunités** (batch statut) + **Évaluation** (sélection sur la carte).
- **Comment** : clic-à-clic pour sélectionner N lots, puis appliquer un statut batch (S-3) ou
  exporter la sélection en CSV (S-4) — README §B4.3. Inclut le geste « **marquer toute une zone X
  comme non retenue** » (batch par `ZoneVersion.codeAffiche`, avec confirmation — README §B3, S-15).
- **Données** : ensemble de `lotId` sélectionnés → `ProspectMark` en lot.
- **Gain** : batch journalisé (`JournalEntry`), réversible.

#### S-10. Labels de zones & n° civiques dépendants du zoom
- **Écran : couches d'étiquettes des vues carto (Opportunités / Évaluation).**
- **Comment** : labels permanents de codes de zone visibles à zoom ≥ 14, n° civiques aux
  centroïdes à zoom ≥ 15 (README §B2/§B4.5). Pur rendu carto.
- **Données** : `ZoneVersion.codeAffiche` (label zone), `LotVersion.adresseCivique` (n° civique).
- **Gain** : lisibilité ; rien de plus que Steve, mais sur notre couche.

#### S-11. Sync temps réel multi-utilisateurs (refaite proprement) + export/import JSON
> **Lot track : CS-P3 (infra), sorti de CS-P1 (amendé revue Fable5 §9.2).** S-11 est de
> l'**infrastructure** (backend + auth + persistance), pas une feature carto P1 — voir §9.
- **Écran : transverse (statuts visibles sur Opportunités/Évaluation).**
- **Comment** : remplacer Firestore ouvert par **backend radar + auth** ; les `ProspectMark` /
  notes se synchronisent via l'API radar (pas de clés en clair). Conserver l'**export/import JSON**
  de secours (dump marks/notes/pastilles) comme filet. Persistance S3-first
  (`SPEC_PERSISTENCE_S3_FIRST.md`) pour l'état durable.
- **Données** : `ProspectMark`, notes, `JournalEntry` (append-only).
- **Gain** : pas de lecture/écriture anonyme du travail d'équipe ; historique + résolution de
  conflits (vs last-write-wins).

### P2 — compléments

#### S-12. Flux annonces en vente (Realtor/Centris) matché sur le cadastre
- **Écran : Opportunités** (enrichissement) + **Sources** (statut du connecteur).
- **Comment** : un lot « en vente » enrichit le dossier d'opportunité (prix demandé, lien
  annonce, MLS) comme la marque `envente` de Steve (README §B5). **L'implémentation de Steve est
  cassée (403 Realtor.ca)** → prévoir un **vrai connecteur Sources**. ATTENTION : Centris/MLS =
  **DO NOT SCRAPE** (Tier C, `SPEC_PLAN_SCRAPING.md` §1, ToS strict) ; privilégier un flux
  partenaire / source autorisée. Matching adresse-annonce → `Lot` via `adresseCivique`.
- **Données** : `Valuation{kind:"market-estimate"}` ou champ annonce sur le dossier ;
  `ScrapeStatusT` pour le statut du connecteur (visible vue Sources).
- **Gain** : statut **honnête** du connecteur (todo/error visible en Sources) au lieu d'un 403
  silencieux.

#### S-13. Lookup code postal (geocoder.ca + cache + saisie manuelle)
- **Écran : Évaluation** (fiche lot, pour le publipostage) + alimente l'export S-4.
- **Comment** : champ code postal éditable avec lookup auto (geocoder.ca, throttlé, cache,
  validation regex `[A-Z]\d[A-Z] \d[A-Z]\d`) comme Steve (README §B3). Côté radar, préférer
  **Adresses Québec / IGO** (A7 `adresses-quebec-igo-geocoder`) déjà prévu, avec geocoder.ca en
  fallback. Cache en base.
- **Données** : code postal rattaché à `LotVersion.adresseCivique`.
- **Gain** : source officielle QC en premier ; cache partagé (pas par poste).

#### S-14. Éditeur de zonage manuel (Leaflet.draw) — bootstrap quand pas de zonage numérique
- **Écran : Sources** (outil de bootstrap d'une source zonage manquante).
- **Comment** : l'éditeur de Steve (README §C — dessiner des polygones de zone, code + type,
  export GeoJSON `[{id, code, type, geojson}]` → déposé en `data/<slug>-zones.json`) devient un
  **outil de saisie manuelle de `ZoneVersion.geom`** rattaché à la vue Sources, pour le cas
  `geomSource = hypothese-street-name | non-disponible` (le « gap polygone » de zone, identifié
  comme manque majeur dans `SPEC_PLAN_SCRAPING.md` B2). Export **GeoJSON versionné** (S3, pas
  localStorage). C'est le **fallback humain** du pipeline d'ingestion.
- **Données** : `ZoneVersion{codeAffiche, kind, geom, geomSource:"vectorised-pdf"|manual}`.
- **Gain** : versionné + traçable (au lieu d'un localStorage perdu) ; alimente directement le
  modèle, pas un JSON parallèle.

#### S-15. Marquer toute une zone comme non retenue (batch par code de zone)
- **Écran : Opportunités / Évaluation** (cas particulier de S-9). Mappé sur le batch par
  `ZoneVersion.codeAffiche` → `ProspectMark{status:"écarté"}` sur tous les lots de la zone, avec
  confirmation. (C'est le geste de masse réel de Steve : 5 043 lots « non retenus » à
  Sainte-Catherine.)

#### S-16. Mobile : fiche lot en bottom-sheet
- **Écran : Évaluation** (responsive de la fiche lot S-2). < 768 px → la fiche lot devient un
  bottom-sheet (55 vh) ouvert via FAB ou clic lot (README §B6). Pur responsive, même composant.

#### S-17. Dashboard multi-villes avec statut de couverture des données par ville
- **Écran : Sources** (déjà la vue Sources !). Le « dashboard de villes » de Steve (grille de
  cartes-villes, statut ✅ Disponible / ⏳ En préparation — README §A) **est notre vue Sources** :
  villes coloriées par **maturité de recueil** (`CityMaturitySummary`, statut par source
  todo/identified/scraped/graphified). Pas de nouvel écran — la vue Sources couvre déjà ce besoin,
  enrichie du statut par couche (lots / zonage / TOD) attendu par Steve.
- **Données** : `ScrapeStatusT{source, status, coveragePct}`, `CoverageCityEntry{hasZonage}`.

---

## 3. Tableau de synthèse feature → écran

| # | Feature Steve | Priorité | Écran radar | Entités/sources radar |
|---|---|---|---|---|
| S-1 | Carte lots+zonage+TOD, scoring visuel | P0 | **Opportunités** (+Évaluation) | Lot/ZoneVersion, TOD (A13), **score de potentiel par lot** (pas `scoreGlobal`) |
| S-1b | Panneau stats ville (Lots/4+/TOD/priorité) + légende | P0 | **Opportunités** | agrégats **score de potentiel par lot**/TOD (A13)/`LotVersion` |
| S-2 | Fiche lot complète (+ mini-formulaire « en vente ») | P0 | **Évaluation** | LotVersion, Valuation (rôle A5), ZoneVersion |
| S-3 | Marques d'équipe + notes + filtres/compteurs | P0 | **Opportunités** (+Évaluation) | `ProspectMark`, JournalEntry |
| S-4 | Export CSV lettres + export sélection | P0 | **Opportunités** | fiche lot + statut + code postal |
| S-5 | Filtres combinés potentiel×usage×superficie | P0 | **Opportunités** (+Évaluation) | **score de potentiel par lot**, usageCode/cubf, superficieM2 |
| S-6 | Pastilles réglementaires par catégorie | P1 | **Signaux**→Opportunités→Évaluation | Signal (auto depuis PV), DesignationEvent |
| S-7 | Couches env (MELCC/BDZI/CPTAQ/satellite) | P1 | couches **Opportunités/Évaluation** | WMS A8/A9/A10 + MELCC, alimente axe risque |
| S-8 | Recherche adresse/lot/zone | P1 | contrôle **Opportunités/Évaluation** | index Lot/Zone ville |
| S-9 | Sélection multiple + batch | P1 | **Opportunités** (+Évaluation) | `ProspectMark` en lot |
| S-10 | Labels zones & n° civiques par zoom | P1 | couches **Opportunités/Évaluation** | codeAffiche, adresseCivique |
| S-11 | Sync temps réel + AUTH + export/import JSON | P1 (**infra → CS-P3**) | transverse | ProspectMark, JournalEntry, S3 (backend+auth) |
| S-12 | Flux annonces en vente | P2 | **Opportunités** (+Sources statut) | `Valuation{market-estimate}` **dérivée** du `ProspectMark` (prix/lien) / ScrapeStatus |
| S-13 | Lookup code postal | P2 (**item `CS-P2-S13`**) | **Évaluation** | adresseCivique + A7 geocoder ; **non-bloquant** export S-4 |
| S-14 | Éditeur de zonage manuel | P2 | **Sources** (bootstrap) | ZoneVersion.geom, geomSource |
| S-15 | Marquer toute une zone non retenue | P2 | **Opportunités/Évaluation** | ProspectMark batch par zone |
| S-16 | Mobile bottom-sheet fiche | P2 | **Évaluation** (responsive) | — |
| S-17 | Dashboard multi-villes couverture | P2 | **Sources** (= déjà cette vue) | ScrapeStatus, maturité |

**Couverture : 17/17 features de Steve (+ S-1b panneau stats/légende), 0 nouvel écran.** Toutes
tombent dans Signaux / Opportunités / Évaluation / Sources ou leurs couches/contrôles carto.

---

## 4. Données nécessaires (récapitulatif par source radar)

| Donnée Steve | Champ Steve | Entité radar | Source radar |
|---|---|---|---|
| Cadastre (polygones) | `NO_LOT`, geom | `Lot.noLot`, `LotVersion.geom` | A6 cadastre-allégé / A4 Données Québec |
| Rôle 2022 (valeurs, usage, logements, étages, année) | `val_*`, `cubf`, `utilisation`, `nb_logements_role`, `nb_etages`, `annee_construction` | `Valuation`, `LotVersion.usageCode` | A5 `roles-evaluation-fonciere-mamh` |
| Façade / profondeur | `facade_m`, `profondeur_m` | champs estimés du rôle (RL) | A5 |
| Superficie | `superficie_m2_calculee` | `LotVersion.superficieM2` (RL0302A) | A5 |
| Zonage (code, densité, usages) | `zone`, `zone_desc` | `ZoneVersion{codeAffiche, densiteLogHa, usages}` | A2 règlements / B2 grilles |
| Flag 4+ / TOD / priorité | `multifamilial_4plus`, `tod`, `priorite` | **score de potentiel par lot** dérivé (`ZoneVersion`/usages ∩ TOD ∩ pré-filtres), pas un flag stocké ni `scoreGlobal` | calcul à la maille lot (§S-1) |
| Périmètre TOD | `tod` FeatureCollection | couche `requalification-tod` | **A13 `aires-tod-pmad-cmm`** (open data CMM, voir §4.0) ; `non-disponible` hors CMM |
| Limite municipale | `boundary` (CSDUID) | `CityProfile.bbox` / boundary GeoJSON | A11 StatCan / A4 |
| Grille de zonage PDF | `meta.grilles` | artefact source rattaché à `ZoneVersion` | A2 / B2 |
| Code postal | lookup geocoder.ca | rattaché à `adresseCivique` | A7 IGO + geocoder.ca fallback |
| Marques / notes / pastilles | Firestore `marks`/`lot_notes`/`pastilles_v2` | `ProspectMark` + `Signal` + JournalEntry | backend radar (auth) |
| Prix / lien annonce (« en vente ») | Firestore `marks` (prix saisi) | **`ProspectMark{prixDemande, lienAnnonce}`** (saisie humaine brute = source de vérité, §4.1) | backend radar (auth) |
| Annonces (estimation marché dérivée) | Firestore `listings` | `Valuation{market-estimate}` **dérivée** du `ProspectMark` (jamais l'inverse) | connecteur Sources (PAS Centris scrape) |
| Couches env | WMS/ArcGIS publics | couches carto + intersections risque | A8 CPTAQ, A9 BDZI, A10 GRHQ, MELCC |

**Nouvelle entité à spécifier** (non encore au modèle) : `ProspectMark`. C'est le **seul** ajout de
modèle requis par l'intégration ; tout le reste réutilise l'existant.

#### 4.0 Source TOD à ajouter au plan (amendé revue Fable5) — **A13 `aires-tod-pmad-cmm`**

La couche `requalification-tod` (référencée en §2 S-1/S-1b et dans la table ci-dessus) **n'avait
aucune source au plan** : le socle ne connaît le TOD que comme **type de signal**
(`requalification-tod`, `SPEC_EVOL_SOCLE_STATES_SCORING.md` §2.0/§3.2), pas comme **couche
géométrique**. Le plan de scraping (`SPEC_PLAN_SCRAPING.md` §1) liste A8 CPTAQ / A9 BDZI / A10 GRHQ
mais **pas** de source d'aires TOD. On ajoute donc au plan une source dédiée :

- **A13 `aires-tod-pmad-cmm`** — **aires TOD du PMAD** (Plan métropolitain d'aménagement et de
  développement) de la **CMM** (Communauté métropolitaine de Montréal), **open data CMM**. Les
  aires TOD du PMAD sont une couche géométrique publique de la CMM (périmètres d'orientation
  transport-aménagement autour des points d'accès au réseau structurant). **Tier A** (open data,
  paramétrable par périmètre), `build-now`, cadence trimestrielle/annuelle (révision PMAD).
- **Couverture** : les **4 villes de Steve** (Delson, Sainte-Catherine, Saint-Constant, Candiac)
  sont **toutes dans la CMM** → A13 les couvre. Plus généralement le « grand filet » rayon ~50 km
  MTL est majoritairement en CMM.
- **Honnêteté hors CMM** : pour une ville **hors CMM**, A13 n'a pas d'aire TOD → la couche TOD est
  marquée **`non-disponible`** (pas `false`/absence : *unknown ≠ pas-de-TOD*,
  `SPEC_EVOL_SOCLE_STATES_SCORING.md` §3.4.0). Le **score de potentiel par lot** (§S-1) est alors
  calculé **sans** la composante TOD (et l'indique), au lieu d'imputer un TOD absent.
- **Entité** : alimente la couche `requalification-tod` (géométrie de périmètre) consommée par
  CS-L1 (couleur), S-1b (compteur « Dans périmètre TOD »), et l'axe **timing** du scoring T2
  (`SPEC_EVOL_SOCLE_STATES_SCORING.md` §3.3). À **référencer dans `SPEC_PLAN_SCRAPING.md` §1.A**
  comme A13 lors de l'attaque de la couche.

#### 4.1 ProspectMark ↔ JournalEntry — relation précisée (amendé revue Fable5)

**Recommandation : table propre `ProspectMark` + entrée `JournalEntry`** — **exactement** le
patron des dossiers (`OpportunityDossier`), pas une surcharge de `JournalEntry`. Les deux objets
ont des rôles distincts et complémentaires :

- **`ProspectMark`** = l'**état courant** du marquage d'un lot/dossier (la projection « ce lot est
  *en-vente* avec ce prix »), lisible directement par la carte/les filtres sans rejouer le journal.
- **`JournalEntry`** = l'**acte** qui a produit ce changement d'état (qui, quand, pourquoi), unité
  de redevabilité — « *signer les décisions, jamais chaque donnée* » (`SPEC_EVOL_SOCLE_STATES_SCORING.md`
  §2.4). **Un** marquage = **une** entrée de journal.

```ts
interface ProspectMark {
  id: string;
  lotId?: string; dossierId?: string;      // l'un OU l'autre
  status: "favori" | "écarté" | "sollicité" | "lettre-envoyée" | "en-vente";
  note?: string;
  prixDemande?: number; lienAnnonce?: string; // si status === "en-vente" (mini-formulaire S-2/S-12)
  who: string; role: string;               // PRINCIPAL = un humain (jamais l'IA), comme §2.4
  at: string;                              // ISO timestamp
  mode: "real" | "simulation";             // §2.7 — un mark simulé ne franchit jamais le réel
  supersedes?: string;                     // correction append-only → id du mark précédent
}
```

**Doctrine append-only (alignée §2.4 / §2.7) :**

- **Append-only + `supersedes`** : on ne **modifie/supprime jamais** un `ProspectMark` en place ;
  un changement de marque (re-toggle, correction) **insère** un nouveau mark qui `supersedes` le
  précédent (même sémantique que la correction de `JournalEntry`). L'état courant = le dernier mark
  non-superseded par lot/dossier ; l'historique reste intégral et traçable. Application logicielle
  en ÉV1 ; révocation Postgres `UPDATE`/`DELETE` au niveau rôle **différée** (comme le journal,
  §2.4 « grant-hardening deferred »).
- **`mode: real|simulation`** : `ProspectMark` porte le discriminant comme `Signal` /
  `OpportunityDossier` / `JournalEntry` (§2.7). En maquette (CS-L6) **tous** les marks sont
  `mode:"simulation"` ; la **frontière réel** exclut tout `mode==="simulation"` → les marks de
  démo ne polluent jamais le pipeline réel ni le journal réel.
- **Chaque mutation de mark écrit une `JournalEntry`** : `action` ∈ taxonomie §2.4
  (`rejeter` ↔ écarté, `surveiller` ↔ favori, `approcher-propriétaire` ↔ sollicité/lettre…),
  `target` = `lotId|dossierId`, `mode` identique, `supersedes` chaîné. Les **compteurs par marque**
  (S-3) s'agrègent sur le **dernier état** de `ProspectMark`, pas sur le journal.

**Tranche prix/lien — `ProspectMark` = vérité, `Valuation` = dérivée (amendé revue Fable5) :**
le `prixDemande` et le `lienAnnonce` du mini-formulaire « en vente » (S-2) sont **portés par le
`ProspectMark`** (saisie humaine brute) et **sont la source de vérité** du prix et du lien
**affichés**. La `Valuation{kind:"market-estimate"}` (S-12) est une **estimation marché dérivée**
(`pricePerM2`, comparables — `SPEC_DESIGN_DATA_MODEL.md` §1.4) qui **peut citer** ce `prixDemande`
mais **ne le stocke ni ne le remplace jamais** ; le sens du flux est **`ProspectMark` → `Valuation`,
jamais l'inverse**. (`Valuation` n'a d'ailleurs **pas** de champ `prixDemande`/`lienAnnonce` au
modèle — `SPEC_DESIGN_DATA_MODEL.md` §1.4 ; ces deux champs vivent **uniquement** sur `ProspectMark`.)

**Coexistence marque-équipe + état « en-vente » (amendé revue Fable5) — ne pas perdre le prix :**
un même lot peut porter **simultanément** une marque de pipeline d'équipe (`favori`/`sollicité`/
`lettre-envoyée`/`écarté`) **et** l'information « en-vente » (prix + lien). Comme l'état courant
est *« le dernier mark non-superseded par lot »*, un nouveau mark `favori` qui `supersedes` un mark
`en-vente` **ferait disparaître `prixDemande`/`lienAnnonce`**. Pour éviter cette perte :

- Les **statuts de pipeline** (`favori|écarté|sollicité|lettre-envoyée`) et l'**état marché**
  (`en-vente`, porteur de `prixDemande`/`lienAnnonce`) sont **deux dimensions orthogonales** d'un
  lot : un `supersedes` ne s'applique **qu'à l'intérieur de la même dimension**. L'état courant
  d'un lot = **le dernier mark non-superseded de *chaque* dimension** (le dernier statut pipeline
  **et** le dernier mark `en-vente`), pas un seul mark global. Ainsi marquer `favori` n'efface pas
  l'`en-vente`, et inversement.
- Conséquence : la **chaîne `supersedes`** est **par dimension** (un mark `favori` ne peut
  `supersedes` qu'un mark de statut pipeline, jamais un mark `en-vente`) ; le retrait de
  l'« en-vente » est un **mark `en-vente` explicitement clôturé** (mark de fermeture qui
  `supersedes` l'ouverture), append-only, jamais une suppression. Les **compteurs** (S-3) comptent
  chaque dimension indépendamment.

Ce double objet (état projeté + acte journalisé, tous deux append-only) **réutilise** la doctrine
existante des dossiers : aucune nouvelle mécanique de persistance, juste une nouvelle table d'état.

---

## 5. Anti-features de Steve — ce que le radar fait mieux

| Anti-feature Steve | Risque | Réponse radar |
|---|---|---|
| JSON monolithique 6–24 Mo/ville chargé d'un bloc (`cache: no-store`) | latence, mémoire navigateur, non scalable à 150 villes | API paginée `/api/geo/:city/lots?limit&bbox` (déjà en place) ; tuiles vectorielles / PMTiles si volume ; S3-first (`SPEC_PERSISTENCE_S3_FIRST.md`) |
| Firestore sans auth, clés API en clair, écriture ouverte | n'importe qui écrase le travail d'équipe ; aucun historique | backend radar **avec auth** ; `ProspectMark`/`JournalEntry` **append-only** ; export/import JSON de secours conservé |
| Hardcode par ville (codes zones 4+, descriptions, grilles) dispersé HTML/data | non maintenable, faux pour les villes sans data | scoring **data-driven** depuis `ZoneVersion` ; `CityProfile` registre ; aucune logique métier par ville en dur |
| Pas d'état d'URL (zoom/filtres/lot non partageables) | collaboration impossible, pas de deep-link | **état d'URL** : `?ville=&view=&zoom=&filtres=&lot=` (§7) |
| localStorage comme stockage primaire | perte de données, pas multi-device | persistance S3-first + base radar ; localStorage seulement comme cache offline |
| Realtor.ca scrape → 403, Centris ToS | connecteur cassé / illégal | connecteur Sources honnête (statut visible) ; **Centris = DO NOT SCRAPE** ; source partenaire |

---

## 6. Approche MAQUETTE — substrat de données réel depuis le Netlify de Steve

**Objectif** : valider l'UX de la vue **Évaluation enrichie** (fiche lot + qualification +
filtres + marques) sur de **vraies données** des 4 villes de Steve **avant** d'avoir le pipeline
complet (rôle MAMH + zonage extrait). On utilise le JSON par ville **scrappable** du Netlify
comme **fixture de maquette** (mode `simulation`, jamais mélangé au réel — `mode` partitionne).

### 6.1 Récupération du JSON (les données ne sont pas dans la rétrodoc, mais téléchargeables)
- Index des villes : `https://thriving-kleicha-89b7ef.netlify.app/data/cities.json`
  (= [`input/carte-steve/tech/cities.json`](input/carte-steve/tech/cities.json), 4 villes `ready`).
- Données par ville (6–24 Mo, GeoJSON WGS84) :
  `https://thriving-kleicha-89b7ef.netlify.app/data/<slug>.json` pour
  `delson`, `sainte-catherine`, `saint-constant`, `candiac`
  (cf. `ARCHITECTURE.md` §fin : « téléchargeables `…/data/<slug>.json` »).
- Zones dessinées (Sainte-Catherine) : `…/data/sainte-catherine-zones.json`.
- Schéma effectif déjà documenté : `{meta, lots, zones, tod, boundary}` + 22 propriétés de lot
  (voir [`tech/analyse-donnees.json`](input/carte-steve/tech/analyse-donnees.json) pour les
  `sample_lot` réels et les compteurs par ville).
- **Méthode** : un petit job de fixture (mode dev) `curl`/fetch + validation Zod → stockage en
  **fixtures S3** `fixtures/carte-steve/<slug>.json` (`SPEC_PERSISTENCE_S3_FIRST.md` §layout
  `fixtures/`). Pas committé en git (volumétrie). Pas de PII (les JSON de Steve ne contiennent que
  cadastre + rôle public + adresse, aucun nom de propriétaire).

### 6.2 Mapping JSON Steve → modèle radar (table de correspondance pour le loader de fixture)

| Champ JSON Steve | Cible radar | Notes |
|---|---|---|
| `lots[].properties.NO_LOT` | `Lot.noLot` | normaliser les espaces (« 2 181 127 » → « 2181127 ») |
| `lots[].geometry` (Polygon/MultiPolygon) | `LotVersion.geom` (SRID 4326) | déjà WGS84 |
| `adresse` | `LotVersion.adresseCivique` | — |
| `zone` | `lot_zone_resolution.zoneId` via `ZoneVersion.codeAffiche` | `confirmed=false` (hypothèse, pas d'intersection géométrique fournie) |
| `categorie` / `cubf` / `utilisation` | `LotVersion.usageCode` (mapping CUBF→enum RU/CH/BO/AV/TE) | `cubf 5xxx` → multi-logements |
| `superficie_m2_calculee` | `LotVersion.superficieM2` | — |
| `facade_m` / `profondeur_m` | champs estimés rôle | profondeur souvent 0 (à ignorer si 0) |
| `annee_construction`, `nb_etages`, `nb_logements_role` | `LotVersion` / Valuation metadata | — |
| `val_totale` / `val_terrain` / `val_batiment` | `Valuation{valeurTotale, valeurTerrain, valeurBatiment, kind:"role-evaluation", rolYear:2022, source:"carte-steve-fixture"}` | `verification:"simulé"`, `mode:"simulation"` |
| `multifamilial_4plus` / `tod` / `priorite` | **ne pas importer comme vérité** — recalculer via le **score de potentiel par lot** (§S-1, dérivé `ZoneVersion` ∩ TOD ∩ pré-filtres) | sert seulement de référence de calibration |
| `zones[]` (FeatureCollection) | `Zone` + `ZoneVersion{codeAffiche, geom}` | quand présent (Delson, Sainte-Catherine, Saint-Constant) |
| `tod[]` | couche `requalification-tod` (équivalent fixture de la source A13 `aires-tod-pmad-cmm`, §4.0) | périmètres ; en maquette = fixture, en réel = A13 open data CMM |
| `boundary[]` (CSDUID) | boundary GeoJSON de la ville | — |
| `meta.grilles` | lien grille rattaché à `ZoneVersion` | 3 formats (préfixe / `_fallback_map` / défaut) |
| `meta.postal_prefix` (ville) | — (pas de code postal lot) | **le JSON n'a PAS de code postal par lot** : seulement un préfixe ville (ex. « J5B »). Le code postal complet vit dans le **cache Firestore geocoder.ca non exporté** → champ vide en maquette (S-13 le remplit hors maquette) |

> **DÉCISION TRANCHÉE (user, 2026-06-11) : OUI on importe le corpus de l'équipe Steve — mais dans
> une TABLE DE CONTRÔLE de parité, PAS dans le store opérationnel des prospects.**
> L'équipe de Steve a produit un **corpus de prospection réel** : (a) le **substrat
> cadastre/rôle/zonage** (JSON Netlify public par ville, sans PII) **et** (b) ses **marques
> d'équipe Firestore** (~**5 043 lots « non retenus »** + **204 lettres**, plus marques/notes —
> README §Données d'usage). La question « importer ce corpus ? » est désormais **tranchée** :
>
> 1. **Import OUI**, mais le corpus de Steve devient une **donnée de *référence / golden* isolée**,
>    matérialisée dans une **table de contrôle** dédiée (`ControlLot` / `ControlMark`), **distincte
>    du store opérationnel** (`Lot`/`LotVersion`/`ProspectMark`). But : **vérification de PARITÉ**
>    entre (a) la **donnée de référence** (importée de Steve) et (b) la **donnée que NOTRE pipeline
>    scrape/dérive**. On **ne** déverse **pas** les marques de Steve comme `ProspectMark`
>    opérationnels (cela contredirait `mode:"real"`/`mode:"simulation"` du store réel) : on les
>    range en **contrôle**, jamais re-publiées.
> 2. **Les 4 villes de Steve** (`delson`, `sainte-catherine`, `saint-constant`, `candiac`)
>    deviennent des **points de contrôle / golden cities**. Conséquence directe : on **priorise le
>    scrape EN PROFONDEUR de ces 4 villes** (toutes sources : PV/zonage, rôle, cadastre, zones, TOD)
>    **pour reproduire la donnée de Steve et pouvoir la *diffّer*** (cf. priorité deep amendée dans
>    `SPEC_PLAN_SCRAPING.md` §2.4, ci-après).
> 3. **Articulation au data model** : la table de contrôle ne **pollue ni** `ProspectMark` **ni**
>    `DesignationEvent` (cf. garde-fou §6.2.1). C'est un **dataset de référence parallèle**, clé
>    `(citySlug, NO_LOT)`, miroir des champs de la fiche lot Steve. **Loi 25** : ce sont des
>    données **fournies par le client sur ses propres prospects** (cadastre + rôle publics + marques
>    *d'équipe* portant `who`/`role`, **aucune PII de tiers / propriétaire**), conservées **en
>    contrôle** — **jamais re-publiées** dans le flux opérationnel.
>
> La spec dédiée **`SPEC_CONTROLE_PARITE_VILLES_STEVE.md`** porte le détail (modèle table de
> contrôle, métrique de parité diffable par ville, mécanisme d'import, priorité deep des 4 villes,
> items track). Le **substrat cadastre/rôle/zonage** de la maquette (§6.2 table de mapping
> ci-dessus, `mode:"simulation"`) reste le socle de démo CS-L6 ; la **table de contrôle** est un
> **usage distinct et additionnel** du même corpus Steve, orienté **mesure de parité**, pas démo UX.

#### 6.2.1 Garde-fou — table de contrôle ≠ store opérationnel (suite de la décision)

La table de contrôle (`ControlLot`/`ControlMark`, détaillée dans
[`SPEC_CONTROLE_PARITE_VILLES_STEVE.md`](SPEC_CONTROLE_PARITE_VILLES_STEVE.md)) est **strictement
séparée** du store opérationnel et **ne touche pas** au détecteur :

- **Pas de pollution `ProspectMark`** : les marques d'équipe de Steve (`non-retenu` → 5 043,
  `lettre` → 204) sont rangées en `ControlMark` (référence golden), **jamais** insérées comme
  `ProspectMark` (§4.1). Le store opérationnel reste alimenté **uniquement** par les décisions
  prises **dans** le radar (réelles ou `simulation`), pas par l'historique importé de Steve.
- **Pas de pollution `DesignationEvent`** : l'import de contrôle **n'émet aucun**
  `DesignationEvent` (§1.3 `SPEC_DESIGN_DATA_MODEL.md`). La table de contrôle est un **snapshot de
  référence**, pas un événement de désignation ; elle ne franchit jamais la **frontière réel**
  (`SPEC_EVOL_SOCLE_STATES_SCORING.md` §2.7).
- **Détecteur intact** : `detectZonageChange` et le pipeline de signaux **ne lisent jamais** la
  table de contrôle — elle est consommée **uniquement** par le **rapport de parité** (lecture
  seule, hors flux opérationnel). La parité **mesure** le pipeline ; elle ne le **nourrit** pas.
- **Sens de la donnée** : `ControlLot`/`ControlMark` (référence Steve) ⟂ `Lot`/`LotVersion`/
  `ProspectMark` (pipeline radar). Le **diff** se fait par jointure `(citySlug, NO_LOT)` **au moment
  du rapport**, sans jamais fusionner les deux tables.

### 6.3 Contraintes de la maquette
- **Pas de codes postaux dans la fixture** : le JSON Netlify n'exporte **pas** le cache Firestore
  geocoder.ca (codes postaux par lot) ; il ne porte qu'un `postal_prefix` au niveau ville. En
  maquette, le **champ code postal de la fiche lot (S-2) est vide** et la **colonne code postal de
  l'export CSV (S-4) reste blanche** — à assumer ; S-13 (CS-P2) la remplit une fois le lookup IGO /
  geocoder.ca branché hors maquette.
- **`mode: "simulation"` + `verification: "simulé"` partout** : les données de Steve **ne
  fuient jamais** dans le flux réel (la frontière réel exclut `mode==="simulation"` et
  `verification==="simulé"`, `SPEC_EVOL_SOCLE_STATES_SCORING.md` §2.7).
- **Chemin de promotion sim→réel des `ProspectMark` (amendé revue Fable5)** : la maquette pose
  **tous** les marks en `mode:"simulation"` (frontière réel ci-dessus), **mais l'équipe de Steve
  prendra de *vraies* décisions** de prospection sur cette UI. Il faut donc un **chemin de
  promotion** explicite pour que ces décisions deviennent réelles **quand le substrat cadastral
  réel arrive** (rôle MAMH + cadastre A6), sans réinventer le geste :
  - **Clé de mapping lot sim→réel** : un `ProspectMark` simulé porte un `lotId` **du substrat de
    maquette** (fixture Netlify). La promotion **ré-ancre** ce mark sur le **`Lot` réel** via la
    **clé naturelle stable** = `NO_LOT` normalisé (`Lot.noLot`, §6.2 normalisation des espaces)
    **+ `citySlug`**. Le `NO_LOT` cadastral est **invariant** entre la fixture et le rôle MAMH
    réel (même cadastre QC) → c'est la jointure de promotion. Un mark dont le `NO_LOT` **ne
    résout pas** vers un `Lot` réel reste `simulation` et est **signalé pour revue** (jamais
    promu en aveugle).
  - **Mécanique append-only** : la promotion **n'édite pas** le mark simulé en place (append-only,
    §4.1). Elle **insère un nouveau `ProspectMark{mode:"real"}`** qui `supersedes` le mark simulé
    (chaîne par dimension, §4.1) et écrit une **`JournalEntry{mode:"real"}`** (l'acte de
    promotion : `who`/`role` = l'humain qui valide, `rationale` = « promotion maquette→réel »).
    L'historique simulé reste intégral et traçable ; la frontière réel ne voit que le nouveau mark.
  - **Garde-fous** : (1) **promotion par décision humaine**, jamais automatique (un humain confirme
    le ré-ancrage `NO_LOT`→`Lot` réel) ; (2) **`prixDemande`/`lienAnnonce` re-confirmés** à la
    promotion (un prix saisi en démo n'est pas une vérité marché — il redevient une saisie humaine
    réelle à valider) ; (3) **PII Loi 25** : les marks ne portent **pas** de propriétaire (seul
    `who`/`role` d'équipe) — rien à caviarder, mais l'import éventuel du corpus Firestore (encadré
    §6.2) suit le **même** chemin et les mêmes garde-fous ; (4) **idempotence** : promouvoir deux
    fois le même mark est un no-op (la chaîne `supersedes` sur `NO_LOT`+`citySlug` dédoublonne).
- **Calibration** : les flags `priorite`/`4plus`/`tod` de Steve servent de **jeu de référence**
  pour vérifier que notre scoring T2 retrouve des priorités cohérentes (Delson : 130 « priorité
  max » attendues, `analyse-donnees.json`).
- **Couverture data variable** : Delson = complet (zonage + TOD + descriptions) ; Candiac = lots +
  rôle seuls (ni zonage ni TOD) — bon cas-test du `partial`/`non-disponible` du scoring.
- **Valeur** : valider l'UX fiche lot + filtres + marques sur **27 279 lots réels** avant d'avoir
  branché le rôle MAMH, puis **basculer la même UI** sur les sources réelles (le contrat de
  données est le même).

---

## 7. État d'URL (correction d'anti-feature, transverse aux 4 vues)

Steve n'a aucun état d'URL (sauf `?ville=`). Le radar rend **partageable** l'état des vues :
`?ville=<slug>&view=<signaux|opportunites|evaluation|sources>&zoom=<n>&center=<lat,lng>&filtres=<encodés>&lot=<noLot>&signal=<id>`.
Permet le deep-link d'un lot/signal/opportunité (collaboration, support, démo). C'est le pendant
des paramètres `?ville=` de Steve, généralisé.

---

## 8. Décision carto (tranchée en revue Fable5)

> **Décision (Fable5) : MapLibre GL dès CS-L1 / CS-L6 pour la couche lots/zones. SVG conservé pour
> la maille Québec (Signaux / Sources). PMTiles différé en étape de scaling.** Leaflet écarté.

### 8.1 Constat — pourquoi le SVG ne suffit plus

Steve = **Leaflet** (couches WMS/ArcGIS, Leaflet.draw, satellite) — et **son outil rend bel et
bien ~11 261 lots** (Saint-Constant) en Leaflet, donc **Leaflet *n'est pas* au mur**. C'est **notre
rendu SVG actuel** qui plafonne : `EvaluationMapView.svelte:125` charge les lots avec
`fetchLots(citySlug, { limit: 200 })` — un cap **codé en dur à 200 lots** pour ne pas écrouler le
DOM (un polygone = un nœud DOM). Rendre ~11 k polygones par ville en **nœuds DOM SVG** est ce qui
ne tient pas ; + le style data-driven (couleur par score recalculée), + les overlays WMS (S-7),
+ ~150 villes visées → il faut **sortir du rendu DOM**. Le choix se joue donc entre **Leaflet**
(canvas/DOM, qui marche pour Steve) et **MapLibre GL** (WebGL) — arbitré en §8.2.

### 8.2 Arbitrage — MapLibre GL maintenant, PMTiles plus tard

- **MapLibre GL dès CS-L1 / CS-L6** : WebGL, **style data-driven** (`paint` par **expression** sur
  le score de potentiel par lot — la couleur de chaque lot dérivée d'une donnée, sans toucher au
  DOM), **labels dépendants du zoom** natifs (S-10), overlays WMS/ArcGIS, et **perf WebGL** stable
  à ~11 k polygones × ~150 villes. C'est la lib qui outille toutes les features carto de Steve sans
  Firestore ni hardcode.
- **Leaflet écarté — argumentaire juste (amendé revue Fable5)** : Leaflet **n'est pas** disqualifié
  parce qu'il « retomberait sur la limite du SVG » — c'est **faux**, l'outil de Steve rend ~11 261
  lots en Leaflet (canvas), bien au-delà de notre cap SVG de 200. Leaflet est écarté pour des
  raisons **positives en faveur de MapLibre**, pas un échec de Leaflet : (1) le **style data-driven
  par expression** (couleur = f(score) recalculée côté GPU) est **natif** en MapLibre et **bricolé**
  en Leaflet (il faut re-styler les features à la main) ; (2) les **labels zoom-dépendants** (S-10)
  et la **densité de labels** sont gérés par le moteur de style MapLibre ; (3) **WebGL** tient mieux
  la charge data-driven + overlays à l'échelle ~150 villes que le canvas Leaflet ; (4) **continuité
  PMTiles** (étape de scaling ci-dessous) : MapLibre consomme un `source` GeoJSON **puis** des
  tuiles vectorielles **sans changer de lib**. Bref : Leaflet *fonctionne*, MapLibre *outille mieux*
  notre style data-driven et notre trajectoire de scaling.
- **PMTiles différé en étape de scaling** : on **ne** génère **pas** de tuiles vectorielles au
  socle. Tant qu'on sert le `FeatureCollection` d'une ville via l'API paginée
  (`/api/geo/:city/lots?limit&bbox`, déjà en place), MapLibre rend un *source* GeoJSON directement.
  PMTiles arrive **quand le volume l'exige** : génération **`tippecanoe`** ville→`.pmtiles`,
  **fichier statique servi depuis S3** (aligné `SPEC_PERSISTENCE_S3_FIRST.md` — S3-first, pas de
  tile-server à opérer). Étape de scaling, pas de blocage du P0.
- **SVG conservé** pour la maille **Québec** (vues **Signaux / Sources**, ~150 entités) : faible
  volume, pas de WebGL requis, rendu actuel suffisant. On ne migre **que** les couches lots/zones.

### 8.3 Contraintes à tenir (impact périmètre lots)

- **Poids du bundle** : MapLibre GL ≈ **~250 KB gz**. À assumer (chargé seulement sur les vues
  Opportunités/Évaluation, pas Signaux/Sources).
- **Canvas hors Design System** : le rendu WebGL est un canvas — il échappe aux tokens CSS du DS.
  Mitigation : **mapper les tokens DS → propriétés `paint` MapLibre** (palette de score, couches),
  un adaptateur tokens→style-JSON, pour que la carte reste cohérente avec le DS.
- **Non testable en jsdom** : WebGL n'a pas de contexte en jsdom → les tests unitaires **ne**
  peuvent **pas** monter la carte. Stratégie : **tester le style JSON séparément** (la fonction
  qui produit l'objet style/paint depuis les tokens + le score, en pur), et couvrir le rendu réel
  par **UAT Playwright** (`harness verify --category uat`).

Impact périmètre : conditionne CS-L1 (couche), CS-L6 (substrat affiché), et les lots P1 S-7/S-10
et P2 S-14. Ce choix **ne crée pas d'écran**, il outille les écrans existants — et il devient le
**prérequis « carto tranchée »** de l'ordre d'exécution (§9.1).

---

## 9. Plan d'intégration (lots) — items `track`

Les lots d'intégration sont créés dans le workspace track **`reorientation`**, parentés sous la
racine **« Réorientation Grand filet »** (`01KTQP5EHKKMM5TSD4ZSE3CFZ2`), aux côtés des lots L1–L6
existants. Chaque lot porte `body: "ref docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md …"`.

### 9.1 Ordre d'exécution (amendé revue Fable5)

L'ordre n'est **pas** « P0 dans l'ordre des numéros » : sans données, CS-L1→CS-L5 n'ont rien à
afficher. Le **socle est la donnée**, et la donnée réelle (rôle MAMH + zonage extrait) n'est pas
encore là. Deux préalables conditionnent tout le reste :

1. **Carto tranchée** (prérequis transverse, §8) : adopter MapLibre GL pour la couche lots/zones
   **avant** CS-L1/CS-L6 — le SVG plafonne à 200 lots (`EvaluationMapView.svelte:125`,
   `fetchLots(..., { limit: 200 })`) et ne peut pas rendre ~11 k polygones/ville. C'est l'outillage
   carto, pas un écran.
2. **CS-L6 (maquette substrat) EN PREMIER** : sans rôle MAMH ni zonage extrait, **aucune** des
   features P0 n'a de données réelles à montrer. La fixture Netlify de Steve (mode `simulation`)
   est le **socle de données** qui débloque toute l'UX P0. Elle passe donc **avant** CS-L1→CS-L5.

**Ordre recommandé :**

> **carto tranchée → CS-L6 → (CS-L1 ∥ CS-L5) → CS-L2 → CS-L3 → CS-L4** → CS-P1 ∥ CS-P3 → CS-P2.

CS-L1 (couche lots coloriée) et CS-L5 (filtres) peuvent démarrer **en parallèle** une fois le
substrat CS-L6 en place (ils consomment le même `FeatureCollection` de lots scorés). CS-L2 (fiche
lot) puis CS-L3 (marques) suivent ; CS-L4 (export) ferme P0. **CS-P3** (infra sync+auth, §9.2) peut
avancer **en parallèle de CS-P1** mais **conditionne le passage de CS-L3 en `mode:"real"`**
multi-utilisateurs (en maquette CS-L3 reste `simulation`, sans backend auth).

**Dépendances explicites (à matérialiser en `blocker --kind dependency` sur les items track) :**

- **CS-L1, CS-L5 ← CS-L6** (pas de couche/filtres sans substrat de données).
- **CS-L2 ← CS-L6** (la fiche lot lit le rôle/zonage du substrat).
- **CS-L3 ← CS-L2** (les marques se posent sur la fiche lot).
- **CS-L4 ← CS-L2 + CS-L3** (blockers `linked-done` **légitimes**) : l'export CSV agrège les
  **colonnes de la fiche lot** (CS-L2) **et** le **statut de prospection** (CS-L3) ; il ne peut
  donc partir qu'une fois les deux livrés.
- **CS-L4 ⟂ S-13 (code postal) — dépendance NON-BLOQUANTE (corrigé revue Fable5)** : l'export
  porte une **colonne code postal** que le lookup S-13 remplit. **Mais l'export N'EST PAS gaté sur
  S-13** : la spec §9.1 elle-même dit *« l'export reste valide, colonne code postal blanche »*. En
  maquette cette colonne est **vide** (le JSON Netlify de Steve n'exporte pas le cache Firestore des
  codes postaux — §2 / §6.3) ; l'export part **quand même**, colonne blanche, et se remplit une fois
  S-13 livré.
  > **CORRECTION track (revue Fable5).** Le plan avait posé un blocker `linked-done`
  > (`01KTW2MBCFV4ASPMW98JM472SK`) faisant dépendre **CS-L4 (P0)** du **chapeau CS-P2 entier (P2)**
  > via son `ref`. C'est **contradictoire** avec cette même §9.1 (« export reste valide, colonne
  > blanche ») : un P0 ne doit pas être `AWAITED` derrière un P2. Le blocker est donc **erroné et
  > superséde** — CS-L4 **ne dépend pas** de CS-P2 ; la relation à **S-13 seul** est une **note
  > non-bloquante**, pas un `linked-done`. S-13 a désormais un **item track distinct**
  > (`CS-P2-S13`, `01KTW67FQGE1AZ9J841Z0FH2FB`, enfant de CS-P2) pour porter cette relation à la
  > bonne maille. *Note d'outillage : `track` 0.12.0 ne permet pas de **résoudre/retirer** un
  > blocker `linked-done` (manuel refusé ; auto-résolution uniquement quand le `ref` est `done`) et
  > l'on ne réécrit pas la chaîne append-only à la main ; la correction est donc **portée par la
  > spec** (source autoritaire) + l'item S-13 correctement graené. Le blocker erroné reste visible
  > dans le log comme un artefact à neutraliser dès qu'un verbe `blocker void` existera.*

Les chapeaux CS-P1/CS-P2/CS-P3 restent en aval et seront éclatés en lots fins à l'attaque de chaque palier.

| Lot track | Feature(s) Steve | Priorité | Écran(s) cible | Estim. (ordre de grandeur) | item id |
|---|---|---|---|---|---|
| **CS-L1** | S-1 score de potentiel par lot (couche coloriée) | P0 | Opportunités (+Évaluation) | **M** (couche MapLibre data-driven + fonction de score par lot + style JSON testable) | `01KTW1NC9NRQQ5G05YB5E2MH8M` |
| **CS-L2** | S-2 fiche lot complète | P0 | Évaluation | **M** (panneau + mapping rôle/zone/grille + responsive) | `01KTW1NZ55V6FTN3ACJSKQQNQ7` |
| **CS-L3** | S-3 marques d'équipe + notes + filtres/compteurs | P0 | Opportunités (+Évaluation) | **M** (entité `ProspectMark` + journal append-only + filtres/compteurs ; **dépend de CS-P3 pour le réel multi-users**) | `01KTW1NZ8FEWYQ1T4CCNR479FK` |
| **CS-L4** | S-4 export CSV lettres + sélection | P0 | Opportunités | **S** (sérialisation CSV + BOM UTF-8 ; colonne code postal blanche tant que S-13 absent) | `01KTW1NZBY7F1SC7A6A4NQAEAS` |
| **CS-L5** | S-5 filtres combinés potentiel×usage×superficie | P0 | Opportunités (+Évaluation) | **S-M** (filtres purs sur champs déjà chargés + état d'URL §7) | `01KTW1NZJ06D73BQZP14GX8PE7` |
| **CS-L6** | §6 maquette substrat Netlify (4 villes, simulation) | P0-socle | transverse (fixtures) | **M-L** (loader fixture + mapping §6.2 + validation Zod + fixtures S3 ; ~27 k lots) | `01KTW1PP40D39CQ3VSFNNNKMM1` |
| **CS-P1** | S-6→S-10 (pastilles=Signaux, couches env, recherche, batch, labels) | P1 | Signaux/Opportunités/Évaluation + couches | **L** (à éclater ; S-7 couches WMS + S-6 Signaux auto = gros) | `01KTW1PP80NN8AYY9NDYRJ7NTN` |
| **CS-P2** | S-12→S-17 (annonces, code postal, éditeur zonage, mobile, dashboard) | P2 | Opportunités/Évaluation/Sources | **L** (à éclater ; S-14 éditeur zonage = gros) | `01KTW1PPBEW81X8HTZZ4NS7VKZ` |
| **CS-P2-S13** | S-13 lookup code postal (A7 + geocoder.ca, cache) | P2 | Évaluation (alimente export S-4) | **S-M** (lookup + cache + regex ; **non-bloquant** pour CS-L4) | `01KTW67FQGE1AZ9J841Z0FH2FB` |
| **CS-P3** | **S-11** sync temps réel multi-users **+ AUTH** + export/import JSON | P1 (**infra**) | transverse | **L** (backend + auth + persistance S3-first ; multi-semaines — **sorti de CS-P1**) | `01KTW674GHVBQ2J843QP0BERGP` |

> **Légende estim.** : **S** ≈ jours · **M** ≈ ~1 semaine · **L** ≈ plusieurs semaines (à éclater
> en lots fins à l'attaque). Ordres de grandeur indicatifs (les chapeaux P1/P2 seront re-estimés à
> l'éclatement).

### 9.2 Amendements track de la revue Fable5 (appliqués)

- **S-11 sorti de CS-P1 → nouvel item infra `CS-P3`** (`01KTW674GHVBQ2J843QP0BERGP`) : le « sync
  temps réel multi-utilisateurs + **AUTH** + export/import JSON » est de l'**infrastructure**
  (backend + auth + persistance S3-first, `SPEC_PERSISTENCE_S3_FIRST.md`), **pas une feature
  carto**. Le mêler aux différenciateurs carto P1 (CS-P1 : pastilles, couches env, recherche,
  batch, labels) brouillait la charge. CS-P1 ne couvre donc plus que **S-6→S-10** ; **S-11 = CS-P3**.
  C'est un **prérequis transverse** de tout marquage **réel** multi-utilisateurs (CS-L3 en
  `mode:"real"` en dépend).
- **S-13 sorti du chapeau CS-P2 → item distinct `CS-P2-S13`** (`01KTW67FQGE1AZ9J841Z0FH2FB`,
  enfant de CS-P2) : pour porter la relation **non-bloquante** CS-L4 ⟂ code postal à la bonne
  maille (cf. §9.1 ; le blocker `linked-done` erroné CS-L4←CS-P2 est superséde).
- **Estimations CS-L1..CS-L6 + chapeaux** : ajoutées en colonne ci-dessus (ordre de grandeur).

Référence amont : `SPEC_REORIENTATION_GRAND_FILET.md` (WP A.1 vues, A.2 data) et la présente spec.
