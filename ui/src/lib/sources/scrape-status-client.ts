import type { ScrapeStatusT } from "@radar/domain";

export function resolveScrapeStatusUrl(
  path: string,
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): string {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export interface ScrapeStatusResponse {
  items: ScrapeStatusT[];
}

/**
 * Fetch all scrape-status records, optionally filtered by city slug.
 * Throws on HTTP error.
 */
export async function fetchScrapeStatus(
  citySlug?: string,
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<ScrapeStatusResponse> {
  const path = citySlug
    ? `/api/scrape-status?city=${encodeURIComponent(citySlug)}`
    : "/api/scrape-status";
  const res = await fetch(resolveScrapeStatusUrl(path, baseUrl));
  if (!res.ok) throw new Error(`scrape-status HTTP ${res.status}`);
  return (await res.json()) as ScrapeStatusResponse;
}

/**
 * Upsert a single scrape-status record (called by scraping agents / admin UI).
 * Throws on HTTP error.
 */
export async function putScrapeStatus(
  record: ScrapeStatusT,
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<{ item: ScrapeStatusT; items: ScrapeStatusT[] }> {
  const path = `/api/scrape-status/${encodeURIComponent(record.citySlug)}/${encodeURIComponent(record.source)}`;
  const res = await fetch(resolveScrapeStatusUrl(path, baseUrl), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(detail?.error ?? `put scrape-status HTTP ${res.status}`);
  }
  return (await res.json()) as { item: ScrapeStatusT; items: ScrapeStatusT[] };
}
