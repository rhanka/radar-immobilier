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

export function scopedProjectionEventsRoute(deps: ScopedProjectionEventsDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  const watchIntervalMs = resolveWatchIntervalMs(process.env, deps.watchIntervalMs);
  app.use("/api/v1/workspaces/:workspaceId/signal-facets/*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "Cookie, Authorization");
    const session = c.get("session" as never) as { sub?: string; via?: string } | undefined;
    if (!deps.auth?.enabled || !session?.sub) return c.json({ error: "unauthenticated" }, 401);
    if (session.via === "bearer") {
      return c.json({ error: "browser_session_required" }, 403);
    }
    if (!workspaceId.safeParse(c.req.param("workspaceId")).success) {
      return c.json({ error: "invalid_scoped_identity" }, 400);
    }
    return next();
  });
  app.get("/api/v1/workspaces/:workspaceId/signal-facets/projection-events", async (c) => {
    const params = z.object({ citySlug: city, mode }).safeParse({
      citySlug: c.req.query("citySlug"), mode: c.req.query("mode"),
    });
    if (!params.success) return c.json({ error: "invalid_scoped_identity" }, 400);
    const session = c.get("session" as never) as { sub: string; exp?: number };
    const requireCredential = () => {
      if (!Number.isFinite(session.exp) || session.exp! * 1000 <= now()) {
        throw new WorkspaceError(401, "session_expired");
      }
    };
    const poll = async () => {
      requireCredential();
      const current = await pollProjectionInvalidation(deps.db, session.sub,
        routeWorkspaceId, params.data.citySlug, params.data.mode);
      requireCredential();
      return current;
    };
    const routeWorkspaceId = c.req.param("workspaceId");
    const live = { sub: session.sub, workspaceId: routeWorkspaceId,
      citySlug: params.data.citySlug, mode: params.data.mode };
    const cursor = decodeInvalidationCursor(c.req.query("cursor"));
    const reason = c.req.query("cursor") == null ? "initial_connection"
      : isCompatibleCursor(cursor, live) ? "restart" : "cursor_incompatible";
    let scope: Awaited<ReturnType<typeof pollProjectionInvalidation>>;
    try {
      scope = await poll();
    } catch (error) {
      if (error instanceof WorkspaceError || error instanceof ScopeError || error instanceof FacetError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
    const revisions = () => ({ personal: scope.personalRevision, workspace: scope.workspaceRevision,
      source: scope.sourceRevision, sourceDigest: scope.sourceDigest,
      membership: scope.membershipRevision });
    const encoder = new TextEncoder();
    let emitted = 0;
    let lastToken = scope.token;
    let lastUnavailable: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let closeStream = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = () => {
          stopped = true;
          if (timer) clearTimeout(timer);
          timer = null;
          c.req.raw.signal?.removeEventListener("abort", close);
          try { controller.close(); } catch { /* already closed */ }
        };
        closeStream = close;
        const send = (frame: string): boolean => {
          if (stopped) return false;
          try { requireCredential(); } catch {
            controller.enqueue(encoder.encode(invalidationSseFrame("closed", { reason: "session_expired" })));
            close();
            return false;
          }
          if (deps.maxEvents !== undefined && emitted >= deps.maxEvents) return false;
          controller.enqueue(encoder.encode(frame));
          emitted += 1;
          if (deps.maxEvents !== undefined && emitted >= deps.maxEvents) close();
          return true;
        };
        send(invalidationSseFrame("resync", { token: scope.token, revisions: revisions(), reason,
          cursor: encodeInvalidationCursor({ version: PROJECTION_INVALIDATION_VERSION, sub: session.sub,
            workspaceId: routeWorkspaceId, citySlug: params.data.citySlug,
            mode: params.data.mode, token: scope.token }) }));
        if (stopped || (deps.maxEvents !== undefined && emitted >= deps.maxEvents)) return;
        const tickOnce = async () => {
          try {
            let current: typeof scope;
            try {
              current = await poll();
            } catch (error) {
              const end = toStreamEnd(error);
              if (end.kind === "closed") {
                send(invalidationSseFrame("closed", { reason: end.reason }));
                close();
              } else if (end.reason !== lastUnavailable) {
                lastUnavailable = end.reason;
                send(invalidationSseFrame("unavailable", { reason: end.reason }));
              }
              return;
            }
            lastUnavailable = null;
            scope = current;
            const tick = decideInvalidationTick(lastToken, current.token);
            if (tick.kind === "steady") return;
            lastToken = tick.token;
            send(invalidationSseFrame("invalidated", { token: tick.token, revisions: revisions() }));
          } catch { close(); }
          finally { if (!stopped) timer = setTimeout(() => { void tickOnce(); }, watchIntervalMs); }
        };
        timer = setTimeout(() => { void tickOnce(); }, watchIntervalMs);
        c.req.raw.signal?.addEventListener("abort", close, { once: true });
        if (c.req.raw.signal?.aborted) close();
      },
      cancel() {
        closeStream();
      },
    });
    c.header("Content-Type", "text/event-stream; charset=utf-8");
    c.header("Cache-Control", "private, no-store");
    c.header("Connection", "keep-alive");
    c.header("X-Accel-Buffering", "no");
    return c.body(stream);
  });
  return app;
}
