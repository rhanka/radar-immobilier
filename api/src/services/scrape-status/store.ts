import { ScrapeStatus, type ScrapeStatusSourceT, type ScrapeStatusT } from "@radar/domain";
import type { ObjectStore } from "../../storage/object-store.js";

/** Object-storage key where the scrape-status list is persisted. */
const STORE_KEY = "scrape-status/index.json";

/**
 * Read the current list from object storage.
 * Returns [] if the object does not exist yet (new environment).
 */
export async function readAll(store: ObjectStore): Promise<ScrapeStatusT[]> {
  try {
    const raw = await store.get(STORE_KEY);
    const text = new TextDecoder().decode(raw);
    const parsed = JSON.parse(text) as unknown[];
    return parsed
      .map((item) => ScrapeStatus.safeParse(item))
      .filter((r) => r.success)
      .map((r) => r.data as ScrapeStatusT);
  } catch {
    // Object not found or malformed — start with empty state.
    return [];
  }
}

/**
 * Mark a (citySlug × source) pair as `graphified` (scraped → graphified).
 *
 * Called by the exploitation pipeline after mentions have been extracted and
 * committed to the knowledge graph. If no record exists yet for the pair, a
 * minimal one is created. Timestamps `lastRunAt` to now (ISO-8601).
 *
 * USAGE: call this AFTER `extractMentions` + `reconcileMentions` succeed so the
 * transition is only recorded when the pipeline step completed successfully.
 */
export async function markAsGraphified(
  store: ObjectStore,
  citySlug: string,
  source: ScrapeStatusSourceT,
  now: Date = new Date(),
): Promise<ScrapeStatusT[]> {
  const current = await readAll(store);
  const existing = current.find(
    (r) => r.citySlug === citySlug && r.source === source,
  );
  const updated: ScrapeStatusT = ScrapeStatus.parse({
    ...(existing ?? {
      citySlug,
      source,
      automation: "refresh",
    }),
    status: "graphified",
    lastRunAt: now.toISOString(),
  });
  return upsert(store, updated);
}

/**
 * Upsert a single ScrapeStatus record (keyed by citySlug + source).
 * Persists the updated list back to object storage atomically.
 */
export async function upsert(
  store: ObjectStore,
  record: ScrapeStatusT,
): Promise<ScrapeStatusT[]> {
  const current = await readAll(store);
  const idx = current.findIndex(
    (r) => r.citySlug === record.citySlug && r.source === record.source,
  );
  const updated =
    idx === -1
      ? [...current, record]
      : current.map((r, i) => (i === idx ? record : r));
  await store.put(
    STORE_KEY,
    JSON.stringify(updated, null, 2),
    "application/json",
  );
  return updated;
}
