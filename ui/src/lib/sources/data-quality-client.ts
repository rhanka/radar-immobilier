import type { DataQualityCitySummaryT } from "@radar/domain";

export interface DataQualityResponse {
  ok: boolean;
  summary: DataQualityCitySummaryT;
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
