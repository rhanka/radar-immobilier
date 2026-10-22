/**
 * 6L2 authorized realtime invalidations: cursor, tick and poll helpers.
 *
 * The watcher emits minimal invalidations that invoke the 6L1 coherent
 * refetch. It never replays business transitions: durable 6L1 revision
 * tokens stay the only authority, so no second event ledger is needed and
 * notifications may coalesce without legacy replay.
 * Every watcher cycle — even without changes — re-reads the authorized
 * 6L1 scope before emitting anything, so account approval, workspace
 * membership, credentials and the scoped epoch are rechecked continuously.
 * Revocation surfaces here as a rejection the route turns into a close.
 */
import type { Database } from "../../db/client.js";
import { readProjectionScope } from "./projection-revisions.js";

/** Opaque cursor version; bump when the encoded shape changes. */
export const PROJECTION_INVALIDATION_VERSION = 1;

export const DEFAULT_PROJECTION_WATCH_INTERVAL_MS = 1000;
export const MIN_PROJECTION_WATCH_INTERVAL_MS = 100;
export const MAX_PROJECTION_WATCH_INTERVAL_MS = 30000;

/**
 * Resolve the watcher interval. An explicit override wins when it lands in
 * range; otherwise `PROJECTION_WATCH_INTERVAL_MS` is parsed; otherwise the
 * 1 s default applies. Out-of-range values fall back to the default.
 */
export function resolveWatchIntervalMs(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  overrideMs?: unknown,
): number {
  if (typeof overrideMs === "number" && Number.isFinite(overrideMs)) {
    const value = Math.floor(overrideMs);
    if (value >= MIN_PROJECTION_WATCH_INTERVAL_MS && value <= MAX_PROJECTION_WATCH_INTERVAL_MS) {
      return value;
    }
    return DEFAULT_PROJECTION_WATCH_INTERVAL_MS;
  }
  const raw = env.PROJECTION_WATCH_INTERVAL_MS;
  if (raw === undefined || raw === "") return DEFAULT_PROJECTION_WATCH_INTERVAL_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PROJECTION_WATCH_INTERVAL_MS;
  if (parsed < MIN_PROJECTION_WATCH_INTERVAL_MS || parsed > MAX_PROJECTION_WATCH_INTERVAL_MS) {
    return DEFAULT_PROJECTION_WATCH_INTERVAL_MS;
  }
  return parsed;
}

/**
 * Opaque resumption cursor. It binds the viewer (`sub`) to the workspace,
 * city, mode and last delivered token: a restart, a context switch or a
 * lost cursor never resumes another context's stream.
 */
export interface InvalidationCursor {
  version: number;
  sub: string;
  workspaceId: string;
  citySlug: string;
  mode: "signal";
  token: string;
}

export interface InvalidationLiveContext {
  sub: string;
  workspaceId: string;
  citySlug: string;
  mode: string;
}

/** Encode a cursor opaquely for transport as one query value. */
export function encodeInvalidationCursor(cursor: InvalidationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Decode a transported cursor; malformed input yields null (resync). */
export function decodeInvalidationCursor(raw: string | null | undefined): InvalidationCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 4096) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as InvalidationCursor;
    if (parsed?.version !== PROJECTION_INVALIDATION_VERSION) return null;
    if (typeof parsed.sub !== "string" || typeof parsed.token !== "string") return null;
    if (typeof parsed.workspaceId !== "string" || typeof parsed.citySlug !== "string") return null;
    if (parsed.mode !== "signal") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True only when the cursor still names the live viewer, scope and mode. */
export function isCompatibleCursor(cursor: InvalidationCursor | null, live: InvalidationLiveContext): boolean {
  if (cursor === null) return false;
  return cursor.sub === live.sub
    && cursor.workspaceId.toLowerCase() === live.workspaceId.toLowerCase()
    && cursor.citySlug === live.citySlug
    && cursor.mode === live.mode;
}

export type InvalidationTick = { kind: "steady" } | { kind: "invalidated"; token: string };

/**
 * Coalescing tick: emit only when the authorized token moved. A null last
 * token (initial connection, restart, lost cursor) always invalidates so the
 * caller resynchronizes through the 6L1 coherent read.
 */
export function decideInvalidationTick(lastEmittedToken: string | null, currentToken: string): InvalidationTick {
  if (lastEmittedToken === currentToken) return { kind: "steady" };
  return { kind: "invalidated", token: currentToken };
}

export interface InvalidationScope {
  token: string;
  personalRevision: number;
  workspaceRevision: number;
  sourceRevision: number;
  sourceDigest: string;
  membershipRevision: number;
}

/**
 * Authorized per-cycle poll. It re-reads the full 6L1 scope — approval,
 * membership with capabilities, scoped epoch and unresolved history — on
 * every call, even when nothing changed, and the route emits only after a
 * successful poll. Rejections carry the 6L1 status for close mapping.
 */
export async function pollProjectionInvalidation(
  db: Database, sub: string, workspaceId: string, citySlug: string, mode: string,
): Promise<InvalidationScope> {
  const scope = await readProjectionScope(db, sub, workspaceId, citySlug, mode);
  return {
    token: scope.token,
    personalRevision: scope.personalRevision,
    workspaceRevision: scope.workspaceRevision,
    sourceRevision: scope.sourceRevision,
    sourceDigest: scope.sourceDigest,
    membershipRevision: scope.membershipRevision,
  };
}

export type InvalidationStreamEvent = "invalidated" | "resync" | "closed" | "unavailable" | "ping";

/** Encode one SSE frame; the transport never emits business payloads. */
export function invalidationSseFrame(event: InvalidationStreamEvent, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}
