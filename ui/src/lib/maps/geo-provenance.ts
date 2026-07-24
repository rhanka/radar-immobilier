/** Opaque, public-safe provenance envelopes supplied by geo. */

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function featureProof(value: unknown): FeatureProof | undefined {
  return isRecord(value) ? value as FeatureProof : undefined;
}

export function zoneLotProvenance(value: unknown): ImmoZoneLotProvenance | undefined {
  return isRecord(value) ? value as ImmoZoneLotProvenance : undefined;
}

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

export function publicAuditUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const isPublicHttp =
      (url.protocol === "http:" || url.protocol === "https:") &&
      !/(^|\.)s3[.-]/i.test(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
    return isPublicHttp ? value : null;
  } catch {
    return null;
  }
}
