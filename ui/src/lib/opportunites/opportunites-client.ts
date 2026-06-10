/**
 * Client for GET /api/opportunites
 *
 * Fetches all scored DesignationEvent opportunities across all seeded cities,
 * ranked by score descending. NO PII is ever returned by this endpoint.
 *
 * Anti-invention: opportunities are present only when a real DesignationEvent
 * canonical exists in a persisted project state. An empty list is the honest
 * response for environments with no seeded states.
 */

/** Score factor breakdown for one opportunity. */
export interface OpportuniteFacteurs {
  /** Proximity to Montréal sub-score (0–1). */
  proximite: number;
  /** Residential/mixed zone type sub-score (0–1). */
  zoneType: number;
  /** Recency sub-score (0–1). */
  recence: number;
}

/** One scored opportunity item (NO PII). */
export interface OpportuniteItem {
  citySlug: string;
  reglementNumbers: string[];
  zoneRefs: string[];
  /** Human-readable label from source bytes. */
  label: string;
  /** Raw S3 evidence ref. */
  sourceRef: string;
  /** ISO date string — project-state generatedAt. */
  dateObserved: string;
  /** Aggregate 0–100 score. */
  score: number;
  /** Decomposed factor scores for transparency. */
  facteurs: OpportuniteFacteurs;
}

export interface OpportunitesResponse {
  ok: boolean;
  total: number;
  scoreVersion: string;
  items: OpportuniteItem[];
}

export function resolveOpportunitesUrl(
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): string {
  const path = "/api/opportunites";
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

/**
 * Fetch all scored opportunities from the real API.
 * Returns an empty items list when no project states are seeded (honest
 * placeholder — never fabricated). Throws on network/HTTP errors.
 */
export async function fetchOpportunites(
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<OpportunitesResponse> {
  const url = resolveOpportunitesUrl(baseUrl);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`opportunites HTTP ${res.status}`);
  const body = (await res.json()) as OpportunitesResponse;
  if (!body.ok) throw new Error("opportunites: api returned ok=false");
  return body;
}
