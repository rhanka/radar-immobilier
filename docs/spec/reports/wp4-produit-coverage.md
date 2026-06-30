# WP4 — État des lieux PRODUIT (app radar client)

> Périmètre : **surface produit & couverture fonctionnelle** des 4 vues officielles
> et des 17 features Steve. **Distinct** des anomalies data/mapping (WP3) et de la
> data (WP1). Lecture seule Track. Baseline commit `f678149`.
> Établi le 2026-06-28 (lecture code + exécution tests unitaires UI).

---

## Partie 1 — Les 4 vues officielles

Câblage (`ui/src/App.svelte` + `ui/src/lib/router/router.ts`) — la nav principale (`TopNav`)
expose exactement 4 vues : `signaux`, `opportunity`, `evaluation`, `sources`. Les
deep-links `carte-opportunites` / `carte-evaluation` / `carte-signaux` sont **legacy**.

| Vue (nav) | Composant principal | État | Ce qu'elle montre réellement | Filtres / buckets | Dépendances data |
|---|---|---|---|---|---|
| **Signaux** | `ui/src/lib/components/maps/SignauxMapView.svelte` (+ `SignauxRail.svelte`, `SignauxSelPanel.svelte`) | **Fonctionnel** | Carte **MapLibre GL** : aplats choroplèthes des villes coloriés par nb d'opportunités / 6 mois ; clic ville → flyTo + rail/panneau liste des signaux (rezonage, PPCMOI, dérogation…) ; légende épinglée | **3 filtres type de signal** `z\|m\|p` cochés par défaut, **persistés URL + localStorage** (`FILTER_LS_KEY`) ; recherche **villes** dans le rail | `GET /api/signals/by-city`, graphify pipeline (PV → Signal). **Seule vue MapLibre**. |
| **Opportunités** | `ui/src/lib/components/opportunity/OpportunityFunnel.svelte` | **Partiel — données DÉMO** | Entonnoir PROCESS 6 phases + `DossierCard` avec score /100. **Pas la carte lots+zonage de Steve.** | Filtre par `signalId` (chip de contexte depuis « Approfondir ») | **`valleyfieldDossiers` statique** (`packages/radar-domain/src/valleyfield-dossiers.ts:973`), **PAS** l'API réelle. Le client réel `fetchOpportunites` (`/api/opportunites`) n'alimente que le **legacy** `OpportunitesMapView` (hors nav). |
| **Évaluation** | `ui/src/lib/components/maps/EvaluationMapView.svelte` (+ `LotFichePanel.svelte`, `MapLegend.svelte`) | **Partiel — fonctionnel mais non migré** | Drilldown ville → lots cadastraux rendus en **SVG** (`<polygon viewBox>`, **plafond `limit:200`**), coloriés par **score de potentiel** ; clic lot → fiche `LotFichePanel` ; section grille signaux par zone | Filtre source `mrnf`/`donnees-quebec` ; **buckets score** (`scoredLotCount`, `highPotentialLotCount`, `fallbackScoreCount`, `unavailableScoreCount`) ; **filtre par marque prospect** (`filteredPolygonFeatures`, `prospectCounterFor`) | `fetchLots` (`/api/geo/:city/lots`), `score-color-scale`, `lot-potential-visual`, `prospect-marks-client` (**lecture seule**). **Pas de MapLibre** (CS-L6 non fait). |
| **Sources** | `ui/src/lib/components/sources-map/SourcesMapView.svelte` (+ `CityDetailPanel.svelte`) | **Fonctionnel** | « Grand filet » : villes coloriées par **maturité de recueil** (% + couleur), distinction `hasZonage`, par-source `graphifié/scrappé/identifié/erreur`, panneau qualité données, clic ville → détail | Split `withZonage`/`withoutZonage`, légende maturité, résumé couverture | `GET /api/scrape-status`, `/api/signals/by-city`, `data-quality-client`. Dégradé proprement si vide (EmptyState honnête). |

**Note transverse importante** : la vue **Opportunités** de la nav est l'**entonnoir de dossiers
démo** (fixture `valleyfieldDossiers`), **pas** la carte lots/zonage/scoring attendue par Steve
(S-1). La carte lots scorée vit côté **Évaluation**. La carte Opportunités lots branchée API
réelle reste à faire (CS-L1/CS-L6). Pour juger « fonctionnel » bout-en-bout (API réelle multi-villes),
la stack est requise : `make demo` / `make up ENV=…` puis `localhost:5301`.

---

## Partie 2 — Couverture des 17 features Steve (S-1..S-17)

Source : `docs/spec/SPEC_EVOL_INTEGRATION_CARTE_STEVE.md` (détail §2 lignes 200-323, table §3
lignes 328-350, table items track §10 lignes 767-794). Statut Track lu via `track_query`
(baseline `f678149`).

| # | Feature Steve | Statut produit | Preuve (fichier / route) | Item Track (réalisation) |
|---|---|---|---|---|
| **S-1** | Carte lots+zonage+TOD, scoring visuel | **Partiel** | Scoring visuel **livré côté Évaluation** (`lot-potential-visual.ts`, `score-color-scale.ts`, lots SVG coloriés). **Mais** : pas de couche **TOD** (A13 non ingéré), pas de carte **Opportunités** lots (démo), pas de MapLibre | CS-L1 `01KTW1NC9NRQQ5G05YB5E2MH8M` **done (AWAITED)** ; CS-L1b `01KW5N4WEBT27JDFZ9VZ0MDD3Y` **in-progress** ; CS-L6 `01KTW1PP40D39CQ3VSFNNNKMM1` **to-do** |
| **S-1b** | Panneau stats ville + légende | **Partiel** (bonus) | `EvaluationMapView` buckets (`scoredLotCount`/`highPotentialLotCount`/fallback/unavailable) + `MapLegend.svelte`. **Compteur « Dans périmètre TOD » absent** | CS-L1 (idem) |
| **S-2** | Fiche lot complète (+ mini-form « en vente ») | **Partiel** | `LotFichePanel.svelte` + `lot-fiche-utils.ts` : noLot, badge/label score, liens Google Maps / Street View, marques + notes (**lecture**). **Mini-formulaire « en vente » absent** (`prixDemande`/`lienAnnonce` non écrits ; absents du type client) | CS-L2 `01KTW1NZ55V6FTN3ACJSKQQNQ7` **in-progress** |
| **S-3** | Marques équipe + notes + filtres/compteurs | **Partiel** | `prospect-marks-client.ts` (5 statuts, `computeProspectCounters`) + filtres/compteurs branchés dans `EvaluationMapView`. **Client read-only** : aucun POST/PUT → **pas d'écriture de marque/note depuis l'UI** ; notes de zone = placeholder | CS-L3 `01KTW1NZ8FEWYQ1T4CCNR479FK` **to-do** |
| **S-4** | Export CSV lettres + sélection | **Absent** | Aucun export CSV côté maps/opportunites (les seuls CSV sont automation/source-review, hors sujet) | CS-L4 `01KTW1NZBY7F1SC7A6A4NQAEAS` **to-do** |
| **S-5** | Filtres combinés potentiel×usage×superficie | **Absent** | Buckets de score affichés (Évaluation) mais **pas de contrôle de filtre combiné** usage/superficie sur les lots | CS-L5 `01KTW1NZJ06D73BQZP14GX8PE7` **to-do** |
| **S-6** | Pastilles réglementaires = Signaux auto | **Livré** | Pipeline Signaux opérationnel : `SignauxMapView`, `SignalsT1View`, `SignalRow`, `signaux-map-entities.ts` ; types catégorisés (ppcmoi/derogation/rezoning…). Pin geo-précis sur lot = gap zone→lot (WP3) | CS-P1 `01KTW1PP80NN8AYY9NDYRJ7NTN` **to-do** (raffinements) ; socle Signaux déjà livré |
| **S-7** | Couches env (MELCC/BDZI/CPTAQ/satellite) | **Absent** | Aucun toggle de couche WMS/ArcGIS sur les cartes | CS-P1 **to-do** |
| **S-8** | Recherche adresse / n° lot / zone | **Absent** (partiel ville) | Recherche **villes** dans `SignauxRail.svelte` uniquement ; pas d'autocomplete adresse/NO_LOT/zone en Opportunités/Évaluation | CS-P1 **to-do** |
| **S-9** | Sélection multiple + batch | **Absent** | `selection-bucket.ts` gère l'affichage de sélection ; **aucun marquage batch écrit** | CS-P1 **to-do** |
| **S-10** | Labels zones & civiques par zoom | **Absent** | Pas de labels dépendants du zoom | CS-P1 **to-do** |
| **S-11** | Sync temps réel + AUTH + export/import JSON | **Partiel** | **AUTH livré** (`auth-store`, `LoginView`, OIDC, `AdminView` validation users). **Sync temps réel multi-users + export/import JSON absents** | CS-P3 `01KTW674GHVBQ2J843QP0BERGP` **to-do** (infra) |
| **S-12** | Flux annonces en vente | **Absent** | Statut `en_vente` (dimension `marche`) présent dans le **type** `ProspectMark` + affichage `marketMark` (`LotFichePanel`), mais **aucun connecteur/flux**, aucune écriture | CS-P2 `01KTW1PPBEW81X8HTZZ4NS7VKZ` **to-do** |
| **S-13** | Lookup code postal | **Absent** | Non implémenté | CS-P2-S13 `01KTW67FQGE1AZ9J841Z0FH2FB` **to-do** |
| **S-14** | Éditeur de zonage manuel | **Absent** | Pas d'éditeur Leaflet.draw / saisie `ZoneVersion.geom` | CS-P2 **to-do** |
| **S-15** | Marquer toute une zone non retenue (batch) | **Absent** | `fetchProspectMarksForZone` (lecture par ville) existe, mais **pas de batch d'écriture** par `codeAffiche` | CS-P2 **to-do** |
| **S-16** | Mobile : fiche lot en bottom-sheet | **Partiel** | `LotFichePanel.svelte` : `Drawer` DS pour `<768px` (wrapper `md:hidden`). **Mais Drawer latéral, pas bottom-sheet 55vh** (limite DS notée en commentaire L30-31) | CS-P2 **to-do** |
| **S-17** | Dashboard multi-villes couverture | **Livré** | `SourcesMapView.svelte` = exactement le dashboard : choroplèthe maturité, `hasZonage`, statut par source, panneau qualité, `CityDetailPanel` | (= vue Sources, déjà livrée) |

### Compte (S-1..S-17, 17 features)

- **Livré : 2** → S-6 (Signaux auto), S-17 (dashboard Sources).
- **Partiel : 5** → S-1 (scoring sans TOD/Opportunités MapLibre), S-2 (fiche sans form « en vente »),
  S-3 (marques **lecture seule**, pas d'écriture), S-11 (AUTH oui / sync+JSON non), S-16 (Drawer latéral, pas bottom-sheet).
- **Absent / planifié : 10** → S-4, S-5, S-7, S-8, S-9, S-10, S-12, S-13, S-14, S-15.

> Bonus S-1b (panneau stats + légende) = **Partiel** (stats+légende oui, compteur TOD non).
> Tous les « Absent » sont **planifiés** sous les chapeaux Track CS-P1/CS-P2/CS-P2-S13/CS-P3 (tous `to-do`),
> les P0 carto sous CS-L4/CS-L5 (`to-do`).

---

## Partie 3 — Tests CS-L (scénario client lots/fiche/prospect/scoring)

Exécution : `cd ui && ../node_modules/.bin/vitest run` (équivaut `make test-ui`). Suite UI complète
exécutée le 2026-06-28.

### Résultat global suite UI

- **680 tests : 669 passent, 1 échoue, 10 todo, 10 skipped** (59 fichiers : 57 pass / 1 fail / 1 skip).

### Tests CS-L spécifiques (lots / fiche / prospect / scoring) — **tous au vert**

| Fichier de test | Couvre | Tests | État |
|---|---|---|---|
| `ui/src/lib/maps/lot-potential-visual.test.ts` | CS-L1 score de potentiel | 5 | ✅ pass |
| `ui/src/lib/components/maps/lot-fiche-utils.test.ts` | CS-L2 fiche lot (centroïde, Maps, score tone/label) | 29 | ✅ pass |
| `ui/src/lib/prospect/prospect-marks-client.test.ts` | CS-L3 marques/notes/compteurs | 3 | ✅ pass |
| `ui/src/lib/maps/lots-client.test.ts` | substrat lots (CS-L1/CS-L6) | 12 | ✅ pass |
| `ui/src/lib/maps/selection-bucket.test.ts` | sélection (S-9) | 9 | ✅ pass |
| `ui/src/lib/opportunites/opportunites-client.test.ts` | API opportunités réelle | 10 | ✅ pass |
| `ui/src/lib/opportunites/funnel.test.ts` | entonnoir/scoring dossiers | 18 | ✅ pass |
| `ui/src/lib/maps/score-color-scale.test.ts` | échelle couleur score | 13 | ✅ pass |

→ **86/86** au vert sur le sous-ensemble CS-L direct ; logique de scoring/fiche/marques **prouvée unitairement**.

### 1 test ROUGE (régression de branche — surface produit Évaluation)

- **`ui/src/lib/components/maps/EvaluationMapView.test.ts`** > *« anti-PII : les properties de chaque
  lot ne contiennent que noLot et citySlug »* — **FAIL** : `expected ['noLot','citySlug'] to include 'potentialScore'`.
- **Cause** : le `lots-client.ts` modifié en working-tree (travail CS-L1b in-progress) **injecte
  désormais `potentialScore` dans les properties des lots** ; le test anti-PII n'a pas été mis à jour.
  `potentialScore` est un **score dérivé public** (pas de PII), donc le test doit être **élargi** pour
  l'autoriser — ce n'est pas une fuite Loi 25, mais un test périmé à recaler. **À corriger** avant merge.

### 10 tests `todo` (à écrire — nécessitent l'API)

- Tous dans `ui/src/lib/components/api-dependent.test.ts` : `DocumentOverlay`/`SignalPdfOverlay` (preuve PDF),
  citations surlignées, etc. → **dépendent de la stack/API**, hors scénario CS-L lots ; à écrire en e2e/intégration.

---

## Synthèse exécutive

- **4 vues** : Signaux **fonctionnel** (MapLibre) ; Opportunités **partiel/démo** (entonnoir fixture,
  pas la carte lots) ; Évaluation **partiel** (lots SVG scorés, cap 200, pas MapLibre, marques lecture seule) ;
  Sources **fonctionnel**.
- **17 features** : **2 livré · 5 partiel · 10 absent**.
- **Tests** : 86/86 CS-L logiques au vert ; **1 rouge** (anti-PII Évaluation périmé par `potentialScore`,
  à recaler) ; 10 todo API-dépendants.
- **Items Track P0 carto** : CS-L1 done, CS-L2 in-progress, **CS-L3/L4/L5/L6 to-do** ; tous les
  chapeaux P1/P2 (CS-P1/CS-P2/CS-P2-S13/CS-P3) **to-do**.
