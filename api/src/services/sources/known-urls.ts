import type { ObjectStore } from "../../storage/object-store.js";
import type { RunManifestEntry } from "./run-manifest.js";

/**
 * "WHICH URLs DID THE LAST RUN ALREADY COLLECT?" — the cheap half of the owner's
 * requirement of 2026-09-20 (issue #723):
 *
 *   « chaque 24 h on vérifie bien s'il y a pas un nouveau doc », and only
 *   re-downloading the whole back catalogue is what must stop.
 *
 * Reading a city's index page every night is the CHECK, it costs one request,
 * and it is never skipped. What used to be expensive was the consequence:
 * every document the index still lists was fetched again every night — 255 of
 * them for drummondville, 240 of which were undatable and therefore escaped the
 * 183-day window entirely.
 *
 * The previous run's manifest is the exact answer to "have I already got this
 * one?", for three reasons:
 *   - it lists `sourceUrl` per collected document, so the test is on the URL,
 *     before any byte is downloaded (the CAS dedup by sha256 only helps AFTER
 *     the download, which is precisely the cost being removed);
 *   - collection is index-driven, so the previous manifest covers everything
 *     the index offered last time; whatever is in today's index and NOT in it
 *     is either new or previously failed — both of which must be fetched;
 *   - it is self-healing: a document that failed is absent from the manifest,
 *     so it is retried; a truncated run leaves a short manifest, so the rest is
 *     picked up next time.
 *
 * Cost: one LIST + one GET per source per run. Degrades to "nothing is known"
 * — i.e. today's behaviour — when the store has no `list` (in-memory test
 * stores) or when no manifest exists yet.
 */

const decoder = new TextDecoder("utf-8");

/** Object-storage prefix holding every run manifest of one source. */
export function runsPrefix(source: string): string {
  return `runs/${source}/`;
}

/**
 * URLs collected by the LAST run of `source`, read from its run manifest.
 *
 * Run ids are `{ISO instant without : and .}-r`, so the lexicographic maximum
 * of the manifest keys is the most recent run. Returns an empty set when the
 * store cannot list, when the source has never run, or when the manifest is
 * unreadable — never throws, because a missing history must degrade into
 * "fetch it", never into "skip it".
 */
export async function knownSourceUrlsFromLastRun(
  store: ObjectStore,
  source: string,
): Promise<ReadonlySet<string>> {
  const urls = new Set<string>();
  if (!store.list) return urls;

  let latestKey: string | undefined;
  try {
    const keys = await store.list(runsPrefix(source));
    latestKey = keys
      .filter((k) => k.endsWith("/manifest.jsonl"))
      .sort()
      .at(-1);
  } catch {
    return urls;
  }
  if (!latestKey) return urls;

  let text: string;
  try {
    text = decoder.decode(await store.get(latestKey));
  } catch {
    return urls;
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const entry = JSON.parse(trimmed) as RunManifestEntry;
      if (typeof entry.sourceUrl === "string" && entry.sourceUrl.length > 0) {
        urls.add(entry.sourceUrl);
      }
    } catch {
      // A malformed line means one URL is re-fetched, which is safe. Aborting
      // would mean skipping nothing — also safe — so just skip the line.
      continue;
    }
  }
  return urls;
}
