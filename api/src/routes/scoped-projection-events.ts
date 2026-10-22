/**
 * 6L2 scoped projection-event route: browser-session SSE under the selected
 * workspace emitting minimal authorized invalidations for the 6L1 refetch.
 * GATED: unmounted in `app.ts` until 6K retires the old delivery paths. No
 * `replayAll`, no marks/notes bus, no second ledger: durable 6L1 revisions
 * stay the only authority. Every cycle re-polls the 6L1 scope before
 * emitting; revocation closes the stream. Initial connection, restart and
 * incompatible cursor always open with a `resync` frame. */
import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { FacetError } from "../services/facets/target.js";
import { ScopeError } from "../services/facets/scope.js";
import { WorkspaceError } from "../services/workspaces/types.js";
import {
  PROJECTION_INVALIDATION_VERSION,
  decideInvalidationTick,
  decodeInvalidationCursor,
  encodeInvalidationCursor,
  invalidationSseFrame,
  isCompatibleCursor,
  pollProjectionInvalidation,
  resolveWatchIntervalMs,
} from "../services/facets/projection-invalidation.js";

const workspaceId = z.string().uuid();
const city = z.string().min(1).max(128).regex(/^[a-z0-9-]+$/);
const mode = z.enum(["signal"]);

export interface ScopedProjectionEventsDeps {
  db: Database;
  auth?: { enabled: boolean };
  watchIntervalMs?: number;
  maxEvents?: number;
  now?: () => number;
}

/** Denials close the stream; anything else stays open with a retry frame. */
export function toStreamEnd(error: unknown): { kind: "closed" | "unavailable"; status: number; reason: string } {
  const status = error instanceof ScopeError || error instanceof WorkspaceError || error instanceof FacetError
    ? error.status : 503;
  const reason = error instanceof ScopeError || error instanceof WorkspaceError || error instanceof FacetError
    ? error.message : "projection_events_unavailable";
  if (status === 401 || status === 403 || status === 404) return { kind: "closed", status, reason };
  return { kind: "unavailable", status, reason };
}

