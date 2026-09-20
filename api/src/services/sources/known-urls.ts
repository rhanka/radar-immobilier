import type { ObjectStore } from "../../storage/object-store.js";
import type { RunManifestEntry } from "./run-manifest.js";

/**
 * "WHICH URLs HAVE I ALREADY COLLECTED?" — the cheap half of the owner's
 * requirement of 2026-09-20 (issue #723):
 *
 *   « chaque 24 h on vérifie bien s'il y a pas un nouveau doc », and only
 *   re-downloading the whole back catalogue is what must stop.
 *
 * Reading a city's index page every night is the CHECK, it costs one request,
 * and it is never skipped. What used to be expensive was the consequence: every
 * document the index still listed was fetched again every night — 255 of them
 * for drummondville, 240 of which were undatable and therefore escaped the
 * 183-day window entirely.
 *
 * THE STATE IS CUMULATIVE, AND THAT IS THE WHOLE POINT. A first version of this
 * module answered the question from the PREVIOUS RUN'S MANIFEST, and both
 * contradictory reviews of PR #735 showed why that oscillates: a manifest lists
 * only what THAT run collected, so a quiet night writes an empty one, and the
 * night after finds nothing to skip and pulls the whole catalogue again. Steady
 * state alternated between 0 and N downloads instead of settling on 0, and a
 * night that collected a single new PV forgot every other document. Two runs
 * cannot see that, which is why `live-scrape.test.ts` now plays FOUR.
 *
 * So the answer lives in ONE object per source, read-merged-written each run:
 *
 *   runs/{source}/collected-urls.jsonl   — one {"url": "…"} per line
 *
 * Properties that matter:
 *   - MONOTONE: a run only ever ADDS the URLs it actually collected. A run that
 *     collects nothing writes back exactly what it read, so a quiet night is a
 *     no-op instead of an amnesia.
 *   - CHEAP: one GET + one PUT per source per run, whatever the size of the back
 *     catalogue. (The union-of-all-manifests alternative costs one GET per past
 *     run — i.e. one more every night, for ever.)
 *   - SELF-HEALING: a document that failed was never collected, so it is absent
 *     from the state and is retried on the next run.
 *   - FAIL-OPEN: an unreadable state degrades to "nothing is known", i.e. the
 *     pre-guard behaviour — a download, never a skip. The expensive direction is
 *     the safe one; the cheap direction is the one that loses documents.
 *
 * DEDUP BY URL, DECIDED BEFORE ANY REQUEST — and that is the design, not an
 * approximation of a better one (owner, 2026-09-20: « une url deja chargee n a
 * pas besoin d etre rechargée pour un pdf. On na pas besoin de verifier si un
 * doc est maj »). A known URL costs NO request at all: no GET, and no HEAD
 * either. A published procès-verbal does not change, so asking whether it has is
 * a question with no use for the answer.
 *
 * This is deliberately NOT the CAS dedup. Content dedup keys on the sha256 of
 * the bytes, so it can only decide AFTER the download — it is what stops a
 * second copy being written when two URLs carry the same file, and it stays for
 * that. It cannot be what decides whether to download, because by then the cost
 * is already paid. The update cycle decides on the URL, upstream, for free.
 */

const decoder = new TextDecoder("utf-8");

/**
 * Cap on the URLs kept in one source's guard state. Reaching it costs at worst
 * ONE re-download of the oldest URLs — never a lost document. A municipal index
 * lists a bounded catalogue (the largest measured is 496 links), so this is a
 * safety valve against a pathological source, not an operating regime.
 */
export const MAX_COLLECTED_URLS = 20_000;

/**
 * Number of past run manifests read ONCE to bootstrap the state of a source
 * that has no state object yet — i.e. every source already collected before
 * this change. Bounded so the bootstrap cannot become "read every manifest ever
 * written"; the newest are read first, and anything older that is missed costs
 * one re-download, never a loss.
 */
export const MAX_BOOTSTRAP_MANIFESTS = 30;

/** Object-storage prefix holding every run artefact of one source. */
export function runsPrefix(source: string): string {
  return `runs/${source}/`;
}

/**
 * Object-storage key of one source's cumulative guard state. Deliberately NOT
 * under a `{runId}/` folder and deliberately not named `manifest.jsonl`: the run
 * manifests are the bitemporal commit record (SPEC_PERSISTENCE_S3_FIRST §1.1,
 * §5) and their readers filter on that exact name (`rebuild-from-s3.ts`). The
 * guard state is operational memory, not a commit record, and the two must not
 * be confused — nor should "bytes verified identical" (a manifest's
 * `status: "seen"`) be confused with "URL assumed unchanged", which is all this
 * file records.
 */
export function collectedUrlsKey(source: string): string {
  return `${runsPrefix(source)}collected-urls.jsonl`;
}

/** One source's guard state as read from storage. */
export interface CollectedUrlsState {
  /** Every URL known to have been collected, in first-seen order. */
  readonly urls: Set<string>;
  /**
   * `true` when the state object itself was read. `false` when it was absent or
   * unreadable and the set was bootstrapped from past run manifests (or left
   * empty) — the caller then writes it back even if it added nothing, so the
   * bootstrap happens once instead of every night.
   */
  readonly fromState: boolean;
}

/** Parse the JSONL state body. A malformed line costs one re-download. */
function parseStateBody(text: string): Set<string> {
  const urls = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const entry = JSON.parse(trimmed) as { url?: unknown };
      if (typeof entry.url === "string" && entry.url.length > 0) urls.add(entry.url);
    } catch {
      continue;
    }
  }
  return urls;
}

/**
 * URLs of the documents `source` has already collected.
 *
 * Reads `runs/{source}/collected-urls.jsonl`. When that object does not exist —
 * a source collected before this state was introduced — the set is bootstrapped
 * ONCE from the most recent {@link MAX_BOOTSTRAP_MANIFESTS} run manifests, so
 * deploying this does not re-download every city's back catalogue on the first
 * night. Never throws: a missing or broken history degrades into "fetch it".
 */
export async function loadCollectedUrls(
  store: ObjectStore,
  source: string,
): Promise<CollectedUrlsState> {
  try {
    const text = decoder.decode(await store.get(collectedUrlsKey(source)));
    return { urls: parseStateBody(text), fromState: true };
  } catch {
    // Absent (the normal first-run case) or unreadable — fall through to the
    // one-off bootstrap below.
  }
  return { urls: await bootstrapFromRunManifests(store, source), fromState: false };
}

/**
 * Seed the guard state from the run manifests already on the store. Used once
 * per source, when no state object exists yet.
 *
 * Run ids are `{ISO instant without : and .}-r`, so the lexicographic order of
 * the manifest keys is chronological and the newest
 * {@link MAX_BOOTSTRAP_MANIFESTS} are read. Never throws — an empty result
 * means "nothing is known", which costs downloads and loses nothing.
 */
export async function bootstrapFromRunManifests(
  store: ObjectStore,
  source: string,
): Promise<Set<string>> {
  const urls = new Set<string>();
  if (!store.list) return urls;

  let manifestKeys: string[];
  try {
    manifestKeys = (await store.list(runsPrefix(source)))
      .filter((k) => k.endsWith("/manifest.jsonl"))
      .sort()
      .slice(-MAX_BOOTSTRAP_MANIFESTS);
  } catch {
    return urls;
  }

  for (const key of manifestKeys) {
    let text: string;
    try {
      text = decoder.decode(await store.get(key));
    } catch {
      continue;
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
        continue;
      }
    }
  }
  return urls;
}

/**
 * Write one source's guard state back, capped at {@link MAX_COLLECTED_URLS}
 * (oldest dropped first — a `Set` preserves insertion order).
 *
 * Never throws: failing to persist the state costs re-downloads on the next
 * run, and must not cost the city that was just collected.
 *
 * @returns `true` when the state was written, `false` when the write failed.
 */
export async function saveCollectedUrls(
  store: ObjectStore,
  source: string,
  urls: ReadonlySet<string>,
): Promise<boolean> {
  const kept = [...urls].slice(-MAX_COLLECTED_URLS);
  const body = kept.map((url) => JSON.stringify({ url })).join("\n")
    + (kept.length > 0 ? "\n" : "");
  try {
    await store.put(collectedUrlsKey(source), body, "application/x-ndjson");
    return true;
  } catch {
    return false;
  }
}
