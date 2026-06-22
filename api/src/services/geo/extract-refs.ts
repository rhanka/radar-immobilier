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
 *   S0 - Champ structuré `zone_ref`             -> score 0.95 (levier A direct)
 *   P1 - Mention explicite "zone X-123"         -> score 0.85
 *   P2 - Format standard lettre+chiffres+tiret  -> score 0.65
 *   P3 - Numérique pur "zone 1000"              -> score 0.40
 *   Notation flèche "TR-185→CEN-183"            -> 2 codes (avant + après)
 *
 * Lot :
 *   S0 - Champ structuré `no_lot`               -> score 0.90 (levier B direct)
 *   L1 - Mention explicite "lot 6 057 912"      -> score 0.75
 *   L2 - Compact 7+ chiffres (hors contexte)    -> score 0.45
 *
 * Adresse (levier D — extraction immo, géocodage côté geo) :
 *   A1 - "206 et 208, rue William"              -> numéro(s) + odonyme normalisé
 *   A1 - "126, rue du Locle"                    -> 1 numéro + odonyme
 *
 * ## Sources de texte (levier A/B — d'où viennent les références)
 * Au-delà du label+description, les références propres vivent souvent dans les
 * champs STRUCTURÉS (`zone_ref`, `no_lot`) et la `citation`/`excerpt` extraite
 * du PV par graphify. `extractRefsFromFields` couvre toutes ces sources.
 *
 * ## Loi 25
 * Aucune PII : le texte source peut contenir des numéros de lot et des adresses
 * (données cadastrales/foncières publiques). Aucun nom de propriétaire n'est extrait.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Un code de zone extrait du texte libre. */
export interface ExtractedZoneCode {
  /** Texte brut tel qu'il apparaît dans la source (avant normalisation). */
  rawText: string;
  /** Code normalisé : majuscules, sans espaces, sans suffixe secteur `(VLO)`. */
  codeNorm: string;
  /** Score de confiance (0.40–0.95). */
  score: number;
  /** Identifiant du pattern ayant produit ce résultat. */
  patternId: "zone_structured" | "zone_explicit" | "zone_standard" | "zone_numeric";
}

/** Un numéro de lot extrait du texte libre. */
export interface ExtractedLotRef {
  /** Texte brut tel qu'il apparaît dans la source. */
  rawText: string;
  /** Numéro de lot normalisé : chiffres uniquement (espaces supprimés). */
  noLotNorm: string;
  /** Score de confiance (0.45–0.90). */
  score: number;
  /** Identifiant du pattern. */
  patternId: "lot_structured" | "lot_explicit" | "lot_compact";
}

/**
 * Une adresse extraite du texte libre (levier D).
 *
 * L'extraction (numéro(s) + odonyme) est faisable côté immo. La résolution
 * géographique (géocodage → coordonnées → jointure spatiale dans le polygone
 * de zone/lot) dépend d'une donnée/API du domaine geo (cf. `streetName` plus bas).
 */
export interface ExtractedAddress {
  /** Texte brut tel qu'il apparaît dans la source. */
  rawText: string;
  /** Numéro(s) civique(s) (ex. ["206", "208"]). */
  civicNumbers: string[];
  /** Nom de rue normalisé sans le type de voie (ex. "WILLIAM", "DU LOCLE"). */
  streetName: string;
  /** Type de voie normalisé (ex. "RUE", "CHEMIN", "BOULEVARD"). */
  streetType: string;
  /** Score de confiance (0.50–0.70). */
  score: number;
}

/** Résultat complet d'extraction pour un noeud. */
export interface ExtractionResult {
  zoneCodes: ExtractedZoneCode[];
  lotRefs: ExtractedLotRef[];
  /** Adresses extraites (levier D — résolution spatiale = dépendance geo). */
  addresses: ExtractedAddress[];
}

// ─── Constantes de score ──────────────────────────────────────────────────────

export const SCORE = {
  /** Champ structuré `zone_ref` — référence la plus fiable (levier A direct). */
  ZONE_STRUCTURED: 0.95,
  ZONE_EXPLICIT: 0.85,
  ZONE_STANDARD: 0.65,
  ZONE_NUMERIC: 0.40,
  /** Champ structuré `no_lot` — référence cadastrale directe (levier B direct). */
  LOT_STRUCTURED: 0.90,
  LOT_EXPLICIT: 0.75,
  LOT_COMPACT: 0.45,
  /** Adresse explicite "N, rue X" (levier D). */
  ADDRESS_EXPLICIT: 0.70,
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
 * Notation flèche de rezonage : "TR-185→CEN-183", "TR-185 → CEN-183",
 * "zone TR-185 vers CEN-183". Capture les DEUX codes (zone d'origine + cible),
 * tous deux pertinents pour le mapping.
 */
const ZONE_ARROW_SRC = String.raw`\b([A-Z]{1,4}[0-9]{0,2}[-–]?[0-9]{1,5})\s*(?:[→➔➜⟶]|->|=>|vers)\s*([A-Z]{1,4}[0-9]{0,2}[-–]?[0-9]{1,5})\b`;

/**
 * L1 - Mention explicite "lot 6 057 912" ou "lot 6057912".
 * Le format NO_LOT du cadastre allégé contient des espaces (ex. "6 057 912").
 */
const LOT_EXPLICIT_SRC = String.raw`\blot\s+([0-9](?:\s*[0-9]){3,9})\b`;

/**
 * L1-multi - Liste de lots "lots 6691146, 5978310, 5978320" ou
 * "lots 6 691 146 et 5 978 310". Capture le bloc complet après "lots " ;
 * les numéros individuels sont ré-extraits par split.
 */
const LOT_LIST_SRC = String.raw`\blots?\s+((?:[0-9][0-9\s]*[0-9])(?:\s*(?:,|et|&)\s*(?:[0-9][0-9\s]*[0-9]))+)`;

/**
 * L2 - Compact 7-10 chiffres sans contexte explicite.
 * Confiance basse : peut être un numéro de règlement, d'article, etc.
 */
const LOT_COMPACT_SRC = String.raw`(?<![0-9])([0-9]{7,10})(?![0-9])`;

/**
 * A1 - Adresse civique "206 et 208, rue William" / "126, rue du Locle" /
 * "486, chemin de la Grande-Côte". Capture le(s) numéro(s) puis le type de
 * voie + odonyme. La résolution spatiale est une dépendance geo (cf. levier D).
 */
const ADDRESS_SRC = String.raw`\b(\d{1,5}(?:\s*(?:,|et|&)\s*\d{1,5})*)\s*,?\s*(rue|avenue|av\.?|boulevard|boul\.?|chemin|ch\.?|montée|montee|rang|route|place|impasse|allée|allee|côte|cote|croissant|terrasse)\s+((?:de\s+la\s+|de\s+l['’]|du\s+|des\s+|de\s+|le\s+|la\s+|les\s+|d['’])?[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*(?:[ \-][A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*){0,3})`;

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Normalise un code de zone (UNIQUE source de vérité — utilisée par extract-refs ET ogc-pull).
 *
 * Règles :
 * - Majuscules
 * - Remplacement des tirets demi-cadratins (–, —) par des tirets ASCII (-)
 * - Suppression du suffixe secteur entre parenthèses (ex. `(VLO)`, `(SAT)`)
 * - Suppression de tous les espaces restants
 *
 * Exemples :
 *   "H34-327 (VLO)" -> "H34-327"
 *   "h-431"         -> "H-431"
 *   "RU1302"        -> "RU1302"
 *   "H 34-327"      -> "H34-327"
 *   "H–431"         -> "H-431"     (demi-cadratin unicode)
 *   null / undefined -> ""
 *
 * @param raw - Valeur brute (string ou unknown depuis les propriétés OGC)
 */
export function normalizeZoneCode(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/\s*\([A-Z0-9]{2,8}\)\s*/g, "")
    .replace(/\s+/g, "");
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

/** Normalisation des types de voie vers une forme canonique. */
const STREET_TYPE_CANON: Record<string, string> = {
  RUE: "RUE",
  AVENUE: "AVENUE",
  AV: "AVENUE",
  "AV.": "AVENUE",
  BOULEVARD: "BOULEVARD",
  BOUL: "BOULEVARD",
  "BOUL.": "BOULEVARD",
  CHEMIN: "CHEMIN",
  CH: "CHEMIN",
  "CH.": "CHEMIN",
  MONTÉE: "MONTEE",
  MONTEE: "MONTEE",
  RANG: "RANG",
  ROUTE: "ROUTE",
  PLACE: "PLACE",
  IMPASSE: "IMPASSE",
  ALLÉE: "ALLEE",
  ALLEE: "ALLEE",
  CÔTE: "COTE",
  COTE: "COTE",
  CROISSANT: "CROISSANT",
  TERRASSE: "TERRASSE",
};

/**
 * Normalise un nom de rue/odonyme pour la jointure géocodage :
 * - Majuscules, accents conservés mais espaces compactés
 * - Suppression des particules de tête déjà incluses ("DE LA", "DU", "DES"…)
 *   pour obtenir le radical comparable (ex. "du Locle" → "LOCLE").
 *
 * Exemples :
 *   "William"        -> "WILLIAM"
 *   "du Locle"       -> "LOCLE"
 *   "de la Grande-Côte" -> "GRANDE-COTE"
 */
export function normalizeStreetName(raw: string): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[ÀÂÄ]/g, "A")
    .replace(/[ÉÈÊË]/g, "E")
    .replace(/[ÎÏ]/g, "I")
    .replace(/[ÔÖ]/g, "O")
    .replace(/[ÛÜÙ]/g, "U")
    .replace(/Ç/g, "C")
    .replace(/['’]/g, " ")
    .replace(/^(?:DE\s+LA|DE\s+L|DU|DES|DE|LE|LA|LES|D)\s+/u, "")
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

  // Notation flèche "TR-185→CEN-183" → 2 codes (origine + cible)
  for (const match of text.matchAll(new RegExp(ZONE_ARROW_SRC, "gi"))) {
    for (const raw of [match[1], match[2]]) {
      const rawText = (raw ?? "").trim();
      const codeNorm = normalizeZoneCode(rawText);
      // Garde-fou : au moins une lettre (évite "185→183" purement numérique)
      if (codeNorm.length >= 2 && /[A-Z]/.test(codeNorm)) {
        results.push({ rawText, codeNorm, score: SCORE.ZONE_EXPLICIT, patternId: "zone_explicit" });
      }
    }
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

  // L1-multi - Liste "lots 6691146, 5978310, 5978320" → 1 entrée par numéro
  for (const match of text.matchAll(new RegExp(LOT_LIST_SRC, "gi"))) {
    const block = match[1] ?? "";
    // Sépare sur virgule / "et" / "&" puis normalise chaque numéro.
    for (const part of block.split(/\s*(?:,|et|&)\s*/i)) {
      const noLotNorm = normalizeLotRef(part);
      if (noLotNorm.length >= 7) {
        results.push({
          rawText: part.trim(),
          noLotNorm,
          score: SCORE.LOT_EXPLICIT,
          patternId: "lot_explicit",
        });
      }
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
 * Extrait toutes les adresses civiques d'un texte libre (levier D).
 *
 * Capture le(s) numéro(s) civique(s) + type de voie + odonyme. L'extraction
 * est faisable côté immo ; la RÉSOLUTION (géocodage → point-in-polygon) dépend
 * d'une donnée/API geo.
 *
 * @param text - Texte libre.
 * @returns Adresses extraites (1 entrée par couple numéros/odonyme), dédupliquées.
 */
export function extractAddresses(text: string): ExtractedAddress[] {
  if (!text || text.trim().length === 0) return [];

  const map = new Map<string, ExtractedAddress>();

  for (const match of text.matchAll(new RegExp(ADDRESS_SRC, "gi"))) {
    const numbersBlock = match[1] ?? "";
    const typeRaw = (match[2] ?? "").trim();
    const nameRaw = (match[3] ?? "").trim();

    const civicNumbers = numbersBlock
      .split(/\s*(?:,|et|&)\s*/i)
      .map((n) => n.replace(/[^0-9]/g, ""))
      .filter((n) => n.length > 0);

    const streetType = STREET_TYPE_CANON[typeRaw.toUpperCase()] ?? typeRaw.toUpperCase();
    const streetName = normalizeStreetName(nameRaw);

    if (civicNumbers.length === 0 || streetName.length === 0) continue;

    const key = `${streetType}|${streetName}|${civicNumbers.join(",")}`;
    if (!map.has(key)) {
      map.set(key, {
        rawText: match[0].trim(),
        civicNumbers,
        streetName,
        streetType,
        score: SCORE.ADDRESS_EXPLICIT,
      });
    }
  }

  return [...map.values()];
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
    addresses: extractAddresses(text),
  };
}

/**
 * Champs disponibles sur un noeud Signal/DesignationEvent pour l'extraction.
 *
 * `extractRefsFromFields` est la porte d'entrée riche : elle combine
 * - les champs STRUCTURÉS (`zoneRef`, `noLot`) — référence directe la plus fiable
 *   (leviers A/B), traités avec un score plancher élevé ;
 * - tout le TEXTE disponible (label, description, citation, excerpt, extraits
 *   des `refs[]`) où les références sont souvent plus complètes que dans le label.
 */
export interface NodeRefFields {
  label?: string | null | undefined;
  description?: string | null | undefined;
  /** Champ structuré `props.properties.zone_ref`. */
  zoneRef?: string | null | undefined;
  /** Champ structuré `props.properties.no_lot`. */
  noLot?: string | null | undefined;
  /** Citation/extrait du PV (`props.properties.citation`). */
  citation?: string | null | undefined;
  /** Extrait additionnel (`props.properties.excerpt` ou refs[].excerpt). */
  excerpts?: Array<string | null | undefined> | undefined;
}

/**
 * Extraction multi-source (leviers A/B/D).
 *
 * Ordre de priorité par déduplication (score max conservé) :
 *   1. champs structurés `zone_ref` / `no_lot` (scores 0.95 / 0.90)
 *   2. patterns sur le texte combiné (label + description + citation + excerpts)
 *
 * Anti-invention : aucun champ exploitable → résultat vide.
 */
export function extractRefsFromFields(fields: NodeRefFields): ExtractionResult {
  const textParts = [
    fields.label,
    fields.description,
    fields.citation,
    ...(fields.excerpts ?? []),
  ].filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  const text = textParts.join(" \n ");

  const zoneCodes = extractZoneCodes(text);
  const lotRefs = extractLotRefs(text);
  const addresses = extractAddresses(text);

  // Champ structuré zone_ref — score plancher élevé (levier A direct).
  if (fields.zoneRef) {
    const codeNorm = normalizeZoneCode(fields.zoneRef);
    if (codeNorm.length >= 2) {
      zoneCodes.push({
        rawText: String(fields.zoneRef).trim(),
        codeNorm,
        score: SCORE.ZONE_STRUCTURED,
        patternId: "zone_structured",
      });
    }
  }

  // Champ structuré no_lot — peut contenir plusieurs lots séparés.
  if (fields.noLot) {
    for (const part of String(fields.noLot).split(/\s*(?:,|;|et|&)\s*/i)) {
      const noLotNorm = normalizeLotRef(part);
      if (noLotNorm.length >= 7) {
        lotRefs.push({
          rawText: part.trim(),
          noLotNorm,
          score: SCORE.LOT_STRUCTURED,
          patternId: "lot_structured",
        });
      }
    }
  }

  return {
    zoneCodes: deduplicateZoneCodes(zoneCodes).sort((a, b) => b.score - a.score),
    lotRefs: deduplicateLotRefs(lotRefs).sort((a, b) => b.score - a.score),
    addresses,
  };
}
