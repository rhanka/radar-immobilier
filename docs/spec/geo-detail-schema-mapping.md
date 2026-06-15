# geo-detail-schema-mapping — GeoCategory[] + GeoDetailSchema

> **Statut** : livrable concret (spec + code TypeScript d'exemple).
> **Date** : 2026-06-15. **Auteur** : rhanka.
> **Usage** : importer depuis `@immo/geo-detail-schema` (à créer) ou copier dans
> `ui/src/lib/geo/geo-detail-schema-mapping.ts`. Consommé par `GeoDetailPanel` de
> `@sentropic/geo-ui-svelte@0.1.0`.
> **Loi 25** : aucune PII. Données géo = données publiques.

---

## 1. Types locaux (conformes à `@sentropic/geo-ui-svelte@0.1.0`)

```typescript
/** Catégorie géo pour GeoMap (prop `categories`). */
export interface GeoCategory {
  /** Identifiant unique — correspond à la valeur de `categoryKey` dans les props GeoJSON. */
  id: string;
  /** Label affiché dans la légende et le panneau détail. */
  labelFr: string;
  /** Couleur hex pour l'aplat choroplèthe et la légende. */
  color: string;
  /**
   * Niveau optionnel : "dimension" (axe transversal multifamilial) ou
   * "anticipation" (étapes du pipeline réglementaire v2.1).
   * Absent = catégorie principale du signal.
   */
  level?: "dimension" | "anticipation";
}

/** Champ affiché dans GeoDetailPanel. */
export interface GeoDetailField {
  /** Clé dans `feature.properties`. */
  key: string;
  /** Label affiché. */
  labelFr: string;
  /**
   * Rendu : "text" (défaut), "number" (localisation numérique), "url" (lien hypertexte),
   * "pdf" (lien PDF + icône), "date" (format court fr-CA), "citation" (référence PV).
   */
  kind?: "text" | "number" | "url" | "pdf" | "date" | "citation";
  /** Niveau de détail (correspond à GeoDetailSchema.levels[].id). Absent = niveau de base. */
  level?: string;
}

/** Schéma de présentation pour GeoDetailPanel. */
export interface GeoDetailSchema {
  /** Clé de la propriété utilisée comme titre du panneau. */
  titleKey?: string;
  /** Champs à afficher. */
  fields: GeoDetailField[];
  /** Niveaux de détail (tabs ou accordéon dans le panneau). */
  levels?: { id: string; labelFr: string }[];
}
```

---

## 2. `GeoCategory[]` — palette catégories + étapes

```typescript
// ─────────────────────────────────────────────────────────────────────────────
// GEO_CATEGORIES
//
// Palette pour GeoMap (prop `categories`, `categoryKey = "category"`).
//
// Structure :
//   - 14 catégories réglementaires principales (sans level)
//   - 1 dimension transversale : multifamilial_4plus (level "dimension")
//   - 6 étapes d'anticipation (level "anticipation") — etape_enum v2.1
//
// Cohérence avec SignauxRail.svelte :
//   - TYPE_PALETTE 12 couleurs (#4f7cac, #f59e0b, #10b981, #ef4444, #8b5cf6, …)
//   - axis-badge--zonage : sky-100 (neutre)
//   - axis-badge--dimension : yellow-100 (amber) → dérogation et dérogation mineure en amber
//   - axis-badge--anticipation : green-100 → étapes d'anticipation en cyan→purple
// ─────────────────────────────────────────────────────────────────────────────
export const GEO_CATEGORIES: GeoCategory[] = [

  // ── Catégories réglementaires principales ─────────────────────────────────

  {
    id: "rezonage",
    labelFr: "Rezonage",
    color: "#6366f1",   // indigo-500 — catégorie principale, fréquente
  },
  {
    id: "derogation",
    labelFr: "Dérogation",
    color: "#f59e0b",   // amber-500 — cohérent axis-badge--dimension (jaune/amber)
  },
  {
    id: "derogation_mineure",
    labelFr: "Dérogation mineure",
    color: "#fbbf24",   // amber-400 — variante plus claire de dérogation
  },
  {
    id: "piia",
    labelFr: "PIIA",
    color: "#8b5cf6",   // violet-500 — instrument à résolution autonome
  },
  {
    id: "ppcmoi",
    labelFr: "PPCMOI",
    color: "#a855f7",   // purple-500 — instrument à résolution autonome, distinct PIIA
  },
  {
    id: "lotissement",
    labelFr: "Lotissement",
    color: "#10b981",   // emerald-500 — opération foncière constructive
  },
  {
    id: "subdivision",
    labelFr: "Subdivision",
    color: "#14b8a6",   // teal-500 — variante lotissement
  },
  {
    id: "densification",
    labelFr: "Densification",
    color: "#ef4444",   // red-500 — signal fort, cohérent avec signalCountColor(6+) du rail
  },
  {
    id: "usage_conditionnel",
    labelFr: "Usage conditionnel",
    color: "#f97316",   // orange-500 — instrument autonome, cohérent signalCountColor(3-5)
  },
  {
    id: "modification_zonage",
    labelFr: "Modification de zonage",
    color: "#3b82f6",   // blue-500 — variante réglementaire du rezonage
  },
  {
    id: "changement_usage",
    labelFr: "Changement d'usage",
    color: "#22c55e",   // green-500 — opération d'usage (non structurel)
  },
  {
    id: "zone_agricole",
    labelFr: "Zone agricole",
    color: "#84cc16",   // lime-500 — registre environnemental/agricole
  },
  {
    id: "cptaq",
    labelFr: "CPTAQ",
    color: "#65a30d",   // lime-600 — registre CPTAQ (plus foncé que zone_agricole)
  },
  {
    id: "patrimoine",
    labelFr: "Patrimoine",
    color: "#78716c",   // stone-500 — contrainte patrimoniale neutre
  },

  // ── Axe dimension (transversal, level "dimension") ────────────────────────

  {
    id: "multifamilial_4plus",
    labelFr: "Multifamilial 4+",
    color: "#7c3aed",   // violet-700 — axe transversal, distingué du pipeline
    level: "dimension",
  },

  // ── Axe anticipation (étapes réglementaires, level "anticipation") ─────────
  // Gamme cyan→purple : du plus précoce (cyan-500) au plus tardif (purple-500).
  // Cohérent avec axis-badge--anticipation (green-100 du rail) tout en formant
  // une rampe temporelle lisible (cyan = frais/précoce, purple = avancé/tardif).

  {
    id: "avis_motion",
    labelFr: "Avis de motion",
    color: "#06b6d4",   // cyan-500 — étape index 0, anticipation maximale
    level: "anticipation",
  },
  {
    id: "projet_reglement",
    labelFr: "Projet de règlement",
    color: "#0ea5e9",   // sky-500 — étape index 1
    level: "anticipation",
  },
  {
    id: "consultation_publique",
    labelFr: "Consultation publique",
    color: "#3b82f6",   // blue-500 — étape index 2
    level: "anticipation",
  },
  {
    id: "second_projet",
    labelFr: "Second projet",
    color: "#6366f1",   // indigo-500 — étape index 3
    level: "anticipation",
  },
  {
    id: "adoption",
    labelFr: "Adoption",
    color: "#8b5cf6",   // violet-500 — étape index 4
    level: "anticipation",
  },
  {
    id: "entree_vigueur",
    labelFr: "Entrée en vigueur",
    color: "#a855f7",   // purple-500 — étape index 5, anticipation minimale
    level: "anticipation",
  },
];

// ── Lookups utilitaires ───────────────────────────────────────────────────────

/** Retourne la GeoCategory par id, ou undefined si inconnue. */
export function getGeoCategory(id: string): GeoCategory | undefined {
  return GEO_CATEGORIES.find((c) => c.id === id);
}

/** Retourne la couleur d'une catégorie, ou une couleur neutre si inconnue. */
export function geoCategoryColor(id: string): string {
  return getGeoCategory(id)?.color ?? "#94a3b8"; // slate-400 (fallback neutre)
}

/** Catégories principales (sans level). */
export const GEO_MAIN_CATEGORIES = GEO_CATEGORIES.filter((c) => !c.level);

/** Catégories dimension. */
export const GEO_DIMENSION_CATEGORIES = GEO_CATEGORIES.filter(
  (c) => c.level === "dimension",
);

/** Catégories anticipation (dans l'ordre du pipeline). */
export const GEO_ANTICIPATION_CATEGORIES = GEO_CATEGORIES.filter(
  (c) => c.level === "anticipation",
);
```

---

## 3. `GeoDetailSchema` — zones et lots

```typescript
// ─────────────────────────────────────────────────────────────────────────────
// GEO_ZONE_DETAIL_SCHEMA
//
// Schéma pour <GeoDetailPanel feature={hitZone} schema={GEO_ZONE_DETAIL_SCHEMA} />
// Niveaux : base (toujours visible) / dimension / anticipation / zonage
// ─────────────────────────────────────────────────────────────────────────────
export const GEO_ZONE_DETAIL_SCHEMA: GeoDetailSchema = {
  titleKey: "zone_code",
  levels: [
    { id: "base",         labelFr: "Général" },
    { id: "dimension",    labelFr: "Dimension" },
    { id: "anticipation", labelFr: "Anticipation" },
    { id: "zonage",       labelFr: "Zonage" },
  ],
  fields: [
    // ── Niveau base ───────────────────────────────────────────────────────────
    // Clé de prop GeoJSON    Label FR                  Kind        Niveau
    { key: "zone_code",       labelFr: "Code de zone",          kind: "text" },
    { key: "zone_usage",      labelFr: "Usage",                 kind: "text" },
    { key: "city_slug",       labelFr: "Municipalité",          kind: "text" },
    { key: "signal_count",    labelFr: "Signaux attachés",      kind: "number" },
    { key: "category",        labelFr: "Catégorie principale",  kind: "text" },

    // ── Niveau dimension ──────────────────────────────────────────────────────
    { key: "nb_unites_min",   labelFr: "Unités min estimées",   kind: "number",   level: "dimension" },
    { key: "nb_unites_max",   labelFr: "Unités max estimées",   kind: "number",   level: "dimension" },
    { key: "superficie_m2",   labelFr: "Superficie (m²)",       kind: "number",   level: "dimension" },

    // ── Niveau anticipation ───────────────────────────────────────────────────
    { key: "etape",           labelFr: "Étape réglementaire",   kind: "text",     level: "anticipation" },
    { key: "etape_date",      labelFr: "Date de l'étape",       kind: "date",     level: "anticipation" },

    // ── Niveau zonage ─────────────────────────────────────────────────────────
    { key: "bylaw",           labelFr: "Règlement constitutif", kind: "text",     level: "zonage" },
    { key: "url_grille",      labelFr: "Grille d'usage (PDF)",  kind: "pdf",      level: "zonage" },
    { key: "source_ref",      labelFr: "Source PV",             kind: "citation", level: "zonage" },
    { key: "source_url",      labelFr: "Lien document source",  kind: "url",      level: "zonage" },
    { key: "geom_source",     labelFr: "Source géométrie",      kind: "text",     level: "zonage" },
    { key: "geom_fetched_at", labelFr: "Géométrie mise à jour", kind: "date",     level: "zonage" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// GEO_LOT_DETAIL_SCHEMA
//
// Schéma pour <GeoDetailPanel feature={hitLot} schema={GEO_LOT_DETAIL_SCHEMA} />
// ─────────────────────────────────────────────────────────────────────────────
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
  ],
};
```

---

## 4. Exemple d'usage dans GeoView.svelte

```svelte
<script lang="ts">
  import { GeoMap, GeoDetailPanel } from "@sentropic/geo-ui-svelte";
  import {
    GEO_CATEGORIES,
    GEO_ZONE_DETAIL_SCHEMA,
    GEO_LOT_DETAIL_SCHEMA,
  } from "$lib/geo/geo-detail-schema-mapping.js";
  import type { GeoDetailField } from "$lib/geo/geo-detail-schema-mapping.js";

  // La FeatureCollection est construite côté immo (API /api/geo/zones?city=...)
  // join avec les polygones géo (côté immo, pas dans la lib)
  let zonesFeatureCollection = /* await fetch(...) */ null;
  let selectedHit = null;
</script>

<GeoMap
  data={zonesFeatureCollection}
  layerKind="choropleth"
  categories={GEO_CATEGORIES}
  categoryKey="category"
  onSelect={(hit) => { selectedHit = hit; }}
/>

{#if selectedHit}
  <GeoDetailPanel
    feature={selectedHit}
    schema={selectedHit.properties.zone_code
      ? GEO_ZONE_DETAIL_SCHEMA
      : GEO_LOT_DETAIL_SCHEMA}
  />
{/if}
```

---

## 5. Correspondance catégories ↔ ontologie v2.1

Correspondance entre les `id` de `GEO_CATEGORIES` et les valeurs des champs `category` / `kind`
dans les nœuds Signal et DesignationEvent (ontologie v2.1) :

| GeoCategory.id | Signal.category (obs.) | DesignationEvent.kind (obs.) |
|---|---|---|
| `rezonage` | `rezonage` | `rezonage` |
| `derogation` | `derogation` | `derogation` |
| `derogation_mineure` | `derogation_mineure` | `derogation_mineure` |
| `piia` | `piia` | `piia` |
| `ppcmoi` | `ppcmoi` | `ppcmoi` |
| `lotissement` | `lotissement` | `lotissement` |
| `subdivision` | `subdivision` | `subdivision` |
| `densification` | `densification` | `densification` |
| `usage_conditionnel` | `usage_conditionnel` | `usage_conditionnel` |
| `modification_zonage` | `modification_zonage` | `modification_zonage` |
| `changement_usage` | `changement_usage` | `changement_usage` |
| `zone_agricole` | `zone_agricole` | `zone_agricole` |
| `cptaq` | `cptaq` | `cptaq` |
| `patrimoine` | `patrimoine` | (rare) |
| `multifamilial_4plus` | dimension (filtre `nb_unites_max >= 4`) | (dimension transversale) |
| `avis_motion` | (etape) | `etape = "avis_motion"` (v2.1) |
| `projet_reglement` | (etape) | `etape = "projet_reglement"` (v2.1) |
| `consultation_publique` | (etape) | `etape = "consultation_publique"` (v2.1) |
| `second_projet` | (etape) | `etape = "second_projet"` (v2.1) |
| `adoption` | (etape) | `etape = "adoption"` (v2.1) |
| `entree_vigueur` | (etape) | `etape = "entree_vigueur"` (v2.1) |

**Note** : les catégories d'anticipation ne correspondent pas à un `category` de Signal mais à
l'axe `etape` (ontologie v2.1). La couche immo dérive la couleur de la zone en priorité depuis
la catégorie du signal le plus précoce attaché à la zone (`etape` → `GeoCategory.id` via ce mapping).

---

## 6. Références

- Cadrage geo-intégration : `docs/spec/cadrage-geo-integration-mapper.md`
- Ontologie v2.1 (`etape_enum`) : `radar/ontology/ontology-profile.yaml`
- Rail Signaux (palette source) : `ui/src/lib/components/maps/SignauxRail.svelte`
- lib `@sentropic/geo-ui-svelte@0.1.0` : contrat inline (cf. cadrage §3.1)
