# Étude — Convergence des composants UI (DS / geo / sentropic) & responsiveness

**Date** : 2026-07-03 · **Base** : `origin/main` @ `b70d5cf` · **Type** : étude (aucun refactor dans cette branche)
**Items track liés** : #57 « composants 100 % DS-natifs + carto partagée », #87 « où vit le viewer PDF (@sentropic/pdf-* vs DS vs radar) » — items track locaux : « Ownership geo de la preuve PDF liée aux signaux/zones/lots », « DS redesign — map selection buckets and right-pane detail cards », « Étude convergence UI… ».

**Méthode** : inventaire statique du code (`ui/src/lib/components/**`, 53 composants) + inspection des packages `@sentropic/*` installés (`design-system-svelte` v0.34.65, `design-system-tokens` v0.11.0, `geo-core`/`geo-ui-svelte` v0.1.1, `chat-ui` v0.5.0, `dataviz-core`) + QA Playwright **headless** jetable sur le dev vite du worktree (port 5307, proxy API vers la stack dev :8803) à 3 viewports : 390×844, 768×1024, 1440×900, sur les vues Signaux et Sources + le viewer PDF (harnais QA `e2e-qa/harness/pdf-overlay.html`, fixture PDF). Captures : `docs/spec/assets/ui-study-*.png` (9 fichiers).

---

## 1. Inventaire — DS-natif vs bespoke (axe 1)

### 1.1 Les chiffres

| Mesure | Valeur |
|---|---|
| Composants `.svelte` sous `ui/src/lib/components/` | **53** |
| Exports du DS v0.34.65 (barrel `dist/index.js`) | **~230** composants |
| Composants DS distincts réellement importés par radar | **15** (~6,5 % du DS) |
| Fichiers radar important ≥ 1 composant DS | **32 / 53** (60 %) |
| Fichiers radar sans aucun import DS | **21 / 53** (40 %) |
| Occurrences palette Tailwind brute (slate/teal/emerald/…-NNN) | **1 525** dans 47 fichiers |
| Occurrences tokens DS `var(--st-*)` | **278** dans 8 fichiers (ratio ≈ 5,5:1 en faveur du bespoke) |

Les 15 composants DS consommés sont presque tous des **atomes** : Badge (23 fichiers), Alert (18), Button (12), Card (11), EmptyState (11), Select (3), Popover (3), Search (2), Checkbox (1), Switch (1), Drawer (1), plus le shell : **AppChrome + IdentityMenu** (TopNav), **ThemeProvider** (App.svelte), Header (dans du code mort). Aucun **pattern** DS de haut niveau (Table/DataTable, FilterBar, MasterDetail, AppShell, GraphLegend, Tabs, Modal, charts, primitives layout Grid/Row/Col/Flex/Stack) n'est utilisé.

### 1.2 Tableau composant → état → propriétaire cible

| Zone / composant radar | Fichier(s) (lignes) | État actuel | Équivalent DS/@sentropic disponible | Propriétaire cible |
|---|---|---|---|---|
| Thème & shell app | `App.svelte` (ThemeProvider + thème sent-tech) | DS-natif (ancrage) — mais layout racine `flex h-screen` à la main | `AppShell` (slots topChrome/rails/panels, `utilityMode: reserve\|overlay\|floating`) **non utilisé** | radar, sur AppShell DS |
| Nav haute | `TopNav.svelte` (227) | **DS-natif** : AppChrome + IdentityMenu, burger mobile natif | — | radar (conserver tel quel) |
| ~~TopBar~~ | `TopBar.svelte` (48) | **code mort** (aucun import dans l'app) | — | à supprimer |
| Gabarit de page 3 colonnes | `ViewLayout.svelte` (100) | **bespoke** : 2 `<aside>` `shrink-0` à largeur fixe (w-72/80/96), 0 media query — partagé par 6 vues | `AppShell` + `Drawer`/`ContextPanel`/`UtilityPanel` | radar, à migrer vers AppShell DS |
| Rail gauche Signaux | `maps/SignauxRail.svelte` (583) | bespoke (accordéons `<details>` natifs ; 4 atomes DS) | `NavRail`, `Drawer`, `FilterBar`, `Accordion` | radar, recomposé sur primitives DS |
| Panneau sélection droit | `maps/SignauxSelPanel.svelte` (1 722) | bespoke massif (Alert/Badge seuls) | `ContextPanel`/`UtilityPanel` + `Card` | radar, recomposé sur primitives DS |
| Panneau de filtres lots/zones | `maps/LotDataFilterPanel.svelte` (280) | **0 import DS** | `FilterBar`, `FilterPill`, `CheckboxGroup` | radar, sur DS |
| Fiche lot / détail | `maps/LotFichePanel.svelte` (710) | partiel : Card DS desktop, Drawer DS mobile ; contenu bespoke | Drawer DS = côtés gauche/droite seulement ; **pas de BottomSheet** (commentaire du fichier l'atteste) | radar ; **BottomSheet à upstreamer au DS** |
| Légendes de carte | `maps/MapLegend.svelte` (69) + légendes inline des MapViews | **0 import DS** (Tailwind brut) | `GraphLegend`, `ColorScaleBar`, `ColorSwatch` | radar, sur DS |
| Liste/table Signaux | `signals/SignalsT1View.svelte` (257) + `SignalRow.svelte` (272) | bespoke (lignes = Card DS + accordéon maison) | `Table`, `DataTable`, `StructuredList`, `SelectableList` | radar, sur DS |
| Tables/scorecards Sources | `sources-map/SourceConsole.svelte` (248), `SourceScorecard.svelte` (236), `CityDetailPanel.svelte` (123) | bespoke (Badge/Alert/Card) | `DataTable`, `KpiCard`, `ScoreCard` | radar, sur DS |
| Source-review (quadrant, deep-dive, board…) | `source-review/*` (6 fichiers, 69–235) | **0 import DS** | Card/Tabs partiels ; quadrant = dataviz custom | radar |
| Socle carto MapLibre | `maps/GeoCityMapBase.svelte` (1 075) + `SignauxMapView` (1 627), `EvaluationMapView` (1 342), `CadastreMapView` (348), `OpportunitesMapView` (320), `sources-map/SourceCoverageMap` (226), `DocumentOverlay` (165) | **100 % bespoke** MapLibre — le commentaire de `CadastreMapView.svelte` note que le DS n'expose aucun composant carte | DS `GeoMap` = **chart SVG statique** (projection mercator/equirect., GeoJSON, types dataviz-core) — PAS une carte interactive à tuiles ; voir §3 pour geo-ui-svelte | **carto partagée geo** (cf. §3, #57) |
| Viewer PDF de preuve | `maps/SignalPdfOverlay.svelte` (2 116) + harnais QA `e2e-qa/harness/pdf-*` | **bespoke radar** (pdf.js direct) | **aucun @sentropic/pdf-*** (voir §2) | cf. §2 (#87) |
| Chat | `RadarChatPanel.svelte` (531), `chat/ChatWidgetHost.svelte` (142) | **convergé** : wrappe `@sentropic/chat-ui` (StreamMessage, ModelSelector, MessageActions, ContextChips, ChatWidget) ; coquille bespoke | — | radar (wrapper fin, OK) |
| Styles globaux | `app.css` (44) | thème `sent-tech.css` importé + Tailwind ; palette réelle = Tailwind brut (1 525 occ.) vs tokens `--st-*` (278 occ.) | tokens sémantiques `--st-semantic-*` (déjà aliasés dans `tailwind.config.cjs` via palette `radar.*`, peu utilisée) | radar : bascule progressive vers tokens |

**Lecture honnête** : « 60 % des fichiers importent du DS » surestime la convergence — retirer les 5 atomes Badge/Alert/Button/Card/EmptyState ferait retomber la quasi-totalité en bespoke. Le seul pattern DS structurant en production est **AppChrome** (nav). L'essentiel de la surface (cartes, rails, panneaux, tables, légendes, PDF) est bespoke.

## 2. Viewer PDF de preuve — où doit-il vivre ? (#87)

### 2.1 État des lieux

- **`ui/src/lib/components/maps/SignalPdfOverlay.svelte` (2 116 lignes) est bespoke radar et — fait établi — le SEUL viewer PDF de tout l'écosystème sentropic.** Il pilote `pdfjs-dist` v4.10 directement (worker bundlé Vite `?url`, `getDocument` sur `/api/documents/raw?rawRef=…`, rendu canvas, nav pages, zoom fit-width via ResizeObserver, surlignage mono- et multi-signaux). Harnais QA associés : `e2e-qa/harness/pdf-{overlay,switch,nav}*`.
- **`@sentropic/pdf-*` n'existe pas.** Vérifié dans `node_modules/@sentropic/` et `/home/antoinefa/src/sentropic/packages/` : aucun package PDF, aucun composant PDF dans le design-system ni dans geo.
- `@sentropic/graphify` (côté serveur) ne fait que de l'**extraction de texte** (`unpdf`) et **stub explicitement pdf.js** (`pdfjs-dist: npm:empty-npm-package`) — il ne rend rien. Donc aucune brique de rendu réutilisable ailleurs.
- **Découplage** : le cœur de rendu (worker + canvas + nav + zoom + moteur de surlignage par rectangles) est **domain-agnostic**. Le couplage au domaine radar est **concentré et mince** : les types signal/preuve et la projection citation→rectangles dans `pdf-overlay-signals.ts`. Le composant se sépare proprement en « render core générique » + « couche d'adaptation signal ».

### 2.2 Recommandation

**Upstreamer le cœur de rendu en lib `@sentropic/pdf`** (render core générique : worker, canvas, nav pages, zoom fit-width, API de surlignage par rectangles/pages), et **garder côté radar une couche d'adaptation** fine (types signal, `pdf-overlay-signals.ts` : citation → rectangles). C'est le meilleur ratio : radar est aujourd'hui le seul porteur d'un viewer PDF fonctionnel et responsive (cf. §4.2) — plusieurs produits sentropic en auront besoin, et le composant est déjà quasi découplé.
Trade-off : (a) **garder radar** = zéro coordination, mais on reste seul mainteneur d'un composant de 2 116 lignes qui n'a rien de radar-spécifique dans son cœur ; (b) **DS** = mauvais fit (le DS est un catalogue de composants UI/charts, pas un hôte de dépendance lourde comme pdf.js + worker) ; (c) **lib `@sentropic/pdf` dédiée** = le bon niveau, mais **exige un accord** (qui possède/maintient, packaging du worker, versioning pdf.js). → **préco : (c)**, en portant l'extraction au consensus (§6). En attendant l'accord, radar reste propriétaire — aucune action bloquante.

## 3. Socle carto — carto partagée ? (#57)

### 3.1 État des lieux

- Une base MapLibre partagée **existe déjà** : `@sentropic/geo-ui-svelte` v0.1.1 exporte **`GeoMap` (545 lignes)**, **déjà importée par radar** dans `ui/src/lib/components/geo/GeoView.svelte`. C'est la vue Geo générique.
- **Mais** le socle carto métier reste bespoke : **`ui/src/lib/components/maps/GeoCityMapBase.svelte` (1 075 lignes)** + les 6 MapViews qui s'appuient dessus (SignauxMapView 1 627 l., EvaluationMapView 1 342 l., CadastreMapView, OpportunitesMapView, SourceCoverageMap, DocumentOverlay). GeoCityMapBase porte ce que `GeoMap` **n'expose pas** : le **drill cadastral** (province → ville → zone → lot), l'**outil de mesure**, et une **API impérative `GeoCityMapApi`** (contrôle programmatique de la carte par les vues).
- **`geo-ui-svelte` n'offre pas de primitive `BaseMap` bas-niveau** : `GeoMap` est une vue de haut niveau (props data-in), pas un hôte de lifecycle MapLibre sur lequel on pourrait greffer sources/layers/interactions custom. Impossible d'y poser GeoCityMapBase tel quel.
- **`@sentropic/dataviz-core`** = moteur de charts + geo-model (types GeoJSON/projections), **sans MapLibre** et **non importé** par radar. Le `GeoMap` du **design-system** (distinct de geo-ui-svelte) est un **chart SVG statique** (projection, GeoJSON), pas une carte à tuiles interactive.
- **Rien de plus récent sur disque** : `/home/antoinefa/src/sentropic` (et `/home/antoinefa/src/geo`) — `geo-ui-svelte`/`geo-core` sont vides/absents sur la branche courante ; la version installée 0.1.1 est l'état de l'art disponible.

### 3.2 Recommandation

**Demander à geo/dataviz une primitive `BaseMap`** (bas niveau) exposant la lifecycle MapLibre (init/destroy carte, hooks `addSource`/`addLayer`, événements clic/hover, API impérative de contrôle) — **sur laquelle GeoCityMapBase se reposerait** en gardant côté radar ce qui est métier : drill cadastral zones/lots, outil mesure, styles de couches. Objectif #57 : que le **fond de carte + la plomberie MapLibre soient possédés par geo**, pas dupliqués dans radar.
Trade-off : (a) **garder GeoCityMapBase 100 % radar** = autonomie totale, mais 1 075 l. de plomberie MapLibre générique à maintenir seul et divergence assurée avec geo-ui-svelte ; (b) **tout migrer vers `GeoMap` geo-ui-svelte** = **impossible aujourd'hui** (GeoMap n'expose ni le drill cadastral, ni l'API impérative, ni les hooks source/layer) ; (c) **primitive `BaseMap` partagée + couches métier radar** = le bon découpage, mais **dépend d'un développement geo** qu'on ne peut pas commander seul. → **préco : (c)**, à porter au consensus (§6). Sans engagement geo, statu quo (radar garde GeoCityMapBase) — pas d'action bloquante ; à réévaluer quand geo-ui-svelte dépasse 0.1.1.

## 4. Responsiveness (axe 2)

### 4.1 Comment le responsive est géré aujourd'hui

- **4 media queries dans toute l'app** (54 fichiers svelte + app.css), dont 1 seule d'accessibilité (`prefers-reduced-motion`) : `TopNav` (min-width 768 — décoratif nav-center), `SignalPdfOverlay` (max-width 900), `RapportView` (max-width 720). **Aucune convention de breakpoint commune** (768/900/720).
- **Tailwind actif** (`tailwind.config.cjs`, breakpoints par défaut sm 640/md 768/lg 1024/xl 1280) mais seulement **39 préfixes responsive `sm:/md:/lg:/xl:` répartis sur 17 fichiers**, tous sur des grilles internes de cartes/formulaires (Onboarding, Grilles, Ciblage, Backlog…) — **zéro sur le squelette de page** (ViewLayout, rails, MapViews).
- **Aucun `matchMedia`/`ResizeObserver` ne pilote le layout** applicatif. Les deux seuls codes conscients de la largeur : le dock chat (`chat-widget-layout.ts` : 100vw < 768, 50vw < 1280, sinon 33vw) et le fit-width du viewer PDF (ResizeObserver).
- **Meta viewport présente** (`ui/index.html`) — rien à corriger là.
- Côté DS : **AppChrome gère nativement le mobile** (burger + tiroir < 768 px, props `mobileMenuOpen`/`onMobileMenuToggle`) — c'est le seul responsive « gratuit » déjà en production. `AppShell` (non utilisé) gère le repli des panneaux à 768 px (`utilityMode: overlay/floating`). `Grid` a un mode fluide `minItemWidth`. **Limites DS** : aucun token de breakpoint exporté par `design-system-tokens` (seuils codés en dur 767/768 px/48 rem dans les composants), aucun hook/store matchMedia exporté.

### 4.2 Constats par breakpoint (captures `docs/spec/assets/`)

**Desktop 1440×900** (`ui-study-signaux-1440.png`, `ui-study-sources-1440.png`) — layout de référence, fonctionnel : rail gauche ~300 px, carte ~800 px, panneau Sélection ~320 px, légende en overlay bas-gauche, nav complète.

**Tablette 768×1024** (`ui-study-signaux-768.png`, `ui-study-sources-768.png`) — **cassé** :
- Les deux rails latéraux `shrink-0` gardent leur largeur fixe (Signaux : 320+320 = 640 px ; Sources : 288+384 = 672 px) → la **carte MapLibre est écrasée à 128 px (Signaux) / 96 px (Sources) de large** (mesuré sur le canvas). Inutilisable.
- Le toggle Province/Ville/Zone est tronqué ; les encarts de stats (Sources) et la légende se superposent à la carte résiduelle.
- La nav AppChrome, elle, reste correcte (768 = son seuil desktop).

**Mobile 390×844** (`ui-study-signaux-390.png`, `ui-study-sources-390.png`) — **cassé, avec perte de fonction** :
- Seul le rail gauche est visible (il occupe ~82–98 % de l'écran). La carte, le panneau Sélection, le toggle de niveau et la légende sont **hors viewport et clippés** : mesure Playwright — `document.scrollWidth` = 390 et **zéro conteneur scrollable horizontalement** (les éléments débordants sont en positionnement absolu, canvas MapLibre mesuré à 720 px de large pour 390 px de viewport). Ce n'est pas un scroll latéral inconfortable : **ces zones sont inaccessibles**.
- La nav AppChrome bascule correctement en burger (comportement DS).
- Il n'existe **aucun point de bascule** (media query ou matchMedia) qui empilerait les colonnes ou transformerait un rail en Drawer.

**Viewer PDF** (`ui-study-pdf-overlay-{390,768,1440}.png`, via harnais QA) — **le bon élève** : rendu propre aux 3 tailles, canvas fit-width (348 px à 390), nav de pages + zoom utilisables, pas d'overflow. Il possède sa media query 900 px et son ResizeObserver.

- Tables : `SourceConsole`, `ReconciliationView`, `AdminView`, `EvaluationMapView` n'ont pas de wrapper `overflow-x-auto` (seuls 2 fichiers de l'app en ont : BenchmarkComparison, KanbanView) → sur petit écran elles poussent la largeur au lieu de scroller localement.

### 4.3 Ce que le DS gère déjà vs ce que casse le bespoke

| Symptôme | Cause | Le DS le gère-t-il déjà ? |
|---|---|---|
| Carte écrasée (768) / inaccessible (390) | `ViewLayout` bespoke : asides `shrink-0` largeur fixe, aucune bascule | **Oui** — `AppShell` (utilityMode overlay/floating, repli < 768) + `Drawer` (left/right) : installés, non utilisés |
| Nav OK sur mobile | — | **Oui** — AppChrome (déjà adopté) : burger natif |
| Panneau fiche lot mobile | partiellement traité (Drawer DS) | Partiel — **pas de BottomSheet** dans le DS (manque avéré) |
| Légendes/toggles qui débordent sur la carte | overlays absolus bespoke sans max-width mobile | Partiel — GraphLegend/ColorScaleBar existent mais rien de spécifique carte |
| Tables qui poussent la largeur | tables bespoke sans conteneur scrollable | **Oui** — DataTable/Table DS (à vérifier: comportement overflow), sinon wrapper 1 ligne |
| Pas de breakpoints partagés | 3 seuils ad hoc (720/768/900) | **Non** — le DS n'exporte pas de tokens de breakpoint (à upstreamer) |

## 5. Plan de convergence priorisé

### 5.1 Quick wins responsive (petits, sans dépendance externe)

1. **`ViewLayout.svelte` : point de bascule unique** — c'est LE levier : 100 lignes, partagé par les 6 vues 3-colonnes (Signaux, Sources ×2, Évaluation, Opportunités, Geo). Sous un seuil (≈ 900 px) : rails en `Drawer` DS (left/right) ouverts à la demande, carte pleine largeur. Corrige d'un coup les casses 390 et 768 des deux vues QAées.
2. **Wrapper `overflow-x-auto` sur les 4 tables** (SourceConsole, ReconciliationView, AdminView, EvaluationMapView) — 1 ligne chacune.
3. **Overlays carte** (toggle Province/Ville/Zone, légendes, encarts stats) : `max-width` + repli/wrap sous ~480 px.
4. **Supprimer `TopBar.svelte`** (code mort, 48 lignes, seule utilisation de `Header` DS).

### 5.2 Moves structurels (dans l'ordre de valeur)

5. **ViewLayout → `AppShell` DS** : remplace le gabarit maison par le shell responsive du DS (slots primaryRail/contextPanel/utilityPanel + utilityMode). Le quick win n°1 peut être une étape intermédiaire si AppShell demande une adaptation.
6. **Tables → `DataTable`/`StructuredList` DS ; légendes → `GraphLegend`/`ColorScaleBar` ; filtres → `FilterBar`** — dé-bespokise les zones listées en §1.2.
7. **Palette : bascule progressive Tailwind brut → tokens `--st-semantic-*`** (1 525 occurrences dans 47 fichiers : chantier de fond, à étaler par vue ; l'alias `radar.*` du tailwind.config existe déjà).
8. **Viewer PDF** : extraction selon la reco §2.2.
9. **Carto** : socle partagé selon la reco §3.2.

### 5.3 Ce que ce plan ne couvre pas

Le rail/panneaux de SignauxSelPanel (1 722 l.) et SignauxRail (583 l.) restent des recompositions longues — à traiter vue par vue après le point 5, pas en big-bang.

## 6. Ce qui nécessite un consensus geo / dataviz / sentropic (à ne pas décider seul)

Les moves de §5.1/§5.2 internes à radar (bascule ViewLayout, wrappers overflow, adoption d'atomes/patterns DS déjà publiés, bascule tokens) sont **décidables par radar seul**. En revanche, **deux moves structurels sortent du périmètre radar et sont des propositions à porter au consensus** — à ne PAS décider solo :

1. **Upstream du viewer PDF en lib `@sentropic/pdf`** (#87). À trancher ensemble : qui possède/maintient la lib, packaging du worker pdf.js, politique de versioning `pdfjs-dist`, frontière exacte render-core vs adaptation signal. Radar apporte le seul viewer existant et quasi découplé ; sentropic doit acter la création du package. **Aucune migration avant accord** ; radar reste propriétaire par défaut.

2. **Primitive `BaseMap` partagée dans geo/geo-ui-svelte** (#57). À trancher ensemble : geo s'engage-t-il à exposer une primitive bas-niveau (lifecycle MapLibre + hooks source/layer + API impérative) au-dessus de laquelle GeoCityMapBase se pose ? Sinon radar garde son socle. Dépend d'un **développement côté geo** et d'une roadmap geo-ui-svelte > 0.1.1. **Statu quo tant que geo n'a pas priorisé.**

Ces deux points relèvent d'une décision inter-équipes (agent→humain / cross-owner) : les inscrire au track comme propositions liées à #57 et #87, et les instruire via un passage de décision consensuel plutôt qu'un choix d'un seul agent.

---

## Annexe A — Captures

| Fichier | Vue | Viewport |
|---|---|---|
| `assets/ui-study-signaux-390.png` / `-768` / `-1440` | Signaux (carte + rails) | 390 / 768 / 1440 |
| `assets/ui-study-sources-390.png` / `-768` / `-1440` | Sources (couverture) | 390 / 768 / 1440 |
| `assets/ui-study-pdf-overlay-390.png` / `-768` / `-1440` | SignalPdfOverlay (harnais QA, fixture) | 390 / 768 / 1440 |

## Annexe B — Mesures Playwright (extraits)

- Signaux@390 : `scrollWidth=390`, canvas MapLibre 720 px (clippé), 0 conteneur h-scrollable ; débordent : `canvas.maplibregl-canvas` (right 720), `aside.w-80.shrink-0` (right 640), toggle de niveau (right 499), légende (right 422).
- Signaux@768 : canvas carte **128×967 px** ; Sources@768 : canvas **96×925 px**.
- PDF overlay : canvas 348 px @390, 726 px @768, 1 373 px @1440 — 0 overflow.
