/**
 * 6K cutover routes: operator status, gate evaluation, explicit D5
 * dispositions, and the protected activation run.
 *
 * Status is member-readable. Evaluation, dispositions, and activation
 * require a moderator browser session; activation additionally requires
 * an explicit confirmation and never runs at deployment. The server
 * recomputes the 6F manifest from live source rows for both the gate
 * and the under-fence recheck; no client-supplied manifest is trusted.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../db/client.js";
import type { CutoverSafety } from "../services/facets/lots/lot-cutover-types.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../services/workspaces/store.js";
import { WorkspaceError } from "../services/workspaces/types.js";
import { ScopeError } from "../services/facets/scope.js";
import { digest, FacetError } from "../services/facets/target.js";
import {
  evaluateActivationGate,
  readCutoverTargets,
  readLotCutover,
} from "../services/facets/lots/lot-cutover.js";
import {
  assertManifestMapping,
  recomputeLotManifest,
  type ManifestMapping,
} from "../services/facets/lots/lot-manifest-refresh.js";
import {
  lotWorkspaceId,
  toLotError,
} from "./scoped-lot-facets-common.js";

const mappingSchema = z.object({
  mappingVersion: z.string().min(1).max(256),
  importerVersion: z.string().min(1).max(256),
  destinationsQualified: z.boolean(),
}).strict();

const evaluateBodySchema = z.object({ mapping: mappingSchema }).strict();

export interface ScopedLotCutoverDeps {
  db: Database;
  auth?: { enabled: boolean };
  /** Deployment adapter must positively retire every replica and reconnect path. */
  cutoverSafety?: CutoverSafety;
  cutoverMapping?: { workspaceId: string; mapping: ManifestMapping };
}

/** Mapping qualification comes from the operator's server configuration. */
export function qualifiedCutoverMapping(
  deps: ScopedLotCutoverDeps, workspaceId: string, requested: ManifestMapping,
): ManifestMapping {
  const configured = deps.cutoverMapping;
  if (!configured || configured.workspaceId !== workspaceId || !configured.mapping.destinationsQualified) {
    throw new ScopeError(503, "lot_mapping_unqualified");
  }
  if (digest(requested) !== digest(configured.mapping)) throw new FacetError(409, "lot_mapping_drift");
  return configured.mapping;
}

export function cutoverWorkspaceGuard(deps: ScopedLotCutoverDeps): Hono {
  const guard = new Hono();
  guard.use("/api/v1/workspaces/:workspaceId/lot-facets/cutover*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "Cookie, Authorization");
    await next();
  });
  guard.use("/api/v1/workspaces/:workspaceId/lot-facets/cutover*", async (c, next) => {
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
  return guard;
}

export async function assertModerator(
  db: Database, workspaceId: string, sub: string,
): Promise<void> {
  await approvedAccountId(db, sub, true);
  const access = await resolveWorkspaceAccess(db, workspaceId, sub);
  if (!access.moderateArchive) {
    throw new WorkspaceError(403, "workspace_capability_required");
  }
}

export function scopedLotCutoverRoute(deps: ScopedLotCutoverDeps): Hono {
  const app = new Hono();
  app.route("/", cutoverWorkspaceGuard(deps));

  app.get("/api/v1/workspaces/:workspaceId/lot-facets/cutover", async (c) => {
    const session = c.get("session" as never) as { sub: string };
    try {
      await approvedAccountId(deps.db, session.sub, true);
      await resolveWorkspaceAccess(deps.db, c.req.param("workspaceId"), session.sub);
      const status = await readLotCutover(deps.db, c.req.param("workspaceId"));
      const targets = await readCutoverTargets(deps.db, c.req.param("workspaceId"));
      return c.json({ ok: true, ...status, ...targets });
    } catch (error) {
      return toLotError(c, error);
    }
  });

  app.post("/api/v1/workspaces/:workspaceId/lot-facets/cutover/evaluate", async (c) => {
    const session = c.get("session" as never) as { sub: string };
    try {
      await assertModerator(deps.db, c.req.param("workspaceId"), session.sub);
      const body = evaluateBodySchema.safeParse(
        await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "invalid_facet_command" }, 400);
      assertManifestMapping(body.data.mapping);
      const mapping = qualifiedCutoverMapping(deps, c.req.param("workspaceId"), body.data.mapping);
      const report = await recomputeLotManifest(deps.db, mapping);
      const gate = await evaluateActivationGate(deps.db, c.req.param("workspaceId"), report);
      return c.json({ ok: true, gate });
    } catch (error) {
      return toLotError(c, error);
    }
  });

  return app;
}
