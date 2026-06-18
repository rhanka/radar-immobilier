import type { DataQualityCitySummaryT, DataQualityStateT } from "@radar/domain";

export interface DataQualityResponse {
  ok: boolean;
  summary: DataQualityCitySummaryT;
}

export interface DataQualityReadiness {
  status: DataQualityStateT;
  label: string;
  detail: string;
  readyCount: number;
  partialCount: number;
  staleCount: number;
  unknownCount: number;
  totalCount: number;
}

export interface EvidenceReadiness {
  status: DataQualityStateT;
  label: string;
  detail: string;
  linkedCount: number;
  totalCount: number;
}

const DATA_QUALITY_SECTION_KEYS = [
  "councilMinutes",
  "youtube",
  "ontology",
  "zones",
  "lots",
] as const;

const DATA_QUALITY_STATUS_LABELS_FR: Record<DataQualityStateT, string> = {
  fresh: "prêt",
  partial: "partiel",
  stale: "périmé",
  unknown: "à configurer",
};

export function dataQualityStatusLabel(status: DataQualityStateT): string {
  return DATA_QUALITY_STATUS_LABELS_FR[status];
}

export function computeDataQualityReadiness(
  summary: DataQualityCitySummaryT,
): DataQualityReadiness {
  const statuses = DATA_QUALITY_SECTION_KEYS.map((key) => summary[key].status);
  const readyCount = statuses.filter((status) => status === "fresh").length;
  const partialCount = statuses.filter((status) => status === "partial").length;
  const staleCount = statuses.filter((status) => status === "stale").length;
  const unknownCount = statuses.filter((status) => status === "unknown").length;
  const totalCount = statuses.length;

  let status: DataQualityStateT;
  if (readyCount === totalCount) {
    status = "fresh";
  } else if (readyCount === 0 && partialCount === 0 && staleCount === 0) {
    status = "unknown";
  } else if (staleCount > 0) {
    status = "stale";
  } else {
    status = "partial";
  }

  const parts = [`${readyCount}/${totalCount} prêts`];
  if (partialCount > 0) parts.push(`${partialCount} partiel${partialCount > 1 ? "s" : ""}`);
  if (staleCount > 0) parts.push(`${staleCount} périmé${staleCount > 1 ? "s" : ""}`);
  if (unknownCount > 0) parts.push(`${unknownCount} à configurer`);

  return {
    status,
    label: DATA_QUALITY_STATUS_LABELS_FR[status],
    detail: parts.join(" · "),
    readyCount,
    partialCount,
    staleCount,
    unknownCount,
    totalCount,
  };
}

export function computeEvidenceReadiness(
  events: readonly { sourceRef?: string | null }[],
): EvidenceReadiness {
  const totalCount = events.length;
  const linkedCount = events.filter(
    (event) => typeof event.sourceRef === "string" && event.sourceRef.trim().length > 0,
  ).length;

  if (totalCount === 0) {
    return {
      status: "unknown",
      label: "aucune preuve",
      detail: "Aucun signal avec preuve PDF/raw",
      linkedCount,
      totalCount,
    };
  }

  const status: DataQualityStateT =
    linkedCount === totalCount ? "fresh" : "partial";

  return {
    status,
    label: linkedCount === totalCount ? "preuves liées" : "preuves à relier",
    detail: `${linkedCount}/${totalCount} événement${totalCount > 1 ? "s" : ""} avec source PDF/raw`,
    linkedCount,
    totalCount,
  };
}

export function resolveDataQualityUrl(
  citySlug: string,
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): string {
  const path = `/api/data-quality/${encodeURIComponent(citySlug)}`;
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export async function fetchDataQuality(
  citySlug: string,
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<DataQualityCitySummaryT> {
  const res = await fetch(resolveDataQualityUrl(citySlug, baseUrl));
  if (!res.ok) throw new Error(`data-quality HTTP ${res.status}`);
  const body = (await res.json()) as DataQualityResponse;
  return body.summary;
}
