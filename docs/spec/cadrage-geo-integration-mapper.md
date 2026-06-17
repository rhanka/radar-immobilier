# Cadrage — Géo-intégration : vues lots/zones + mapper opportunités↔entités géo réelles

> **Statut** : cadrage architectural (spec). Aucun code ici — ce document chiffre le chantier,
> arbitre les décisions de design et sert de brief aux lots d'implémentation.
> **Date** : 2026-06-15. **Auteur** : rhanka.
> **Périmètre** : WP « Geo-intégration » — 3 volets : (1) mapper Signal/DesignationEvent → entités
> géo réelles (Zone/Lot), (2) vues cartographiques lots/zones dans l'UI, (3) GeoDetailSchema +
> palette catégorie→couleur.
> **Loi 25** : rôle caviardé (no_lot uniquement, aucune PII propriétaire). Données géo =
> données publiques. Le rôle d'évaluation (nom propriétaire, adresse) reste hors périmètre.

---

## 0. TL;DR — décisions proposées

| # | Décision | Impact |
|---|---|---|
| **D1** | Le mapper extrait les codes zone/no-lot par **regex sur texte libre** (`label` + `props.properties.description`) car les champs structurés (`zone_ref`, `no_lot`, `reglement_number`) sont quasiment vides (1×/0×/0× sur 7 781 nœuds Signal/DesignationEvent). Taux de résolution V1 : **estimé 30–60 %**, honnêtement incertain. | Choix technique central — l'extraction vient du texte, pas des champs |
| **D2** | **Recommander l'extraction graphify** des codes zone/no-lot à la source (ontology v2.2) : peupler `zone_ref` et `no_lot` dans les nœuds Signal/DesignationEvent pendant le graphify, pour que le mapper devienne une simple jointure. C'est la piste long terme. | Lot séparé, non bloquant pour la V1 |
| **D3** | Les entités `Zone`/`Lot` PostGIS existent déjà dans l'ontologie (v2.1) ; on esquisse la **migration Drizzle** pour y ajouter les colonnes géométrie PostGIS + les arêtes Signal→Zone et Signal→Lot. | Modèle de données |
| **D4** | L'intégration des vues est **progressive** : nouvelle route `/geo` (ou flag feature) parallèle à `SignauxMapView`. Pas de rip de la vue Signaux existante. | Stratégie UI |
| **D5** | Le join MUS_CO_GEO est **côté immo** : la lib `@sentropic/geo-ui-svelte` reçoit uniquement la FeatureCollection fusionnée (polygones + props métier). | Frontière lib/app |

---

## 1. Contexte — pourquoi la résolution via texte libre

### 1.1 État réel des champs structurés (sondé 2026-06-15)

Sur 7 781 nœuds Signal et DesignationEvent dans la base graphifiée :

| Champ structuré | Remplissage |
|---|---|
| `zone_ref` | **1×** (quasi vide) |
| `no_lot` | **0×** |
| `reglement_number` | **0×** |
| `adresse` | **154×** |

**Conséquence directe** : le mapper ne peut pas s'appuyer sur des champs structurés pour la
résolution zone/lot. Il doit extraire les codes du texte libre (`label` du nœud + `description`
dans `props->'properties'`), puis les matcher aux polygones réels.

### 1.2 Nature du texte libre — formats observés par ville

Les codes de zone observés dans les PV et avis ont des formats variables selon la ville :

- `H-431`, `C-512`, `P-02` — format lettre-chiffres tiret (générique QC)
- `H34-327 (VLO)`, `P22-328 (VLO)` — format Longueuil (suffixe secteur)
- `H-9509`, `H-9506` — format Shawinigan
- `A1336`, `RU1302` — format Sherbrooke
- `1000`, `2000` — format Saguenay (numérique pur, ambiguïté haute)

Les numéros de lot cadastraux apparaissent sous la forme `6 057 912` (avec espaces, comme
dans `NO_LOT` de la couche cadastre allégé) ou `6057912` (sans espaces).

### 1.3 Taux de résolution attendu — honnêteté

**Le taux de résolution en V1 sera faible et variable.** Estimations :

- Codes de zone bien formés dans le texte : **~40–60 % des nœuds** pour les villes dont la couche
  zonage est disponible (ArcGIS + CKAN, ~15–250 villes selon l'avancement de l'acquisition géo).
- No-lot dans le texte : **~10–20 %** (les PV mentionnent rarement le no-lot explicitement).
- Adresses (154 signaux) → géocodage → lot : piste V2, non incluse en V1.
- **Pour les villes sans couche zonage vectorielle** (~850 villes) : résolution zone = 0 % par
  construction.

**Le mapper doit stocker explicitement le taux de non-résolution et ne jamais inventer une
correspondance.** Un score de confiance + une provenance horodatée sont obligatoires sur chaque arête.

---

## 2. Volet 1 — Mapper Signal/DesignationEvent → Zone/Lot

### 2.1 Architecture du mapper

```
┌─────────────────────────────────────────────────────────────────┐
│  INPUT : nœuds Signal + DesignationEvent (PG — table nodes)     │
│   → label (string)                                              │
│   → props->'properties'->>'description' (string)               │
│   → citySlug (pour restreindre au bon corpus de polygones)      │
└────────────────────────┬────────────────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │   EXTRACTEUR REGEX  │
              │  (immo, côté API)   │
              │  - zone_codes[]     │
              │  - no_lots[]        │
              └──────────┬──────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
  ┌────────────┐  ┌────────────┐  ┌──────────────┐
  │ ZONE MATCH │  │  LOT MATCH │  │ NON-RÉSOLU   │
  │ PostGIS    │  │ PostGIS    │  │ (stocké tel  │
  │ zones.code │  │ lots.no_lot│  │  quel)       │
  └─────┬──────┘  └─────┬──────┘  └──────────────┘
        │               │
        ▼               ▼
  arête Signal→Zone  arête Signal→Lot
  (relation concerns) (relation concerns)
  + score_confiance   + score_confiance
  + extrait_brut      + extrait_brut
  + as_of_date        + as_of_date
```

### 2.2 Extracteur regex — spécification

#### Extraction des codes de zone

```typescript
// Pattern 1 : format standard lettre(s) + chiffres + tiret (couvre ~80 % des villes QC)
const ZONE_CODE_PATTERN =
  /\b([A-Z]{1,3}[0-9]{0,2}[-–][A-Z0-9]{2,10}(?:\s*\([A-Z]{2,5}\))?)\b/g;

// Pattern 2 : mention explicite "zone X-123" (fonctionne sur tous formats)
const ZONE_CODE_EXPLICIT = /\bzone\s+([A-Z][A-Z0-9-]{1,12})\b/gi;

// Pattern 3 : numérique pur "zone 1000" (Saguenay-style — confiance basse)
const ZONE_CODE_NUMERIC = /\bzone\s+([0-9]{3,6})\b/gi;
```

Normalisation : supprimer les espaces, mettre en majuscules, tronquer le suffixe secteur
`(VLO)` → comparer `zones.code_norm` (même normalisation côté table).

#### Extraction des numéros de lot

```typescript
// Pattern 1 : mention explicite "lot 6 057 912"
const LOT_PATTERN = /\blot\s+([0-9](?:\s*[0-9]){3,7})\b/gi;

// Pattern 2 : compact 7+ chiffres (sans espace — ambiguïté, confiance basse)
const LOT_PATTERN_COMPACT = /\b([0-9]{7,10})\b/g;
```

Normalisation : supprimer les espaces → comparer `lots.no_lot_norm`
(no_lot avec `replace(/\s/g, '')`).

#### Score de confiance (heuristique V1)

| Situation | Score |
|---|---|
| Mention explicite `zone X-123` dans le texte | 0.85 |
| Code extrait par pattern standard (PATTERN 1) | 0.65 |
| Code numérique pur (ambiguïté possible) | 0.40 |
| Lot extrait par mention explicite | 0.75 |
| Lot extrait par pattern compact uniquement | 0.45 |

Seuil de publication d'arête : **score ≥ 0.50**. En dessous → stocker dans `geo_unresolved`.

### 2.3 Matching aux polygones réels

#### Zones

Jointure par `zones.code_norm = normalize(extracted_code) AND zones.city_slug = signal.city_slug`.

Si zéro polygone → non résolu (cas normal pour les villes sans couche vectorielle).

Si plusieurs polygones → prendre celui dont le code normalisé a une distance de Levenshtein ≤ 2
(uniquement si score ≥ 0.70, sinon non résolu).

#### Lots

Jointure par `lots.no_lot_norm = normalize(extracted_no_lot)`. La couche cadastre allégé est
province-entière → la jointure est possible pour toutes les villes dès que `lots` est peuplé.

**Option V2 (adresses)** : `ST_Contains(lots.geom, geocode(adresse))` pour les 154 signaux avec
adresse → résolution via géocodage + intersection spatiale.

### 2.4 Modèle de données — esquisse migration Drizzle

Les types `Zone` et `Lot` existent déjà dans l'ontologie v2.1 (table `nodes`). La migration
ajoute les colonnes PostGIS et les tables de résolution :

```sql
-- Enrichissement table zones : ajout géométrie
ALTER TABLE zones
  ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326),
  ADD COLUMN IF NOT EXISTS geom_source text,        -- 'arcgis' | 'ckan' | 'manual'
  ADD COLUMN IF NOT EXISTS geom_fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS code_norm text;          -- code normalisé (sans espaces/suffixe)
CREATE INDEX IF NOT EXISTS zones_geom_gist ON zones USING GIST (geom);
CREATE INDEX IF NOT EXISTS zones_code_norm_city ON zones (code_norm, city_slug);

-- Enrichissement table lots : ajout géométrie
ALTER TABLE lots
  ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326),
  ADD COLUMN IF NOT EXISTS geom_source text DEFAULT 'cadastre-allege',
  ADD COLUMN IF NOT EXISTS geom_fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_lot_norm text;        -- no_lot sans espaces
CREATE INDEX IF NOT EXISTS lots_geom_gist ON lots USING GIST (geom);
CREATE INDEX IF NOT EXISTS lots_no_lot_norm ON lots (no_lot_norm);

-- Table d'arêtes géo (Signal/DesignationEvent → Zone/Lot)
CREATE TABLE IF NOT EXISTS geo_resolutions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id       text NOT NULL,           -- id du nœud Signal ou DesignationEvent
  node_type     text NOT NULL,           -- 'Signal' | 'DesignationEvent'
  city_slug     text NOT NULL,
  relation_type text NOT NULL,           -- 'concerns_zone' | 'concerns_lot'
  target_id     text NOT NULL,           -- id de la Zone ou du Lot
  target_type   text NOT NULL,           -- 'Zone' | 'Lot'
  extrait_brut  text,                    -- texte brut extrait du label/description
  score_confiance numeric(3,2),          -- 0.00–1.00
  provenance    text,                    -- 'regex_zone_standard' | 'regex_lot' | ...
  as_of_date    date,                    -- date du signal/événement
  resolved_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS geo_resolutions_node ON geo_resolutions (node_id);
CREATE INDEX IF NOT EXISTS geo_resolutions_city ON geo_resolutions (city_slug);

-- Table des non-résolus (audit + amélioration continue)
CREATE TABLE IF NOT EXISTS geo_unresolved (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id        text NOT NULL,
  node_type      text NOT NULL,
  city_slug      text NOT NULL,
  extrait_brut   text,
  pattern_type   text,               -- 'zone_code' | 'no_lot'
  score_confiance numeric(3,2),
  raison         text,               -- 'no_polygon' | 'score_too_low' | 'ambiguous'
  created_at     timestamptz DEFAULT now()
);

-- Vue Zone⊃Lot (lots contenus dans une zone — jointure spatiale)
CREATE OR REPLACE VIEW zone_lots AS
  SELECT
    z.id   AS zone_id,
    z.code AS zone_code,
    z.city_slug,
    l.id   AS lot_id,
    l.no_lot,
    ST_Area(ST_Intersection(z.geom, l.geom)::geography)
      / NULLIF(ST_Area(l.geom::geography), 0) AS overlap_ratio
  FROM zones z
  JOIN lots  l ON ST_Intersects(z.geom, l.geom) AND z.city_slug = l.city_slug
  WHERE ST_Area(ST_Intersection(z.geom, l.geom)::geography)
        / NULLIF(ST_Area(l.geom::geography), 0) > 0.5;
```

### 2.5 Recommandation — extraction graphify (ontology v2.2)

**Cause racine** du problème de résolution : les champs `zone_ref` et `no_lot` ne sont pas
peuplés par graphify car le LLM n'est pas guidé pour les extraire structurellement.

**Recommandation** : ouvrir un lot **ontology v2.2** pour ajouter des `extraction_hints` dans
`ontology-profile.yaml` sur les types Signal et DesignationEvent :

- `zone_ref` — extraction ciblée regex `[A-Z][A-Z0-9-]{2,12}` dans le contexte "zone".
- `no_lot` — extraction ciblée regex `[0-9\s]{7,12}` dans le contexte "lot".

Ces hints deviennent des instructions au LLM graphify → taux de résolution attendu **70–85 %**
(vs 30–60 % en regex post-hoc). Le mapper en V2 devient alors une simple jointure PG.

**Séquence recommandée** :
- **V1 (ce WP)** : mapper regex texte libre → taux ~30–60 %, table `geo_unresolved` pour mesure.
- **V2 (lot ontology v2.2)** : extraction graphify → taux ~70–85 %, maintenable.

---

## 3. Volet 2 — Vues lots/zones (composant GeoMap)

### 3.1 Contrat `@sentropic/geo-ui-svelte@0.1.0` (rappel)

Exports : `GeoMap`, `GeoMapLegend`, `GeoDetailPanel`, `GeoSearch`, `AttributionBar`.

**`GeoMap` props clés** :
- `data?: FeatureCollection` — GeoJSON WGS84.
- `layerKind?: 'choropleth' | 'hexbin' | 'cluster' | 'density'` — défaut `choropleth`.
- `categories?: GeoCategory[]` + `categoryKey?` — colorisation par catégorie.
- `valueKey?` + `binCount?` + `binMethod?` — mode valeur numérique.
- `pointLayer?` — overlay points au-dessus des polygones.
- `onHover?(hit)` + `onSelect?(hit)` — `hit = { id, properties, geometry }`.
- `legend?` + `legendPosition?`, `height?`, `fitBounds?`.
- Basemap = fond tokenisé DS (pas de tuiles OSM directes — PMTiles plus tard).

**`<GeoDetailPanel feature={hit} schema={GeoDetailSchema} />`** — panneau détail structuré.

**`GeoDetailSchema`** = `{ titleKey?, fields: GeoDetailField[], levels?: [{id, labelFr}] }`.

**Règle frontière** : le join MUS_CO_GEO est **côté immo**. La lib reçoit uniquement la
FeatureCollection fusionnée. L'API HTTP géo n'est pas appelée en live depuis le composant.

### 3.2 Architecture des couches — vue GeoZonage

La vue `/geo` (ou flag `?view=geo` sur `/signaux`) organise les couches ainsi :

```
Couche 1 — ZONES (polygones, choroplèthe par catégorie d'opportunité)
  data = FeatureCollection<Polygon>  — fourni par immo (fusionné avec polygones géo)
    properties immo :
      zone_code       : string        (ex. "H34-327")
      zone_usage      : string        (ex. "Habitation")
      city_slug       : string
      signal_count    : number        (nb signaux résolus sur cette zone)
      category        : string        (catégorie dominante — GeoCategory.id)
      anticipation    : string | null (étape la plus précoce parmi les signaux)
      url_grille      : string | null (PDF grille d'usage — depuis ArcGIS/CKAN)
  categoryKey = "category"
  layerKind = "choropleth"

Couche 2 — LOTS 4+ (polygones, choroplèthe distinct)
  data = FeatureCollection<Polygon>
    properties immo :
      no_lot          : string
      city_slug       : string
      nb_unites_max   : number | null
      zone_code       : string | null
      category        : string | null  (ex. "multifamilial_4plus")
  Filtre : nb_unites_max >= 4 OU catégorie "multifamilial_4plus"
  layerKind = "choropleth" (teinte violet/indigo distincte des zones)

Overlay — OPPORTUNITÉS (points, cluster)
  data = FeatureCollection<Point>
    properties immo :
      signal_id       : string
      category        : string
      etape           : string | null
      date            : string
      city_slug       : string
  layerKind = "cluster"
  pointLayer = true  (au-dessus des polygones)
```

### 3.3 Stratégie d'intégration progressive

**Règle absolue** : NE PAS modifier `SignauxMapView.svelte` ni `SignauxRail.svelte`. La vue
Signaux existante est stable et ne doit pas régresser.

**Plan d'intégration en 5 étapes** :

1. **Étape A** — Nouvelle page `GeoView.svelte` sur route `/geo`, cachée derrière un feature flag
   env (`GEO_VIEW_ENABLED=true` ou cookie). Squelette vide, aucun impact sur les routes existantes.
2. **Étape B** — Service API : `GET /api/geo/zones?city=<slug>` → FeatureCollection zones + props
   métier (signal_count, category, url_grille). Idem `GET /api/geo/lots?city=<slug>&min_units=4`.
   Ces endpoints consomment les tables `zones` + `geo_resolutions` construites en Volet 1.
3. **Étape C** — Wiring `GeoMap` avec la FeatureCollection fusionnée côté Svelte. Choroplèthe
   zones colorées par `category` (palette `GEO_CATEGORIES`). Overlay clusters opportunités.
4. **Étape D** — `GeoDetailPanel` avec `GEO_ZONE_DETAIL_SCHEMA` (§4.2). Relier à `onSelect`.
   `GeoSearch` pour chercher une zone ou un lot.
5. **Étape E** (V2) — Activer le flag en prod après UAT. Documenter le handoff.

---

## 4. Volet 3 — GeoDetailSchema + mapping catégorie→couleur

### 4.1 `GeoCategory[]` — palette complète

Palette conçue pour être cohérente avec la palette existante du rail Signaux
(`SignauxRail.svelte` : `TYPE_PALETTE` 12 couleurs + badges amber/yellow/green).

```typescript
// geo-detail-schema-mapping.ts — reproductible comme GeoCategory[]

export const GEO_CATEGORIES: GeoCategory[] = [
  // ── Catégories réglementaires principales ─────────────────────────────────
  { id: "rezonage",              labelFr: "Rezonage",                  color: "#6366f1" }, // indigo-500
  { id: "derogation",            labelFr: "Dérogation",                color: "#f59e0b" }, // amber-500
  { id: "derogation_mineure",    labelFr: "Dérogation mineure",        color: "#fbbf24" }, // amber-400
  { id: "piia",                  labelFr: "PIIA",                      color: "#8b5cf6" }, // violet-500
  { id: "ppcmoi",                labelFr: "PPCMOI",                    color: "#a855f7" }, // purple-500
  { id: "lotissement",           labelFr: "Lotissement",               color: "#10b981" }, // emerald-500
  { id: "subdivision",           labelFr: "Subdivision",               color: "#14b8a6" }, // teal-500
  { id: "densification",         labelFr: "Densification",             color: "#ef4444" }, // red-500
  { id: "usage_conditionnel",    labelFr: "Usage conditionnel",        color: "#f97316" }, // orange-500
  { id: "modification_zonage",   labelFr: "Modification de zonage",    color: "#3b82f6" }, // blue-500
  { id: "changement_usage",      labelFr: "Changement d'usage",        color: "#22c55e" }, // green-500
  { id: "zone_agricole",         labelFr: "Zone agricole",             color: "#84cc16" }, // lime-500
  { id: "cptaq",                 labelFr: "CPTAQ",                     color: "#65a30d" }, // lime-600
  { id: "patrimoine",            labelFr: "Patrimoine",                color: "#78716c" }, // stone-500
  // ── Axe dimension (transversal — niveau "dimension") ─────────────────────
  { id: "multifamilial_4plus",   labelFr: "Multifamilial 4+",          color: "#7c3aed", level: "dimension" }, // violet-700
  // ── Axe anticipation (étapes réglementaires — niveau "anticipation") ─────
  // Gamme cyan→purple : du plus précoce (cyan) au plus tardif (purple)
  { id: "avis_motion",           labelFr: "Avis de motion",            color: "#06b6d4", level: "anticipation" }, // cyan-500
  { id: "projet_reglement",      labelFr: "Projet de règlement",       color: "#0ea5e9", level: "anticipation" }, // sky-500
  { id: "consultation_publique", labelFr: "Consultation publique",     color: "#3b82f6", level: "anticipation" }, // blue-500
  { id: "second_projet",         labelFr: "Second projet",             color: "#6366f1", level: "anticipation" }, // indigo-500
  { id: "adoption",              labelFr: "Adoption",                  color: "#8b5cf6", level: "anticipation" }, // violet-500
  { id: "entree_vigueur",        labelFr: "Entrée en vigueur",         color: "#a855f7", level: "anticipation" }, // purple-500
];
```

**Logique de cohérence couleurs** :
- **Rezonage** (indigo-500) : couleur principale, la plus fréquente, non ambigu.
- **Dérogations** (amber) : cohérent avec `axis-badge--dimension` du rail (jaune).
- **PIIA/PPCMOI/usage conditionnel** (violet/purple/orange) : instruments à résolution autonome.
- **Lotissement/Subdivision** (emerald/teal) : opérations foncières constructives.
- **Densification** (red-500) : signal fort, cohérent avec le rouge `axis-badge` d'alerte.
- **Modification/Changement** (blue/green) : nuances d'une même famille réglementaire.
- **Zone agricole/CPTAQ** (lime) : registre environnemental/réglementaire protecteur.
- **Patrimoine** (stone neutre) : contrainte non-opportuniste.
- **Dimension 4+** (violet-700) : axe transversal, distingué du pipeline principal.
- **Anticipation** (cyan→purple) : progression temporelle cohérente avec `axis-badge--anticipation`
  vert du rail — le cyan (plus précoce) et le purple (plus tardif) forment une rampe lisible.

### 4.2 `GeoDetailSchema` complet

```typescript
// geo-detail-schema-mapping.ts (suite)

import type { GeoDetailSchema, GeoDetailField } from "@sentropic/geo-ui-svelte";

// Schéma pour le panneau détail d'une ZONE
export const GEO_ZONE_DETAIL_SCHEMA: GeoDetailSchema = {
  titleKey: "zone_code",
  levels: [
    { id: "base",         labelFr: "Général" },
    { id: "dimension",    labelFr: "Dimension" },
    { id: "anticipation", labelFr: "Anticipation" },
    { id: "zonage",       labelFr: "Zonage" },
  ],
  fields: [
    // ── Niveau base (toujours visible) ────────────────────────────────────
    { key: "zone_code",       labelFr: "Code de zone",          kind: "text" },
    { key: "zone_usage",      labelFr: "Usage",                 kind: "text" },
    { key: "city_slug",       labelFr: "Municipalité",          kind: "text" },
    { key: "signal_count",    labelFr: "Signaux attachés",      kind: "number" },
    { key: "category",        labelFr: "Catégorie principale",  kind: "text" },
    // ── Niveau dimension ──────────────────────────────────────────────────
    { key: "nb_unites_min",   labelFr: "Unités min estimées",   kind: "number",   level: "dimension" },
    { key: "nb_unites_max",   labelFr: "Unités max estimées",   kind: "number",   level: "dimension" },
    { key: "superficie_m2",   labelFr: "Superficie (m²)",       kind: "number",   level: "dimension" },
    // ── Niveau anticipation ───────────────────────────────────────────────
    { key: "etape",           labelFr: "Étape réglementaire",   kind: "text",     level: "anticipation" },
    { key: "etape_date",      labelFr: "Date de l'étape",       kind: "date",     level: "anticipation" },
    // ── Niveau zonage ─────────────────────────────────────────────────────
    { key: "bylaw",           labelFr: "Règlement constitutif", kind: "text",     level: "zonage" },
    { key: "url_grille",      labelFr: "Grille d'usage (PDF)",  kind: "pdf",      level: "zonage" },
    { key: "source_ref",      labelFr: "Source PV",             kind: "citation", level: "zonage" },
    { key: "source_url",      labelFr: "Lien document source",  kind: "url",      level: "zonage" },
    { key: "geom_source",     labelFr: "Source géométrie",      kind: "text",     level: "zonage" },
    { key: "geom_fetched_at", labelFr: "Géométrie mise à jour", kind: "date",     level: "zonage" },
  ] satisfies GeoDetailField[],
};

// Schéma pour le panneau détail d'un LOT
export const GEO_LOT_DETAIL_SCHEMA: GeoDetailSchema = {
  titleKey: "no_lot",
  levels: [
    { id: "base",   labelFr: "Général" },
    { id: "zonage", labelFr: "Zonage" },
  ],
  fields: [
    { key: "no_lot",          labelFr: "Numéro de lot",         kind: "text" },
    { key: "city_slug",       labelFr: "Municipalité",          kind: "text" },
    { key: "superficie_m2",   labelFr: "Superficie (m²)",       kind: "number" },
    { key: "usage",           labelFr: "Usage actuel",          kind: "text" },
    { key: "zone_code",       labelFr: "Zone affectée",         kind: "text",  level: "zonage" },
    { key: "signal_count",    labelFr: "Signaux attachés",      kind: "number",level: "zonage" },
    { key: "geom_source",     labelFr: "Source géométrie",      kind: "text",  level: "zonage" },
    { key: "geom_fetched_at", labelFr: "Géométrie mise à jour", kind: "date",  level: "zonage" },
  ] satisfies GeoDetailField[],
};
```

---

## 5. Plan d'incréments + estimation d'effort

| Incrément | Contenu | Pré-requis | Effort estimé | Livrable |
|---|---|---|---|---|
| **G1** — Mapper V1 (regex) | Extracteur regex zone_code/no_lot + tables `geo_resolutions`/`geo_unresolved`. Service `resolve-geo`. Migration Drizzle colonnes géom. | Couche zones ArcGIS/CKAN ≥ 1 ville pilote | **3–5 j-h** | Script mapper + migration + tests unitaires |
| **G2** — Peuplement PostGIS | Pipeline import `zones.geom` depuis arcgis-zonage/ckan-zonage → PostGIS. Import `lots.geom` depuis cadastre-allege. | G1 + adapters P0/P1 livrés (déjà faits) | **2–4 j-h** | Commandes import + index GiST |
| **G3** — Route `/geo` + GeoMap | Page `GeoView.svelte`, API `GET /api/geo/zones`, wiring `GeoMap` choroplèthe, feature flag. | G1 + G2 + `geo-ui-svelte@0.1.0` installé | **4–6 j-h** | Vue zones colorées par catégorie |
| **G4** — GeoDetailPanel | Wiring `GeoDetailPanel` avec `GEO_ZONE_DETAIL_SCHEMA` + `GEO_LOT_DETAIL_SCHEMA`, overlay lots 4+. | G3 | **2–3 j-h** | Panneau détail complet |
| **G5** — Adresse→lot (V2) | Géocodage 154 signaux avec adresse → `ST_Contains` → arête Signal→Lot. | G2 + géocodeur QC | **3–5 j-h** | Résolution adresse→lot |
| **G6** — Extraction graphify v2.2 | Ajout `extraction_hints` profil ontologie → `zone_ref`/`no_lot` peuplés à la source. Re-graphify villes pilotes. | G1 (pour mesurer delta) | **2–4 j-h** | Profil v2.2 + re-graphify + delta metrics |

**Effort V1 (G1–G4) : ~11–18 j-h** pour mapper fonctionnel + vues lots/zones.
**Effort V2 (G5–G6) : ~5–9 j-h** additionnels.

**Taux de résolution attendu** :
- V1 regex seul (G1–G4) : **~30–60 %** pour les villes avec couche vectorielle.
- V2 graphify v2.2 (G6) : montée à **~70–85 %** pour les villes re-graphifiées.
- Global toutes villes : **< 30 %** tant que l'acquisition géo des ~850 villes PDF/JMap est incomplète.

---

## 6. Inconnues et risques honnêtes

| Risque | Impact | Mitigation |
|---|---|---|
| Regex trop permissive → faux positifs (codes de règlement mal interprétés comme codes de zone) | Arêtes Signal→Zone incorrectes | Score de confiance + seuil 0.50 + `geo_unresolved` pour audit |
| Codes de zone non normalisés entre texte et couche ArcGIS (ex. "H34-327 (VLO)" vs "H34327") | Zéro match malgré extraction correcte | Normalisation + distance Levenshtein ≤ 2 + log non-résolus |
| Villes sans couche vectorielle (~850) → résolution zone = 0 % | Couverture géo faible en V1 | Badge "couche indisponible" dans l'UI — pas d'invention |
| Cadastre allégé : 4,64 M lots → import lent (2 322 pages × 2 000 lots) | Performance peuplement | Import par bbox (villes prioritaires d'abord) + tâche background |
| `geo-ui-svelte@0.1.0` API non encore finalisée | Régression API sans version pin | Pin exact dans `package.json` |
| Taux résolution V1 < 30 % → valeur perçue faible | Dépriorisation du WP | Communiquer honnêtement + montrer roadmap V2 avant livraison |

---

## 7. Références

- Adapters géo livrés :
  - `packages/radar-sources/src/geo/cadastre-allege.ts` (P0-A — lots province-entière)
  - `packages/radar-sources/src/geo/arcgis-zonage.ts` (P0-B — crawler ArcGIS REST générique)
  - `packages/radar-sources/src/geo/ckan-zonage.ts` (P1-A — Données Québec CKAN)
- Cadrage acquisition zones/lots : `docs/spec/cadrage-zones-lots-acquisition.md` (PR #203)
- Suivi acquisition : `docs/study/acquisition-zones-lots-suivi.md`
- Ontologie v2.1 : `radar/ontology/ontology-profile.yaml`
- Modèle de données ontologie : `docs/spec/SPEC_ONTOLOGY_DATA_MODEL.md`
- Vue Signaux existante (palette) : `ui/src/lib/components/maps/SignauxMapView.svelte` +
  `ui/src/lib/components/maps/SignauxRail.svelte`
- Mapping GeoCategory + GeoDetailSchema (livrable concret) : `docs/spec/geo-detail-schema-mapping.md`
- Frontière carto/DS (issue #56) : `docs/spec/audit-ds-realignement.md`
- Modèle temporel : `docs/spec/SPEC_INTENT_DATA_MODEL_ZONING_LOTS.md`
