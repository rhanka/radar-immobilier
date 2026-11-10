/**
 * Closed `props` projection (SPEC §5.4), shared by the artifact reader
 * surface and the scoped card view (SPEC_FILTRAGE_API §3). Fail-closed:
 * any key not listed here — at any level — is dropped.
 */
import { RegulatoryStageKind } from "@radar/domain";

/** Surrogate-safe truncation, matching the `SignalCard` projection precedent. */
export function cut(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  const truncated = value.slice(0, maximum);
  return /[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated;
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function validBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map(finiteNumber);
  return numbers.every((n): n is number => n !== null)
    ? [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!]
    : null;
}

const SHORT_STRING_KEYS = new Set([
  "category", "etape", "instrument",
  "date", "documentDate", "publishedAt", "meetingDate", "etapeDate", "etape_date", "meeting_date",
  "linkSource", "link_source",
]);

const TEXT_KEYS = new Set([
  "description", "summary", "details", "resume", "justification", "citation", "excerpt",
]);

const REGLEMENT_KEYS = new Set([
  "reglement_number", "reglementNumber", "reglement_numero",
  "reglementNumbers", "bylaw", "reglement_millesime", "reglementMillesime", "millesime",
]);

const ZONE_LOT_KEYS = new Set([
  "zone_ref", "zoneRef", "zone_refs", "zones", "zone", "target_zone", "targets_zone",
  "lot_ref", "lotRef", "noLot", "no_lot", "lot", "lots", "target_lot", "targets_lot",
]);

const PROOF_BOOL_KEYS = new Set([
  "provisional", "is_provisional", "isProvisional", "auto", "autoLinked",
]);

function projectStringArray(value: unknown, itemMax: number): string[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    out.push(item.slice(0, itemMax));
  }
  return out;
}

function projectReglementValue(value: unknown): string | number | Array<string | number> | null {
  if (typeof value === "string") return value.slice(0, 256);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length <= 32) {
    const out: Array<string | number> = [];
    for (const item of value) {
      if (typeof item === "string") out.push(item.slice(0, 256));
      else if (typeof item === "number" && Number.isFinite(item)) out.push(item);
      else return null;
    }
    return out;
  }
  return null;
}

function projectStringOrArray(value: unknown): string | string[] | null {
  if (typeof value === "string") return value.slice(0, 256);
  return projectStringArray(value, 128);
}

function projectDocumentDate(value: unknown): string | { status: string; precision: string; value: string } | null {
  if (typeof value === "string") return value.slice(0, 256);
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 3 && keys.includes("status") && keys.includes("precision") && keys.includes("value")
      && typeof record.status === "string" && typeof record.precision === "string" && typeof record.value === "string") {
      return { status: record.status.slice(0, 128),
        precision: record.precision.slice(0, 128), value: record.value.slice(0, 256) };
    }
  }
  return null;
}

function projectRefItem(item: unknown): Record<string, unknown> | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["excerpt", "citation", "quote", "text"]) {
    if (typeof record[key] === "string") out[key] = cut(record[key] as string, 2000);
  }
  if (typeof record.fetchedAt === "string") out.fetchedAt = (record.fetchedAt as string).slice(0, 256);
  if (typeof record.publishedAt === "string") out.publishedAt = (record.publishedAt as string).slice(0, 256);
  const documentDate = projectDocumentDate(record.documentDate);
  if (documentDate !== null) out.documentDate = documentDate;
  const page = finiteNumber(record.page);
  if (page !== null) out.page = page;
  const bbox = validBbox(record.bbox);
  if (bbox !== null) out.bbox = bbox;
  for (const key of PROOF_BOOL_KEYS) {
    if (typeof record[key] === "boolean") out[key] = record[key];
  }
  for (const key of ["linkSource", "link_source"]) {
    if (typeof record[key] === "string") out[key] = (record[key] as string).slice(0, 256);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function projectRefs(refs: unknown): Record<string, unknown>[] {
  if (!Array.isArray(refs)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of refs.slice(0, 64)) {
    const projected = projectRefItem(item);
    if (projected !== null) out.push(projected);
  }
  return out;
}

function projectPropsLevel(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const status = input.status ?? input.statut;
  if (typeof status === "string" && RegulatoryStageKind.safeParse(status).success) out.statut = status;
  if (typeof input.description === "string") out.description = cut(input.description, 2000);
  for (const key of TEXT_KEYS) {
    if (key === "description") continue;
    if (typeof input[key] === "string") out[key] = cut(input[key] as string, 2000);
  }
  for (const key of SHORT_STRING_KEYS) {
    if (typeof input[key] === "string") out[key] = (input[key] as string).slice(0, 1024);
  }
  for (const key of REGLEMENT_KEYS) {
    const projected = projectReglementValue(input[key]);
    if (projected !== null) out[key] = projected;
  }
  for (const key of ZONE_LOT_KEYS) {
    const projected = projectStringOrArray(input[key]);
    if (projected !== null) out[key] = projected;
  }
  const page = finiteNumber(input.page);
  if (page !== null) out.page = page;
  const bbox = validBbox(input.bbox);
  if (bbox !== null) out.bbox = bbox;
  for (const key of PROOF_BOOL_KEYS) {
    if (typeof input[key] === "boolean") out[key] = input[key];
  }
  return out;
}

/**
 * Closed projection of the ingestion passthrough (§5.4). Refs are kept at
 * both levels the client date lens reads: root `refs` and
 * `properties.refs` (same bounded item projection).
 */
export function projectProps(props: unknown): Record<string, unknown> {
  if (typeof props !== "object" || props === null || Array.isArray(props)) return {};
  const input = props as Record<string, unknown>;
  const out = projectPropsLevel(input);
  if (typeof input.properties === "object" && input.properties !== null && !Array.isArray(input.properties)) {
    const nestedInput = input.properties as Record<string, unknown>;
    const nested = projectPropsLevel(nestedInput);
    const nestedRefs = projectRefs(nestedInput.refs);
    if (nestedRefs.length > 0) nested.refs = nestedRefs;
    if (Object.keys(nested).length > 0) out.properties = nested;
  }
  const refs = projectRefs(input.refs);
  if (refs.length > 0) out.refs = refs;
  return out;
}
