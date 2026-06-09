// WP6 — Backlog API client (browser).
//
// Thin wrapper over the radar backlog API. The Backlog view loads from
// `GET /api/backlog`, which returns the REAL tracked items folded from the
// `.track` sidecar (`source: "track"`) or the ÉV fallback (`source:
// "ev-fallback"`) when the sidecar is unavailable. The "Ajouter une demande"
// affordance posts to `POST /api/backlog/items` (runtime request).

import type { BacklogItem, BacklogSource } from "./backlog-data.js";

export function resolveBacklogUrl(
  path: string,
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): string {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

/** The backlog list plus its provenance (live track vs. fallback). */
export interface BacklogResponse {
  items: BacklogItem[];
  /** "track" when folded from the live sidecar; "ev-fallback" otherwise. */
  source: BacklogSource;
}

/** Fetch the API backlog (tracked items + runtime items). Throws on HTTP error. */
export async function fetchBacklog(
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<BacklogResponse> {
  const res = await fetch(resolveBacklogUrl("/api/backlog", baseUrl));
  if (!res.ok) throw new Error(`backlog HTTP ${res.status}`);
  const body = (await res.json()) as {
    items: BacklogItem[];
    source?: BacklogSource;
  };
  return { items: body.items, source: body.source ?? "ev-fallback" };
}

/** Add a request (statut "a-faire"). Throws on HTTP error. */
export async function addBacklogItem(
  input: { titre: string; description?: string },
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<BacklogItem> {
  const res = await fetch(resolveBacklogUrl("/api/backlog/items", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `add HTTP ${res.status}`);
  }
  const body = (await res.json()) as { item: BacklogItem };
  return body.item;
}

/** Process a request (statut -> "en-cours"). Throws on HTTP error. */
export async function processBacklogItem(
  id: string,
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<BacklogItem> {
  const res = await fetch(
    resolveBacklogUrl(`/api/backlog/items/${encodeURIComponent(id)}/process`, baseUrl),
    { method: "POST" },
  );
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `process HTTP ${res.status}`);
  }
  const body = (await res.json()) as { item: BacklogItem };
  return body.item;
}
