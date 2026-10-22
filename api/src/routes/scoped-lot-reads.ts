/**
 * 6J scoped lot reads: authorized target, collection projection, and
 * paginated destination/source history. No business mutation here.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { LotMode } from "../services/facets/lots/lot-target.js";
import { readLotHistory, readLotSourceHistory } from "../services/facets/lots/lot-history.js";
import { readLotCity } from "../services/facets/lots/lot-city.js";
import { readLotState } from "../services/facets/lots/lot-reader.js";
import {
  lotMode,
  toLotError,
  type ScopedLotFacetsDeps,
} from "./scoped-lot-facets-common.js";

export function scopedLotReadsRoute(deps: ScopedLotFacetsDeps): Hono {
  const app = new Hono();

  app.get("/api/v1/workspaces/:workspaceId/lot-facets", async (c) => {
    const query = z.object({
      citySlug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
      canonicalId: z.string().min(1).max(512),
      mode: lotMode,
    }).safeParse({ citySlug: c.req.query("citySlug"),
      canonicalId: c.req.query("canonicalId"), mode: c.req.query("mode") });
    if (!query.success) return c.json({ error: "invalid_facet_command" }, 400);
    const session = c.get("session" as never) as { sub: string };
    try {
      const state = await readLotState(deps.db, session.sub, c.req.param("workspaceId"),
        query.data.mode as LotMode,
        { type: "Lot", authority: "lot_versions",
          citySlug: query.data.citySlug, canonicalId: query.data.canonicalId });
      return c.json({ ok: true, ...state });
    } catch (error) {
      return toLotError(c, error);
    }
  });

  app.get("/api/v1/workspaces/:workspaceId/lot-facets/heads", async (c) => {
    const query = z.object({
      citySlug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
      mode: lotMode,
    }).safeParse({ citySlug: c.req.query("citySlug"), mode: c.req.query("mode") });
    if (!query.success) return c.json({ error: "invalid_facet_command" }, 400);
    const session = c.get("session" as never) as { sub: string };
    try {
      const projection = await readLotCity(deps.db, session.sub, c.req.param("workspaceId"),
        query.data.mode as LotMode, query.data.citySlug);
      return c.json({ ok: true, ...projection });
    } catch (error) {
      return toLotError(c, error);
    }
  });

  app.get("/api/v1/workspaces/:workspaceId/lot-facets/history", async (c) => {
    const query = z.object({
      citySlug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
      canonicalId: z.string().min(1).max(512),
      mode: lotMode,
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }).safeParse({
      citySlug: c.req.query("citySlug"), canonicalId: c.req.query("canonicalId"),
      mode: c.req.query("mode"), offset: c.req.query("offset"), limit: c.req.query("limit"),
    });
    if (!query.success) return c.json({ error: "invalid_facet_command" }, 400);
    const session = c.get("session" as never) as { sub: string };
    try {
      const page = await readLotHistory(deps.db, session.sub, c.req.param("workspaceId"),
        query.data.mode as LotMode,
        { type: "Lot", authority: "lot_versions",
          citySlug: query.data.citySlug, canonicalId: query.data.canonicalId },
        query.data.offset, query.data.limit);
      return c.json({ ok: true, ...page });
    } catch (error) {
      return toLotError(c, error);
    }
  });

  app.get("/api/v1/workspaces/:workspaceId/lot-facets/source-history", async (c) => {
    const query = z.object({
      chainId: z.string().min(1).max(512),
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }).safeParse({
      chainId: c.req.query("chainId"),
      offset: c.req.query("offset"), limit: c.req.query("limit"),
    });
    if (!query.success) return c.json({ error: "invalid_facet_command" }, 400);
    const session = c.get("session" as never) as { sub: string };
    try {
      const page = await readLotSourceHistory(deps.db, session.sub, c.req.param("workspaceId"),
        query.data.chainId, query.data.offset, query.data.limit);
      return c.json({ ok: true, ...page });
    } catch (error) {
      return toLotError(c, error);
    }
  });

  return app;
}
