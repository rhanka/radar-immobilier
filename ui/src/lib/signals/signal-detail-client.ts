/**
 * Client for GET /api/signals/:city/detail
 *
 * Fetches the real DesignationEvent detail for one city from the ontology
 * project state. NO PII is ever returned by this endpoint.
 *
 * Anti-invention: events are present only when a real DesignationEvent
 * canonical exists in the persisted project state. An empty list is the
 * honest response for unseeded or stale cities.
 */

/** One DesignationEvent change detail (NO PII). */
export interface DesignationEventDetail {
  /** Human-readable label (verbatim from source bytes). */
  label: string;
  /** Règlement numbers that key this event (e.g. ["1926-26", "1927-26"]). */
  reglementNumbers: string[];
  /** Zone codes referenced by this event (e.g. ["H-431"]). */
  zoneRefs: string[];
  /** Raw S3 evidence ref (procès-verbal or avis-public key). */
  sourceRef: string;
  /** ISO date — when the event was observed in the project state. */
  dateObserved: string;
}

export interface SignalDetailResponse {
  ok: boolean;
  citySlug: string;
  events: DesignationEventDetail[];
}

export function resolveSignalDetailUrl(
  citySlug: string,
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): string {
  const path = `/api/signals/${encodeURIComponent(citySlug)}/detail`;
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

/**
 * Fetch real DesignationEvent details for one city.
 *
 * Returns an empty events list when the city has no project state (honest
 * placeholder — never fabricated). Throws on network/HTTP errors.
 */
export async function fetchSignalDetail(
  citySlug: string,
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<SignalDetailResponse> {
  const url = resolveSignalDetailUrl(citySlug, baseUrl);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`signals/detail HTTP ${res.status}`);
  const body = (await res.json()) as SignalDetailResponse;
  if (!body.ok) throw new Error("signals/detail: api returned ok=false");
  return body;
}
