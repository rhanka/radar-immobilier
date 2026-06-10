/**
 * Client for GET /api/signals/by-city — aggregate DesignationEvent counts per
 * city derived from the ontology project state.
 *
 * Anti-invention: only cities with a persisted, recent (< 6 months) project
 * state return a non-zero count. All other cities explicitly return 0.
 */

/** One city's signal aggregate item returned by the API. */
export interface SignalCityItem {
  citySlug: string;
  /** Count of DesignationEvent canonicals in the current project state. */
  designationEventCount: number;
  /** ISO timestamp when the project state was generated; null when no state. */
  generatedAt: string | null;
}

export interface SignalsByCityResponse {
  ok: boolean;
  items: SignalCityItem[];
}

export function resolveSignalsByCityUrl(
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): string {
  const path = "/api/signals/by-city";
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

/**
 * Fetch aggregate DesignationEvent counts per city from the real API.
 * Throws on HTTP error or a non-ok JSON response.
 */
export async function fetchSignalsByCity(
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<SignalsByCityResponse> {
  const url = resolveSignalsByCityUrl(baseUrl);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`signals/by-city HTTP ${res.status}`);
  const body = (await res.json()) as SignalsByCityResponse;
  if (!body.ok) throw new Error("signals/by-city: api returned ok=false");
  return body;
}
