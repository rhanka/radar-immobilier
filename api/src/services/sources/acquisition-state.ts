import type { ObjectStore } from "../../storage/object-store.js";
import { isMissingObjectError } from "../../storage/s3-object-store.js";
import type { RecueilDocumentJournal, RecueilSetAsideDocument, RecueilSetAsideReason } from "./recueil.js";
import { runsPrefix } from "./known-urls.js";

/**
 * PER-URL ACQUISITION STATE (issue #805) — what the update cycle must NOT
 * download, and the document requests that never came back.
 *
 * Kept apart from the known-URL guard on purpose. The guard means "collected":
 * a URL in it is skipped for ever and its document is in the CAS. A document
 * refused for its size, or one the process kept dying on, was never collected;
 * recording it there would hide it for good, and the coverage ledger cannot
 * hold it either (keyed by sha256, which nobody has before reading the body).
 * So this is its own object, keyed by URL:
 *
 *   runs/{source}/acquisition-state.jsonl
 *     {"url": "…", "state": "deferred-oversize", "markedAt": …, "bytesAnnounced": …, "bytesRead": …, "capBytes": …}
 *     {"url": "…", "state": "interrupted-repeatedly", "markedAt": …, "attempts": 2}
 *     {"url": "…", "state": "attempt-open", "open": 1, "lastAt": …}
 *
 * A deferred URL is never requested again by the cycle — not even under a
 * larger cap — until the line is removed: re-examining it is an explicit act,
 * for the operator or for the large-document pipeline that will read this
 * object. Every pass that meets one lists it, so the PO sees what is not read.
 */

/** Unclosed attempts after which a document is set aside as `interrupted-repeatedly`. */
export const INTERRUPTED_ATTEMPTS = 2;

/** A durable deferral: the URL is not requested again. */
export type DeferredMark = Omit<RecueilSetAsideDocument, "url" | "newlySetAside">;

/** A document request started and not yet settled in-process. */
export interface AttemptMark {
  /** Consecutive unclosed attempts. */
  readonly open: number;
  readonly lastAt: string;
}

/** One source's acquisition state as read from storage. */
export interface AcquisitionState {
  readonly deferred: Map<string, DeferredMark>;
  readonly attempts: Map<string, AttemptMark>;
  /**
   * `true` when the store FAILED to answer (an S3 fault other than "absent").
   * The run then writes nothing back: the object it could not read may hold
   * deferrals that nothing else can rebuild.
   */
  readonly unreadable: boolean;
}

const DEFERRED_STATES: ReadonlySet<string> = new Set<RecueilSetAsideReason>(
  ["deferred-oversize", "interrupted-repeatedly"]);

/** Object-storage key of one source's acquisition state. */
export function acquisitionStateKey(source: string): string {
  return `${runsPrefix(source)}acquisition-state.jsonl`;
}

/** An S3 client error (every one carries `$metadata`) that does not mean "absent". */
function isStoreFault(error: unknown): boolean {
  return typeof (error as { $metadata?: unknown } | null)?.$metadata === "object"
    && !isMissingObjectError(error);
}

function parseLine(line: string, state: AcquisitionState): void {
  const entry = JSON.parse(line) as Record<string, unknown>;
  const { url, state: kind, open, lastAt, markedAt } = entry;
  if (typeof url !== "string" || url.length === 0 || typeof kind !== "string") return;
  if (kind === "attempt-open") {
    if (typeof open === "number" && Number.isInteger(open) && open > 0) {
      state.attempts.set(url, { open, lastAt: typeof lastAt === "string" ? lastAt : "" });
    }
    return;
  }
  if (!DEFERRED_STATES.has(kind)) return;
  const mark: { -readonly [K in keyof DeferredMark]: DeferredMark[K] } = {
    reason: kind as RecueilSetAsideReason, markedAt: typeof markedAt === "string" ? markedAt : "",
  };
  const announced = entry.bytesAnnounced;
  if (announced === null || typeof announced === "number") mark.bytesAnnounced = announced;
  for (const key of ["bytesRead", "capBytes", "attempts"] as const) {
    const value = entry[key];
    if (typeof value === "number") mark[key] = value;
  }
  state.deferred.set(url, mark);
}

/** Read one source's acquisition state. Never throws; absent ⇒ empty. */
export async function loadAcquisitionState(store: ObjectStore, source: string): Promise<AcquisitionState> {
  const state: AcquisitionState = { deferred: new Map(), attempts: new Map(), unreadable: false };
  let text: string;
  try {
    text = new TextDecoder("utf-8").decode(await store.get(acquisitionStateKey(source)));
  } catch (error) {
    return { ...state, unreadable: isStoreFault(error) };
  }
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      parseLine(line.trim(), state);
    } catch {
      continue;
    }
  }
  return state;
}

/** Write one source's acquisition state. Never throws; `false` when the write failed. */
export async function saveAcquisitionState(
  store: ObjectStore,
  source: string,
  state: Pick<AcquisitionState, "deferred" | "attempts">,
): Promise<boolean> {
  const lines: string[] = [];
  for (const [url, { reason, ...detail }] of state.deferred) {
    lines.push(JSON.stringify({ url, state: reason, ...detail }));
  }
  for (const [url, { open, lastAt }] of state.attempts) {
    if (!state.deferred.has(url)) lines.push(JSON.stringify({ url, state: "attempt-open", open, lastAt }));
  }
  try {
    await store.put(acquisitionStateKey(source), lines.join("\n") + (lines.length > 0 ? "\n" : ""),
      "application/x-ndjson");
    return true;
  } catch {
    return false;
  }
}

/**
 * The RECUEIL journal backed by one source's acquisition state.
 *
 *   - `setAside(url)`: the deferral on file for `url`, or — once it has
 *     {@link INTERRUPTED_ATTEMPTS} unclosed attempts — an `interrupted-repeatedly`
 *     deferral made now. An unclosed attempt proves a process that did not come
 *     back (OOM kill, deadline, eviction, node loss), not which one.
 *   - `open(url)`: one more attempt, WRITTEN before the request — the only way
 *     an uncatchable death is ever counted. The write touches this object only,
 *     never the known-URL guard.
 *   - `close(url, …)`: drops the attempt; an oversize settlement becomes a
 *     `deferred-oversize` deferral. Kept in memory until the next `open` or the
 *     end-of-city save.
 */
export function acquisitionJournal(
  store: ObjectStore,
  source: string,
  state: AcquisitionState,
  now: () => Date = () => new Date(),
): RecueilDocumentJournal & { changed(): boolean } {
  let changed = false;
  return {
    setAside(url) {
      const mark = state.deferred.get(url);
      if (mark) return { url, ...mark, newlySetAside: false };
      const attempt = state.attempts.get(url);
      if (!attempt || attempt.open < INTERRUPTED_ATTEMPTS) return undefined;
      const interrupted: DeferredMark = {
        reason: "interrupted-repeatedly", markedAt: now().toISOString(), attempts: attempt.open,
      };
      state.attempts.delete(url);
      state.deferred.set(url, interrupted);
      changed = true;
      return { url, ...interrupted, newlySetAside: true };
    },
    async open(url) {
      state.attempts.set(url, { open: (state.attempts.get(url)?.open ?? 0) + 1, lastAt: now().toISOString() });
      changed = true;
      await saveAcquisitionState(store, source, state);
    },
    close(url, settlement) {
      if (state.attempts.delete(url)) changed = true;
      if (typeof settlement === "object") {
        const { url: _url, newlySetAside: _newlySetAside, ...mark } = settlement;
        state.deferred.set(url, mark);
        changed = true;
      }
    },
    changed: () => changed,
  };
}
