import { ScrapeStatus, type ScrapeStatusSourceT, type ScrapeStatusT } from "@radar/domain";
import type { ObjectStore } from "../../storage/object-store.js";

/**
 * Scrape-status is SHARDED per (city × source): each record lives at its own
 * key `state/{citySlug}/{source}.json` (spec §1.4). One writer per key removes
 * the read→modify→write race of the previous single global object, which lost
 * updates under concurrency at 1000 cities (spec §7 bug #2).
 */
const STATE_PREFIX = "state/";

/** Per-shard key for a (city × source) pair. */
export function stateKey(citySlug: string, source: ScrapeStatusSourceT): string {
  return `${STATE_PREFIX}${citySlug}/${source}.json`;
}

/** Read one shard, or null if absent/malformed. */
async function readShard(
  store: ObjectStore,
  key: string,
): Promise<ScrapeStatusT | null> {
  try {
    const raw = await store.get(key);
    const parsed = ScrapeStatus.safeParse(
      JSON.parse(new TextDecoder().decode(raw)),
    );
    return parsed.success ? (parsed.data as ScrapeStatusT) : null;
  } catch {
    return null;
  }
}

/**
 * Aggregate all stored records by listing the `state/` shards.
 * Degrades to [] when the store cannot list (e.g. a mock without `list`) —
 * the sharded WRITES already fix the race regardless of the read path.
 */
export async function readAll(store: ObjectStore): Promise<ScrapeStatusT[]> {
  const keys = (await store.list?.(STATE_PREFIX)) ?? [];
  const records = await Promise.all(keys.map((k) => readShard(store, k)));
  return records.filter((r): r is ScrapeStatusT => r !== null);
}

/**
 * Upsert a single ScrapeStatus record — writes ONLY its own shard
 * `state/{city}/{source}.json` (no global read→modify→write). Returns the
 * stored record.
 */
export async function upsert(
  store: ObjectStore,
  record: ScrapeStatusT,
): Promise<ScrapeStatusT> {
  const key = stateKey(record.citySlug, record.source);
  await store.put(key, JSON.stringify(record, null, 2), "application/json");
  return record;
}

/**
 * Mark a (citySlug × source) pair as `graphified` (scraped → graphified).
 * Reads and rewrites ONLY that pair's shard — never touches other cities.
 *
 * USAGE: call this AFTER `extractMentions` + `reconcileMentions` succeed so the
 * transition is only recorded when the pipeline step completed successfully.
 */
export async function markAsGraphified(
  store: ObjectStore,
  citySlug: string,
  source: ScrapeStatusSourceT,
  now: Date = new Date(),
): Promise<ScrapeStatusT> {
  const existing = await readShard(store, stateKey(citySlug, source));
  const updated: ScrapeStatusT = ScrapeStatus.parse({
    ...(existing ?? { citySlug, source, automation: "refresh" }),
    status: "graphified",
    lastRunAt: now.toISOString(),
  });
  return upsert(store, updated);
}
