# DS enrichment request — cartographic / geospatial visualization component

> Statut : **demande d'enrichissement** adressée à l'architecte `@sentropic/design-system`.
> Origine : LOT DEV FRONTEND carto de `radar-immobilier` (branche `feat/carto-maplibre-ds`).
> En attendant, le radar embarque un **wrapper MapLibre MINCE provisoire**
> (`ui/src/lib/components/maps/CadastreMapView.svelte`) conforme aux tokens DS,
> explicitement marqué « provisoire en attente du composant DS carto ».

## 1. Besoin

Le design-system `@sentropic/design-system-svelte` (v0.7.0) expose 56 composants
(Button, Card, Badge, Alert, DataTable, Drawer, Modal, …) mais **aucun composant
de visualisation cartographique / géospatiale** (pas de `Map`, `MapView`,
`GeoMap`, `Carto`, `MapLibre`, `Leaflet`). Vérifié dans
`@sentropic/design-system-svelte/dist/index.js`.

`radar-immobilier` a besoin de rendre des couches **GeoJSON à l'échelle**
(>200 — jusqu'à ~11 000 lots cadastraux par ville), coloriées par un **score
continu data-driven par lot**, avec contrôles de couches (lots / zones / TOD),
labels dépendants du zoom, et popups de détail. C'est un besoin **transverse**
(toutes les vues carto du radar : Signaux / Opportunités / Évaluation / Sources),
donc un bon candidat à la mutualisation dans le DS plutôt qu'à un one-off radar.

## 2. Pourquoi MapLibre GL

- **Échelle** : rendu GPU de polygones via couches `fill`/`line` + expressions
  `interpolate`/`case` data-driven. Le coloriage par feature n'est PAS calculé en
  JS (le moteur interpole), ce qui tient à >200 features là où un rendu SVG
  capait à 200.
- **Open source** (BSD-3), pas de clé API obligatoire, fonds de carte
  configurables (raster/vector), compatible PMTiles/tuiles vectorielles pour la
  montée en charge (150 villes).
- **GeoJSON natif** : `addSource({type:"geojson"})` + `setData()` ; pas d'adaptateur
  géométrique custom.

## 3. API souhaitée du composant DS

Un composant `Map` (ou `GeoMap`) « tête nue » + des sous-composants de couche, qui
**n'impose aucune palette** et **consomme les tokens DS** :

```svelte
<Map
  bind:this={map}
  bounds={[lonMin, latMin, lonMax, latMax]}
  center={[lon, lat]}
  zoom={14}
  styleUrl="https://…/style.json"   {/* ou un style minimal DS par défaut */}
  attributionControl
  on:load on:moveend on:featureclick
>
  <GeoJsonLayer
    id="lots"
    type="fill"
    data={lotFeatureCollection}
    paint={{
      "fill-color": colorExpression,   {/* expression MapLibre fournie par l'app */}
      "fill-opacity": opacityExpression,
    }}
    interactive
  />
  <GeoJsonLayer id="zones" type="line" data={zoneFC} paint={{ "line-color": "var(--st-…)" }} />
  <SymbolLayer id="zone-labels" data={zoneFC} minzoom={14} textField="zone" />
</Map>
```

### Props clés

| Prop | Type | Rôle |
|---|---|---|
| `bounds` | `[number,number,number,number]` | cadrage initial (lonMin,latMin,lonMax,latMax) |
| `center` / `zoom` | `[number,number]` / `number` | position initiale |
| `styleUrl` | `string?` | fond de carte ; **défaut = un style minimal aligné tokens DS** |
| `data` (layer) | `FeatureCollection` | source GeoJSON, mise à jour réactive (`setData`) |
| `paint` (layer) | `Record<string, unknown>` | passe-plat des expressions MapLibre (couleurs = tokens DS) |
| `interactive` (layer) | `boolean` | active hover/click + événements `featureclick`/`featurehover` |
| `minzoom` / `maxzoom` (layer) | `number?` | labels/civiques dépendants du zoom |

### Événements

`load`, `moveend` (→ état d'URL zoom/centre), `featureclick` (→ fiche/détail),
`featurehover`. Le composant ne décide PAS de la palette : l'app fournit les
expressions de `paint` construites à partir des tokens DS (`--st-semantic-*`).

### Intégration tokens (load-bearing)

- Le composant ne doit embarquer **aucun hex en dur**. Fond, contours par défaut,
  attribution : lus depuis `--st-semantic-surface-*`, `--st-semantic-text-*`.
- Exposer un helper `resolveToken(name, el)` (ou documenter le pattern
  `getComputedStyle`) pour que les expressions data-driven (rampes de score)
  pointent vers les tokens `--st-semantic-feedback-*` / `--st-semantic-data-categoryN`.

## 4. En attendant — wrapper provisoire radar

Tant que le composant DS n'existe pas, le radar livre :

- `ui/src/lib/components/maps/CadastreMapView.svelte` — wrapper MINCE MapLibre,
  import dynamique de `maplibre-gl`, couches lots/zones/TOD, coloriage par
  `score-color-scale.ts` (rampe **dérivée des tokens DS**, zéro palette inventée),
  chrome UI (panneaux, badges, légende) en composants DS (`Badge`, `Alert`),
  marqué en tête « provisoire en attente du composant DS carto ».
- `ui/src/lib/maps/score-color-scale.ts` — rampe de score → tokens DS, réutilisable
  tel quel par le futur composant DS.

Quand le composant DS atterrit, remplacer le corps du wrapper par `<Map>` + couches
DS, en conservant `score-color-scale.ts` et le loader `cadastre-geojson-source.ts`.

## 5. Demandé à l'architecte sentropic

1. Trancher : composant carto **dans le DS** vs. package satellite
   `@sentropic/design-system-maplibre` (svelte). Préco : package satellite (dépendance
   MapLibre lourde, ne pas alourdir le bundle DS de base).
2. Valider l'**API ci-dessus** (props/événements/intégration tokens).
3. Fournir un **style de fond minimal aligné tokens** (clair + sombre via
   `ThemeProvider`).
