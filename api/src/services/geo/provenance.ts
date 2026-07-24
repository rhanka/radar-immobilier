/**
 * Public provenance envelopes supplied by geo — POSITIVE, VERSIONED validation.
 *
 * These envelopes are additive audit metadata (`properties.proof`,
 * `properties.immo_zone_lot_provenance`). They are NOT opaque: immo re-derives
 * their public safety from the contracts rather than trusting the producer.
 *
 * The guard is an ALLOWLIST by contract shape, not a blocklist of bad tokens:
 *
 *  - `proof`   → `immo-feature-proof` v1 (`schema_version:"1.0"`) OR v2 (`"2.0"`),
 *    per `docs/spec/geo-contracts/contrat-jointure-immo-zones-lots.md` §7/§8.
 *  - `immo_zone_lot_provenance` → `immo-zone-lot-provenance/v1`, per
 *    `docs/spec/geo-contracts/immo-zone-lot-provenance-api-20260722.md` §3–§7.
 *
 * ONLY the fields, enums and shapes declared by those contracts are accepted.
 * Every unknown key (job_id, run_id, raw_log, error, token, password, S3/object
 * keys, local paths…) fails the envelope AS A WHOLE — it is never partly
 * rewritten. Every URL must be a public, canonical HTTP(S) URL (no query,
 * fragment, credentials, no localhost / private IP / minio / S3 host). A
 * truncated envelope (missing a mandatory axis) is rejected, not repaired.
 */

export type ProvenanceEnvelope = Record<string, unknown>;

export interface FeatureProvenanceProperties {
  proof?: ProvenanceEnvelope;
  immo_zone_lot_provenance?: ProvenanceEnvelope;
}

// ─── Primitive guards ────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** Exactly the allowed keys are present — no more, no fewer. */
function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(record);
  if (own.length !== keys.length) return false;
  return keys.every((key) => key in record);
}

/** Every present key is in the allowed set (subset — optional nested fields). */
function onlyKnownKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).every((key) => keys.includes(key));
}

function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

// ─── Public canonical URL guard ──────────────────────────────────────────────

function stripBrackets(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "");
}

/** localhost / loopback / link-local / RFC1918 private hosts. */
function isPrivateOrLocalHost(hostname: string): boolean {
  const host = stripBrackets(hostname.toLowerCase());
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0 || a === 127) return true; // this-host / loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 169 && b === 254) return true; // link-local
  }
  return false;
}

/** S3 / object-storage / minio host (never a public geometry source). */
function isStorageHost(hostname: string): boolean {
  const host = stripBrackets(hostname.toLowerCase());
  if (host.includes("minio")) return true;
  if (/(^|\.)s3[.-]/.test(host)) return true; // s3.amazonaws.com, s3-eu…, foo.s3.bar
  if (host.endsWith(".r2.cloudflarestorage.com")) return true;
  if (host.includes(".digitaloceanspaces.")) return true;
  if (host.includes("scw.cloud") && host.includes("s3")) return true;
  return false;
}

/** A public, canonical HTTP(S) URL: no credentials/query/fragment, public host. */
export function isPublicCanonicalUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed !== value) return false; // no leading/trailing whitespace
  if (!/^https?:\/\//i.test(trimmed)) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.search || url.hash) return false;
  if (!url.hostname) return false;
  if (isPrivateOrLocalHost(url.hostname)) return false;
  if (isStorageHost(url.hostname)) return false;
  return true;
}

/** null OR a public canonical URL. */
function isNullOrPublicUrl(value: unknown): value is string | null {
  return value === null || isPublicCanonicalUrl(value);
}

/** null OR `sha256:<lowercase-hex>`. */
function isNullableSha256(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^sha256:[0-9a-f]+$/.test(value));
}

// ─── proof — immo-feature-proof v1 & v2 ──────────────────────────────────────

const PROOF_V1_KEYS = ["schema_version", "status", "sources", "zone", "gaps"] as const;
const PROOF_SOURCES_KEYS = ["geometry", "regulation"] as const;
const PROOF_SUBSOURCE_KEYS = ["status", "artifact_uri", "upstream_uri"] as const;
const PROOF_ZONE_KEYS = ["collection", "zone_code", "feature_ref", "assignment_method"] as const;

function validateProofSubSource(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, PROOF_SUBSOURCE_KEYS)) return false;
  if (!isEnum(value["status"], ["available", "unavailable"])) return false;
  if (!isNullOrPublicUrl(value["artifact_uri"])) return false;
  if (!isNullOrPublicUrl(value["upstream_uri"])) return false;
  return true;
}

function validateProofSources(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, PROOF_SOURCES_KEYS)) return false;
  return validateProofSubSource(value["geometry"]) && validateProofSubSource(value["regulation"]);
}

function validateProofZone(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, PROOF_ZONE_KEYS)) return false;
  return PROOF_ZONE_KEYS.every((key) => isNullableString(value[key]));
}

function validateProofV1(value: Record<string, unknown>): ProvenanceEnvelope | undefined {
  if (!hasExactKeys(value, PROOF_V1_KEYS)) return undefined;
  if (!isEnum(value["status"], ["complete", "partial"])) return undefined;
  if (!validateProofSources(value["sources"])) return undefined;
  if (!validateProofZone(value["zone"])) return undefined;
  if (!isStringArray(value["gaps"])) return undefined;
  return value;
}

const PROOF_V2_KEYS = ["schema_version", "geometry_source"] as const;
const GEOMETRY_SOURCE_KEYS = ["url", "type", "method", "reliability", "retrieved_at", "sha256"] as const;
const PROOF_GEOMETRY_TYPES = [
  "geonet",
  "arcgis",
  "agol",
  "wfs",
  "jmap",
  "pdf-zonage",
  "geojson-officiel",
] as const;

function validateProofV2(value: Record<string, unknown>): ProvenanceEnvelope | undefined {
  if (!hasExactKeys(value, PROOF_V2_KEYS)) return undefined;
  const gs = value["geometry_source"];
  if (!isRecord(gs)) return undefined;
  if (!hasExactKeys(gs, GEOMETRY_SOURCE_KEYS)) return undefined;
  if (!isPublicCanonicalUrl(gs["url"])) return undefined; // mandatory, never null
  if (!isEnum(gs["type"], PROOF_GEOMETRY_TYPES)) return undefined;
  if (!isEnum(gs["method"], ["natif", "georeference"])) return undefined;
  if (!isEnum(gs["reliability"], ["directe", "georeferencee"])) return undefined;
  if (!isNullableString(gs["retrieved_at"])) return undefined;
  if (!isNullableSha256(gs["sha256"])) return undefined;
  return value;
}

/** Validate `properties.proof` against immo-feature-proof v1 or v2. */
export function validateFeatureProof(value: unknown): ProvenanceEnvelope | undefined {
  if (!isRecord(value)) return undefined;
  if (value["schema_version"] === "1.0") return validateProofV1(value);
  if (value["schema_version"] === "2.0") return validateProofV2(value);
  return undefined;
}

// ─── immo_zone_lot_provenance/v1 ─────────────────────────────────────────────

const PROVENANCE_KEYS = [
  "contract",
  "assessed_at",
  "lot_assignment_evidence",
  "zone_geometry_provenance",
  "acquisition_v2_readiness",
] as const;

const LOT_EVIDENCE_KEYS = [
  "state",
  "selected_zone",
  "assignment_method",
  "dominant_fraction",
  "multi_zone",
  "zone_codes",
  "evidence_snapshot",
  "evidence_id",
  "reason_codes",
] as const;
const SELECTED_ZONE_KEYS = ["collection", "feature_ref", "code"] as const;
const ASSIGNMENT_STATES = ["recorded", "unassigned", "not-assessed"] as const;
const ASSIGNMENT_METHODS = [
  "area-majority",
  "centroid-fallback",
  "legacy-import",
  "unassigned",
  "unknown",
] as const;

const ZGP_KEYS = ["status", "zone", "public_source", "verified_at", "evidence_id", "reason_codes"] as const;
const ZGP_ZONE_KEYS = ["collection", "feature_ref", "code"] as const;
const PUBLIC_SOURCE_KEYS = ["url", "type", "method", "retrieved_at", "sha256"] as const;
const GEOMETRY_STATUSES = [
  "historical-verified",
  "legacy-traceable",
  "candidate-needs-human-confirmation",
  "orphan",
] as const;
const PUBLIC_SOURCE_TYPES = [...PROOF_GEOMETRY_TYPES, "other-official"] as const;

const READINESS_KEYS = ["state", "checked_at", "unmet_requirement_codes"] as const;
const READINESS_STATES = ["ready", "not-ready", "not-assessed"] as const;

function validateSelectedZone(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, SELECTED_ZONE_KEYS)) return false;
  if (!isString(value["collection"])) return false;
  if (!isString(value["code"])) return false;
  if (!isNullableString(value["feature_ref"])) return false;
  return true;
}

function validateLotAssignmentEvidence(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, LOT_EVIDENCE_KEYS)) return false;
  const state = value["state"];
  if (!isEnum(state, ASSIGNMENT_STATES)) return false;
  if (!validateSelectedZone(value["selected_zone"])) return false;
  const method = value["assignment_method"];
  if (!(method === null || isEnum(method, ASSIGNMENT_METHODS))) return false;
  const fraction = value["dominant_fraction"];
  if (!(fraction === null || (typeof fraction === "number" && fraction >= 0 && fraction <= 1))) return false;
  const multiZone = value["multi_zone"];
  if (!(multiZone === null || typeof multiZone === "boolean")) return false;
  const zoneCodes = value["zone_codes"];
  if (!(zoneCodes === null || isStringArray(zoneCodes))) return false;
  if (!isNullableString(value["evidence_snapshot"])) return false;
  if (!isNullableString(value["evidence_id"])) return false;
  if (!isStringArray(value["reason_codes"])) return false;

  // Nullity constraints by state (contract §3): a `recorded` assignment carries
  // a selected zone; `unassigned`/`not-assessed` never borrow a neighbour zone.
  if (state === "recorded") {
    if (value["selected_zone"] === null) return false;
  } else {
    if (value["selected_zone"] !== null) return false;
    if (!(method === null || method === "unassigned")) return false;
  }
  return true;
}

function validateZgpZone(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, ZGP_ZONE_KEYS)) return false;
  if (!isString(value["collection"])) return false;
  if (!isNullableString(value["feature_ref"])) return false;
  if (!isNullableString(value["code"])) return false;
  return true;
}

function validatePublicSource(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, PUBLIC_SOURCE_KEYS)) return false;
  if (!isPublicCanonicalUrl(value["url"])) return false; // mandatory, never null
  if (!isEnum(value["type"], PUBLIC_SOURCE_TYPES)) return false;
  if (!isEnum(value["method"], ["natif", "georeference"])) return false;
  if (!isNullableString(value["retrieved_at"])) return false;
  if (!isNullableSha256(value["sha256"])) return false;
  return true;
}

function validateZoneGeometryProvenance(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, ZGP_KEYS)) return false;
  const status = value["status"];
  if (!isEnum(status, GEOMETRY_STATUSES)) return false;
  if (!validateZgpZone(value["zone"])) return false;
  if (!validatePublicSource(value["public_source"])) return false;
  if (!isNullableString(value["verified_at"])) return false;
  if (!isNullableString(value["evidence_id"])) return false;
  const reasonCodes = value["reason_codes"];
  if (!isStringArray(reasonCodes)) return false;

  // Status-specific constraints (contract §4).
  if (status === "historical-verified") {
    if (value["verified_at"] === null || value["evidence_id"] === null) return false;
  }
  if (status === "orphan" && reasonCodes.length === 0) return false;
  return true;
}

function validateReadiness(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, READINESS_KEYS)) return false;
  const state = value["state"];
  if (!isEnum(state, READINESS_STATES)) return false;
  if (!isNullableString(value["checked_at"])) return false;
  const unmet = value["unmet_requirement_codes"];
  if (!isStringArray(unmet)) return false;
  // `ready` requires an empty unmet list (contract §5).
  if (state === "ready" && unmet.length !== 0) return false;
  return true;
}

/** Validate `properties.immo_zone_lot_provenance` against contract v1. */
export function validateZoneLotProvenance(value: unknown): ProvenanceEnvelope | undefined {
  if (!isRecord(value)) return undefined;
  if (!hasExactKeys(value, PROVENANCE_KEYS)) return undefined;
  if (value["contract"] !== "immo-zone-lot-provenance/v1") return undefined;
  if (!isString(value["assessed_at"])) return undefined;
  if (!validateLotAssignmentEvidence(value["lot_assignment_evidence"])) return undefined;
  if (!validateZoneGeometryProvenance(value["zone_geometry_provenance"])) return undefined;
  if (!validateReadiness(value["acquisition_v2_readiness"])) return undefined;
  return value;
}

// ─── Public API (unchanged surface) ──────────────────────────────────────────

/**
 * Extract only contract-valid, public-safe envelopes. Anything else — an
 * unknown key, a leak, a truncated axis, a private URL — yields nothing for
 * that key (the envelope is dropped as a whole, never partly rewritten).
 */
export function publicProvenanceFromProperties(
  properties: Record<string, unknown>,
): FeatureProvenanceProperties {
  const proof = validateFeatureProof(properties["proof"]);
  const provenance = validateZoneLotProvenance(properties["immo_zone_lot_provenance"]);
  return {
    ...(proof ? { proof } : {}),
    ...(provenance ? { immo_zone_lot_provenance: provenance } : {}),
  };
}

/** Recover the envelopes stored in an OGC evidence entry. */
export function publicProvenanceFromEvidence(evidence: unknown): FeatureProvenanceProperties {
  const entries = Array.isArray(evidence) ? evidence : [evidence];
  for (const entry of entries) {
    if (isRecord(entry)) {
      const provenance = publicProvenanceFromProperties(entry);
      if (provenance.proof || provenance.immo_zone_lot_provenance) return provenance;
    }
  }
  return {};
}

/**
 * Remove only non-conforming provenance envelopes; every other property —
 * including a preexisting, contract-valid `proof` — is left exactly as it was.
 */
export function sanitizeFeatureProvenance(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const provenance = publicProvenanceFromProperties(properties);
  const sanitized = { ...properties };
  for (const key of ["proof", "immo_zone_lot_provenance"] as const) {
    if (!(key in properties)) continue;
    if (provenance[key]) sanitized[key] = provenance[key];
    else delete sanitized[key];
  }
  return sanitized;
}
