import type { ObjectStore } from "../../storage/object-store.js";
import { isMissingObjectError } from "../../storage/s3-object-store.js";
import type { RecueilDocumentJournal, RecueilSetAsideDocument, RecueilSetAsideReason } from "./recueil.js";
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
 *
 * SET-ASIDE MARKS AND OPEN ATTEMPTS LIVE IN THE SAME OBJECT (issue #805). It is
 * already read before any document request and is the one place that decides
 * "request this URL or not", so a document that must never be requested again
 * is one more line of it, at no extra GET:
 *
 *   {"url": "…"}                                          collected
 *   {"url": "…", "setAside": "oversize", "markedAt": …}   never requested again
 *   {"attemptUrl": "…", "open": 1, "lastAt": "…"}        requested, never settled
 *
 * Both shapes degrade safely under a reader that predates them: a set-aside
 * line still has a `url`, so it is skipped as collected; an attempt line has
 * none, so it is ignored and the document is simply retried.
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

/**
 * Unclosed attempts after which a document is set aside as `oom-suspected`.
 * Two, not one: a single unclosed attempt may be a pod killed for an unrelated
 * reason (deadline, eviction) while that document happened to be in flight.
 */
export const OOM_SUSPECTED_ATTEMPTS = 2;

/** A durable set-aside mark: the URL is never requested again. */
export type SetAsideMark = Omit<RecueilSetAsideDocument, "url" | "newlySetAside">;

/** A document request started and not yet settled in-process. */
export interface AttemptMark {
  /** Consecutive unclosed attempts. */
  readonly open: number;
  readonly lastAt: string;
}

/** Set-aside marks and open attempts of one source (issue #805). */
export interface DocumentMarks {
  readonly setAside: Map<string, SetAsideMark>;
  readonly attempts: Map<string, AttemptMark>;
}

const SET_ASIDE_REASONS: ReadonlySet<string> = new Set<RecueilSetAsideReason>(["oversize", "oom-suspected"]);

/** One source's guard state as read from storage. */
export interface CollectedUrlsState extends DocumentMarks {
  /** Every URL known to have been collected, in first-seen order. */
  readonly urls: Set<string>;
  /**
   * `true` when the state object itself was read. `false` when it was absent or
   * unreadable and the set was bootstrapped from past run manifests (or left
   * empty) — the caller then writes it back even if it added nothing, so the
   * bootstrap happens once instead of every night.
   */
  readonly fromState: boolean;
  /**
   * `true` when the store FAILED to answer (an S3 fault other than "absent").
   * The run still downloads fail-open, but must write NOTHING back: the object
   * on storage may hold set-aside marks that cannot be rebuilt from manifests.
   */
  readonly unreadable: boolean;
}

/** An S3 client error (every one carries `$metadata`) that does not mean "absent". */
function isStoreFault(error: unknown): boolean {
  return typeof (error as { $metadata?: unknown } | null)?.$metadata === "object"
    && !isMissingObjectError(error);
}

/** Parse the JSONL state body. A malformed line costs one re-download. */
function parseStateBody(text: string): { urls: Set<string> } & DocumentMarks {
  const urls = new Set<string>();
  const setAside = new Map<string, SetAsideMark>();
  const attempts = new Map<string, AttemptMark>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const entry = JSON.parse(trimmed) as Record<string, unknown>;
      const { url, setAside: reason, attemptUrl, open, lastAt, markedAt } = entry;
      if (typeof attemptUrl === "string" && attemptUrl.length > 0) {
        if (typeof open === "number" && Number.isInteger(open) && open > 0) {
          attempts.set(attemptUrl, { open, lastAt: typeof lastAt === "string" ? lastAt : "" });
        }
      } else if (typeof url === "string" && url.length > 0) {
        if (typeof reason === "string" && SET_ASIDE_REASONS.has(reason)) {
          const mark: { -readonly [K in keyof SetAsideMark]: SetAsideMark[K] } = {
            reason: reason as RecueilSetAsideReason,
            markedAt: typeof markedAt === "string" ? markedAt : "",
          };
          const announced = entry.bytesAnnounced;
          if (announced === null || typeof announced === "number") mark.bytesAnnounced = announced;
          for (const key of ["bytesRead", "capBytes", "attempts"] as const) {
            const value = entry[key];
            if (typeof value === "number") mark[key] = value;
          }
          setAside.set(url, mark);
        } else {
          urls.add(url);
        }
      }
    } catch {
      continue;
    }
  }
  return { urls, setAside, attempts };
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
  let unreadable = false;
  try {
    const text = decoder.decode(await store.get(collectedUrlsKey(source)));
    return { ...parseStateBody(text), fromState: true, unreadable };
  } catch (error) {
    // Absent (the normal first-run case) or unreadable — fall through to the
    // one-off bootstrap below.
    unreadable = isStoreFault(error);
  }
  return { urls: await bootstrapFromRunManifests(store, source), setAside: new Map(),
    attempts: new Map(), fromState: false, unreadable };
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
 * `marks` are written after the URLs; a caller holding a state read with
 * {@link loadCollectedUrls} passes it, or its set-aside marks are lost.
 *
 * @returns `true` when the state was written, `false` when the write failed.
 */
export async function saveCollectedUrls(
  store: ObjectStore,
  source: string,
  urls: ReadonlySet<string>,
  marks?: DocumentMarks,
): Promise<boolean> {
  const kept = [...urls].slice(-MAX_COLLECTED_URLS);
  const lines = kept.map((url) => JSON.stringify({ url }));
  for (const [url, { reason, ...detail }] of marks?.setAside ?? []) {
    lines.push(JSON.stringify({ url, setAside: reason, ...detail }));
  }
  for (const [url, { open, lastAt }] of marks?.attempts ?? []) {
    if (!urls.has(url) && !marks?.setAside.has(url)) lines.push(JSON.stringify({ attemptUrl: url, open, lastAt }));
  }
  const body = lines.join("\n") + (lines.length > 0 ? "\n" : "");
  try {
    await store.put(collectedUrlsKey(source), body, "application/x-ndjson");
    return true;
  } catch {
    return false;
  }
}

/**
 * The RECUEIL journal (issue #805) backed by one source's guard state.
 *
 *   - `setAside(url)`: the earlier mark for `url`, or — when it has
 *     {@link OOM_SUSPECTED_ATTEMPTS} unclosed attempts — a new `oom-suspected`
 *     mark made now.
 *   - `open(url)`: one more attempt, WRITTEN before the request. The URLs
 *     written are the ones read at the start of the city, never this run's
 *     harvest: a document collected now is still recorded only once its city
 *     has committed, exactly as before.
 *   - `close(url, …)`: drops the attempt; an oversize settlement becomes a
 *     mark. Kept in memory until the next `open` or the end-of-city save.
 *
 * `changed()` tells the caller to write the state back at the end of the city
 * even when no URL was added.
 *
 * An `oversize` mark holds only while the run's cap (`maxDocumentBytes`,
 * omitted = none) is not above the cap it was made under: raising the cap lets
 * the document be tried once more, and a caller with no cap is not bound by
 * another caller's. `oom-suspected` marks hold until removed by hand.
 */
export function guardDocumentJournal(
  store: ObjectStore,
  source: string,
  state: CollectedUrlsState,
  now: () => Date = () => new Date(),
  maxDocumentBytes = Number.POSITIVE_INFINITY,
): RecueilDocumentJournal & { changed(): boolean } {
  let changed = false;
  return {
    setAside(url) {
      const mark = state.setAside.get(url);
      const outgrown = mark?.reason === "oversize" && maxDocumentBytes > (mark.capBytes ?? Number.POSITIVE_INFINITY);
      if (mark && !outgrown) return { url, ...mark, newlySetAside: false };
      const attempt = state.attempts.get(url);
      if (!attempt || attempt.open < OOM_SUSPECTED_ATTEMPTS) return undefined;
      const quarantined: SetAsideMark = {
        reason: "oom-suspected", markedAt: now().toISOString(), attempts: attempt.open,
      };
      state.attempts.delete(url);
      state.setAside.set(url, quarantined);
      changed = true;
      return { url, ...quarantined, newlySetAside: true };
    },
    async open(url) {
      state.attempts.set(url, { open: (state.attempts.get(url)?.open ?? 0) + 1, lastAt: now().toISOString() });
      changed = true;
      await saveCollectedUrls(store, source, state.urls, state);
    },
    close(url, settlement) {
      if (state.attempts.delete(url)) changed = true;
      // Collected under a raised cap: the old oversize mark no longer applies.
      if (settlement === "collected" && state.setAside.delete(url)) changed = true;
      if (typeof settlement === "object") {
        const { url: _url, newlySetAside: _newlySetAside, ...mark } = settlement;
        state.setAside.set(url, mark);
        changed = true;
      }
    },
    changed: () => changed,
  };
}
