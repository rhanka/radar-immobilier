/**
 * WP6 — Track sidecar reader.
 *
 * The repo carries an event-sourced **track** sidecar at the repo root
 * (`.track/events.jsonl`, append-only JSONL + `.track/head.json`). This module
 * folds that event log into the current state of each tracked item, mirroring
 * what `track report` shows, so the Backlog view can render the REAL backlog
 * instead of a hand-maintained in-memory demo seed.
 *
 * Design constraints:
 *  - **Pure + deterministic**: `foldTrackEvents(jsonlText)` has no I/O and no
 *    external deps; the loader (`loadTrackItems`) is the only thing that touches
 *    the filesystem.
 *  - **Configurable path**: `TRACK_EVENTS_PATH` (env) overrides the default,
 *    which resolves to the repo-root `.track/events.jsonl`. In dev/test the repo
 *    is bind-mounted at `/workspace`, so that default points at the live sidecar.
 *  - **Graceful degradation**: a missing/unreadable file yields an empty list
 *    (never throws); the caller keeps the ÉV seed as a labeled fallback.
 *  - **Anti-invention**: only REAL events are folded; no field is fabricated. A
 *    field absent from `item.created` is simply omitted.
 *
 * Event shape (one JSON object per line):
 *   { aggregate:"item", aggregateId:<ULID>, at:<iso>, by:<actor>,
 *     type:<event-type>, payload:{...} }
 *
 * Folded types:
 *   - `item.created`           payload: { kind, title, workspace, body, accountable, parent? }
 *   - `realization.transition` payload: { to ∈ to-do|in-progress|done|cancelled|rejected }
 *   - `acceptance.run`         payload: { result ∈ pass|fail|... }
 * (`spec.transition`, `acceptance.criterion.added`, `acceptance.evidence.linked`
 *  exist in the log but do not affect the bucket/realization/acceptance fold.)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Realization state of a tracked item (latest `realization.transition.to`). */
export type TrackRealization =
  | "to-do"
  | "in-progress"
  | "done"
  | "cancelled"
  | "rejected";

/** Acceptance annotation (latest `acceptance.run.result`, or "none"). */
export type TrackAcceptance = "pass" | "fail" | "none";

/** Coarse backlog bucket derived from the realization state. */
export type TrackBucket = "DONE" | "TO-DO" | "DROPPED";

/** A single tracked item, folded from its event stream. */
export interface TrackItem {
  /** Aggregate id (ULID). */
  readonly id: string;
  /** Title from `item.created`. */
  readonly title: string;
  /** Workspace from `item.created` (e.g. "wp4-sources"). */
  readonly workspace: string;
  /** Kind from `item.created` (e.g. "feature"). */
  readonly kind: string;
  /** Latest realization state (defaults to "to-do" when never transitioned). */
  readonly realization: TrackRealization;
  /** Latest acceptance run result ("none" when never run). */
  readonly acceptance: TrackAcceptance;
  /** Coarse bucket (DONE / TO-DO / DROPPED). */
  readonly bucket: TrackBucket;
  /** Parent aggregate id, only when present in `item.created`. */
  readonly parentId?: string;
}

/** A raw track event (only the fields we read are typed; the rest is ignored). */
interface RawTrackEvent {
  aggregate?: unknown;
  aggregateId?: unknown;
  at?: unknown;
  type?: unknown;
  payload?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const asString = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/** Map a realization state to a coarse backlog bucket. */
export function bucketForRealization(realization: TrackRealization): TrackBucket {
  if (realization === "done") return "DONE";
  if (realization === "cancelled" || realization === "rejected") return "DROPPED";
  // to-do / in-progress / anything unknown -> still awaited work.
  return "TO-DO";
}

/** Normalize a `realization.transition.to` payload value to a known state. */
function normalizeRealization(to: string | undefined): TrackRealization | undefined {
  switch (to) {
    case "to-do":
    case "in-progress":
    case "done":
    case "cancelled":
    case "rejected":
      return to;
    default:
      return undefined;
  }
}

/** Normalize an `acceptance.run.result` payload value to a known annotation. */
function normalizeAcceptance(result: string | undefined): TrackAcceptance {
  return result === "pass" || result === "fail" ? result : "none";
}

/**
 * Fold a JSONL track-events string into the current state of each `item`
 * aggregate. Pure and deterministic: malformed lines are skipped, the latest
 * (by `at`, then by stream order) `realization.transition` / `acceptance.run`
 * wins, and only aggregates that have an `item.created` event are returned.
 *
 * Returned items preserve **first-seen** stream order (the order their
 * `item.created` line appears), which mirrors `track report`'s chronology.
 */
export function foldTrackEvents(jsonlText: string): TrackItem[] {
  interface Acc {
    id: string;
    title: string;
    workspace: string;
    kind: string;
    parentId?: string;
    realization: TrackRealization;
    realizationAt: string;
    acceptance: TrackAcceptance;
    acceptanceAt: string;
    seq: number;
  }

  const byId = new Map<string, Acc>();
  let order = 0;

  const lines = jsonlText.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: RawTrackEvent;
    try {
      event = JSON.parse(trimmed) as RawTrackEvent;
    } catch {
      continue; // skip malformed lines, never throw
    }

    if (event.aggregate !== "item") continue;
    const id = asString(event.aggregateId);
    const type = asString(event.type);
    const at = asString(event.at) ?? "";
    if (!id || !type) continue;
    const payload = isObject(event.payload) ? event.payload : {};

    if (type === "item.created") {
      // First creation wins; ignore any (impossible) duplicate creation.
      if (byId.has(id)) continue;
      const acc: Acc = {
        id,
        title: asString(payload.title) ?? "(sans titre)",
        workspace: asString(payload.workspace) ?? "(sans workspace)",
        kind: asString(payload.kind) ?? "(sans type)",
        realization: "to-do",
        realizationAt: "",
        acceptance: "none",
        acceptanceAt: "",
        seq: order++,
      };
      const parentId = asString(payload.parent);
      if (parentId) acc.parentId = parentId;
      byId.set(id, acc);
      continue;
    }

    const acc = byId.get(id);
    if (!acc) continue; // event for an item we haven't seen created yet

    if (type === "realization.transition") {
      const to = normalizeRealization(asString(payload.to));
      if (to && at >= acc.realizationAt) {
        acc.realization = to;
        acc.realizationAt = at;
      }
      continue;
    }

    if (type === "acceptance.run") {
      const result = normalizeAcceptance(asString(payload.result));
      if (at >= acc.acceptanceAt) {
        acc.acceptance = result;
        acc.acceptanceAt = at;
      }
      continue;
    }
    // Other event types do not affect the fold.
  }

  return [...byId.values()]
    .sort((a, b) => a.seq - b.seq)
    .map((acc) => {
      const item: TrackItem = {
        id: acc.id,
        title: acc.title,
        workspace: acc.workspace,
        kind: acc.kind,
        realization: acc.realization,
        acceptance: acc.acceptance,
        bucket: bucketForRealization(acc.realization),
        ...(acc.parentId ? { parentId: acc.parentId } : {}),
      };
      return item;
    });
}

// ── Filesystem loader ───────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
// api/src/services/track -> repo root is four levels up (mirrors seed-ontology).
const REPO_ROOT = join(here, "..", "..", "..", "..");

/** Default sidecar path: repo-root `.track/events.jsonl`. */
export const DEFAULT_TRACK_EVENTS_PATH = join(REPO_ROOT, ".track", "events.jsonl");

/** Resolve the configured track-events path (env override, else default). */
export function resolveTrackEventsPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.TRACK_EVENTS_PATH?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_TRACK_EVENTS_PATH;
}

/** Result of a track load: the items + whether the sidecar was available. */
export interface TrackLoadResult {
  /** Whether the configured path was found and read. */
  readonly available: boolean;
  /** Absolute path that was attempted. */
  readonly path: string;
  /** Folded items (empty when unavailable). */
  readonly items: TrackItem[];
}

/**
 * Load + fold the track sidecar from disk. Never throws: a missing or
 * unreadable file yields `{ available: false, items: [] }` so the caller can
 * fall back to the ÉV seed. Read errors are swallowed by design (the sidecar is
 * optional in deployed environments that don't bind-mount the repo).
 */
export function loadTrackItems(
  env: NodeJS.ProcessEnv = process.env,
): TrackLoadResult {
  const path = resolveTrackEventsPath(env);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { available: false, path, items: [] };
  }
  return { available: true, path, items: foldTrackEvents(text) };
}
