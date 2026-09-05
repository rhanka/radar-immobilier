export type LotPotentialScoreStatus = "scored" | "fallback" | "unavailable";

export interface LotPotentialScoreResolution {
  score: number;
  status: LotPotentialScoreStatus;
  source: "api" | "zone" | "flags" | "none";
  reason: string;
}

export type ZoneKind = "H" | "C" | "U" | "I" | "P" | "A" | "CONS" | "REC" | "MIXTE" | "AUTRE";

const RESIDENTIAL_KINDS = new Set<ZoneKind>(["H", "MIXTE"]);
const RECONVERTIBLE_KINDS = new Set<ZoneKind>(["C", "U", "I"]);

export function resolveLotPotentialScore(
  properties: Readonly<Record<string, unknown>>,
): LotPotentialScoreResolution {
  const apiScore = firstNumber([
    properties.potentialScore,
    properties.potential_score,
    properties.score,
  ]);
  if (apiScore !== null) {
    return {
      score: clampScore(apiScore),
      status: "scored",
      source: "api",
      reason: "score fourni par la source geo",
    };
  }

  const flagsScore = scoreFromFlags(properties);
  if (flagsScore !== null) {
    return {
      score: flagsScore,
      status: "fallback",
      source: "flags",
      reason: "fallback depuis indicateurs lot 4+ / TOD",
    };
  }

  const zoneScore = scoreFromZone(properties);
  if (zoneScore !== null) {
    return {
      score: zoneScore,
      status: "fallback",
      source: "zone",
      reason: "fallback depuis code/type de zone",
    };
  }

  return {
    score: 0,
    status: "unavailable",
    source: "none",
    reason: "zone et TOD non disponibles",
  };
}

function scoreFromFlags(properties: Readonly<Record<string, unknown>>): number | null {
  const priority = firstBoolean([properties.priorite, properties.priority]);
  const multifamilial4plus = firstBoolean([
    properties.multifamilial4plus,
    properties.multifamilial_4plus,
    properties.fourPlus,
  ]);
  const tod = firstBoolean([properties.tod, properties.inTod, properties.in_tod]);
  if (priority) return 7;
  if (multifamilial4plus === null && tod === null) return null;
  if (multifamilial4plus && tod) return 7;
  if (multifamilial4plus) return 4;
  if (tod) return 2;
  return null;
}

function scoreFromZone(properties: Readonly<Record<string, unknown>>): number | null {
  const zone = readZoneObject(properties.zone);
  // §zones (directive owner) : le potentiel de zone n'est calculé QUE depuis le
  // `kind` SOURCE du lot. Le token du code de zone n'est PLUS dérivé en famille
  // — un lot sans kind source ⇒ score de zone `unknown` (null), jamais une
  // densité fabriquée à partir d'un code (« H-12 »).
  const kind = zone?.kind ?? null;
  if (kind === null) return null;

  const densiteLogHa = zone?.densiteLogHa ?? fallbackDensity(kind);
  const scoreBase = densityToBaseScore(densiteLogHa);
  const bonusKind = RESIDENTIAL_KINDS.has(kind) ? 1 : 0;
  const bonusReconvertible = RECONVERTIBLE_KINDS.has(kind) ? 0.5 : 0;
  return clampScore(scoreBase + bonusKind + bonusReconvertible);
}

function readZoneObject(value: unknown): { kind: ZoneKind; densiteLogHa: number | null } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rawKind = firstString([record.kind, record.zoneUsage, record.usage]);
  const kind = normalizeKind(rawKind);
  if (kind === null) return null;
  return {
    kind,
    densiteLogHa: firstNumber([record.densiteLogHa, record.densite_log_ha]),
  };
}

/**
 * Codes courts de famille de zonage → kind canonique. Couvre les préfixes
 * réglementaires QC historiques (H-, C-, I-, CONS-…) ET la taxonomie servie
 * par geo, MESURÉE sur les collections `qc-zonage-*` (2026-07 : Mont-Tremblant
 * + échantillon de 80 collections) : CO/CR/CF/CFA conservation, VP/VF/V/TV
 * villégiature (résidentiel saisonnier), TO/RE/REC récréotouristique, AG/AF/FO
 * agro-forestier, EX extraction, IN industriel, PU public, HA/RA/RB/RC/RV
 * résidentiel, suffixes des codes à secteur CV-/VA- (RF/RMF/RFM/RTF
 * résidentiel, CA/CCM commercial, MF/MXT/CU mixte, IND industriel).
 * Aucune entrée inventée.
 */
const ZONE_CODE_TOKEN_KINDS: Record<string, ZoneKind> = {
  // Habitation (résidentiel + villégiature)
  H: "H",
  HA: "H",
  R: "H",
  RA: "H",
  RB: "H",
  RC: "H",
  RM: "H",
  RV: "H",
  RF: "H",
  RFM: "H",
  RMF: "H",
  RTF: "H",
  V: "H",
  VP: "H",
  VF: "H",
  TV: "H",
  VILL: "H",
  // Mixte
  M: "MIXTE",
  MS: "MIXTE",
  MXTV: "MIXTE",
  MXT: "MIXTE",
  MF: "MIXTE",
  CU: "MIXTE",
  // Commercial
  C: "C",
  CM: "C",
  CA: "C",
  CCM: "C",
  // Industriel (extraction incluse : carrières/sablières)
  I: "I",
  ID: "I",
  IN: "I",
  IND: "I",
  EX: "I",
  // Utilité publique
  U: "U",
  // Public / institutionnel
  P: "P",
  PU: "P",
  CGS: "P",
  // Agricole / agro-forestier
  A: "A",
  AG: "A",
  AF: "A",
  FO: "A",
  // Conservation (corridors fauniques et conservation forestière inclus)
  CONS: "CONS",
  CONSERVATION: "CONS",
  CO: "CONS",
  CR: "CONS",
  CF: "CONS",
  CFA: "CONS",
  // Récréation / touristique
  REC: "REC",
  RE: "REC",
  TO: "REC",
};

/**
 * Kind canonique dérivé des TOKENS alphabétiques d'un code de zone : le code
 * est découpé sur tout séparateur non alphabétique (« CO-939 » → [CO],
 * « CV-RF-2 » → [CV, RF], « Af/b » → [AF, B]) et le PREMIER token connu de la
 * table gagne — ce qui résout aussi les codes à préfixe de secteur
 * (CV-/VA-/ST- de Mont-Tremblant : le secteur est inconnu, le suffixe porte la
 * famille). Insensible à la casse. null si aucun token connu (aucune invention).
 * Exporté : sert aussi à la teinte des aplats de zone (zone-kind-style).
 */
export function kindFromZoneCode(zoneCode: string | null): ZoneKind | null {
  if (!zoneCode) return null;
  const code = zoneCode.trim().toUpperCase();
  if (!code || code === "N/D") return null;
  const tokens = code.split(/[^A-Z]+/).filter((token) => token.length > 0);
  for (const token of tokens) {
    const kind = ZONE_CODE_TOKEN_KINDS[token];
    if (kind) return kind;
  }
  return null;
}

function normalizeKind(value: string | null): ZoneKind | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (["H", "C", "U", "I", "P", "A", "CONS", "REC", "MIXTE", "AUTRE"].includes(normalized)) {
    return normalized as ZoneKind;
  }
  return null;
}

function fallbackDensity(kind: ZoneKind): number | null {
  if (kind === "H") return 20;
  if (kind === "MIXTE") return 40;
  return null;
}

function densityToBaseScore(densiteLogHa: number | null): number {
  if (densiteLogHa === null || densiteLogHa <= 0) return 0;
  if (densiteLogHa <= 20) return 1;
  if (densiteLogHa <= 50) return 2;
  if (densiteLogHa <= 100) return 3;
  if (densiteLogHa <= 200) return 4;
  return 5;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.round(Math.max(0, Math.min(10, score)) * 10) / 10;
}

function firstString(values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function firstNumber(values: readonly unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function firstBoolean(values: readonly unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "oui"].includes(normalized)) return true;
      if (["false", "0", "no", "non"].includes(normalized)) return false;
    }
  }
  return null;
}
