export type LotPotentialScoreStatus = "scored" | "fallback" | "unavailable";

export interface LotPotentialScoreResolution {
  score: number;
  status: LotPotentialScoreStatus;
  source: "api" | "zone" | "flags" | "none";
  reason: string;
}

type ZoneKind = "H" | "C" | "U" | "I" | "P" | "A" | "CONS" | "REC" | "MIXTE" | "AUTRE";

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
  const zoneCode = firstString([
    properties.zoneCode,
    properties.zone_code,
    typeof properties.zone === "string" ? properties.zone : null,
  ]);
  const kind = zone?.kind ?? kindFromZoneCode(zoneCode);
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

function kindFromZoneCode(zoneCode: string | null): ZoneKind | null {
  if (!zoneCode) return null;
  const code = zoneCode.trim();
  if (!code || code === "N/D") return null;
  if (/^(H|RM|R)-/i.test(code)) return "H";
  if (/^(M|MS|MXTV)-/i.test(code)) return "MIXTE";
  if (/^C-/i.test(code)) return "C";
  if (/^(I|ID)-/i.test(code)) return "I";
  if (/^U-/i.test(code)) return "U";
  if (/^(P|CGS)-/i.test(code)) return "P";
  if (/^A-/i.test(code)) return "A";
  if (/^(CONS|CONSERVATION)-/i.test(code)) return "CONS";
  if (/^REC-/i.test(code)) return "REC";
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
