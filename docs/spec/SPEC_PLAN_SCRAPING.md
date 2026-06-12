# SPEC_PLAN — Plan de scraping `radar-immobilier`

> **Statut**: PLAN d'exécution, destiné à être délégué à un agent codex.
> **Rédigé le**: 2026-06-06.
> **Périmètre**: analyse en lecture seule du dépôt + rédaction de ce seul document.
> **Ville pilote**: Salaberry-de-Valleyfield (code géographique MAMH `70052`).
> **Inputs lus**: `docs/spec/input/PROMPT.md`, `docs/spec/input/PROMPT_RESULT_GPT5.5.md`,
> `SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md`, `SPEC_EVOL_SOURCE_VALUE_REVIEW.md`,
> `SPEC_INTENT_SOURCE_VALUE_REVIEW.md`, `SPEC_EVOL_SOURCE_FEASIBILITY.md`,
> `SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md`,
> `packages/radar-domain/src/{valleyfield-dossiers.ts,source-kind.ts}`,
> `packages/radar-sources/src/sources/**`,
> `api/src/services/automation/avis-publics-valleyfield.ts`,
> `docker-compose.{yml,dev.yml}`, `rules/{MASTER,sources}.md`, `AGENTS.md`.

---

## 0. Cadre, règles cardinales et constat de l'existant

### 0.1 Règles non négociables (héritées `rules/MASTER.md` §Scraping Policy + VISION/PROCESS)

- **Anti-invention**: chaque donnée porte `source (lien exact) + date + mode
  d'obtention + confiance + vérification (fait | hypothese | non-disponible)`.
  Une valeur non obtenue = `"non-disponible"` explicite. Jamais d'invention.
- **Respect `robots.txt`**, avec déviation documentée dans le README de l'adaptateur
  si explicitement requis.
- **Rate-limit**: 1 requête / 2 s par source par défaut (jitter +/- 300 ms),
  plus conservateur pour les petits sites municipaux. Backoff exponentiel sur
  HTTP 429/503, max 5 retries, budget 5 min.
- **User-agent honnête**: `radar-immobilier/<version> (+contact@...)`. L'anti-detect
  d'obscura sert la fiabilité du rendu, **pas la dissimulation**.
- **Obscura n'est pas un outil de contournement** de paywall, CAPTCHA, ToS ou
  restriction de compte (cf. `SPEC_INTENT_SOURCE_VALUE_REVIEW.md` §5). Il sert au
  rendu, à la stabilité et à la capture de pages publiques.
- **Stockage brut AVANT extraction**, jamais l'inverse. Clé S3:
  `raw/<source-kind>/<city>/<YYYY>/<MM>/<DD>/<sha256>.<ext>`. La ré-extraction est
  bon marché (LLM), le re-fetch est cher et impoli.
- **Provenance de bout en bout** (cohérent avec le mode réel vs simulation existant).
- **Outils**: tout via `make` (jamais `npm`/`node`/`docker` direct), `ENV=<env>`
  en dernier argument, tests jamais sur `ENV=dev`.

### 0.2 Constat de l'existant (réel-vs-hypothèse au niveau code)

- **RÉEL**: un seul adaptateur de production existe et fonctionne:
  `api/src/services/automation/avis-publics-valleyfield.ts` (HTML Craft CMS →
  ancres `icon-block--is-link` → PDF), avec parsing pur testé sur fixture,
  inférence de type d'avis, extraction de numéros de règlement, échecs typés.
  C'est le **patron de référence** pour tous les autres connecteurs HTTP/HTML.
- **RÉEL**: 34 notes de spike sous `packages/radar-sources/src/sources/_spikes/**`
  + 4 notes d'investigation Valleyfield consolidées
  (`role-cadastre-valleyfield.md`, `signal-marche-contexte-valleyfield.md`,
  `contraintes-geo-valleyfield.md`, `youtube-conseil-valleyfield.md`).
- **RÉEL**: 3 dossiers d'opportunité peuplés avec données réelles
  (`valleyfield-dossiers.ts`): H-609-4, U-521→H-521, H-143/H-143-1.
- **HYPOTHÈSE / À CONSTRUIRE**: l'interface `SourceAdapter` décrite dans
  `rules/sources.md` (`packages/radar-sources/src/SourceAdapter.ts`) **n'existe pas
  encore**. `packages/radar-sources/src/` ne contient que le dossier `sources/`
  (spikes). Le contrat d'adaptateur est donc à créer dans le cadre de ce plan.
- **CONFIRMÉ + FLAG**: **une seule ville** est modélisée à ce jour
  (Salaberry-de-Valleyfield, `70052`). La MRC Beauharnois-Salaberry est référencée
  comme couche régionale (schéma d'aménagement, avis MRC), pas comme ville pilote.
  Aucune autre ville n'a de dossier, d'adaptateur ou de fixture. **Le plan est donc
  templé pour N villes** (voir §3).

### 0.3 Portails identifiés comme login-gated ou bloqués (réel)

- **PG Municipal « Accès aux citoyens »** (rôle d'évaluation en ligne de la Ville):
  bloqué techniquement depuis l'environnement d'investigation
  (`PROMPT_RESULT_GPT5.5.md` Phase 3). Contournable par l'open-data MAMH (XML 70052).
- **Registre foncier du Québec** (SIRF): public **payant** (1,50 $/document),
  pas d'API bulk. → `manual-check`, pas d'automatisation navigateur recommandée.
- **Cadastre / Infolot** (carte interactive): consultation gratuite, extraits
  vectoriels **payants**. Ne pas scraper la carte live; utiliser les extraits officiels.
- **YouTube conseil municipal**: API bloquée (cookie requis), transcriptions non
  obtenues au 1er passage. → Tier B partiel.
- **Centris/MLS, JLR**: partenaire/payant. **Ne pas scraper** les annonces publiques;
  flux formel requis.

---

## 1. Inventaire des sources — ville pilote (Valleyfield)

Total: **34 familles de sources** spikées (`SPEC_EVOL_SOURCE_FEASIBILITY.md` §3) +
1 connecteur réel livré (avis-publics). Réparties en 3 tiers d'accessibilité
(`SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md` §5).

### Décompte par tier

| Tier | Définition | Décompte | Recommandation dominante |
| ---- | ---------- | -------- | ------------------------ |
| **A** — investigué pour de vrai (auto. forte, public/gratuit) | Données Québec (CKAN), rôle open-data, cadastre allégé, avis publics, BDZI, GRHQ, CPTAQ, permis, Adresses Québec, StatCan | ~10 familles | `build-now` |
| **B** — tenté (scraping/OCR/LLM, plus dur) | zonage municipal + grilles PDF, PV conseils, schémas MRC, YouTube transcription | ~12 familles | `build-later` |
| **C** — documenté comme manque (payant/restreint, non bloquant) | registre foncier, JLR, Centris/MLS, transactions parcellaires, Infolot extraits payants | ~5 familles | `manual-check` / `partner-required` / `drop-for-phase-1` |

> Note: certaines familles sont « mixtes » (open-data + payant), classées au tier
> de leur **chemin de production retenu** (ex. cadastre allégé open-data = A; Infolot
> extraits payants = C).

### 1.A Tier A — public/gratuit, automatisation forte (`build-now`)

| # | Source (id spike) | URL / identifiants | CIBLAGE (scope, clés) | RECUEIL (méthode) | EXPLOITATION (entités) | Login? | Cadence cible | Faisabilité & risque | Réel-vs-hypothèse |
|---|---|---|---|---|---|---|---|---|---|
| A1 | `avis-publics-valleyfield` | `ville.valleyfield.qc.ca/avis-publics` ; PDF sur `dua3m7xvptjbw.cloudfront.net` | Avis par ville ; clés: n° règlement (150-49…), type (dérogation/PPCMOI/consultation/référendaire/entrée-vigueur), date, zone | HTTP + parse HTML (ancres `icon-block--is-link`) → download PDF | DesignationEvent (signal réglementaire), Zone (code/usage/densité via règl.), Signal | Non | quotidien (cron 1×/j) | Faible risque; petit site, rate-limit conservateur; PDF lourds à OCR | **RÉEL** (connecteur livré + testé) |
| A2 | `reglements-urbanisme-valleyfield` | section règlements d'urbanisme + PDF codifiés (Règl. 150 + 150-44/-47/-48/-49/-49-1/-49-2/-50/-51) | Texte normatif par n° règlement ; grilles d'usage/densité/hauteur/marges ; zones contiguës | HTTP HTML + download PDF → OCR/LLM extraction | Zone (attributs), DesignationEvent (création/scission/renommage), Valuation (n/a) | Non | hebdo + sur événement avis | OCR de grilles complexes; LLM pour normaliser; rate-limit | **RÉEL partiel** (PDF récupérés dans dossiers; parsing géométrique non fait) |
| A3 | `ppcmoi-valleyfield` | section urbanisme/PPCMOI + avis | PPCMOI actifs (n° dossier 2025-0059, 2026-0061…), adresse, secteur | HTTP HTML + PDF | DesignationEvent (signal projet ponctuel), Signal | Non | hebdo | Faible risque; enrichit l'avis | **RÉEL partiel** (liste dans `PROMPT_RESULT_GPT5.5.md`) |
| A4 | `donnees-quebec-catalog` | `donneesquebec.ca` CKAN API | Résolveur de ressources partagé (datasets par mot-clé/organisation) | REST CKAN JSON | (infra) alimente A5/A6/A8/A9… | Non | mensuel (refresh catalogue) | Très faible risque; brique transverse | **RÉEL** (API stable) |
| A5 | `roles-evaluation-fonciere-mamh` | `donneesouvertes.affmunqc.net/role/RL70052_2026.xml` ; index `indexRole2026.csv` ; `ROLE2026_GEOPACKAGE.zip` | Rôle par municipalité (70052) ; champs `RL0101Gx` (rue), `NO_LOT`, matricule, superficie, usage, valeurs terrain/bât/total | Download XML/CSV/GPKG (streaming, 27 Mo) → parse XSD MAMH | Lot (identité, superficie, usage), Valuation (valeur année), Zone (résolution indirecte) | Non | annuel (dépôt) + trimestriel (MàJ) | Volumineux (streaming); XML codé → dictionnaire/XSD MAMH requis; caviardage/privacy | **RÉEL** (15 lots extraits, vérifiés) |
| A6 | `cadastre-allege` (cadastre allégé QC) | `geo.environnement.gouv.qc.ca/.../Cadastre_allege/MapServer/0` | Géométrie + `NO_LOT` par lot ; clé commune cadastre↔registre | REST ESRI (query, EPSG:3857) | Lot (géométrie), résout Lot↔Zone (intersection) | Non | bimestriel (MàJ ~2 mois) | Faible risque; REST stable; pas de polygones de **zone** (manque) | **RÉEL** (15/15 lots présents HTTP 200) |
| A7 | `adresses-quebec-igo-geocoder` | GeocodeServer IGO Adresses Québec | Normalisation adresse → lat/lon ; clé rue↔secteur | REST GeocodeServer | Lot/Zone (géocodage, normalisation), Signal | Non | à la demande (enrichissement) | Faible risque; utilitaire immédiat | **HYPOTHÈSE** (spiké, non câblé) |
| A8 | `cptaq-zone-agricole` | services géo CPTAQ SHP/WMS | Intersection lot/zone ↔ zone agricole LPTA (A-118, A-912, A-939…) | WMS/SHP → intersection géospatiale | Constraint (filtre dur), Signal (dé-risque) | Non | trimestriel | Filtre spatial cœur; mises en garde légales LPTA | **RÉEL partiel** (adjacences observées, intersection exacte = hypothèse) |
| A9 | `bdzi-flood-zones` | `servicesgeo.enviroweb.gouv.qc.ca/.../MapServer/22/query` | Intersection lot/zone ↔ zone inondable | REST/WMS query (bbox) | Constraint (risque) | Non | trimestriel | REST d'abord; bulk volumineux; ZIS hors BDZI possibles | **RÉEL** (0 polygone dans bbox, high conf.) |
| A10 | `grhq-hydrography` | `servicesgeo.enviroweb.gouv.qc.ca/.../MapServer/{101,104}/query` | Hydrographie ; bandes riveraines PPRLPI 10-15 m | REST/WMS query (bbox) | Constraint (environnement) | Non | trimestriel | Interprétation locale des marges; volumineux à Grande-Île | **RÉEL** (512 éléments Grande-Île, fait) |
| A11 | `statcan-census-profile-2021` | `www12.statcan.gc.ca` ; DGUID `2021A00052470052` | Profil socio-démo ville | SDMX/CSV (API WDS) | Context (contexte stratégique) | Non | annuel/recensement | Pages directes en 404 (mai 2026) → privilégier l'API WDS/SDMX, pas le scraping HTML | **RÉEL partiel** (valeurs via index Google; API non câblée) |
| A12 | `infc-hicc-projects` | données fédérales projets HICC | Investissements publics par municipalité | CSV/JSON/XLSX | Context | Non | annuel | Normalisation des noms de municipalités | **HYPOTHÈSE** (spiké) |

### 1.B Tier B — scraping/OCR/LLM, plus dur (`build-later`)

| # | Source (id spike) | URL / identifiants | CIBLAGE | RECUEIL | EXPLOITATION | Login? | Cadence | Faisabilité & risque | Réel-vs-hypothèse |
|---|---|---|---|---|---|---|---|---|---|
| B1 | `seances-conseil-valleyfield` | ordres du jour + PV conseil | Timeline décisions, lien règl.↔séance↔date | HTTP HTML + PDF | DesignationEvent (datation officielle), Signal | Non | hebdo | OCR PV; liaison agenda/PV | RÉEL partiel |
| B2 | `zonage-plans-grilles-valleyfield` | plans de zonage feuillets 1-3 + grilles PDF | **Polygones de zone** (le manque majeur), grilles densité/hauteur | PDF maps + tables → extraction + géoréférencement | Zone (géométrie + attributs) — clé pour Lot↔Zone exact | Non | sur amendement | Extraction carte/table + géoréf = effort 6-9 md; pas de vecteur open-data | RÉEL partiel (PDF dispo, non parsés) |
| B3 | `videos-youtube-conseil-valleyfield` | `youtube.com/@VilleValleyfield` | Mentions densité/hauteur/zonage/intentions par séance | captions sinon `yt-dlp` + Whisper (via obscura/conteneur) | Signal (intentions Phase 1), Context (Phase 5) | **Oui (cookie API)** | mensuel | Transcriptions non obtenues; cookie API; coût Whisper → Tier B partiel | RÉEL partiel (bloqueur documenté) |
| B4 | `permis-construction-valleyfield` | pages portail permis | Validation marché (volume permis) | HTTP/portail | Signal (marché) | possible | n/a Phase 1 | Pas de flux énumérable public observé → `drop-for-phase-1` | RÉEL (drop) |
| B5 | `schema-amenagement-mrcbhs` | schéma d'aménagement MRC BHS (gros PDF) | Cadre planification long terme | HTTP + gros PDF | Context | Non | trimestriel | Contexte, pas alerte | RÉEL partiel |
| B6 | `avis-reglements-mrcbhs` | avis/règlements MRC | Signal réglementaire régional | HTTP + PDF | DesignationEvent (régional), Signal | Non | hebdo | À ajouter après avis ville | RÉEL partiel |
| B7 | `seances-conseil-maires-mrcbhs` | PV conseil des maires MRC | Contexte régional | HTTP + PDF | Context | Non | mensuel | Densité de signal moindre | RÉEL partiel |
| B8 | `zonage-municipal-open-data` | datasets GIS génériques | Zonage vectoriel quand publié | mixte GIS/API | Zone | Non | mensuel | Pas de dataset Valleyfield trouvé → support générique | RÉEL (manque) |
| B9 | `construction-permits-open-data` | datasets permis (autres villes) | Traction marché | tabulaire/GIS | Signal (marché) | Non | mensuel | Utile autres villes; pas de flux Valleyfield | RÉEL (manque) |
| B10 | `cptaq-decisions` | décisions CPTAQ SHP/WMS/DBF | Dé-risque (autorisations accordées) | WMS/SHP | Constraint (déblocage), Signal | Non | trimestriel | Après filtre zone agricole | HYPOTHÈSE |
| B11 | `orthophotos-imagery` | `imagerie-telechargement.portailcartographique.gouv.qc.ca` | Validation visuelle (vacant/sous-utilisé) | WMS/WFS imagery | Context (preuve visuelle) | Non | annuel | Index/preview d'abord; CV différée | HYPOTHÈSE |
| B12 | `mtmd-travaux-routiers` / `mtmd-reseau-routier-rtss` / `exo-gtfs` / `salaberry-info-travaux-projets` / `statcan-wds` | divers WFS/GTFS/HTML/CSV | Proximité axes, transport, travaux | WFS/GTFS/HTTP/CSV | Context | Non | mensuel/trimestriel | Couches de contexte, pas alertes | HYPOTHÈSE/spiké |

### 1.C Tier C — payant/restreint, non bloquant (manque documenté)

| # | Source (id spike) | URL / identifiants | CIBLAGE | RECUEIL | EXPLOITATION | Login/accès? | Traitement | Risque |
|---|---|---|---|---|---|---|---|---|
| C1 | `registre-foncier-qc` | `registrefoncier.gouv.qc.ca/Sirf/` | Propriété, actes, hypothèques par lot | web/PDF payant (1,50 $/doc) | Valuation/Context (due diligence) | **Compte + paiement** | `manual-check` — preuve manuelle démo uniquement | Automatisation paiement fragile; données légales/perso |
| C2 | `jlr` | flux commercial JLR | Transactions notariées, propriété | feed/export sous contrat | Valuation (marché), Context | **Partenaire/payant** | `partner-required` — meilleur candidat enrichissement payant | ToS réutilisation; coût |
| C3 | `centris-mls` | pages stats Centris/MLS | Annonces, prix médians | flux MLS formel | Valuation (marché) | **Partenaire/payant** | `partner-required` — **ne pas scraper** les annonces publiques | ToS strict; anti-bot |
| C4 | `transactions-immobilieres` | agrégats publics + parcellaire payant | Valeur marché | HTML/feed | Valuation (marché) | mixte | agrégat public OK; parcellaire = provider | Accès provider requis pour le fin |
| C5 | `cadastre-infolot` (extraits payants) | `appli.foncier.gouv.qc.ca/Infolot/` | Géométrie de lot fine | extraits officiels payants | Lot (géométrie) | Consultation libre / extraits payants | `build-later` via extraits officiels; **ne pas scraper la carte live** | ToS carte live |

---

## 2. Généralisation multi-villes (architecture templée N villes)

### 2.1 Constat

Une seule ville modélisée à ce jour: **Salaberry-de-Valleyfield (70052)**. La MRC
Beauharnois-Salaberry est une couche **régionale** (pas une ville pilote). Le plan est
**templé pour N villes**. **Cibles prioritaires ajoutées (§2.4)** : les 4 villes de
contrôle de parité Steve (`delson`, `sainte-catherine`, `saint-constant`, `candiac`)
passent **en tête** en scrape profond (aucune n'a encore de dossier/adaptateur/fixture
— à instancier via `CityProfile`).

### 2.2 Typologie des sources pour la généralisation

- **Sources provinciales/fédérales paramétrées par code géo** (réutilisables telles
  quelles pour toute ville QC, change juste le code/DGUID/bbox): A5 rôle (par code
  MAMH), A6 cadastre allégé, A7 Adresses Québec, A8 CPTAQ, A9 BDZI, A10 GRHQ,
  A11 StatCan (DGUID), A12 INFC, A4 Données Québec. → **généralisation gratuite**.
- **Sources municipales spécifiques** (un adaptateur par CMS/ville): A1 avis publics,
  A2 règlements, A3 PPCMOI, B1 PV, B2 plans/grilles, B3 YouTube. → **un connecteur
  par ville ou par moteur de CMS**. Valleyfield = Craft CMS (sélecteurs
  `icon-block--is-link`). Stratégie: identifier le **CMS/fournisseur** (Craft, PG
  Solutions, B2B portails, etc.) et factoriser un adaptateur par moteur, paramétré
  par URL de base + sélecteurs.
- **Sources régionales** (par MRC): B5/B6/B7.

### 2.3 Contrat d'enregistrement de ville

Introduire un registre `CityProfile` (multi-villes) portant, par ville:
`{ slug, nomOfficiel, codeMamh, dguidStatcan, mrcSlug, bbox, cms: {moteur, baseUrl,
selecteurs}, sources: SourceBinding[] }`. Chaque `SourceBinding` lie une
`SourceKind` à ses paramètres (URL, code géo, cadence). Valleyfield est la première
entrée; ajouter une ville = ajouter une entrée + (si CMS inédit) un adaptateur de
moteur. Aucune logique ville en dur ailleurs.

### 2.4 Priorité de villes — points de contrôle « parité Steve » en TÊTE et en PROFONDEUR

> Amendement (2026-06-11) découlant de la décision produit tranchée en
> `SPEC_EVOL_INTEGRATION_CARTE_STEVE.md` §6.2 et spécifiée dans
> [`SPEC_CONTROLE_PARITE_VILLES_STEVE.md`](SPEC_CONTROLE_PARITE_VILLES_STEVE.md).

Jusqu'ici le plan ne portait **aucune** notion de priorité **par ville** ni de « profondeur » de
collecte (priorisation par **source** au §5, ville unique Valleyfield §2.1). On l'introduit : les
**4 villes de Steve** (`delson`, `sainte-catherine`, `saint-constant`, `candiac` — toutes
Roussillon / CMM) deviennent des **points de contrôle de parité** et passent **en tête** du backlog,
en **scrape profond** (toutes les sources : rôle, cadastre, zonage/PV, zones, TOD), **avant**
Valleyfield et le grand filet. **Objectif explicite : reproduire la donnée de référence de Steve et
mesurer la parité** (couverture + flags + delta de score —
[`SPEC_CONTROLE_PARITE_VILLES_STEVE.md`](SPEC_CONTROLE_PARITE_VILLES_STEVE.md) §4).

**Où marquer « contrôle-parité / deep » (config) — deux annotations ajoutées au `CityProfile`
(§2.3)** :

- **`controlParity: boolean`** — la ville est un point de contrôle (un `ControlLot`/`ControlMark`
  importé de Steve existe ; son **rapport de parité** est calculé). `true` pour les 4 villes de
  Steve, `false` (défaut) ailleurs.
- **`scrapeDepth: "deep" | "shallow"`** — `"deep"` = **toutes** les `SourceBinding` de la ville sont
  attaquées (rôle A5, cadastre A6, zonage A2/B2, zones, TOD A13) ; `"shallow"` (défaut) = veille de
  signaux seule (PV/avis A1, pour le grand filet). Les 4 villes de Steve = `"deep"`.

Soit, par ville de contrôle :
`{ …, controlParity: true, scrapeDepth: "deep", sources: [A5, A6, A2, B2, A13, A1/PV, …] }`.

**Ordre** : les 4 villes `controlParity:true` sont **en tête** du backlog §5 tant que leur parité
n'est pas atteinte (priorité de scrape, pas de logique métier en dur — toujours via `CityProfile`).
**Codes MAMH** : la rétrodoc Steve ne les fournit pas ; ils sont **à résoudre** au remplissage de
`codeMamh` (anti-invention — on ne les fabrique pas ;
`SPEC_CONTROLE_PARITE_VILLES_STEVE.md` §1). **Sources templées** : les bindings municipaux
(`*-valleyfield`) sont instanciés par ville via `CityProfile.sources` (§2.1/§2.3) ; le **gap polygone
de zone** (§6) reste le manque structurant, avec fallback éditeur manuel (S-14 de l'intégration
carte). La source **TOD A13 `aires-tod-pmad-cmm`** (à ajouter au §1.A, cf.
`SPEC_EVOL_INTEGRATION_CARTE_STEVE.md` §4.0) couvre les 4 villes (toutes CMM).

---

## 3. Architecture trois étages — séparée et pilotable par l'UI

Les trois étages sont **physiquement séparés** (jobs, tables, statuts distincts) afin
d'être pilotés indépendamment depuis l'UI. Alignés sur
`SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md` §6 et `rules/sources.md`.

### 3.1 Étage 1 — CIBLAGE (« quoi collecter »)

- **But**: définir le périmètre de collecte sans rien fetcher.
- **Entrées UI**: sélection ville (`CityProfile`), zones/règlements d'intérêt,
  sous-ensemble de `SourceKind`, scope géographique (bbox/secteur), cadence.
- **Sortie (contrat)**: `CiblagePlan { id, citySlug, scope: {zones[], bylaws[],
  bbox}, sources: SourceBinding[], cadence, createdBy, createdAt }`.
- **Persistance**: table `ciblage_plan` (jsonb config). Pas d'I/O réseau ici.
- **Statuts**: `draft → active → archived`.

### 3.2 Étage 2 — RECUEIL (« collecte brute »)

- **But**: fetcher + stocker le brut + provenance, **sans normaliser**.
- **Contrat d'adaptateur** (à créer, conforme `rules/sources.md`):
  `SourceAdapter { kind, city?, version, list(opts): AsyncIterable<RawDocumentRef>,
  fetch(ref): Promise<RawDocument>, hash(raw): string }`. Stateless, idempotent.
- **Obscura**: pour pages JS-rendues / capture HTML+screenshot, via Playwright sur
  le sidecar (`http://obscura:9222`, `OBSCURA_CDP_URL`). `stealth: false` par défaut.
- **Sortie (contrat)**: `RawDocument { id, sourceKind, citySlug, url, fetchedAt,
  sha256, contentType, s3Key, provenance: {ciblagePlanId, adapterVersion, userAgent,
  obscura: bool}, httpStatus }`. Brut stocké S3 (`raw/<kind>/<city>/<Y>/<M>/<D>/<sha>.<ext>`)
  **avant** toute extraction.
- **Persistance**: table `raw_document` (métadonnées) + S3 (payload).
- **Statuts de job**: `queued → fetching → stored → failed(error typé:
  timeout|network|http|parse)`. Échecs typés jamais lancés (patron avis-publics).

### 3.3 Étage 3 — EXPLOITATION (« normalisation »)

- **But**: brut → entités du modèle, avec confiance/vérification, sans re-fetch.
- **Entrée**: `RawDocument` (par `s3Key`). La ré-extraction relit S3, ne refetch jamais.
- **Sortie (contrat)**: entités du modèle cible
  (`SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md`):
  - `Zone { idInterne, codeAffiche, type, densite, reglementSource, geometrie?,
    validFrom, validTo, supersedes?, supersededBy? }`
  - `Lot { noCadastral, geometrie?, superficie, zoneResolue@date, filiation[] }`
  - `DesignationEvent { cible(zone|lot), type(création|scission|renommage|changement
    densité/usage), reglement, validFrom, rawRef }` (temps de validité + de connaissance)
  - `Valuation { portee(lot|zone), valeur, annee, source, confiance }`
  - `Signal` (rezonage = DesignationEvent de changement densité/usage)
  - Chaque entité porte `EvidenceItem { phase, sourceId, url, date, obtentionMode,
    confidence, value, verification }` (déjà en place dans `valleyfield-dossiers.ts`).
- **Persistance**: tables normalisées (PostGIS) + lien `rawRef` vers `raw_document`.
- **Statuts**: `pending → extracted → verified | needs-review | non-disponible`.

### 3.4 Contrats inter-étages (résumé paragraphe)

Le **Ciblage** produit un `CiblagePlan` (ville + scope zones/règl./bbox + liste de
`SourceBinding` + cadence) que l'UI crée/édite/active sans aucune I/O réseau; le
**Recueil** consomme ce plan, lance par binding des jobs d'adaptateur idempotents qui
écrivent d'abord le payload brut en S3 puis un `RawDocument` (sha256, url, fetchedAt,
provenance incluant `ciblagePlanId`, version d'adaptateur, user-agent et flag obscura)
et n'expose que des erreurs typées (timeout|network|http|parse); l'**Exploitation**
relit chaque `RawDocument` par sa clé S3 (jamais de re-fetch), en dérive les entités
Zone/Lot/DesignationEvent/Valuation/Signal bitemporelles avec `rawRef` + EvidenceItem
(source, date, mode, confiance, vérification fait|hypothese|non-disponible), et
l'UI pilote les trois via des contrôles dédiés (Ciblage: sélecteurs ville/zone/source/
cadence; Recueil: bouton lancer + table de jobs avec statut queued/fetching/stored/
failed; Exploitation: file de revue pending/extracted/verified/needs-review et bouton
ré-extraire).

### 3.5 Pilotage UI par étage

| Étage | Contrôles UI | Statuts visibles | Action manuelle |
|---|---|---|---|
| Ciblage | sélecteur ville, zones, règlements, sources, bbox, cadence | draft/active/archived | créer/éditer/activer un plan |
| Recueil | bouton « lancer la collecte », filtres source/ville, table de jobs | queued/fetching/stored/failed(type) | relancer un job échoué, voir le raw S3 |
| Exploitation | file de revue, diff brut↔normalisé, sélecteur confiance | pending/extracted/verified/needs-review/non-disponible | valider/corriger/ré-extraire, marquer non-disponible |

---

## 4. Procédure login + obscura + maildev (générique, réutilisable)

> **Mise en garde légale (à rappeler dans le code et le README)**: cette procédure
> est réservée à la création de comptes sur des services qui **autorisent**
> l'inscription par email et dont les ToS **permettent** l'accès automatisé public.
> Elle **n'est pas** un moyen de contourner paywalls, CAPTCHA, ou restrictions
> (registre foncier, Centris, JLR sont explicitement **hors** de ce chemin —
> `manual-check`/`partner-required`). Obscura sert au rendu/stabilité, pas à la
> dissimulation. Vérifier `robots.txt` + ToS avant tout.

### 4.1 Infrastructure disponible (réel, docker-compose)

- **obscura**: navigateur headless Rust, CDP sur `http://obscura:9222`
  (`OBSCURA_CDP_URL` côté API; hôte dev `9222`). Healthcheck `/json/version`.
  Piloté via Playwright (`connectOverCDP`).
- **maildev**: email jetable. SMTP `maildev:1025`, UI web `:1080` (hôte dev `1080`).
  `MAILDEV_SMTP_HOST/PORT` côté API. API HTTP de maildev pour lire/filtrer les mails
  reçus (récupération de lien de confirmation/OTP).

### 4.2 Procédure pas-à-pas (cible: automatisable)

1. **Générer une adresse jetable** unique: `radar+<source>-<timestamp>@maildev.local`
   (boîte interceptée par maildev). Documenter le mapping adresse↔source.
2. **Ouvrir une session obscura** via Playwright (`connectOverCDP(OBSCURA_CDP_URL)`),
   nouveau contexte isolé (cookies par source/compte), `stealth: false` sauf besoin
   de fiabilité documenté.
3. **Naviguer** vers la page d'inscription du service (après contrôle robots/ToS).
4. **Remplir et soumettre** le formulaire (email maildev + mot de passe généré stocké
   en secret, jamais commité).
5. **Récupérer le mail de confirmation** via l'API maildev (`GET` boîte, filtrer par
   destinataire, extraire le lien/OTP par regex).
6. **Confirmer**: ouvrir le lien dans la même session obscura (ou poster l'OTP).
7. **Capturer et persister la session**: cookies + `storageState` Playwright →
   secret chiffré (clé par source/ville). Stocker `createdAt`, `expiresAt` si connu.
8. **Rafraîchir**: avant chaque collecte, vérifier la validité (requête légère
   authentifiée); si expirée → re-login (étapes 2-7) ou refresh-token si disponible.
9. **Documenter** dans le README de l'adaptateur: service, base légale (ToS autorise),
   robots, cadence, et le fait que le compte est jetable.
10. **Cible d'automatisation**: encapsuler 1-8 dans un job `account-bootstrap` +
    `session-refresh` réutilisable, paramétré par `SourceBinding`. Idempotent
    (réutilise la session valide existante avant d'en créer une).

### 4.3 Données concernées par ce chemin

Aucune source **Tier A/B Valleyfield n'exige de login** (toutes publiques sans compte).
Le chemin login est donc une **brique générique pour des sources futures** (autres
villes, portails municipaux à compte) et pour des sources tier C **uniquement si**
un accès partenaire légitime est obtenu (jamais pour contourner un paywall). À ce
stade: procédure documentée, non câblée sur une source précise — flag honnête.

---

## 5. Backlog d'implémentation priorisé (valeur × faisabilité)

Ordre dérivé de `SPEC_EVOL_SOURCE_FEASIBILITY.md` §6 (séquence Phase 1) + valeur
quadrant `SPEC_EVOL_SOURCE_VALUE_REVIEW.md`. Le brut avant tout, puis l'enrichissement.

### Top 5 sources prioritaires

1. **`avis-publics-valleyfield` (A1)** — `build-now`, déjà réel. **Action**: le promouvoir
   dans l'étage Recueil sous le contrat `SourceAdapter`, brancher le stockage raw S3 +
   `RawDocument`. Point de départ du slice (signal réglementaire direct).
2. **`reglements-urbanisme-valleyfield` (A2)** — `build-now`. Résout les références de
   règlement de l'avis (150-49…), alimente Zone + DesignationEvent. OCR/LLM des grilles.
3. **`roles-evaluation-fonciere-mamh` (A5)** — `build-now`. Ancrage foncier réel: Lot +
   Valuation par code 70052. XML streamé + dictionnaire MAMH. Enrichissement clé BR06/07.
4. **`donnees-quebec-catalog` (A4)** + **`adresses-quebec-igo-geocoder` (A7)** — `build-now`.
   Briques transverses: résolveur de ressources + géocodage/normalisation (servent toutes
   les autres sources géo et le multi-villes).
5. **`cptaq-zone-agricole` (A8)** — `build-now`. Filtre de contrainte dur (anti-faux-positif):
   intersection lot↔LPTA (A-118, A-912, A-939). Cœur du dé-risquage spatial.

### Séquence complète recommandée (Phase 1)

A1 → A2 → A3 → A4 → A7 → A5 → A8 → A11 → A12, puis A6/A9/A10 (couches géo de contrainte),
puis Tier B (`build-later`: B1 PV, B2 plans/grilles+géoréf, B6 MRC, B3 YouTube différé).
**Manuel/partenaire Phase 1**: C1 registre foncier (preuve manuelle), C2 JLR (si contrat),
C3 Centris (flux formel uniquement). **Drop Phase 1**: B4 permis ville, B9, certains contextes
macro trop grossiers.

### Jalons d'architecture (prérequis au backlog ci-dessus)

- **J0**: créer `packages/radar-sources/src/SourceAdapter.ts` (interface) + types
  `RawDocumentRef`/`RawDocument` (contrat Recueil). **Bloque tout le reste.**
- **J1**: tables `ciblage_plan` / `raw_document` + clés S3 + provenance.
- **J2**: `CityProfile` + `SourceBinding` (registre multi-villes, Valleyfield 1re entrée).
- **J3**: promouvoir A1 (avis-publics) hors `_spikes`/automation vers adaptateur conforme.
- **J4**: entités Exploitation (Zone/Lot/DesignationEvent/Valuation) — coordonné avec
  le chantier ÉV-DATA-MODEL (`SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md`, à brainstormer
  avant code).

---

## 6. Points ouverts / questions à trancher (réel-vs-hypothèse)

- Chemin exact du dictionnaire/XSD MAMH pour les champs du rôle (`SPEC_EVOL_SOURCE_FEASIBILITY.md` §7).
- **Polygones de zone** (Zone.geometrie): manque le plus structurant. Aucun vecteur
  open-data; à extraire des plans PDF (B2) ou à numériser depuis annexes. Bloque
  l'intersection Lot↔Zone exacte (aujourd'hui hypothèse par nom de rue).
- Coûts stockage S3 (PDF/GIS volumineux) une fois la cadence connue.
- Accord JLR/registre commercialement réaliste pour la phase proposition (à décider client).
- Disponibilité réelle des captions YouTube + coût Whisper (Tier B partiel).
- Le contrat `SourceAdapter` est à créer (n'existe pas) — prérequis dur (J0).
