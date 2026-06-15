/**
 * Catégories géo + schémas de détail — G3 WP géo-intégration.
 *
 * Source : docs/spec/cadrage-geo-integration-mapper.md §4.1 et §4.2 (PR #210).
 * Réutilisé tel quel dans GeoView.svelte (pas d'import depuis @sentropic/geo-ui-svelte
 * car le package n'est pas encore installé en UI).
 *
 * Loi 25 : aucun champ PII.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types locaux (miroir des types @sentropic/geo-ui-svelte quand disponibles)
// ─────────────────────────────────────────────────────────────────────────────

export interface GeoCategory {
  id: string;
  labelFr: string;
  color: string;
  /** Niveau sémantique (optionnel). */
  level?: "dimension" | "anticipation";
}

export interface GeoDetailField {
  key: string;
  labelFr: string;
  kind: "text" | "number" | "date" | "url" | "pdf" | "citation";
  /** Niveau sémantique (optionnel, pour regroupement dans le panneau). */
  level?: string;
}

export interface GeoDetailLevel {
  id: string;
  labelFr: string;
}

export interface GeoDetailSchema {
  titleKey?: string;
  fields: GeoDetailField[];
  levels?: GeoDetailLevel[];
}

// ─────────────────────────────────────────────────────────────────────────────
// GEO_CATEGORIES — palette catégorie → labelFR → couleur
// ─────────────────────────────────────────────────────────────────────────────

export const GEO_CATEGORIES: GeoCategory[] = [
  // ── Catégories réglementaires principales ─────────────────────────────────
  { id: "rezonage",              labelFr: "Rezonage",                  color: "#6366f1" },
  { id: "derogation",            labelFr: "Dérogation",                color: "#f59e0b" },
  { id: "derogation_mineure",    labelFr: "Dérogation mineure",        color: "#fbbf24" },
  { id: "piia",                  labelFr: "PIIA",                      color: "#8b5cf6" },
  { id: "ppcmoi",                labelFr: "PPCMOI",                    color: "#a855f7" },
  { id: "lotissement",           labelFr: "Lotissement",               color: "#10b981" },
  { id: "subdivision",           labelFr: "Subdivision",               color: "#14b8a6" },
  { id: "densification",         labelFr: "Densification",             color: "#ef4444" },
  { id: "usage_conditionnel",    labelFr: "Usage conditionnel",        color: "#f97316" },
  { id: "modification_zonage",   labelFr: "Modification de zonage",    color: "#3b82f6" },
  { id: "changement_usage",      labelFr: "Changement d'usage",        color: "#22c55e" },
  { id: "zone_agricole",         labelFr: "Zone agricole",             color: "#84cc16" },
  { id: "cptaq",                 labelFr: "CPTAQ",                     color: "#65a30d" },
  { id: "patrimoine",            labelFr: "Patrimoine",                color: "#78716c" },
  // ── Axe dimension ─────────────────────────────────────────────────────────
  { id: "multifamilial_4plus",   labelFr: "Multifamilial 4+",          color: "#7c3aed", level: "dimension" },
  // ── Axe anticipation ─────────────────────────────────────────────────────
  { id: "avis_motion",           labelFr: "Avis de motion",            color: "#06b6d4", level: "anticipation" },
  { id: "projet_reglement",      labelFr: "Projet de règlement",       color: "#0ea5e9", level: "anticipation" },
  { id: "consultation_publique", labelFr: "Consultation publique",     color: "#3b82f6", level: "anticipation" },
  { id: "second_projet",         labelFr: "Second projet",             color: "#6366f1", level: "anticipation" },
  { id: "adoption",              labelFr: "Adoption",                  color: "#8b5cf6", level: "anticipation" },
  { id: "entree_vigueur",        labelFr: "Entrée en vigueur",         color: "#a855f7", level: "anticipation" },
];

/** Lookup rapide id → GeoCategory */
export const GEO_CATEGORY_MAP = new Map<string, GeoCategory>(
  GEO_CATEGORIES.map((c) => [c.id, c]),
);

/** Couleur par défaut quand la catégorie est inconnue ou nulle */
export const GEO_CATEGORY_DEFAULT_COLOR = "#94a3b8"; // slate-400

/** Retourne la couleur d'une catégorie, ou la couleur par défaut. */
export function getCategoryColor(categoryId: string | null | undefined): string {
  if (!categoryId) return GEO_CATEGORY_DEFAULT_COLOR;
  return GEO_CATEGORY_MAP.get(categoryId)?.color ?? GEO_CATEGORY_DEFAULT_COLOR;
}

/** Retourne le label FR d'une catégorie, ou l'id brut. */
export function getCategoryLabel(categoryId: string | null | undefined): string {
  if (!categoryId) return "Non classifié";
  return GEO_CATEGORY_MAP.get(categoryId)?.labelFr ?? categoryId;
}

// ─────────────────────────────────────────────────────────────────────────────
// GEO_ZONE_DETAIL_SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

export const GEO_ZONE_DETAIL_SCHEMA: GeoDetailSchema = {
  titleKey: "zoneCode",
  levels: [
    { id: "base",         labelFr: "Général" },
    { id: "dimension",    labelFr: "Dimension" },
    { id: "anticipation", labelFr: "Anticipation" },
    { id: "zonage",       labelFr: "Zonage" },
  ],
  fields: [
    { key: "zoneCode",       labelFr: "Code de zone",          kind: "text" },
    { key: "zoneUsage",      labelFr: "Usage",                 kind: "text" },
    { key: "citySlug",       labelFr: "Municipalité",          kind: "text" },
    { key: "signalCount",    labelFr: "Signaux attachés",      kind: "number" },
    { key: "category",       labelFr: "Catégorie principale",  kind: "text" },
    { key: "anticipation",   labelFr: "Étape réglementaire",   kind: "text",   level: "anticipation" },
    { key: "geomSource",     labelFr: "Source géométrie",      kind: "text",   level: "zonage" },
    { key: "geomFetchedAt",  labelFr: "Géométrie mise à jour", kind: "date",   level: "zonage" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// GEO_LOT_DETAIL_SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

export const GEO_LOT_DETAIL_SCHEMA: GeoDetailSchema = {
  titleKey: "noLot",
  levels: [
    { id: "base",   labelFr: "Général" },
    { id: "zonage", labelFr: "Zonage" },
  ],
  fields: [
    { key: "noLot",         labelFr: "Numéro de lot",         kind: "text" },
    { key: "citySlug",      labelFr: "Municipalité",          kind: "text" },
    { key: "superficieM2",  labelFr: "Superficie (m²)",       kind: "number" },
    { key: "usage",         labelFr: "Usage actuel",          kind: "text" },
    { key: "zoneCode",      labelFr: "Zone affectée",         kind: "text",  level: "zonage" },
    { key: "signalCount",   labelFr: "Signaux attachés",      kind: "number", level: "zonage" },
    { key: "geomSource",    labelFr: "Source géométrie",      kind: "text",  level: "zonage" },
    { key: "geomFetchedAt", labelFr: "Géométrie mise à jour", kind: "date",  level: "zonage" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// GEO_OPPORTUNITE_DETAIL_SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

export const GEO_OPPORTUNITE_DETAIL_SCHEMA: GeoDetailSchema = {
  titleKey: "label",
  levels: [
    { id: "base", labelFr: "Signal" },
  ],
  fields: [
    { key: "label",     labelFr: "Description",        kind: "text" },
    { key: "type",      labelFr: "Type",               kind: "text" },
    { key: "citySlug",  labelFr: "Municipalité",       kind: "text" },
    { key: "category",  labelFr: "Catégorie",          kind: "text" },
    { key: "etape",     labelFr: "Étape",              kind: "text" },
    { key: "date",      labelFr: "Date",               kind: "date" },
  ],
};
