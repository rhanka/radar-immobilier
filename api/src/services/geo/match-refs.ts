/**
 * G1 — Matching multi-niveau Signal/DesignationEvent → zone_versions / lot_versions.
 *
 * ## Niveaux de matching (zone)
 *
 * N1 — Exact normalisé : codeNorm === zone_versions.code_norm (filtre city_slug)
 *      score_confiance = score_extraction (inchangé)
 *      provenance = "exact_norm"
 *
 * N2 — Variantes :
 *   a. Code sans tiret : "H431" matche "H-431"
 *   b. Code avec préfixe lettre supplémentaire : "ZH-431" matche "H-431"
 *   c. Lettre unique padding : "H-0431" matche "H-431"
 *   score_confiance = score_extraction * 0.90
 *   provenance = "variant_norm"
 *
 * N3 — Distance d'édition pondérée (Levenshtein normalisé) :
 *   Seuil : distance_norm <= 0.25 (<=2 edits sur 8 chars typiques)
 *   score_confiance = score_extraction * (1 - distance_norm) * 0.85
 *   provenance = "edit_dist"
 *
 * N4 — Désambiguïsation ville (uniquement si N1–N3 échouent pour cette ville) :
 *   Cherche dans TOUTES les villes si une seule correspond → score * 0.70
 *   provenance = "city_fallback"
 *
 * ## Matching lot
 *
 * Lot L1 — Exact no_lot_norm (pas de filtre city_slug — cadastre province-entière)
 *   score_confiance = score_extraction
 *   provenance = "exact_norm"
 *
 * ## Non-résolu
 *
 * Raisons possibles :
 *   "no_extract"    — aucun code/lot extrait du texte
 *   "score_too_low" — score d'extraction < RESOLUTION_THRESHOLD (avant matching)
 *   "no_polygon"    — code extrait OK, pas de cible en DB
 *   "ambiguous"     — plusieurs cibles possibles en N3/N4 (non implémenté V1)
 *
 * ## Loi 25 / anti-PII
 * Uniquement des codes de zone et numéros de lot publics.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Résultat d'un matching réussi.
 */
export interface MatchResult {
  canonicalId: string;
  scoreConfiance: number;
  provenance: string;
  extraitBrut: string;
}

/**
 * Résultat d'un non-matching (pour geo_unresolved).
 */
export interface UnresolvedResult {
  extraitBrut: string | null;
  patternType: "zone_code" | "no_lot";
  scoreConfiance: number | null;
  raison: "no_polygon" | "score_too_low" | "ambiguous" | "no_extract";
}

// ─── Distance de Levenshtein ──────────────────────────────────────────────────

/**
 * Distance de Levenshtein entre deux strings.
 * Implémentation O(min(m,n)) en espace.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Assure que a est la string la plus courte
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const m = a.length;
  const n = b.length;

  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  let curr = new Array<number>(m + 1);

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        (prev[i] ?? 0) + 1,      // suppression
        (curr[i - 1] ?? 0) + 1,  // insertion
        (prev[i - 1] ?? 0) + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[m] ?? 0;
}

/**
 * Distance de Levenshtein normalisée : dist / max(len(a), len(b)).
 * Retourne 0 si les deux strings sont vides.
 */
export function levenshteinNorm(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 0;
  const maxLen = Math.max(a.length, b.length);
  return levenshtein(a, b) / maxLen;
}

// ─── Variantes de normalisation ───────────────────────────────────────────────

/**
 * Génère les variantes de normalisation d'un code de zone.
 *
 * Couvre les divergences courantes dans les données québécoises :
 *   - Suppression du tiret : "H-431" → "H431"
 *   - Insertion du tiret : "C18" → "C-18" (DB compacte vs signal tireté)
 *   - Suppression des zéros de padding : "H-0431" → "H-431"
 *   - Suppression du préfixe lettre unique : "ZH-431" → "H-431"
 *
 * La symétrie tiret/sans-tiret couvre le décalage fréquent entre l'odonyme
 * source (tiret "C-18") et la couche cadastrale (espace → compacte "C18").
 */
export function zoneCodeVariants(codeNorm: string): string[] {
  const variants = new Set<string>();

  // Sans tiret : "C-18" → "C18"
  const noHyphen = codeNorm.replace(/-/g, "");
  if (noHyphen !== codeNorm) variants.add(noHyphen);

  // Avec tiret (insertion lettre↔chiffre) : "C18" → "C-18", "RU1302" → "RU-1302"
  // Uniquement si le code n'a pas déjà de tiret (sinon ambiguïté).
  if (!codeNorm.includes("-")) {
    const splitMatch = codeNorm.match(/^([A-Z]{1,3})([0-9].*)$/);
    if (splitMatch && splitMatch[1] && splitMatch[2]) {
      variants.add(`${splitMatch[1]}-${splitMatch[2]}`);
    }
  }

  // Suppression du préfixe lettre unique (ex. "ZH-431" → "H-431", "VH-431" → "H-431")
  const prefixMatch = codeNorm.match(/^[A-Z]([A-Z]-?\d.*)$/);
  if (prefixMatch && prefixMatch[1]) {
    variants.add(prefixMatch[1]);
  }

  // Suppression des zéros de padding dans la partie numérique
  const paddingMatch = codeNorm.match(/^([A-Z]{1,3}-)0+(\d+.*)$/);
  if (paddingMatch && paddingMatch[1] && paddingMatch[2]) {
    variants.add(paddingMatch[1] + paddingMatch[2]);
  }

  return [...variants];
}

// ─── Interfaces de la DB (injection) ─────────────────────────────────────────

/**
 * Interface minimale pour les fonctions de lookup DB.
 * Permet le test sans DB réelle.
 */
export interface GeoMatchDb {
  /**
   * Cherche une zone par code_norm exact pour une ville.
   * Retourne le canonical_id ou null.
   */
  findZoneExact(codeNorm: string, citySlug: string): Promise<string | null>;

  /**
   * Cherche une zone par code_norm dans une liste de codes (variantes).
   * Retourne le premier canonical_id trouvé ou null.
   */
  findZoneByVariants(codeVariants: string[], citySlug: string): Promise<string | null>;

  /**
   * Cherche toutes les zones d'une ville pour matching par distance.
   * Retourne [{canonicalId, codeNorm}].
   */
  listZoneCodesForCity(citySlug: string): Promise<{ canonicalId: string; codeNorm: string }[]>;

  /**
   * Cherche une zone dans TOUTES les villes (city_fallback).
   * Retourne [{canonicalId, codeNorm, citySlug}] ou [] si aucun.
   */
  findZoneAllCities(codeNorm: string): Promise<{ canonicalId: string; codeNorm: string; citySlug: string }[]>;

  /**
   * Cherche un lot par no_lot_norm (province-wide, sans préférence de ville).
   * Retourne le canonical_id ou null.
   *
   * @deprecated Utiliser `findLotCandidates` pour la résolution Signal→Lot :
   * un même no_lot peut exister dans plusieurs villes (cadastre non-rénové),
   * et la ville du signal doit être préférée (cf. précision géo).
   */
  findLotExact(noLotNorm: string): Promise<string | null>;

  /**
   * Cherche TOUS les lots partageant un no_lot_norm, en retournant leur ville.
   *
   * Un même numéro de lot peut exister dans plusieurs municipalités (le cadastre
   * non-rénové réutilise les numéros entre villes). La résolution Signal→Lot doit
   * donc PRÉFÉRER le lot de la ville du signal, et ne tomber sur une autre ville
   * que si le no_lot y est NON-AMBIGU (présent dans une seule ville).
   *
   * Retourne [{ canonicalId, citySlug }] (vide si aucun match).
   */
  findLotCandidates(noLotNorm: string): Promise<{ canonicalId: string; citySlug: string }[]>;
}

/**
 * Sélectionne le bon lot parmi les candidats pour un signal d'une ville donnée.
 *
 * Politique (précision géo) :
 *   1. Si un candidat appartient à la ville du signal → on le retient (match local fiable).
 *   2. Sinon, si le no_lot est NON-AMBIGU (une seule ville candidate) → on le retient
 *      (résolution cross-ville honnête : un seul polygone possible).
 *   3. Sinon (plusieurs villes, aucune n'étant celle du signal) → AMBIGU : pas de
 *      résolution (on évite de géolocaliser le signal au mauvais endroit).
 *
 * @returns Le canonical_id retenu, ou null si ambigu / aucun candidat.
 */
export function pickLotForCity(
  candidates: { canonicalId: string; citySlug: string }[],
  citySlug: string,
): string | null {
  if (candidates.length === 0) return null;

  // 1. Préférence stricte : lot de la ville du signal.
  const local = candidates.find((c) => c.citySlug === citySlug);
  if (local) return local.canonicalId;

  // 2. Cross-ville accepté seulement si non-ambigu (une seule ville candidate).
  const cities = new Set(candidates.map((c) => c.citySlug));
  if (cities.size === 1) return candidates[0]!.canonicalId;

  // 3. Plusieurs villes, aucune n'étant celle du signal → ambigu.
  return null;
}

// ─── Seuils de matching ───────────────────────────────────────────────────────

/** Distance Levenshtein normalisée maximale pour N3. */
export const EDIT_DIST_THRESHOLD = 0.25;

/** Pénalité de score pour le matching N2 (variantes). */
export const VARIANT_SCORE_FACTOR = 0.90;

/** Pénalité de score pour le matching N3 (edit distance). */
export const EDIT_DIST_SCORE_FACTOR = 0.85;

/** Pénalité de score pour le matching N4 (city fallback). */
export const CITY_FALLBACK_SCORE_FACTOR = 0.70;

// ─── Matching zone multi-niveau ───────────────────────────────────────────────

/**
 * Matching multi-niveau d'un code de zone extrait.
 *
 * @param db           - Adaptateur DB (injecté pour testabilité)
 * @param codeNorm     - Code normalisé extrait du texte
 * @param rawText      - Texte brut original (pour provenance)
 * @param citySlug     - Slug de la commune
 * @param extractScore - Score de confiance de l'extraction
 * @returns MatchResult si résolu, ou UnresolvedResult sinon
 */
export async function matchZoneMultiLevel(
  db: GeoMatchDb,
  codeNorm: string,
  rawText: string,
  citySlug: string,
  extractScore: number,
): Promise<MatchResult | UnresolvedResult> {
  // N1 — Exact normalisé
  const exactId = await db.findZoneExact(codeNorm, citySlug);
  if (exactId) {
    return {
      canonicalId: exactId,
      scoreConfiance: extractScore,
      provenance: "exact_norm",
      extraitBrut: rawText,
    };
  }

  // N2 — Variantes
  const variants = zoneCodeVariants(codeNorm);
  if (variants.length > 0) {
    const variantId = await db.findZoneByVariants(variants, citySlug);
    if (variantId) {
      return {
        canonicalId: variantId,
        scoreConfiance: extractScore * VARIANT_SCORE_FACTOR,
        provenance: "variant_norm",
        extraitBrut: rawText,
      };
    }
  }

  // N3 — Distance d'édition pondérée
  const allZones = await db.listZoneCodesForCity(citySlug);
  if (allZones.length > 0) {
    let bestId: string | null = null;
    let bestDist = Infinity;
    let bestScore = 0;

    for (const zone of allZones) {
      const dist = levenshteinNorm(codeNorm, zone.codeNorm);
      if (dist <= EDIT_DIST_THRESHOLD && dist < bestDist) {
        bestDist = dist;
        bestId = zone.canonicalId;
        bestScore = extractScore * (1 - dist) * EDIT_DIST_SCORE_FACTOR;
      }
    }

    if (bestId) {
      return {
        canonicalId: bestId,
        scoreConfiance: bestScore,
        provenance: "edit_dist",
        extraitBrut: rawText,
      };
    }
  }

  // N4 — Désambiguïsation ville (city_fallback)
  const allCitiesMatches = await db.findZoneAllCities(codeNorm);
  if (allCitiesMatches.length === 1 && allCitiesMatches[0]) {
    return {
      canonicalId: allCitiesMatches[0].canonicalId,
      scoreConfiance: extractScore * CITY_FALLBACK_SCORE_FACTOR,
      provenance: "city_fallback",
      extraitBrut: rawText,
    };
  }
  // Plusieurs matches dans d'autres villes → ambiguïté
  if (allCitiesMatches.length > 1) {
    return {
      extraitBrut: rawText,
      patternType: "zone_code",
      scoreConfiance: extractScore,
      raison: "ambiguous",
    };
  }

  // Aucun match
  return {
    extraitBrut: rawText,
    patternType: "zone_code",
    scoreConfiance: extractScore,
    raison: "no_polygon",
  };
}

/**
 * Type guard : teste si le résultat est un match réussi.
 */
export function isMatchResult(
  r: MatchResult | UnresolvedResult,
): r is MatchResult {
  return "canonicalId" in r;
}
