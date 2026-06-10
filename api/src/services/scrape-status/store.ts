import { ScrapeStatus, type ScrapeStatusT } from "@radar/domain";
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
