/**
 * 6J scoped lot-facet routes: four independent facets on one stable target.
 * GATED: this router is not mounted in `app.ts` until the protected 6K
 * activation opens the destination. Legacy mark routes keep serving
 * unchanged behavior; nothing here retires them (6K owns that cutover).
 *
 * Mapping of the current `LotFichePanel.svelte` actions (unchanged until
 * the 6K cutover):
 * - pipeline/favori -> workspace `select` in the configured basket.
 * - pipeline/sollicite -> workspace `set_pipeline("sollicite")`.
 * - pipeline/lettre_envoyee -> workspace `set_pipeline("lettre_envoyee")`.
 * - pipeline/ecarte -> explicit workspace `discard` (moderator-only);
 *   other facets stay unless an authorized deselection is requested.
 * - marche/en_vente -> workspace `set_market` with explicit price/link
 *   values (or nulls). The current toggle only sets; `clear_market`,
 *   `clear_pipeline`, deselection, and restoration stay explicit commands.
 * A contributor is never silently redirected from a forbidden common
 * archive to a personal action.
 */
import { Hono } from "hono";
import { scopedLotCommandsRoute } from "./scoped-lot-commands.js";
import {
  lotWorkspaceId,
  type ScopedLotFacetsDeps,
} from "./scoped-lot-facets-common.js";
import { scopedLotReadsRoute } from "./scoped-lot-reads.js";

export type { ScopedLotFacetsDeps } from "./scoped-lot-facets-common.js";

export function scopedLotFacetsRoute(deps: ScopedLotFacetsDeps): Hono {
  const app = new Hono();
  app.use("/api/v1/workspaces/:workspaceId/lot-facets/*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "Cookie, Authorization");
    await next();
  });
  app.use("/api/v1/workspaces/:workspaceId/lot-facets/*", async (c, next) => {
    const session = c.get("session" as never) as { sub?: string; via?: string } | undefined;
    if (!deps.auth?.enabled || !session?.sub) return c.json({ error: "unauthenticated" }, 401);
    if (c.req.method !== "GET" && session.via === "bearer") {
      return c.json({ error: "browser_session_required" }, 403);
    }
    if (!lotWorkspaceId.safeParse(c.req.param("workspaceId")).success) {
      return c.json({ error: "invalid_scoped_identity" }, 400);
    }
    return next();
  });
  app.route("/", scopedLotReadsRoute(deps));
  app.route("/", scopedLotCommandsRoute(deps));
  return app;
}
