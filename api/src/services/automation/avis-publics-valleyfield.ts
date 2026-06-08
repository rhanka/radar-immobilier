import {
  AVIS_PUBLICS_SOURCE_URL,
  AVIS_PUBLICS_USER_AGENT,
  parseAvisPublics,
  type AvisPublicItemT,
} from "@radar/sources";
import { z } from "zod";

/**
 * REAL public-source connector for the city of Salaberry-de-Valleyfield
 * "Avis publics" index page. The pure parsing primitives now live in
 * `@radar/sources` (single implementation, shared with the RECUEIL
 * SourceAdapter — see No Legacy Fallback). This module keeps the
 * automation-benchmark `collect*` outcome shape used by the
 * `/api/automation/collect/:source` endpoint.
 */

// Re-export the proven parser surface so existing importers keep working
// against ONE implementation.
export {
  AVIS_PUBLICS_SOURCE_URL,
  NON_DISPONIBLE,
  parseAvisPublics,
  frenchDateToIso,
  inferAvisType,
  extractBylaws,
  AvisType,
  AvisPublicItem,
} from "@radar/sources";
export type { AvisPublicItemT, AvisTypeT } from "@radar/sources";

/** Hard cap on the fetch so a slow/hanging source never blocks the request. */
const FETCH_TIMEOUT_MS = 15000;

export const CollectResult = z.object({
  source: z.literal("avis-publics-valleyfield"),
  sourceUrl: z.string().url(),
  fetchedAt: z.string().datetime(),
  count: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      title: z.string(),
      dateLabel: z.string(),
      dateIso: z.string(),
      url: z.string().url(),
      type: z.string(),
      bylaws: z.array(z.string()),
    }),
  ),
});
export type CollectResultT = z.infer<typeof CollectResult>;

/** Typed connector failure: never thrown to the caller, always returned. */
export interface CollectError {
  ok: false;
  source: "avis-publics-valleyfield";
  sourceUrl: string;
  fetchedAt: string;
  error: "timeout" | "network" | "http" | "parse";
  detail: string;
}

export type CollectOutcome = ({ ok: true } & CollectResultT) | CollectError;

/** Minimal fetch signature so the connector is testable without globals. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Fetch + parse the live Valleyfield avis-publics page. Never throws: any
 * failure (timeout, network, HTTP, parse) is returned as a typed CollectError.
 *
 * @param limit  Max number of items to return (most-recent first as listed).
 */
export async function collectAvisPublicsValleyfield(
  options: { fetchImpl?: FetchLike; limit?: number; timeoutMs?: number } = {},
): Promise<CollectOutcome> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const limit = options.limit ?? 25;
  const fetchedAt = new Date().toISOString();
  const base = {
    source: "avis-publics-valleyfield" as const,
    sourceUrl: AVIS_PUBLICS_SOURCE_URL,
    fetchedAt,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let html: string;
  try {
    const res = await fetchImpl(AVIS_PUBLICS_SOURCE_URL, {
      signal: controller.signal,
      headers: { "user-agent": AVIS_PUBLICS_USER_AGENT, accept: "text/html" },
    });
    if (!res.ok) {
      return { ...base, ok: false, error: "http", detail: `HTTP ${res.status}` };
    }
    html = await res.text();
  } catch (e) {
    const isAbort = e instanceof Error && e.name === "AbortError";
    return {
      ...base,
      ok: false,
      error: isAbort ? "timeout" : "network",
      detail: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }

  try {
    const all: AvisPublicItemT[] = parseAvisPublics(html);
    const items = all.slice(0, limit);
    const result = CollectResult.parse({
      source: base.source,
      sourceUrl: base.sourceUrl,
      fetchedAt,
      count: items.length,
      items,
    });
    return { ok: true, ...result };
  } catch (e) {
    return {
      ...base,
      ok: false,
      error: "parse",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
