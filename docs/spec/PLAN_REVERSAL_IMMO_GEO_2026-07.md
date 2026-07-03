# Plan — Reversal MAXIMAL des composants UI `immo` → `geo`

**Date** : 2026-07-03 · **Base** : `origin/main` @ `99cac6c` · **Type** : PLAN (document ; aucun refactor dans cette branche)
**Auteur** : rhanka
**Antécédents lus** : `docs/spec/STUDY_UI_CONVERGENCE_RESPONSIVE_2026-07.md` (l'étude établit les faits : `@sentropic/pdf` n'existe pas ; `geo-ui-svelte@0.1.1` = `GeoMap` sans BaseMap bas-niveau ; `GeoCityMapBase` = drill + mesure + API impérative bespoke ; responsive cassé), `docs/spec/data-division-immo-geo.md` (frontière **DATA** déjà tracée), `docs/spec/geo-detail-schema-mapping.md` + `docs/spec/cadrage-geo-integration-mapper.md` (contrat `GeoCategory[]`/`GeoDetailSchema`).
**Items track liés** : #57 « composants 100 % DS-natifs + carto partagée », #87 « où vit le viewer PDF ».

**Méthode** : lecture statique du code `origin/main` (worktree isolé, `git reset --hard origin/main`) + inspection du paquet installé `@sentropic/geo-ui-svelte@0.1.1` (source lisible : `node_modules/@sentropic/geo-ui-svelte/src/*`) + sous-agent d'exploration sur les 3 gros composants carto (SignauxMapView 1 649 l, EvaluationMapView 1 342 l, SignauxSelPanel 1 855 l). Chiffres mesurés (`wc -l`) sur `origin/main`.

---

## 0. Principe directeur — la frontière UI suit la frontière DATA

La division **DATA** est déjà arbitrée (`data-division-immo-geo.md`) :

- **`geo`** = *donnée géo générique, réutilisable hors immo* : cadastre, zonage, lots, contraintes, adresses, registre municipalités — livrés en **OGC API Features** (`api.geo.sent-tech.ca`, collections `qc-lots-<slug>`/`qc-zonage-<slug>`) + les **primitives géo lourdes** (OCR/géoréf de plans PDF, vision/RANSAC/ICP).
- **`immo`** = *sémantique métier* : détection avis-motion→règlement→zonage, ontologie temporelle, mapper de résolution, **signaux**, scoring + l'infra de scraping dur (Obscura).

Ce plan **prolonge cette frontière à la couche UI**, à l'identique :

> **`geo` possède la carto générique** (fond de carte, drill cadastre province→ville→zone→lot, rendu zones/lots, mesure, légendes, fiche zone/lot, viewer de preuve PDF) ; **`immo` possède la couche signaux** (projection signal→géométrie, peinture par score/étape, overlay/ajout, fiche signal, adaptateur preuve PV→PDF) + auth + tracking.

Corollaire opérationnel : **tout ce qui, dans une MapView immo, ne parle ni de « signal », ni de « score », ni de « filtre métier », ni d'« étape v2.x » est du ressort `geo`.** Le reste reste `immo`. C'est le test de tri appliqué fichier par fichier au §2.

Fait de fond qui rend le reversal réaliste (et non un vœu) : **`GeoCityMapBase.svelte` est DÉJÀ un découpage policy/mechanism manuel**. Le socle (mécanique MapLibre) est explicitement domain-agnostique (commentaire `GeoCityMapBase:93-95` : « Le socle NE porte AUCUNE logique métier ») ; la vue (`SignauxMapView`) calcule **toutes** les expressions de couleur/opacité et les pousse par props + `syncGeoLayers`. La couture immo↔geo **existe déjà dans le code** ; le reversal consiste à *déplacer le socle chez geo*, pas à l'inventer.

---

## 1. Cible — schéma de la frontière

### 1.1 Schéma

```
┌─────────────────────────────────── immo (frontend mince) ───────────────────────────────────┐
│                                                                                              │
│  AUTH · TRACKING · ROUTAGE VUES · CHAT (wrapper @sentropic/chat-ui)                           │
│                                                                                              │
│  COUCHE SIGNAUX (la seule valeur carto propre à immo) :                                       │
│   • data          : FeatureCollection signaux + zones/lots décorés (signalProjection)         │
│   • paint policy  : expressions MapLibre couleur/opacité (score, étape, focus, filtre, sélection) │
│   • projection    : signaux → géométrie (decorateLotsWithSignalProjection, zone/lot refs)     │
│   • fiche signal  : adaptateur GeoDetailSchema + accesseurs (reglement, zone_ref, 4+, tod…)   │
│   • preuve        : adaptateur signal → citation/rects (pdf-overlay-signals)                   │
│   • filtres       : eval-lot-filters, zone-kind-filter · clients signaux ($lib/signals)       │
│   • prospect-marks (overlay CRM)                                                              │
│                                                                                              │
│      ▲ injecte via CONTRAT « ajout de signaux » (§3)                     ▲ adaptateur (§5)     │
├──────┼──────────────────────────────────────────────────────────────────┼───────────────────┤
│      │                          geo / dataviz / sentropic                │                   │
│  ┌───┴───────────────────────────────────────┐   ┌──────────────────┐  ┌┴────────────────┐  │
│  │  BaseMap (primitive bas-niveau, §4)        │   │  Composants       │  │ @sentropic/     │  │
│  │  • lifecycle MapLibre init/destroy         │   │  génériques :     │  │ cite-source     │  │
│  │  • fond OSM raster / neutral-gray / PMTiles│   │  • drill cadastre  │  │ (render core    │  │
│  │  • addSource/setData/addLayer/setPaint     │   │    prov→ville→     │  │  PDF : worker,  │  │
│  │  • on(click/hover) + feature-state         │   │    zone→lot        │  │  canvas, nav,   │  │
│  │  • flyTo/fitBounds/resetToInitialView      │   │  • rendu zones/lots│  │  zoom, highlight│  │
│  │  • themeElement (tokens DS)                │   │  • mesure (règle)  │  │  par rects +    │  │
│  │  • overlay channel (syncOverlay, §3)       │   │  • légendes        │  │  citation-match)│  │
│  └────────────────────────────────────────────┘   │  • fiche zone/lot  │  └─────────────────┘  │
│                                                    │    (GeoDetailPanel│                       │
│  DATA géo (déjà chez geo, OGC API) : zones, lots,  │    déjà publié)   │                       │
│  cadastre + **superficie_m2 + frontage_m servis**  └──────────────────┘                       │
│  comme propriétés de feature (§6)                                                             │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Frontière exacte (qui possède quoi)

| Capacité UI | Propriétaire cible | Contrat / paquet |
|---|---|---|
| Lifecycle MapLibre, fond de carte, addSource/addLayer/on/camera | **geo** | primitive `BaseMap` (à créer, §4) |
| Drill cadastre province→ville→zone→lot (choroplèthe villes + échafaudage zones/lots + segmented-control) | **geo** | composant `CadastreMap` (extrait de `GeoCityMapBase`, §2) |
| Rendu polygones zones/lots (sources+couches+interactions ; couleurs = props) | **geo** | idem `CadastreMap` (le paint reste piloté par le consommateur, §3) |
| Langage couleur zonage (H/C/I/A → token DS) | **geo** | module `zone-kind-style` porté chez geo |
| Outil mesure (règle géodésique) | **geo** | `measure` porté chez geo (module pur `measure.ts` + UI dans la base) |
| Légendes carte | **geo** | `GeoMapLegend` (déjà publié) — convergence de `MapLegend` + légendes inline |
| Fiche zone / fiche lot | **geo** | `GeoDetailPanel` (déjà publié) + `GeoDetailSchema` fourni par immo |
| `superficie_m2` / `frontage_m` | **geo** | propriétés OGC (calcul géo, §6) |
| Viewer de preuve PDF (render core) | **geo/sentropic** | `@sentropic/cite-source` (à créer, §5) |
| **Couche signaux** : data + paint policy + projection + fiche signal + adaptateur preuve + filtres | **immo** | contrat « ajout de signaux » (§3) + adaptateur cite-source (§5) |
| Auth, tracking, routage, chat | **immo** | inchangé |

**Ce que geo N'a PAS aujourd'hui et qui bloque** : `geo-ui-svelte@0.1.1` n'expose **que** `GeoMap` (vue data-in de haut niveau : `data` FeatureCollection + `layerKind` + `categories` + `onHover`/`onSelect`), **sans aucune primitive bas-niveau** — pas d'instance MapLibre exposée, pas de `addSource`/`addLayer`, pas de `fitBounds(bbox)`, pas de fond de carte à tuiles (style « background vide » codé en dur, `GeoMap.svelte:283-289`). Impossible d'y poser le drill cadastre. **La cible dépend donc d'un développement geo** (la primitive `BaseMap`, §4). C'est le point dur, honnête, de tout le plan.

---

## 2. Inventaire fichier-par-fichier — MIGRE-vers-geo vs RESTE-immo

Effort en **jours-personne (j)** indicatifs, incluant migration + tests + coordination. Couplage = ce qu'il faut casser.

### 2.1 MIGRE vers `geo`

| Fichier (lignes) | Rôle | Couplage à casser | Effort |
|---|---|---|---|
| `maps/GeoCityMapBase.svelte` (**1 075**) | Socle carto : init MapLibre, fond OSM/neutral-gray, choroplèthe villes `cities-fill`, échafaudage zones/lots (`syncGeoLayers`), drill segmenté, mesure, légende, API impérative `GeoCityMapApi`. **DÉJÀ domain-agnostique.** | Le socle importe `$lib/maps` : `geometry-bounds`, `viewport-memory`, `cadastre-geojson-source` (types), `measure`. Tous **génériques** → partent avec lui. Aucun import `$lib/signals`. **Zéro couplage métier à casser** : le socle est prêt à migrer tel quel, une fois posé sur la primitive `BaseMap` geo. | **5–8 j** (portage paquet + refonte sur `BaseMap` + tests) |
| `maps/measure.ts` (calcul pur haversine) + UI mesure dans la base (`GeoCityMapBase:546-687`) | Outil « mesurer une distance » façon Google Maps. | Aucun (pur, testé offline). | **1 j** |
| `maps/zone-kind-style.ts` (**192**) | Teinte des aplats de ZONE par kind (H jaune / C rouge / I violet / A vert) via tokens DS `--st-semantic-data-category*`. Langage couleur cadastre générique. | Importe `lot-potential-visual` (kindFromZoneCode — générique), `score-color-scale` (**immo** : à découpler — seule la constante `LOT_4PLUS_TOD_*` est immo), `geo-zones-client` (types), `signaux-map-geo` (`zoneRefComparableKey` — utilitaire). Découpler la teinte cadastre (part geo) du helper 4+/TOD (reste immo). | **2 j** |
| `maps/cadastre-geojson-source.ts` (**353**) | Normalisation FeatureCollection cadastre (lit `superficie_m2_calculee`, `facade_m`…). | Générique (lecture de propriétés OGC). | **1 j** (part comme util de la base) |
| `maps/geometry-bounds.ts`, `maps/viewport-memory.ts` | bbox + mémoire de cadrage caméra. | Purs, génériques. | **0,5 j** |
| `maps/MapLegend.svelte` (**69**) + légendes inline des MapViews | Légende overlay. | Palette Tailwind brute → converger sur `GeoMapLegend` (déjà publié). | **1 j** (remplacement, pas portage) |
| `components/maps/lot-fiche-utils.ts` → **`estimatedFacadeM`** (`:73-122`) | Façade estimée client-side (convex hull + rotating calipers, min oriented bbox, petit côté). **La seule vraie géo-computation embarquée côté immo.** | À **supprimer** côté immo : geo sert `frontage_m` (§6). Le reste de `lot-fiche-utils` (formatage, score tone) reste immo. | **0,5 j** immo (suppression) + effort geo au §6 |

**Sous-total « part chez geo » ≈ 1 700 lignes de socle carto + 2 modules purs.**

### 2.2 RESTE `immo` (recomposé sur les composants geo)

| Fichier (lignes) | Rôle | Devient | Effort de recomposition |
|---|---|---|---|
| `maps/SignauxMapView.svelte` (**1 649**) | **Seul consommateur MapLibre vivant** du socle. Calcule *toutes* les expressions : choroplèthe villes = `signalCountColor(subsetCounts)` (`:473-484`), lots = `signauxLotFillColorExpression` (score/projection/4+/tod), opacités = focus/filtre/sélection. | Se recompose sur `CadastreMap` geo + le **contrat signaux** (§3) : garde ses builders d'expressions, appelle `syncOverlay(...)` au lieu de `syncGeoLayers(...)`. | **5–8 j** (re-câblage sur l'API geo + non-régression QA) |
| `maps/SignauxSelPanel.svelte` (**1 855**) | Pane détail droit (zone/lot/signal buckets). **Aucune API carte** ; prop/callback only. ~60–70 % générique (accordéons bucket, `SelectionBucketState`, focus-reveal, filter-headers, retry/empty), ~30–40 % immo (champs par entité, sous-panneau preuve/PV, grille-PDF, accesseurs). | Buckets zone/lot → `GeoDetailPanel(schema)` geo ; **sous-panneau signal + preuve reste immo** (adaptateur). | **6–10 j** (le plus gros chantier « fiche ») |
| `maps/EvaluationMapView.svelte` (**1 342**) | **Rendu SVG parallèle** (equirectangulaire, `<svg viewBox>`, projection maison `projX/projY`) — **n'utilise PAS MapLibre ni le socle**. Paint = `evalLotPaint` (pas des expressions MapLibre). Porte aussi la couche **prospect-marks** (CRM). | **Point de friction n°1** : à **migrer d'abord sur MapLibre/`CadastreMap`** (tuer le renderer divergent) AVANT de déplacer le socle chez geo. La couche prospect-marks reste immo (overlay via §3). | **8–12 j** (réécriture du rendu) |
| `maps/CadastreMapView.svelte` (**348**), `maps/OpportunitesMapView.svelte` (**320**), `maps/DocumentOverlay.svelte` (**165**) | Vues carto secondaires. | Recomposées sur `CadastreMap` geo + contrat signaux. | **2–4 j** chacune |
| `maps/LotFichePanel.svelte` (**710**), `maps/LotDataFilterPanel.svelte` (**280**), `maps/SignauxRail.svelte` (**580**) | Fiche lot desktop/mobile, filtres lots/zones, rail gauche Signaux. | Fiche lot → `GeoDetailPanel` + slots immo ; filtres/rail restent immo (métier), sur primitives DS. | **3–5 j** (fiche), **2–3 j** (rail/filtres) |
| `$lib/maps/signaux-map-geo.ts` (**606**), `signaux-map-entities.ts` (**431**), `score-color-scale.ts` (**239**), `eval-lot-filters.ts` (**362**), `selection-bucket.ts` (**262**), `signaux-zones-loader.ts` (**183**), `lot-potential-visual.ts` (**182**), `zone-kind-filter.ts`, `maps-data.ts` (**155**) | Projection signal→géométrie, entités carte, échelle couleur score, filtres, buckets, chargeurs. | **Restent immo** — cœur de la couche signaux. `selection-bucket` est générique dans sa mécanique mais son `BucketKind = municipality\|signal\|zone\|lot` mêle cadastre (geo) et `signal` (immo) → garder immo, ou scinder plus tard. | inchangé (glue) |
| `$lib/maps/zones-client.ts` (**351**), `lots-client.ts` (**690**), `geo-zones-client.ts`, `components/geo/geo-client.ts` | Clients OGC (`/api/geo/collections/:id/items`, `/api/geo/cities`, `/api/geo/features/:city`). | **Restent immo** (consommateurs), mais **l'API elle-même** (`api/src/routes/geo-*.ts`) est un candidat à devenir un service geo-owned (OGC standard = domaine geo — cohérent avec la data-division). Décision service = hors périmètre UI, à noter au consensus. | inchangé |
| `$lib/signals/*` (`pdf-overlay-signals.ts` **285**, `pdf-citation-match.ts` **161**, `pdf-signal-colors.ts`, `graph-signal-detail-client.ts`, `graph-signals-by-city-client.ts`, `graph-signal-filter.ts`) | Détail signal, appariement citation, couleurs, clients graphe. | **Restent immo** SAUF `pdf-citation-match.ts` (100 % générique, candidat CORE cite-source, §5). | voir §5 |
| `components/geo/GeoView.svelte` (**319**) + `geo-categories.ts` (**156**) | **Chemin geo mince DÉJÀ en place** : consomme `GeoMap` + `GeoDetailPanel` avec catégories/schémas immo, fusionne zones+lots+opps en une FeatureCollection. | **Preuve de concept du pattern cible.** Sert de gabarit pour recomposer Signaux/Source. | référence |
| `maps/SignalPdfOverlay.svelte` (**2 116**) | Seul viewer PDF de l'écosystème. | Render core → `@sentropic/cite-source` (§5) ; adaptateur signal reste immo. | voir §5 |

### 2.3 Lecture honnête de l'ampleur

- **Ce qui part chez geo est net et déjà découplé** (~1 700 l de socle + modules purs) : le risque technique du *portage* est faible, le risque est de **coordination** (geo doit livrer la primitive `BaseMap`).
- **Le gros du coût est côté immo**, en *recomposition* : `SignauxMapView` (re-câblage), `SignauxSelPanel` (fiche), et surtout **`EvaluationMapView` qui doit d'abord rejoindre MapLibre** (aujourd'hui SVG divergent). Sans cette convergence, on migrerait un socle qu'une seule vue utilise.
- **Ordre de grandeur total** : **45–70 j-personne** étalés, dont ~10–15 j réellement « chez geo » (primitive + composants), le reste = recomposition immo + cite-source + superficie/frontage. **À étaler par vue, jamais en big-bang** (§7).

---

## 3. Contrat d'interface « ajout de signaux »

**Objectif** : `immo` injecte sa couche signaux dans une vue carto `geo` sans que geo ne connaisse jamais la sémantique « signal ». Deux niveaux, du plus simple au plus expressif — **les deux existent déjà en germe dans le code**.

### 3.1 Niveau 1 — déclaratif (couvre l'overlay simple, déjà prouvé par `GeoView`)

`immo` fournit une **FeatureCollection + une taxonomie** ; geo peint via un `match` sur une clé de catégorie. C'est **exactement** ce que fait `GeoView.svelte:289-300` aujourd'hui :

```ts
// Contrat existant (geo-ui-svelte@0.1.1)
interface SignalLayerSpecDeclaratif {
  data: FeatureCollection;              // signaux (points) ou zones/lots décorés
  categories: GeoCategory[];            // immo mappe ses classes → {id, labelFr, color}
  categoryKey: string;                  // ex. "category" — propriété portant l'id de catégorie
  valueKey?: string;                    // choroplèthe graduée (alternative aux catégories)
  onSelect?: (hit: GeoFeatureHit) => void;
  onHover?: (hit: GeoFeatureHit | null) => void;
}
```

immo possède `GEO_CATEGORIES` (21 catégories : 14 réglementaires + dimension + 6 étapes v2.1) et les schémas détail (`geo-categories.ts`, `geo-detail-schema-mapping.md`). geo reste ontology-agnostique (il joint sur `categoryKey`, n'invente ni couleur ni label).

**Limite** : ce niveau **ne peut PAS** exprimer la peinture réelle des vues Signaux/Évaluation — dimming par focus/filtre/sélection, hiérarchie score (`signalProjection`×`priorite`×`4+`×`tod`), exergue orange de sélection. Ces effets sont des **expressions MapLibre feature-state-driven**, hors d'un simple `match` catégoriel. D'où le niveau 2.

### 3.2 Niveau 2 — impératif (couvre la peinture complexe, déjà prouvé par `syncGeoLayers`)

La vue geo expose, via `onReady(api)`, un **canal d'overlay** où immo pousse données **+ expressions de paint opaques**. C'est la généralisation directe de l'actuel `GeoCityMapApi.syncGeoLayers(GeoLayersInput)` (`GeoCityMapBase:53-78`) :

```ts
interface SignalOverlayInput {
  id: string;                          // identifiant de couche immo (ex. "signaux-lots")
  data: FeatureCollectionLike;         // zones/lots décorés (signalProjection, refs…)
  paint: {                             // expressions MapLibre calculées par immo, opaques pour geo
    fillColor: unknown;                //   ex. signauxLotFillColorExpression (score-color-scale)
    fillOpacity: unknown;              //   ex. buildLotOpacityExpression (focus/filtre/sélection)
    lineColor?: unknown;
  };
}

interface GeoOverlayApi {             // ce que geo livre à immo (onReady)
  syncOverlay(input: SignalOverlayInput): void;   // (re)peint la couche immo — remplace syncGeoLayers
  removeOverlay(id: string): void;
  // interactions renvoyées à immo :
  onFeatureClick(id: string, handler: (f: GeoFeatureHit) => void): void;
  onFeatureHover(id: string, handler: (f: GeoFeatureHit | null) => void): void;
  // caméra + tokens (déjà dans GeoCityMapApi) :
  flyTo, fitMapToBounds, resetToInitialView, themeElement;
}
```

**Le contrat de couleur/opacité est déjà `unknown` (expression MapLibre opaque)** dans `GeoLayersInput` — geo ne lit jamais la sémantique. C'est un séparateur policy/mechanism propre : **immo garde 100 % de la politique** (quoi peindre, quelle couleur = quel score), **geo fournit la mécanique** (source, couche, feature-state, événements).

### 3.3 Préco de contrat

- **Livrer le niveau 2 (canal impératif `syncOverlay` + `onFeatureClick/Hover`) comme contrat principal** : il est prouvé en prod (c'est `syncGeoLayers` déplacé), il couvre les vues complexes, et il garde immo 100 % propriétaire de sa peinture.
- **Garder le niveau 1 (déclaratif `categories`)** pour les overlays simples (Géo, Opportunités) — déjà en prod via `GeoView`.
- **immo n'ajoute que** : (a) la FeatureCollection de signaux/décoration, (b) les 3 expressions de paint, (c) les handlers clic/hover, (d) le `GeoDetailSchema` de la fiche. **Tout le reste (carte, drill, sélection visuelle, mesure, légende) est à geo.** C'est le « mécanisme simple de couche de signaux par-dessus » demandé.

---

## 4. Primitive `BaseMap` à demander à `geo`/`dataviz`

`geo-ui-svelte@0.1.1` n'a **rien** de bas-niveau (cf. §1.2). La primitive à créer expose la **lifecycle MapLibre** + les **hooks** sur lesquels `CadastreMap` (ex-`GeoCityMapBase`) et le canal signaux (§3) se posent. Elle est le **dénominateur commun** de tout ce que `GeoCityMapBase` fait déjà en interne — donc l'API ci-dessous est *dérivée du code qui tourne*, pas spéculative.

```ts
interface BaseMapProps {
  basemap: "osm" | "neutral-gray" | "pmtiles" | "none"; // fond raster OSM / gris désaturé / vecteur / vide
  center?: [number, number]; zoom?: number;             // défaut Québec [-71.5, 47] z4
  height?: string;
  onReady?: (map: BaseMapApi) => void;                  // ESCAPE HATCH livré au chargement
}

interface BaseMapApi {
  // — sources & couches (le cœur manquant) —
  addSource(id: string, data: FeatureCollectionLike): void;
  setSourceData(id: string, data: FeatureCollectionLike): void;
  removeSource(id: string): void;
  addLayer(spec: LayerSpec): void;
  setPaint(layerId: string, prop: string, value: unknown): void;   // expressions opaques
  setFilter(layerId: string, filter: unknown): void;
  removeLayer(id: string): void;
  // — interactions —
  on(event: "click" | "mousemove" | "mouseleave", layerId: string, handler: (f: GeoFeatureHit) => void): void;
  setFeatureState(id: string | number, state: Record<string, unknown>): void;  // hover/selection
  // — caméra (déjà dans GeoCityMapApi) —
  flyTo(o: { center: [number, number]; zoom: number; duration: number }): void;
  fitBounds(bbox: [number, number, number, number], o?: { maxZoom?: number; duration?: number }): void;
  resetToInitialView(o?: { duration?: number }): boolean;   // C9 (viewport-memory intégrée)
  // — thème —
  readonly themeElement: HTMLElement | null;                // getComputedStyle des tokens DS
  destroy(): void;
}
```

**Écarts vs `GeoMap@0.1.1` (ce que geo doit AJOUTER)** :
1. **Exposer l'instance** (aujourd'hui `map` est une variable locale de `onMount`, jamais rendue — `GeoMap.svelte:240`). Sans `onReady(map)`, aucune greffe possible.
2. **Fond de carte à tuiles** : OSM raster + variante `neutral-gray` (désaturé/éclairci) + PMTiles plus tard. `GeoMap@0.1.1` a un fond **vide** (`style.sources = {}`, `GeoMap.svelte:295-306`). `GeoCityMapBase` a déjà l'OSM (`:704-859`, tuiles `tile.openstreetmap.org`, attribution « © OpenStreetMap contributors ») — geo hérite de cette plomberie.
3. **`fitBounds(bbox)` impératif** (aujourd'hui `GeoMap` n'a qu'un `fitBounds` booléen sur les data-bounds).
4. **`setPaint`/`setFilter`/`setFeatureState`** pour le paint dynamique feature-state (sélection/hover/focus).

**Trade-off** : (a) **radar garde `GeoCityMapBase`** = autonomie, mais 1 075 l de plomberie MapLibre générique maintenue seul + divergence assurée avec geo-ui-svelte ; (b) **attendre que `GeoMap` grossisse** = impossible tant que 0.1.1 n'expose pas le bas-niveau ; (c) **primitive `BaseMap` partagée + `CadastreMap` posé dessus** = le bon découpage, mais **dépend d'un dev geo** non commandable seul. → **préco (c)**, à porter au consensus (§7). Statu quo sûr tant que geo n'a pas priorisé.

---

## 5. `@sentropic/cite-source` — render core générique vs adaptateur signal immo

### 5.1 Découpe (déjà quasi réalisée dans le code)

`SignalPdfOverlay.svelte` (2 116 l) est **le seul viewer PDF de l'écosystème** (`@sentropic/pdf` **n'existe pas**). Son cœur est **domain-agnostique** ; le couplage immo est **concentré et mince** :

| Brique | Nature | Cible |
|---|---|---|
| Worker pdf.js singleton mémoïsé + `getDocument(url)` (`SignalPdfOverlay:5-48`) | générique | **CORE cite-source** |
| Rendu canvas, nav pages, zoom fit-width (ResizeObserver), surlignage par **rectangles/pages** | générique | **CORE cite-source** |
| `pdf-citation-match.ts` (**161 l**) — appariement verbatim citation → intervalle `[start,end]` sur la couche texte, **zéro dépendance pdf.js, zéro type immo** | **100 % générique** | **CORE cite-source** |
| `pdf-overlay-signals.ts` (**285 l**) — projette `GraphSignalNode` → `OverlaySignal`/`OverlayNavSignal`/`HoverCardData` (excerpt, page, couleur, badge, complétude preuve) | **immo** | **adaptateur (reste immo)** |
| `pdf-signal-colors.ts`, `graph-signal-detail-client.ts` (evidence, docRefs) | **immo** | **adaptateur (reste immo)** |

### 5.2 API du render core (dérivée de l'usage réel)

```ts
interface CiteSourceApi {
  openDocument(url: string): Promise<void>;                 // worker singleton, isEvalSupported:false
  gotoPage(n: number): void;                                // nav ◀ ▶ i/N
  setZoom(mode: "fit-width" | number): void;                // ResizeObserver fit-width
  highlight(marks: Array<{                                  // surlignage générique multi-cible
    page: number;
    rects?: Array<[number, number, number, number]>;        // si bbox connue
    citationText?: string;                                  // sinon : matché via citation-match sur la couche texte
    color: string; label?: string; dim?: boolean;           // couleur/label/désaturation (hors-filtre)
  }>): void;
  onPageRender(handler: (page: number) => void): void;
}
```

L'**adaptateur immo** mappe `OverlaySignal[]` → `highlight(marks)` (couleur par rang, courant mis en avant, hors-filtre en slate désaturé) et fournit la nav multi-PDF (`buildNavSignals`, `docIdentityOf`). Il ne touche jamais au worker ni au canvas.

### 5.3 Porteur & préco

Aligné sur l'étude §2/#87 : **créer `@sentropic/cite-source`** (render core), **radar garde l'adaptateur signal**. À trancher au consensus : qui possède/maintient la lib, packaging du worker pdf.js, politique de versioning `pdfjs-dist`, frontière exacte core↔adaptateur. **Aucune migration avant accord** ; radar reste propriétaire par défaut (aucune action bloquante). Note de nommage : « cite-source » (et non « pdf ») est le bon niveau — le core surligne des **citations sur une source**, PDF n'étant qu'un backend de rendu.

---

## 6. `superficie_m2` / `frontage_m` servis par `geo`

**État mesuré** :
- **Superficie** : **déjà serveur**. La valeur vient de la propriété OGC `superficie_m2_calculee` (cadastre), normalisée en `superficieM2` (`cadastre-geojson-source.ts:250`, `lots-client.ts:448-451`). immo **ne recalcule rien** — il lit et formate (`formatArea(lot.properties.superficieM2)`, `SignauxSelPanel:1211`).
- **Façade (frontage)** : **hybride**. immo préfère la mesure serveur `facadeM` (`facade_m`) quand elle existe, **sinon calcule côté client** `estimatedFacadeM` (`lot-fiche-utils.ts:73-122`) : projection équirectangulaire locale → enveloppe convexe (Andrew) → **rectangle englobant orienté minimal (rotating calipers)** → façade = petit côté. Heuristique honnête (« ≈ … m (estimée) »), mais **c'est la seule vraie géo-computation embarquée côté immo**, et elle vit en **double définition potentielle** avec ce que geo pourrait servir.

**Cible** : `geo` calcule **aire ET façade** à l'ingestion cadastre (il possède déjà la géométrie + les primitives géo lourdes — cf. data-division flux j : vision/RANSAC/ICP) et les expose comme **propriétés OGC** `superficie_m2` + `frontage_m` (+ provenance : `mesuree` vs `estimee`). immo :
- **supprime `estimatedFacadeM`** et la géométrie associée (convex hull + calipers) de `lot-fiche-utils.ts` ;
- lit `properties.frontage_m` comme il lit déjà `superficieM2`.

**Bénéfice** : une seule définition canonique de la façade (pas deux implémentations divergentes), calcul fait là où vit la géométrie de référence, immo redevient pur consommateur. **Effort** : immo ~0,5 j (suppression) ; geo = ajout du champ `frontage_m` au pipeline cadastre (à chiffrer côté geo — la définition « petit côté du min oriented bbox » est portable telle quelle). **Caveat honnête** : la façade reste une **estimation géométrique** (pas un relevé d'arpenteur) ; geo doit porter le champ `frontage_source` pour ne pas survendre la précision.

---

## 7. Migration incrémentale + décisions de consensus

### 7.1 Étapes déployables sans casser la prod (chaque étape passe le gate, vue par vue, derrière flag si besoin)

| # | Étape | Livrable | Dépend de | Déployable seul ? |
|---|---|---|---|---|
| **0** | **Formaliser le contrat** immo↔geo (§3) à partir de `GeoCityMapApi`/`GeoLayersInput` existants. Documenter la couture. | doc + types partagés | — | oui (doc) |
| **1** | **Unifier `EvaluationMapView` sur MapLibre/`GeoCityMapBase`** (tuer le renderer SVG divergent). Prospect-marks → overlay §3. | 1 seule base MapLibre en prod | rien (interne immo) | oui, vue par vue |
| **2** | **geo publie la primitive `BaseMap`** (§4) dans `geo-ui-svelte > 0.1.1`. immo re-pointe `GeoCityMapBase` dessus (devient un wrapper mince). | `geo-ui-svelte@0.2.x` | **consensus geo** | oui (drop-in) |
| **3** | **Déplacer le socle cadastre chez geo** : `GeoCityMapBase` → `CadastreMap` (geo) + `zone-kind-style` + `measure` + légendes → `GeoMapLegend`. immo ne garde que les expressions de paint + `syncOverlay`. | `CadastreMap` geo | étapes 1+2 | oui, vue par vue |
| **4** | **Fiche : `SignauxSelPanel`/`LotFichePanel` → `GeoDetailPanel(schema)`** + sous-panneau signal/preuve immo. (Gabarit = `GeoView` déjà en prod.) | fiches convergées | `GeoDetailPanel` (déjà publié) | oui, bucket par bucket |
| **5** | **`@sentropic/cite-source`** (render core) + adaptateur immo. | lib cite-source | **consensus #87** | oui (adaptateur d'abord côté radar) |
| **6** | **geo sert `frontage_m`** ; immo supprime `estimatedFacadeM`. | champ OGC `frontage_m` | **pipeline geo** | oui |

**Chemin critique** : 1 → 2 → 3 (il faut une base unique MapLibre AVANT de déplacer le socle, et la primitive geo AVANT le déplacement). 4, 5, 6 sont **parallélisables** une fois 3 amorcée. Rien ne bloque la prod : à chaque étape, l'ancien code reste jusqu'au basculement vue-par-vue, gate vert exigé (`scripts/gate.sh`).

### 7.2 Décisions de consensus `geo` / `dataviz` / `sentropic` (agent→humain, cross-owner — à NE PAS trancher solo)

1. **Primitive `BaseMap`** (§4, #57) : geo s'engage-t-il à exposer la lifecycle MapLibre bas-niveau (instance + addSource/addLayer/setPaint/on + fond à tuiles + fitBounds impératif) dans `geo-ui-svelte > 0.1.1` ? **Sans cet engagement, tout le reversal carto reste au statu quo** (radar garde `GeoCityMapBase`).
2. **Composant `CadastreMap`** : geo accepte-t-il de posséder le **drill cadastre** (province→ville→zone→lot) + **mesure** + **langage couleur zonage** (extraits de `GeoCityMapBase`, déjà domain-agnostiques) ? Frontière : geo = mécanique + rendu ; immo = expressions de paint (§3).
3. **`frontage_m` servi par geo** (§6) : geo ajoute-t-il `frontage_m` (+ `frontage_source`) aux propriétés OGC des lots, pour qu'immo supprime `estimatedFacadeM` ? Définition canonique (petit côté du min oriented bbox) portée par geo.
4. **`@sentropic/cite-source`** (§5, #87) : création + propriétaire + packaging worker pdf.js + versioning + frontière core↔adaptateur.
5. **Forme du contrat signaux** (§3) : geo/dataviz valident le canal impératif `syncOverlay` + `onFeatureClick/Hover` (généralisation de `syncGeoLayers`) comme API principale, le déclaratif `categories` restant pour les overlays simples.
6. **Richesse de `GeoDetailPanel`** (§4 étape 4) : le sous-panneau « preuve/PV » d'immo passe-t-il par un **slot** exposé par `GeoDetailPanel`, ou geo grandit-il un `kind:"evidence"` ? (impacte la frontière fiche zone/lot vs fiche signal).
7. **Service OGC geo-owned** (hors périmètre UI, à noter) : l'API `/api/geo/*` (OGC Features) est-elle un candidat à migrer côté service geo (cohérent data-division) ? À instruire séparément.

**Ces 7 points sont des propositions inter-équipes** : à inscrire au track comme liées à #57 et #87, et à instruire via un passage de décision consensuel — pas un choix d'un seul agent. Tant qu'ils ne sont pas actés, **statu quo sûr** : radar reste propriétaire de son socle, aucune action bloquante.

---

## Annexe — chiffres mesurés (origin/main @ 99cac6c)

| Composant | Lignes | Consomme le socle MapLibre ? | Cible |
|---|---:|---|---|
| `SignalPdfOverlay.svelte` | 2 116 | (viewer PDF) | core→cite-source, adaptateur immo |
| `SignauxSelPanel.svelte` | 1 855 | non (pane détail) | GeoDetailPanel + adaptateur immo |
| `SignauxMapView.svelte` | 1 649 | **oui (seul consommateur vivant)** | recomposé sur `CadastreMap` + §3 |
| `EvaluationMapView.svelte` | 1 342 | **non (rendu SVG divergent)** | migrer sur MapLibre d'abord |
| `GeoCityMapBase.svelte` | 1 075 | (EST le socle) | **→ geo (`CadastreMap`)** |
| `LotFichePanel.svelte` | 710 | non | GeoDetailPanel + slots immo |
| `lots-client.ts` | 690 | non (client OGC) | reste immo |
| `signaux-map-geo.ts` | 606 | non (projection) | reste immo |
| `SignauxRail.svelte` | 580 | non | reste immo (DS) |
| `eval-lot-filters.ts` | 362 | non | reste immo |
| `cadastre-geojson-source.ts` | 353 | (util socle) | **→ geo** |
| `zones-client.ts` | 351 | non (client OGC) | reste immo |
| `CadastreMapView.svelte` | 348 | oui | recomposé §3 |
| `OpportunitesMapView.svelte` | 320 | oui | recomposé §3 |
| `GeoView.svelte` | 319 | (déjà GeoMap geo) | **gabarit cible** |
| `pdf-overlay-signals.ts` | 285 | non | adaptateur immo (§5) |
| `LotDataFilterPanel.svelte` | 280 | non | reste immo (DS) |
| `selection-bucket.ts` | 262 | non | reste immo |
| `score-color-scale.ts` | 239 | non (paint immo) | reste immo |
| `zone-kind-style.ts` | 192 | non | **→ geo** (teinte cadastre) |
| `DocumentOverlay.svelte` | 165 | oui | recomposé §3 |
| `pdf-citation-match.ts` | 161 | non | **→ core cite-source** (générique) |
| `geo-categories.ts` | 156 | non (taxonomie immo) | reste immo (contrat §3) |
| `MapLegend.svelte` | 69 | non | **→ `GeoMapLegend`** geo |

**Paquet geo installé** : `@sentropic/geo-ui-svelte@0.1.1` — exporte `GeoMap`, `GeoMapLegend`, `GeoDetailPanel`, `GeoSearch`, `DatasetCatalog`, `AttributionBar` + modules `choropleth`/`point-layers`/`dataviz-adapter`. **Aucune primitive `BaseMap` bas-niveau** (cf. §4). `@sentropic/geo-core@0.1.1` (types GeoJSON/CRS), `@sentropic/dataviz-core` (moteur charts, non importé par radar).

**Synthèse ordre de grandeur** : ~1 700 l de socle carto migrables vers geo (couplage métier ≈ nul, déjà domain-agnostique) ; recomposition immo + cite-source + frontage ≈ 45–70 j-personne étalés, chemin critique 1→2→3, le reste parallélisable. **Le seul vrai blocage est le consensus geo sur la primitive `BaseMap`** — sans lui, statu quo sûr.
