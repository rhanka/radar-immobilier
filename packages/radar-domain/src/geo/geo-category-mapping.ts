/**
 * geo-category-mapping — Pont ontologie radar ↔ taxonomie agnostique GeoMap.
 *
 * LIVRABLE CONCRET du cadrage `docs/spec/cadrage-geo-integration-mapper.md`
 * (volet 3). C'est le contrat qu'`immo` doit à `geo` :
 *
 *   1. `GEO_CATEGORY_MAPPING` — mapping CATÉGORIE d'opportunité → libellé FR →
 *      couleur (token DS). Consommé tel quel comme `GeoCategory[]` par
 *      `@sentropic/geo-ui-svelte` `GeoMap` (`categories` + `categoryKey`).
 *   2. `GEO_DETAIL_SCHEMA` — la forme du panneau de détail (`GeoDetailSchema`
 *      de `GeoDetailPanel`) : citation/extrait, lien PDF + page, props lisibles
 *      FR, niveaux dimension/anticipation/zonage.
 *   3. `DIMENSION_*` / `ANTICIPATION_*` — les deux axes secondaires (multifamilial
 *      4+ ; étape/anticipation v2.1) exposés comme catégories alternatives.
 *
 * ## Règles cardinales respectées
 *
 * - **Agnostique** : ces objets sont des `GeoCategory`/`GeoDetailSchema` purs.
 *   `GeoMap`/`GeoDetailPanel` ne connaissent QUE `id`/`labelFr`/`color` et
 *   `key`/`labelFr`/`kind`. Aucune sémantique immo ne fuit dans le composant.
 * - **Couleurs = TOKENS DS, jamais de hex maison** : `color` est une référence
 *   `var(--st-*, #fallback)`. `GeoMap.resolveColor` résout la variable CSS au
 *   runtime ; le fallback `sent-tech` n'est utilisé que hors DOM. (Même règle
 *   que `ui/src/lib/maps/score-color-scale.ts`.)
 * - **Loi 25 / anti-PII** : aucune clé propriétaire/personne n'est exposée par
 *   le schéma de détail. Le rôle d'évaluation est caviardé.
 * - **Anti-invention** : une catégorie inconnue retombe sur `UNCATEGORIZED`
 *   (gris muted), JAMAIS sur une couleur/catégorie devinée. ~55 % des signaux
 *   réels ont `category = null` aujourd'hui → la classe `autre` est de
 *   première importance, pas un cas marginal.
 *
 * Vérifié contre les données réelles (graph PG, 2026-06-15) : distribution des
 * `props.properties.category` sur 2634 nœuds Signal (rezonage 552, derogation
 * 108, piia 101, cptaq 57, ppcmoi 50, lotissement 35, densification 26,
 * usage_conditionnel 19, changement_usage 8, modification_zonage 12,
 * zone_agricole 5, patrimoine 5, … + 1438 NULL).
 */

// ─── Types (miroir local du contrat @sentropic/geo-ui-svelte 0.1.0) ──────────
//
// On RECOPIE les interfaces ici (et non un import) pour que `radar-domain`
// reste sans dépendance Svelte/UI ; l'UI réimporte ces objets et les passe à
// GeoMap, où le typage structurel garantit la compatibilité.

/** Miroir de `GeoCategory` (GeoMap.svelte). */
export interface GeoCategory {
  /** Clé de jointure, comparée à `feature.properties[categoryKey]`. */
  id: string;
  /** Libellé FR affiché (légende + détail). */
  labelFr: string;
  /** Couleur résolue : `var(--st-*, #fallback)` ou hex. */
  color: string;
  /** Regroupement / hiérarchie optionnel. */
  level?: string;
}

/** Miroir de `GeoDetailField` (GeoDetailPanel.svelte). */
export interface GeoDetailField {
  key: string;
  labelFr: string;
  kind?: "text" | "number" | "url" | "pdf" | "date" | "citation";
  level?: string;
}

/** Miroir de `GeoDetailSchema` (GeoDetailPanel.svelte). */
export interface GeoDetailSchema {
  titleKey?: string;
  fields: GeoDetailField[];
  levels?: { id: string; labelFr: string }[];
}

// ─── 1. Mapping CATÉGORIE d'opportunité → libellé FR → couleur ───────────────
//
// `id` = valeur attendue dans `feature.properties.category` (le `categoryKey`
// par défaut de GeoMap est "category", aligné sur `props.properties.category`).
// Les ids sont les valeurs RÉELLES observées dans le graphe (canonisées).
//
// Couleurs : on réutilise la palette sémantique DS. Les familles ont une
// couleur de famille ; on regroupe par `level` (dimension réglementaire).
//
// Choix de couleurs (sémantique métier, palette DS sent-tech) :
//   - rezonage / modification_zonage / changement_usage  → ambre warning
//     (le signal le plus fort : ça bouge réglementairement)
//   - derogation / derogation_mineure / piia / ppcmoi / usage_conditionnel
//     → bleu info (instruments d'urbanisme, signal de mouvement local)
//   - lotissement / subdivision / densification           → violet accent
//     (création/division d'assiette foncière)
//   - zone_agricole / cptaq / patrimoine                  → vert success
//     (contraintes/leviers de protection — lecture inverse)
//   - autre / non catégorisé                              → gris muted

export const GEO_CATEGORY_MAPPING: readonly GeoCategory[] = [
  // ── Famille « changement de zonage » (signal réglementaire fort) ──────────
  {
    id: "rezonage",
    labelFr: "Rezonage",
    color: "var(--st-semantic-feedback-warning, #d97706)",
    level: "zonage",
  },
  {
    id: "modification_zonage",
    labelFr: "Modification de zonage",
    color: "var(--st-semantic-feedback-warning, #d97706)",
    level: "zonage",
  },
  {
    id: "changement_usage",
    labelFr: "Changement d'usage",
    color: "var(--st-semantic-feedback-warning, #d97706)",
    level: "zonage",
  },
  // ── Famille « instruments d'urbanisme » (mouvement local, dossier) ────────
  {
    id: "derogation",
    labelFr: "Dérogation",
    color: "var(--st-semantic-feedback-info, #2563eb)",
    level: "instrument",
  },
  {
    id: "derogation_mineure",
    labelFr: "Dérogation mineure",
    color: "var(--st-semantic-feedback-info, #2563eb)",
    level: "instrument",
  },
  {
    id: "piia",
    labelFr: "PIIA (intégration architecturale)",
    color: "var(--st-semantic-feedback-info, #2563eb)",
    level: "instrument",
  },
  {
    id: "ppcmoi",
    labelFr: "PPCMOI (projet particulier)",
    color: "var(--st-semantic-feedback-info, #2563eb)",
    level: "instrument",
  },
  {
    id: "usage_conditionnel",
    labelFr: "Usage conditionnel",
    color: "var(--st-semantic-feedback-info, #2563eb)",
    level: "instrument",
  },
  // ── Famille « assiette foncière » (création / division / densité) ─────────
  {
    id: "lotissement",
    labelFr: "Lotissement",
    color: "var(--st-semantic-accent, #7c3aed)",
    level: "fonciere",
  },
  {
    id: "subdivision",
    labelFr: "Subdivision",
    color: "var(--st-semantic-accent, #7c3aed)",
    level: "fonciere",
  },
  {
    id: "densification",
    labelFr: "Densification",
    color: "var(--st-semantic-accent, #7c3aed)",
    level: "fonciere",
  },
  // ── Famille « protection / contrainte » (lecture inverse du signal) ───────
  {
    id: "zone_agricole",
    labelFr: "Zone agricole",
    color: "var(--st-semantic-feedback-success, #16a34a)",
    level: "protection",
  },
  {
    id: "cptaq",
    labelFr: "CPTAQ (commission agricole)",
    color: "var(--st-semantic-feedback-success, #16a34a)",
    level: "protection",
  },
  {
    id: "patrimoine",
    labelFr: "Patrimoine",
    color: "var(--st-semantic-feedback-success, #16a34a)",
    level: "protection",
  },
  // ── Anti-invention : tout le reste (incl. category = null) ────────────────
  {
    id: "autre",
    labelFr: "Autre / non catégorisé",
    color: "var(--st-semantic-text-muted, #64748b)",
    level: "autre",
  },
];

/** Regroupements (familles) de catégories, pour légende structurée. */
export const GEO_CATEGORY_LEVELS: readonly { id: string; labelFr: string }[] = [
  { id: "zonage", labelFr: "Changement de zonage" },
  { id: "instrument", labelFr: "Instruments d'urbanisme" },
  { id: "fonciere", labelFr: "Assiette foncière" },
  { id: "protection", labelFr: "Protection / contrainte" },
  { id: "autre", labelFr: "Autre" },
];

/**
 * Canonise une `category` brute (valeur de `props.properties.category`, souvent
 * `null` ou un libellé hors-liste) vers un `id` de `GEO_CATEGORY_MAPPING`.
 * Anti-invention : tout ce qui n'est pas reconnu retombe sur `"autre"`.
 *
 * NOTE : la projection (volet 1) doit écrire cet `id` canonisé dans
 * `feature.properties.category` AVANT de passer la FeatureCollection à GeoMap ;
 * GeoMap ne fait pas de fuzzy-matching, il fait un `match` exact sur `id`.
 */
export function canonicalGeoCategory(raw: string | null | undefined): string {
  if (raw == null || raw.trim() === "") return "autre";
  const v = raw.trim().toLowerCase();
  const known = new Set(GEO_CATEGORY_MAPPING.map((c) => c.id));
  if (known.has(v)) return v;
  // Quelques synonymes fréquents observés dans le graphe réel → canonique.
  const SYNONYMS: Record<string, string> = {
    amendement_zonage: "modification_zonage",
    modification_reglementaire: "modification_zonage",
    reglementation_urbanisme: "modification_zonage",
    densification_residentielle: "densification",
    densification_multifamiliale: "densification",
    contrainte_agricole: "zone_agricole",
    exclusion_zone_agricole: "cptaq",
    projet_particulier: "ppcmoi",
  };
  return SYNONYMS[v] ?? "autre";
}

// ─── 2. Axe DIMENSION — multifamilial 4+ logements ───────────────────────────
//
// Axe orthogonal à la catégorie : « ce signal/lot porte-t-il un potentiel
// multifamilial 4+ ? ». Dérivé de `nb_unites_min`/`nb_unites_max` (présents sur
// ~115/117 signaux) ou de `usage = residentiel_multifamilial` (Zone).
// Exposé comme `GeoCategory[]` alternatif (`categoryKey = "dimensionLevel"`).

export const DIMENSION_MAPPING: readonly GeoCategory[] = [
  {
    id: "multifamilial_4plus",
    labelFr: "Multifamilial 4+ logements",
    color: "var(--st-semantic-feedback-warning, #d97706)",
  },
  {
    id: "petit_collectif",
    labelFr: "Petit collectif (2–3 logements)",
    color: "var(--st-semantic-feedback-info, #2563eb)",
  },
  {
    id: "non_residentiel_ou_inconnu",
    labelFr: "Non résidentiel / inconnu",
    color: "var(--st-semantic-text-muted, #64748b)",
  },
];

/** Dérive le niveau de dimension depuis nb d'unités estimé (anti-invention). */
export function dimensionLevel(
  nbUnitesMin: number | null | undefined,
  nbUnitesMax: number | null | undefined,
): string {
  const max = nbUnitesMax ?? nbUnitesMin ?? null;
  if (max == null) return "non_residentiel_ou_inconnu";
  if (max >= 4) return "multifamilial_4plus";
  if (max >= 2) return "petit_collectif";
  return "non_residentiel_ou_inconnu";
}

// ─── 3. Axe ANTICIPATION — étape réglementaire (ontologie v2.1) ──────────────
//
// `etape` est un enum ORDONNÉ (profil v2.1). Plus l'étape est précoce, plus
// l'avantage d'anticipation est grand → couleur plus « chaude ».
// ⚠️ HONNÊTETÉ : ce champ est DÉCLARÉ dans le profil mais PAS ENCORE PEUPLÉ dans
// le graphe live (0/2634 Signal, 0/3587 DesignationEvent au 2026-06-15). Ce
// mapping est prêt pour l'annotation `etape` à venir (cf. mémoire
// sz-etape-v21-anticipation) ; en attendant, tout retombe sur `inconnu`.

export const ANTICIPATION_MAPPING: readonly GeoCategory[] = [
  { id: "avis_motion", labelFr: "Avis de motion (très en amont)", color: "var(--st-semantic-feedback-warning, #d97706)", level: "amont" },
  { id: "projet_reglement", labelFr: "Projet de règlement", color: "var(--st-semantic-feedback-warning, #d97706)", level: "amont" },
  { id: "consultation_publique", labelFr: "Consultation publique", color: "var(--st-semantic-feedback-info, #2563eb)", level: "milieu" },
  { id: "second_projet", labelFr: "Second projet", color: "var(--st-semantic-feedback-info, #2563eb)", level: "milieu" },
  { id: "adoption", labelFr: "Adoption", color: "var(--st-semantic-feedback-success, #16a34a)", level: "aval" },
  { id: "entree_vigueur", labelFr: "Entrée en vigueur", color: "var(--st-semantic-feedback-success, #16a34a)", level: "aval" },
  { id: "inconnu", labelFr: "Étape inconnue", color: "var(--st-semantic-text-muted, #64748b)", level: "inconnu" },
];

// ─── 4. GeoDetailSchema — panneau de détail (agnostique) ─────────────────────
//
// Forme du panneau quand on clique une opportunité. `key` lit
// `feature.properties[key]` ; `kind` choisit le rendu (citation = blockquote,
// pdf = lien étiqueté PDF, date = fr-CA…). Les `levels` regroupent en sections
// repliables (dimension / anticipation / zonage / source).
//
// La projection (volet 1) APLATIT les props nécessaires dans
// `feature.properties` avec EXACTEMENT ces clés (citation, pdfUrl, pdfPage…).

export const GEO_DETAIL_SCHEMA: GeoDetailSchema = {
  titleKey: "title",
  fields: [
    // ── Toujours visibles (sans level) ──────────────────────────────────────
    { key: "categoryLabel", labelFr: "Catégorie", kind: "text" },
    { key: "date", labelFr: "Date", kind: "date" },
    { key: "municipality", labelFr: "Municipalité", kind: "text" },
    { key: "description", labelFr: "Description", kind: "text" },
    { key: "citation", labelFr: "Extrait source", kind: "citation" },
    // ── Niveau « source » (provenance, preuve) ───────────────────────────────
    { key: "pdfUrl", labelFr: "Document source (PDF)", kind: "pdf", level: "source" },
    { key: "pdfPage", labelFr: "Page", kind: "number", level: "source" },
    { key: "resolutionRef", labelFr: "Résolution / référence", kind: "text", level: "source" },
    { key: "docSha", labelFr: "Empreinte document (SHA-256)", kind: "text", level: "source" },
    // ── Niveau « zonage » (entité géo résolue) ───────────────────────────────
    { key: "zoneCode", labelFr: "Code de zone", kind: "text", level: "zonage" },
    { key: "zoneUsage", labelFr: "Usage de la zone", kind: "text", level: "zonage" },
    { key: "bylawNumber", labelFr: "Règlement", kind: "text", level: "zonage" },
    { key: "lotNumber", labelFr: "Lot cadastral", kind: "text", level: "zonage" },
    { key: "matchConfidence", labelFr: "Confiance de l'appariement", kind: "text", level: "zonage" },
    { key: "matchProvenance", labelFr: "Méthode d'appariement", kind: "text", level: "zonage" },
    // ── Niveau « dimension » (multifamilial 4+) ─────────────────────────────
    { key: "dimensionLabel", labelFr: "Dimension", kind: "text", level: "dimension" },
    { key: "nbUnitesMin", labelFr: "Unités (min)", kind: "number", level: "dimension" },
    { key: "nbUnitesMax", labelFr: "Unités (max)", kind: "number", level: "dimension" },
    // ── Niveau « anticipation » (étape v2.1) ────────────────────────────────
    { key: "etapeLabel", labelFr: "Étape réglementaire", kind: "text", level: "anticipation" },
    { key: "etapeDate", labelFr: "Date de l'étape", kind: "date", level: "anticipation" },
  ],
  levels: [
    { id: "source", labelFr: "Source & preuve" },
    { id: "zonage", labelFr: "Entité géographique résolue" },
    { id: "dimension", labelFr: "Dimension (logements)" },
    { id: "anticipation", labelFr: "Anticipation (étape)" },
  ],
};
