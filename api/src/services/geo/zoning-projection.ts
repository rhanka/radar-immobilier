/**
 * Closed zoning projection for governed `qc-zonage-<city>` items (J1 zonage,
 * field review j1-2b §7.3).
 *
 * The real Signaux zoning layer (`ui/src/lib/maps/zones-client.ts`,
 * `normalizeOgcZoneFeature` / `normalizeOgcZoneProperties`) reads a small,
 * known set of public zoning attributes through ordered candidate keys. This
 * module applies EXACTLY the same candidate order on the server, restricted to
 * the source keys a dated per-collection record lists, and emits a CLOSED
 * normalised property object:
 *
 *   code, kind, affectation, usages, reglementMillesime, reglementNumero,
 *   reglementUrl, grillePdfUrl
 *
 * Fail-closed: a raw key that is not a recorded source key is never read, and
 * no raw key is ever copied through. URL fields are a PROJECTION (§7.3): they
 * survive only as public canonical URLs (`isPublicCanonicalUrl`: http(s),
 * public host, no credentials, no query, no fragment, no object-storage
 * host); anything else is dropped, never rewritten. Strings are trimmed (same
 * as the UI `readString`) and bounded.
 *
 * Candidate lists mirror `zones-client.ts` verbatim (order is load-bearing:
 * `zone_code` first, the generic `code` late, sequential ids last). The UI
 * parity test (`ui/src/lib/maps/zones-reader-transport.test.ts`) fails if the
 * two drift on the recorded fixtures.
 */

import { isPublicCanonicalUrl } from "./provenance.js";

/** Projection identifier served in the reader response. */
export const ZONING_PROJECTION = "zoning-v1" as const;

/** Closed output keys of the zoning projection (the record's served fields). */
export const ZONING_PROJECTION_FIELDS = [
  "code",
  "kind",
  "affectation",
  "usages",
  "reglementMillesime",
  "reglementNumero",
  "reglementUrl",
  "grillePdfUrl",
] as const;
export type ZoningProjectionField = (typeof ZONING_PROJECTION_FIELDS)[number];

/** Bound on any projected string (zone codes and labels are short). */
export const ZONING_STRING_MAX = 256;
/** Bound on the `usages` array length. */
export const ZONING_USAGES_MAX = 32;

// Mirror of zones-client.ts normalizeOgcZoneFeature (code candidates). The
// pseudo-key "ETIQUETTE" stands for its last whitespace token, as in the UI.
export const ZONING_CODE_CANDIDATES = [
  "zone_code",
  "zoneCode",
  "ZONE",
  "Zone",
  "Zonage",
  "zonage",
  "NO_ZONAGE",
  "zone_",
  "ETIQUETTE",
  "code",
  "Code",
  "code_affiche",
  "codeAffiche",
  "No_zone",
  "no_zone",
  "NumZone",
  "num_zone",
  "NUM_ZONE",
] as const;
export const ZONING_KIND_CANDIDATES = ["kind", "type", "categorie", "category", "zoneKind", "zone_kind"] as const;
export const ZONING_AFFECTATION_CANDIDATES = ["affectation", "Affectation", "AFFECTATION"] as const;
export const ZONING_USAGES_CANDIDATES = ["usages", "usage"] as const;
export const ZONING_GRILLE_CANDIDATES = [
  "URL_Grille",
  "LienGrille",
  "Grille",
  "URL_GRILLE",
  "GRILLE_URL",
  "grille",
  "lien_grille",
] as const;
export const ZONING_MILLESIME_CANDIDATES = [
  "reglement_millesime",
  "reglementMillesime",
  "REGLEMENT_MILLESIME",
  "Reglement_Millesime",
  "millesime",
  "Millesime",
] as const;
export const ZONING_NUMERO_CANDIDATES = [
  "reglement_numero",
  "reglementNumero",
  "REGLEMENT_NUMERO",
  "Reglement_Numero",
  "reglement_number",
  "reglementNumber",
] as const;
export const ZONING_REGLEMENT_URL_CANDIDATES = [
  "reglement_url",
  "reglementUrl",
  "REGLEMENT_URL",
  "Reglement_Url",
] as const;

/** Every raw key the projection may ever read (record source keys ⊆ this). */
export const ZONING_SOURCE_KEY_UNIVERSE: ReadonlySet<string> = new Set<string>([
  ...ZONING_CODE_CANDIDATES,
  ...ZONING_KIND_CANDIDATES,
  ...ZONING_AFFECTATION_CANDIDATES,
  ...ZONING_USAGES_CANDIDATES,
  ...ZONING_GRILLE_CANDIDATES,
  ...ZONING_MILLESIME_CANDIDATES,
  ...ZONING_NUMERO_CANDIDATES,
  ...ZONING_REGLEMENT_URL_CANDIDATES,
]);

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > ZONING_STRING_MAX) return null;
  return trimmed;
}

function readStringLike(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return readString(value);
}

/** Read `key` only when the record lists it; the ETIQUETTE pseudo-key yields its last token. */
function pick(properties: Record<string, unknown>, allowed: ReadonlySet<string>, key: string): unknown {
  if (!allowed.has(key)) return undefined;
  const value = properties[key];
  if (key === "ETIQUETTE") {
    return typeof value === "string" ? value.trim().split(/\s+/).pop() : undefined;
  }
  return value;
}

function first(
  properties: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  candidates: readonly string[],
  read: (value: unknown) => string | null,
): string | null {
  for (const key of candidates) {
    const parsed = read(pick(properties, allowed, key));
    if (parsed !== null) return parsed;
  }
  return null;
}

function publicUrl(
  properties: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  candidates: readonly string[],
): string | null {
  // Same resolution as the UI (first non-empty string), THEN the §7.3 URL
  // projection: a first candidate that is not a public canonical URL drops
  // the field — it never falls through to a later, different link.
  const candidate = first(properties, allowed, candidates, readString);
  return candidate !== null && isPublicCanonicalUrl(candidate) ? candidate : null;
}

function usages(properties: Record<string, unknown>, allowed: ReadonlySet<string>): string[] | undefined {
  // UI: `properties.usages ?? properties.usage` (nullish fallback only).
  const primary = pick(properties, allowed, "usages");
  const value = primary ?? pick(properties, allowed, "usage");
  if (Array.isArray(value)) {
    const items = value.map((item) => readString(item)).filter((item): item is string => item !== null);
    return items.length > 0 ? items.slice(0, ZONING_USAGES_MAX) : undefined;
  }
  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.length <= ZONING_STRING_MAX);
    return items.length > 0 ? items.slice(0, ZONING_USAGES_MAX) : undefined;
  }
  return undefined;
}

/**
 * Project one feature's raw properties into the closed zoning shape.
 * `sourceKeys` is the record's explicit per-collection mapping: only these
 * raw keys are ever read. A feature without a resolvable code keeps an empty
 * `code`-less object (the UI drops it exactly as it drops it on the app path).
 */
export function projectZoningProperties(
  properties: Record<string, unknown>,
  sourceKeys: readonly string[],
): Partial<Record<ZoningProjectionField, string | string[]>> {
  const allowed = new Set(sourceKeys.filter((key) => ZONING_SOURCE_KEY_UNIVERSE.has(key)));
  const out: Partial<Record<ZoningProjectionField, string | string[]>> = {};
  const code = first(properties, allowed, ZONING_CODE_CANDIDATES, readString);
  if (code !== null) out.code = code;
  const kind = first(properties, allowed, ZONING_KIND_CANDIDATES, readString);
  if (kind !== null) out.kind = kind;
  const affectation = first(properties, allowed, ZONING_AFFECTATION_CANDIDATES, readString);
  if (affectation !== null) out.affectation = affectation;
  const list = usages(properties, allowed);
  if (list !== undefined) out.usages = list;
  const millesime = first(properties, allowed, ZONING_MILLESIME_CANDIDATES, readStringLike);
  if (millesime !== null) out.reglementMillesime = millesime;
  const numero = first(properties, allowed, ZONING_NUMERO_CANDIDATES, readStringLike);
  if (numero !== null) out.reglementNumero = numero;
  const reglementUrl = publicUrl(properties, allowed, ZONING_REGLEMENT_URL_CANDIDATES);
  if (reglementUrl !== null) out.reglementUrl = reglementUrl;
  const grille = publicUrl(properties, allowed, ZONING_GRILLE_CANDIDATES);
  if (grille !== null) out.grillePdfUrl = grille;
  return out;
}

/** Restrict a projected object to a requested field subset (field projection param). */
export function selectZoningFields<T extends Record<string, unknown>>(
  projected: T,
  fields: readonly string[] | undefined,
): Partial<T> {
  if (!fields) return projected;
  const wanted = new Set(fields);
  return Object.fromEntries(Object.entries(projected).filter(([key]) => wanted.has(key))) as Partial<T>;
}

const GEOMETRY_TYPES: ReadonlySet<string> = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
]);

function finiteCoordinates(value: unknown, depth: number): boolean {
  if (depth > 6 || !Array.isArray(value)) return false;
  if (value.length > 0 && typeof value[0] === "number") {
    return value.length >= 2 && value.length <= 4 && value.every((n) => typeof n === "number" && Number.isFinite(n));
  }
  return value.every((item) => finiteCoordinates(item, depth + 1));
}

/**
 * §6.4 geometry PROJECTION: a known GeoJSON type with finite numeric
 * coordinates, or null. No other geometry key is copied.
 */
export function projectZoningGeometry(value: unknown): { type: string; coordinates: unknown } | null {
  if (typeof value !== "object" || value === null) return null;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  if (typeof geometry.type !== "string" || !GEOMETRY_TYPES.has(geometry.type)) return null;
  if (!finiteCoordinates(geometry.coordinates, 0)) return null;
  return { type: geometry.type, coordinates: geometry.coordinates };
}
