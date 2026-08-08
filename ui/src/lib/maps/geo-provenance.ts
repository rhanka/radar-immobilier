/**
 * Public provenance envelopes supplied by geo — POSITIVE, VERSIONED validation.
 *
 * Mirror of the API guard (`api/src/services/geo/provenance.ts`): the same
 * allowlist-by-contract-shape runs on the UI DTO path so a leaky or truncated
 * envelope never reaches a component. immo re-derives public safety from the
 * contracts; it does not trust the producer.
 *
 *  - `proof`   → `immo-feature-proof` v1 (`schema_version:"1.0"`) or v2 (`"2.0"`)
 *    (contrat-jointure-immo-zones-lots §7/§8).
 *  - `immo_zone_lot_provenance` → `immo-zone-lot-provenance/v1`
 *    (immo-zone-lot-provenance-api-20260722 §3–§7).
 *
 * ONLY declared fields/enums/shapes pass. Any unknown key (job_id, run_id,
 * raw_log, error, token, password, S3/object key, local path…) fails the
 * envelope as a whole. No declared string is free-form either: reason/gap codes,
 * dates, collections, feature refs, evidence ids and zone codes are validated by
 * POSITIVE FORMAT before anything can be displayed, so a secret or a log line
 * can never ride inside an allowed key. Every URL must be public, canonical
 * HTTP(S) toward a public DNS name, a public IPv4 or a global-unicast IPv6 —
 * loopback, ULA, link-local, IPv4-mapped, minio and S3 hosts are refused.
 *
 * `acquisition_v2_readiness.state:"ready"` is accepted only when contract §5's
 * four prerequisites are really present (zone identity, canonical public source,
 * acquisition instant, content sha256): the UI never labels a dossier
 * « vérifiable » on an empty `unmet_requirement_codes` alone.
 */

export type GeometryProvenanceStatus =
  | "historical-verified"
  | "legacy-traceable"
  | "candidate-needs-human-confirmation"
  | "orphan";

export interface FeatureProof extends Record<string, unknown> {
  schema_version?: string;
  status?: "complete" | "partial";
  sources?: {
    geometry?: { status?: "available" | "unavailable"; artifact_uri?: string | null; upstream_uri?: string | null };
    regulation?: { status?: "available" | "unavailable"; artifact_uri?: string | null; upstream_uri?: string | null };
  };
  geometry_source?: { url?: string | null };
  gaps?: string[];
}

export interface ImmoZoneLotProvenance extends Record<string, unknown> {
  contract?: "immo-zone-lot-provenance/v1";
  lot_assignment_evidence?: {
    state?: "recorded" | "unassigned" | "not-assessed";
    selected_zone?: { collection?: string; feature_ref?: string | null; code?: string } | null;
    assignment_method?: string | null;
    dominant_fraction?: number | null;
    multi_zone?: boolean | null;
    reason_codes?: string[];
  };
  zone_geometry_provenance?: {
    status?: GeometryProvenanceStatus;
    public_source?: { url?: string | null } | null;
    reason_codes?: string[];
  } | null;
  acquisition_v2_readiness?: {
    state?: "ready" | "not-ready" | "not-assessed";
    unmet_requirement_codes?: string[];
  };
}

type AssignmentState = NonNullable<ImmoZoneLotProvenance["lot_assignment_evidence"]>["state"];
type ReadinessState = NonNullable<ImmoZoneLotProvenance["acquisition_v2_readiness"]>["state"];

// ─── Primitive guards ────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(record);
  if (own.length !== keys.length) return false;
  return keys.every((key) => key in record);
}

function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

// ─── Public host guard (IPv4 + IPv6, positive) ───────────────────────────────

function stripBrackets(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "");
}

/** Expand an IPv6 literal into its 8 groups, or null when it is not one. */
function ipv6Groups(host: string): number[] | null {
  if (!host.includes(":")) return null;
  const halves = host.split("::");
  if (halves.length > 2) return null;
  const parseHalf = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    const pieces = part.split(":");
    for (let i = 0; i < pieces.length; i += 1) {
      const piece = pieces[i]!;
      if (/^[0-9a-f]{1,4}$/.test(piece)) {
        out.push(parseInt(piece, 16));
        continue;
      }
      // A trailing dotted quad (`::ffff:127.0.0.1`, `::127.0.0.1`) is an
      // embedded IPv4: it is only legal last, and it fills two groups.
      const quad = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(piece);
      if (!quad || i !== pieces.length - 1) return null;
      const octets = [Number(quad[1]), Number(quad[2]), Number(quad[3]), Number(quad[4])];
      if (octets.some((octet) => octet > 255)) return null;
      out.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
      continue;
    }
    return out;
  };
  const head = parseHalf(halves[0]!);
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = parseHalf(halves[1]!);
  if (tail === null) return null;
  if (head.length + tail.length > 7) return null; // `::` stands for ≥1 zero group
  return [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail];
}

/**
 * ONLY global-unicast IPv6 (2000::/3) is public. That single positive rule
 * refuses `::1` (loopback), `::` (unspecified), `fc00::/7` (ULA, incl. fd00::/8),
 * `fe80::/10` (link-local), `ff00::/8` (multicast) and every IPv4-mapped /
 * IPv4-compatible form (`::ffff:10.0.0.1`, `::ffff:0:0/96`) — their first group
 * is not in 2000::/3. Documentation (2001:db8::/32) and 6to4 (2002::/16, an
 * encapsulated IPv4 that would smuggle a private v4) are excluded on top.
 */
function isGlobalUnicastIpv6(host: string): boolean {
  const groups = ipv6Groups(host);
  if (groups === null || groups.length !== 8) return false;
  const g0 = groups[0]!;
  if ((g0 & 0xe000) !== 0x2000) return false;
  if (g0 === 0x2001 && groups[1] === 0x0db8) return false;
  if (g0 === 0x2002) return false;
  return true;
}

/** Public IPv4 only: every special-use / private / loopback block is refused. */
function isPublicIpv4(octets: number[]): boolean {
  if (octets.length !== 4 || octets.some((octet) => octet > 255)) return false;
  const a = octets[0]!;
  const b = octets[1]!;
  if (a === 0 || a === 127 || a === 10) return false; // this-host, loopback, RFC1918
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
  if (a === 192 && (b === 0 || b === 168)) return false; // IETF protocol / TEST-NET-1 / RFC1918
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false; // benchmark / TEST-NET-2
  if (a === 203 && b === 0) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** A public DNS name: labelled, with an alphabetic TLD — never a bare host. */
const PUBLIC_DNS_HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Private-use / internal name suffixes that are never a public source. */
const NON_PUBLIC_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".corp",
  ".private",
  ".home.arpa",
] as const;

/** Positive: a public DNS name, a public IPv4, or a global-unicast IPv6. */
function isPublicHost(hostname: string): boolean {
  const host = stripBrackets(hostname.toLowerCase());
  if (!host) return false;
  if (host.includes(":")) return isGlobalUnicastIpv6(host);
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) return isPublicIpv4(ipv4.slice(1).map(Number));
  if (!PUBLIC_DNS_HOST.test(host)) return false; // localhost, bare internal name…
  if (NON_PUBLIC_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  return true;
}

/**
 * #2b — Marqueurs de SIGNATURE / CREDENTIAL dans la query (URL S3 signée ou
 * pré-signée). Le garde de preuve publique est SIGNATURE-based, PAS
 * query-presence : une query bénigne (sélection de doc ; le proxy d'archive
 * porte lui-même `?rawRef=`) est légitime ; seuls ces noms de paramètres
 * trahissent une URL signée qui expire et peut fuiter un secret → à router via
 * le viewer d'archive same-origin, jamais exposée telle quelle. Mesuré recette :
 * 0/2893 sourceUrl signée ; garde préventive.
 */
const SIGNED_QUERY_PARAMS = new Set([
  "x-amz-algorithm",
  "x-amz-credential",
  "x-amz-signature",
  "x-amz-date",
  "x-amz-expires",
  "x-amz-signedheaders",
  "x-amz-security-token",
  "signature",
  "awsaccesskeyid",
  "policy",
  "token",
]);
function hasSignedOrCredentialQuery(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    if (SIGNED_QUERY_PARAMS.has(key.toLowerCase())) return true;
  }
  return false;
}

/**
 * A public, canonical HTTP(S) URL used as clickable proof (#2b, contrat mesuré
 * recette) : host public, http(s), NON signée / sans credential. Query et
 * fragment BÉNINS (sélection de doc) sont AUTORISÉS ; l'object-storage PUBLIC
 * non-signé (VPlus, sites muni S3/OVH) est une source canonique légitime — le
 * discriminant est scheme + signature, PAS le pattern d'hostname `s3`. Les hosts
 * privés/loopback/RFC1918 (anti-SSRF) et les URL signées restent rejetés ; une
 * archive interne `s3://raw/...` (scheme non-http) est routée via le viewer.
 */
export function isPublicCanonicalUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length > 2048) return false;
  const trimmed = value.trim();
  if (trimmed !== value) return false;
  if (/[\s\\]/.test(trimmed)) return false;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (hasSignedOrCredentialQuery(url)) return false;
  if (!url.hostname) return false;
  if (!isPublicHost(url.hostname)) return false;
  return true;
}

function isNullOrPublicUrl(value: unknown): value is string | null {
  return value === null || isPublicCanonicalUrl(value);
}

// ─── Positive string formats (contract §7 — no free-form string) ─────────────

/**
 * Reason / gap / unmet-requirement code. Contract-known codes are listed, and
 * any other producer code must still be a bare lowercase token: no space, no
 * uppercase, no `=`, no `/`, no `@`, no `%` — so `raw_log: token=SECRET
 * s3://bucket/key` can never pass as a "code", nor be rendered by the audit
 * panels.
 */
const KNOWN_AUDIT_CODES = new Set([
  "missing-zone-identity",
  "missing-canonical-public-source",
  "missing-retrieved-at",
  "missing-content-sha256",
  "needs-human-confirmation",
  "source-identity-unlinked",
  "not-assessed",
  "no-selected-zone",
  "historical-verification-unavailable",
  "area-calculation-unavailable",
  "regulation_source_unavailable",
]);
const SAFE_CODE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;

/** A public-safe audit code — the same guard the panels apply before display. */
export function isSafeAuditCode(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return KNOWN_AUDIT_CODES.has(value) || SAFE_CODE.test(value);
}

function isSafeCodeArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 64 && value.every(isSafeAuditCode);
}

/** ISO-8601 UTC/offset instant, calendar-valid. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

function isNullableIsoInstant(value: unknown): value is string | null {
  return value === null || isIsoInstant(value);
}

/** Public-safe snapshot marker: an ISO date, an ISO instant, or an opaque code. */
function isNullableSnapshot(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  if (ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))) return true;
  return isIsoInstant(value) || isSafeAuditCode(value);
}

/** Collection slug (`qc-zonage-delson`) — never a path, a URL or a bucket key. */
const SAFE_COLLECTION = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function isSafeCollection(value: unknown): value is string {
  return typeof value === "string" && SAFE_COLLECTION.test(value);
}

/**
 * Stable public feature reference (`qc-zonage-delson#zone_code=H-12`): a
 * collection slug with an optional `#key=value` selector. No `/`, no space, no
 * scheme — an S3 key or a signed URL cannot masquerade as a ref.
 */
const SAFE_FEATURE_REF = /^[a-z0-9][a-z0-9._-]{0,63}(#[A-Za-z0-9_.:=-]{1,64})?$/;

function isNullableFeatureRef(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && SAFE_FEATURE_REF.test(value));
}

/** Opaque public-safe identifier (`lot-zone-ev-7d21`). */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function isNullableSafeId(value: unknown): value is string | null {
  return value === null || isSafeId(value);
}

/**
 * Zone code (`H-12`, `CO-939`): a SHORT public label — letters/digits and light
 * punctuation, no `_`, no `:`, no `/`, no `=`, 32 chars max. A token, a path or
 * a key=value pair cannot be passed off as a zone code.
 */
const SAFE_ZONE_CODE = /^[\p{L}\p{N}][\p{L}\p{N} .'()-]{0,31}$/u;

function isSafeZoneCode(value: unknown): value is string {
  return typeof value === "string" && SAFE_ZONE_CODE.test(value);
}

function isNullableZoneCode(value: unknown): value is string | null {
  return value === null || isSafeZoneCode(value);
}

function isSafeZoneCodeArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 256 && value.every(isSafeZoneCode);
}

/** null OR `sha256:<64 lowercase hex>`. */
const SHA256 = /^sha256:[0-9a-f]{64}$/;

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function isNullableSha256(value: unknown): value is string | null {
  return value === null || isSha256(value);
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
  const collection = value["collection"];
  if (!(collection === null || isSafeCollection(collection))) return false;
  if (!isNullableZoneCode(value["zone_code"])) return false;
  if (!isNullableFeatureRef(value["feature_ref"])) return false;
  const method = value["assignment_method"];
  if (!(method === null || isSafeAuditCode(method))) return false;
  return true;
}

function validateProofV1(value: Record<string, unknown>): FeatureProof | undefined {
  if (!hasExactKeys(value, PROOF_V1_KEYS)) return undefined;
  if (!isEnum(value["status"], ["complete", "partial"])) return undefined;
  if (!validateProofSources(value["sources"])) return undefined;
  if (!validateProofZone(value["zone"])) return undefined;
  if (!isSafeCodeArray(value["gaps"])) return undefined;
  return value as FeatureProof;
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

function validateProofV2(value: Record<string, unknown>): FeatureProof | undefined {
  if (!hasExactKeys(value, PROOF_V2_KEYS)) return undefined;
  const gs = value["geometry_source"];
  if (!isRecord(gs)) return undefined;
  if (!hasExactKeys(gs, GEOMETRY_SOURCE_KEYS)) return undefined;
  if (!isPublicCanonicalUrl(gs["url"])) return undefined;
  if (!isEnum(gs["type"], PROOF_GEOMETRY_TYPES)) return undefined;
  if (!isEnum(gs["method"], ["natif", "georeference"])) return undefined;
  if (!isEnum(gs["reliability"], ["directe", "georeferencee"])) return undefined;
  if (!isNullableIsoInstant(gs["retrieved_at"])) return undefined;
  if (!isNullableSha256(gs["sha256"])) return undefined;
  return value as FeatureProof;
}

/** Validate `properties.proof` against immo-feature-proof v1 or v2. */
export function featureProof(value: unknown): FeatureProof | undefined {
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
const GEOMETRY_STATUSES: readonly GeometryProvenanceStatus[] = [
  "historical-verified",
  "legacy-traceable",
  "candidate-needs-human-confirmation",
  "orphan",
];
const PUBLIC_SOURCE_TYPES = [...PROOF_GEOMETRY_TYPES, "other-official"] as const;

const READINESS_KEYS = ["state", "checked_at", "unmet_requirement_codes"] as const;
const READINESS_STATES = ["ready", "not-ready", "not-assessed"] as const;

function validateSelectedZone(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, SELECTED_ZONE_KEYS)) return false;
  if (!isSafeCollection(value["collection"])) return false;
  if (!isSafeZoneCode(value["code"])) return false;
  if (!isNullableFeatureRef(value["feature_ref"])) return false;
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
  if (!(zoneCodes === null || isSafeZoneCodeArray(zoneCodes))) return false;
  if (!isNullableSnapshot(value["evidence_snapshot"])) return false;
  if (!isNullableSafeId(value["evidence_id"])) return false;
  if (!isSafeCodeArray(value["reason_codes"])) return false;

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
  if (!isSafeCollection(value["collection"])) return false;
  if (!isNullableFeatureRef(value["feature_ref"])) return false;
  if (!isNullableZoneCode(value["code"])) return false;
  return true;
}

function validatePublicSource(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, PUBLIC_SOURCE_KEYS)) return false;
  if (!isPublicCanonicalUrl(value["url"])) return false;
  if (!isEnum(value["type"], PUBLIC_SOURCE_TYPES)) return false;
  if (!isEnum(value["method"], ["natif", "georeference"])) return false;
  if (!isNullableIsoInstant(value["retrieved_at"])) return false;
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
  if (!isNullableIsoInstant(value["verified_at"])) return false;
  if (!isNullableSafeId(value["evidence_id"])) return false;
  const reasonCodes = value["reason_codes"];
  if (!isSafeCodeArray(reasonCodes)) return false;

  if (status === "historical-verified") {
    if (value["verified_at"] === null || value["evidence_id"] === null) return false;
  }
  if (status === "orphan" && reasonCodes.length === 0) return false;
  return true;
}

/**
 * Contract §5: `ready` is a CLAIM about the four acquisition-v2 prerequisites.
 * It is accepted only when the envelope really carries them — zone identity,
 * canonical public source, acquisition instant, content sha256 — plus the
 * explicit check (`checked_at`) and an empty `unmet_requirement_codes`. A
 * `ready` that only shows an empty unmet list is a false claim: the envelope is
 * refused as a whole, so « Dossier vérifiable » can never be displayed without
 * its prerequisites.
 */
function readinessPrerequisitesMet(geometry: unknown): boolean {
  if (!isRecord(geometry)) return false;
  const zone = geometry["zone"];
  if (!isRecord(zone) || !isSafeCollection(zone["collection"])) return false; // (1) identity
  const source = geometry["public_source"];
  if (!isRecord(source)) return false;
  if (!isPublicCanonicalUrl(source["url"])) return false; // (2) canonical public source
  if (!isIsoInstant(source["retrieved_at"])) return false; // (3) acquisition instant
  if (!isSha256(source["sha256"])) return false; // (4) content hash
  return true;
}

function validateReadiness(value: unknown, geometry: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, READINESS_KEYS)) return false;
  const state = value["state"];
  if (!isEnum(state, READINESS_STATES)) return false;
  if (!isNullableIsoInstant(value["checked_at"])) return false;
  const unmet = value["unmet_requirement_codes"];
  if (!isSafeCodeArray(unmet)) return false;
  if (state !== "ready") return true;
  if (unmet.length !== 0) return false;
  if (!isIsoInstant(value["checked_at"])) return false;
  return readinessPrerequisitesMet(geometry);
}

/** Validate `properties.immo_zone_lot_provenance` against contract v1. */
export function zoneLotProvenance(value: unknown): ImmoZoneLotProvenance | undefined {
  if (!isRecord(value)) return undefined;
  if (!hasExactKeys(value, PROVENANCE_KEYS)) return undefined;
  if (value["contract"] !== "immo-zone-lot-provenance/v1") return undefined;
  if (!isIsoInstant(value["assessed_at"])) return undefined;
  if (!validateLotAssignmentEvidence(value["lot_assignment_evidence"])) return undefined;
  if (!validateZoneGeometryProvenance(value["zone_geometry_provenance"])) return undefined;
  if (!validateReadiness(value["acquisition_v2_readiness"], value["zone_geometry_provenance"])) {
    return undefined;
  }
  return value as ImmoZoneLotProvenance;
}

/**
 * Re-validate the two envelopes carried by a DTO/`properties` bag, dropping only
 * the non-conforming ones. Every other property is preserved verbatim
 * (non-blackout): this is the guard the non-OGC fallback path applies to a JSON
 * body it did not build itself.
 */
export function sanitizeProvenanceProperties<T extends Record<string, unknown>>(properties: T): T {
  const sanitized = { ...properties };
  const proof = featureProof(properties["proof"]);
  const provenance = zoneLotProvenance(properties["immo_zone_lot_provenance"]);
  if ("proof" in properties) {
    if (proof) (sanitized as Record<string, unknown>)["proof"] = proof;
    else delete (sanitized as Record<string, unknown>)["proof"];
  }
  if ("immo_zone_lot_provenance" in properties) {
    if (provenance) (sanitized as Record<string, unknown>)["immo_zone_lot_provenance"] = provenance;
    else delete (sanitized as Record<string, unknown>)["immo_zone_lot_provenance"];
  }
  return sanitized;
}

// ─── Display labels ──────────────────────────────────────────────────────────

export function proofStatusLabel(status: FeatureProof["status"]): string {
  if (status === "complete") return "Dossier de preuve complet";
  if (status === "partial") return "Dossier de preuve partiel";
  return "Statut de preuve non indiqué";
}

export function geometryProvenanceLabel(status: GeometryProvenanceStatus | undefined): string {
  switch (status) {
    case "historical-verified": return "Vérification déclarée par la source";
    case "legacy-traceable": return "Trace historique disponible";
    case "candidate-needs-human-confirmation": return "À confirmer par une personne";
    case "orphan": return "Source de géométrie non reliée";
    default: return "État non indiqué";
  }
}

export function assignmentStateLabel(state: AssignmentState): string {
  if (state === "recorded") return "Rattachement enregistré";
  if (state === "unassigned") return "Aucune zone enregistrée";
  if (state === "not-assessed") return "Rattachement non évalué";
  return "État non indiqué";
}

export function readinessLabel(state: ReadinessState): string {
  if (state === "ready") return "Dossier vérifiable";
  if (state === "not-ready") return "Dossier incomplet";
  if (state === "not-assessed") return "Dossier non évalué";
  return "État non indiqué";
}

/**
 * État affiché quand aucune enveloppe de preuve/provenance n'est rattachée à
 * l'élément (absente, non servie, ou écartée par les gardes). Le bloc « Audit
 * des sources » reste VISIBLE et porte cet état explicite : l'utilisateur
 * distingue « pas de preuve pour cet élément » de « fonctionnalité absente ».
 * Vocabulaire produit neutre (Servi / Partiel / Non couvert) — aucun jargon.
 */
export const AUDIT_NOT_COVERED_LABEL = "Non couvert";
export const AUDIT_NOT_COVERED_HINT =
  "Aucune source auditée n'est rattachée à cet élément.";

/**
 * Libellé d'un code d'audit. Une valeur qui n'a pas la forme d'un code public
 * n'est JAMAIS rendue littéralement (dernière barrière avant l'écran, même si
 * l'enveloppe a été construite hors des gardes ci-dessus).
 */
export function auditCodeLabel(code: string): string {
  const labels: Record<string, string> = {
    regulation_source_unavailable: "Source réglementaire indisponible",
    "missing-canonical-public-source": "Source géométrique publique indisponible",
    "missing-content-sha256": "Empreinte du contenu indisponible",
    "missing-retrieved-at": "Date d’acquisition indisponible",
    "missing-zone-identity": "Identité de zone incomplète",
    "needs-human-confirmation": "Confirmation humaine nécessaire",
    "source-identity-unlinked": "Source géométrique non reliée",
    "not-assessed": "Évaluation non réalisée",
  };
  if (labels[code]) return labels[code];
  if (!isSafeAuditCode(code)) return "Code de lacune non affichable";
  return `Code de lacune : ${code}`;
}

/** A public, canonical audit URL, or null — same guard as the passthrough. */
export function publicAuditUrl(value: unknown): string | null {
  return isPublicCanonicalUrl(value) ? value : null;
}
