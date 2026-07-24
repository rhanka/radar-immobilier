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
 * envelope as a whole. Every URL must be public, canonical HTTP(S) (no query,
 * fragment, credentials; no localhost / private IP / minio / S3 host).
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

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(record);
  if (own.length !== keys.length) return false;
  return keys.every((key) => key in record);
}

function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

// ─── Public canonical URL guard ──────────────────────────────────────────────

function stripBrackets(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "");
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = stripBrackets(hostname.toLowerCase());
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0 || a === 127) return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

function isStorageHost(hostname: string): boolean {
  const host = stripBrackets(hostname.toLowerCase());
  if (host.includes("minio")) return true;
  if (/(^|\.)s3[.-]/.test(host)) return true;
  if (host.endsWith(".r2.cloudflarestorage.com")) return true;
  if (host.includes(".digitaloceanspaces.")) return true;
  if (host.includes("scw.cloud") && host.includes("s3")) return true;
  return false;
}

/** A public, canonical HTTP(S) URL: no credentials/query/fragment, public host. */
export function isPublicCanonicalUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed !== value) return false;
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

function isNullOrPublicUrl(value: unknown): value is string | null {
  return value === null || isPublicCanonicalUrl(value);
}

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

function validateProofV1(value: Record<string, unknown>): FeatureProof | undefined {
  if (!hasExactKeys(value, PROOF_V1_KEYS)) return undefined;
  if (!isEnum(value["status"], ["complete", "partial"])) return undefined;
  if (!validateProofSources(value["sources"])) return undefined;
  if (!validateProofZone(value["zone"])) return undefined;
  if (!isStringArray(value["gaps"])) return undefined;
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
  if (!isNullableString(gs["retrieved_at"])) return undefined;
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
  if (!isPublicCanonicalUrl(value["url"])) return false;
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
  if (state === "ready" && unmet.length !== 0) return false;
  return true;
}

/** Validate `properties.immo_zone_lot_provenance` against contract v1. */
export function zoneLotProvenance(value: unknown): ImmoZoneLotProvenance | undefined {
  if (!isRecord(value)) return undefined;
  if (!hasExactKeys(value, PROVENANCE_KEYS)) return undefined;
  if (value["contract"] !== "immo-zone-lot-provenance/v1") return undefined;
  if (!isString(value["assessed_at"])) return undefined;
  if (!validateLotAssignmentEvidence(value["lot_assignment_evidence"])) return undefined;
  if (!validateZoneGeometryProvenance(value["zone_geometry_provenance"])) return undefined;
  if (!validateReadiness(value["acquisition_v2_readiness"])) return undefined;
  return value as ImmoZoneLotProvenance;
}

// ─── Display labels ──────────────────────────────────────────────────────────

export function proofStatusLabel(status: FeatureProof["status"]): string {
  if (status === "complete") return "Dossier de preuve complet";
  if (status === "partial") return "Dossier de preuve partiel";
  return "Statut de preuve non indiqué";
}

export function geometryProvenanceLabel(status: GeometryProvenanceStatus | undefined): string {
  switch (status) {
    case "historical-verified": return "Vérifiée dans les dossiers historiques";
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
  return labels[code] ?? `Code de lacune : ${code}`;
}

/** A public, canonical audit URL, or null — same guard as the passthrough. */
export function publicAuditUrl(value: unknown): string | null {
  return isPublicCanonicalUrl(value) ? value : null;
}
