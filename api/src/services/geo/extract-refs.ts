/**
 * G1 — Extracteur de références géographiques (codes de zone + numéros de lot)
 * depuis texte libre (label + description des nœuds Signal/DesignationEvent).
 *
 * ## Principes
 * - Fonctions PURES : aucun accès DB, aucun effet de bord.
 * - Honnêteté anti-invention : un texte sans code → tableau vide.
 * - Normalisation : code_norm / no_lot_norm comparables côté table.
 * - Score de confiance : 0.40–0.85 (seuil publication >= 0.50).
 *
 * ## Patterns retenus (cf. cadrage-geo-integration-mapper.md §2.2)
 *
 * Zone :
 *   P1 - Mention explicite "zone X-123"         -> score 0.85
 *   P2 - Format standard lettre+chiffres+tiret  -> score 0.65
 *   P3 - Numérique pur "zone 1000"              -> score 0.40
 *
 * Lot :
 *   L1 - Mention explicite "lot 6 057 912"      -> score 0.75
 *   L2 - Compact 7+ chiffres (hors contexte)    -> score 0.45
 *
 * ## Loi 25
 * Aucune PII : le texte source peut contenir des numéros de lot (données
 * cadastrales publiques). Aucun nom de propriétaire n'est extrait.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Un code de zone extrait du texte libre. */
export interface ExtractedZoneCode {
  /** Texte brut tel qu'il apparaît dans la source (avant normalisation). */
  rawText: string;
  /** Code normalisé : majuscules, sans espaces, sans suffixe secteur `(VLO)`. */
  codeNorm: string;
  /** Score de confiance (0.40–0.85). */
  score: number;
  /** Identifiant du pattern ayant produit ce résultat. */
  patternId: "zone_explicit" | "zone_standard" | "zone_numeric";
}

/** Un numéro de lot extrait du texte libre. */
export interface ExtractedLotRef {
  /** Texte brut tel qu'il apparaît dans la source. */
  rawText: string;
  /** Numéro de lot normalisé : chiffres uniquement (espaces supprimés). */
  noLotNorm: string;
  /** Score de confiance (0.45–0.75). */
  score: number;
  /** Identifiant du pattern. */
  patternId: "lot_explicit" | "lot_compact";
}

/** Résultat complet d'extraction pour un noeud. */
export interface ExtractionResult {
  zoneCodes: ExtractedZoneCode[];
  lotRefs: ExtractedLotRef[];
}

// ─── Constantes de score ──────────────────────────────────────────────────────

export const SCORE = {
  ZONE_EXPLICIT: 0.85,
  ZONE_STANDARD: 0.65,
  ZONE_NUMERIC: 0.40,
  LOT_EXPLICIT: 0.75,
  LOT_COMPACT: 0.45,
} as const;

/** Seuil minimum pour publier une résolution en `geo_resolutions`. */
export const RESOLUTION_THRESHOLD = 0.50;

// ─── Patterns regex (sources, réinstanciées à chaque appel pour reset lastIndex) ──

/**
 * P1 - Mention explicite "zone X-123" (couvre tous les formats de ville).
 * Exemples : "zone H34-327 (VLO)", "zone A1336", "Zone P-02"
 */
const ZONE_EXPLICIT_SRC =
  String.raw`\bzone\s+([A-Z][A-Z0-9]{0,2}[0-9]{0,2}[-–]?[A-Z0-9]{1,10}(?:\s*\([A-Z]{2,5}\))?)\b`;

/**
 * P2 - Format standard lettre(s) + chiffres + tiret.
 * Exemples : "H-431", "C-512", "H34-327 (VLO)", "H-9509", "RU1302-A"
 */
const ZONE_STANDARD_SRC =
  String.raw`\b([A-Z]{1,3}[0-9]{0,2}[-–][A-Z0-9]{2,10}(?:\s*\([A-Z]{2,5}\))?)\b`;

/**
 * P3 - Numérique pur "zone 1000" (Saguenay-style, ambiguïté haute).
 */
const ZONE_NUMERIC_SRC = String.raw`\bzone\s+([0-9]{3,6})\b`;

/**
 * L1 - Mention explicite "lot 6 057 912" ou "lot 6057912".
 * Le format NO_LOT du cadastre allégé contient des espaces (ex. "6 057 912").
 */
const LOT_EXPLICIT_SRC = String.raw`\blot\s+([0-9](?:\s*[0-9]){3,9})\b`;

/**
 * L2 - Compact 7-10 chiffres sans contexte explicite.
 * Confiance basse : peut être un numéro de règlement, d'article, etc.
 */
const LOT_COMPACT_SRC = String.raw`(?<![0-9])([0-9]{7,10})(?![0-9])`;

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Normalise un code de zone :
 * - Majuscules
 * - Suppression des espaces
 * - Suppression du suffixe secteur entre parenthèses (ex. `(VLO)`)
 * - Remplacement du tiret en demi-cadratin par un tiret ASCII
 *
 * Exemples :
 *   "H34-327 (VLO)" -> "H34-327"
 *   "h-431"         -> "H-431"
 *   "RU1302"        -> "RU1302"
 */
export function normalizeZoneCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\s*\([A-Z]{2,5}\)\s*/g, "")
    .replace(/\s+/g, "")
    .replace(/–/g, "-");
}

/**
 * Normalise un numéro de lot cadastral :
 * - Suppression de tous les espaces et caractères non-numériques
 *
 * Exemples :
 *   "6 057 912" -> "6057912"
 *   "6057912"   -> "6057912"
 */
export function normalizeLotRef(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

// ─── Déduplication ────────────────────────────────────────────────────────────

function deduplicateZoneCodes(codes: ExtractedZoneCode[]): ExtractedZoneCode[] {
  const map = new Map<string, ExtractedZoneCode>();
  for (const c of codes) {
    const existing = map.get(c.codeNorm);
    if (!existing || c.score > existing.score) {
      map.set(c.codeNorm, c);
    }
  }
  return [...map.values()];
}

function deduplicateLotRefs(lots: ExtractedLotRef[]): ExtractedLotRef[] {
  const map = new Map<string, ExtractedLotRef>();
  for (const l of lots) {
    const existing = map.get(l.noLotNorm);
    if (!existing || l.score > existing.score) {
      map.set(l.noLotNorm, l);
    }
  }
  return [...map.values()];
}

// ─── Extraction principale ────────────────────────────────────────────────────

/**
 * Extrait tous les codes de zone d'un texte libre.
 *
 * Les patterns sont appliqués en ordre décroissant de priorité (P1 > P2 > P3).
 * La déduplication par codeNorm conserve le score maximal.
 *
 * @param text - Texte libre (label + description concaténés ou séparément).
 * @returns Tableau de codes extraits, dédupliqués par codeNorm, triés par score décroissant.
 */
export function extractZoneCodes(text: string): ExtractedZoneCode[] {
  if (!text || text.trim().length === 0) return [];

  const results: ExtractedZoneCode[] = [];

  // P1 - Mention explicite "zone X-123"
  for (const match of text.matchAll(new RegExp(ZONE_EXPLICIT_SRC, "gi"))) {
    const rawText = (match[1] ?? "").trim();
    const codeNorm = normalizeZoneCode(rawText);
    if (codeNorm.length >= 2) {
      results.push({ rawText, codeNorm, score: SCORE.ZONE_EXPLICIT, patternId: "zone_explicit" });
    }
  }

  // P2 - Format standard (lettre+chiffres+tiret)
  for (const match of text.matchAll(new RegExp(ZONE_STANDARD_SRC, "g"))) {
    const rawText = (match[1] ?? "").trim();
    const codeNorm = normalizeZoneCode(rawText);
    if (codeNorm.length >= 3) {
      results.push({ rawText, codeNorm, score: SCORE.ZONE_STANDARD, patternId: "zone_standard" });
    }
  }

  // P3 - Numérique pur "zone 1000"
  for (const match of text.matchAll(new RegExp(ZONE_NUMERIC_SRC, "gi"))) {
    const rawText = (match[1] ?? "").trim();
    const codeNorm = normalizeZoneCode(rawText);
    results.push({ rawText, codeNorm, score: SCORE.ZONE_NUMERIC, patternId: "zone_numeric" });
  }

  return deduplicateZoneCodes(results).sort((a, b) => b.score - a.score);
}

/**
 * Extrait tous les numéros de lot d'un texte libre.
 *
 * @param text - Texte libre.
 * @returns Tableau de refs lot extraites, dédupliquées par noLotNorm, triées par score décroissant.
 */
export function extractLotRefs(text: string): ExtractedLotRef[] {
  if (!text || text.trim().length === 0) return [];

  const results: ExtractedLotRef[] = [];

  // L1 - Mention explicite "lot 6 057 912"
  for (const match of text.matchAll(new RegExp(LOT_EXPLICIT_SRC, "gi"))) {
    const rawText = (match[1] ?? "").trim();
    const noLotNorm = normalizeLotRef(rawText);
    if (noLotNorm.length >= 7) {
      results.push({ rawText, noLotNorm, score: SCORE.LOT_EXPLICIT, patternId: "lot_explicit" });
    }
  }

  // L2 - Compact 7-10 chiffres
  for (const match of text.matchAll(new RegExp(LOT_COMPACT_SRC, "g"))) {
    const rawText = (match[1] ?? "").trim();
    const noLotNorm = normalizeLotRef(rawText);
    if (noLotNorm.length >= 7) {
      results.push({ rawText, noLotNorm, score: SCORE.LOT_COMPACT, patternId: "lot_compact" });
    }
  }

  return deduplicateLotRefs(results).sort((a, b) => b.score - a.score);
}

/**
 * Extraction combinée depuis le label et la description d'un noeud.
 *
 * Concatène label + description (séparés par un espace) pour un seul passage
 * regex, ce qui évite de dupliquer les hits présents dans les deux champs.
 *
 * @param label       - Champ `label` du noeud graphify.
 * @param description - Champ `props.properties.description` (peut être undefined/null).
 */
export function extractRefsFromNode(
  label: string,
  description?: string | null,
): ExtractionResult {
  const text = [label, description].filter(Boolean).join(" ");
  return {
    zoneCodes: extractZoneCodes(text),
    lotRefs: extractLotRefs(text),
  };
}
