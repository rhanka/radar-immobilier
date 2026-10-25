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
import type {
  ActivationGate,
  CutoverSafety,
} from "../services/facets/lots/lot-cutover-types.js";
import type { LotMigrationReport } from "../services/facets/lot-migration-report/manifest.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../services/workspaces/store.js";
import { WorkspaceError } from "../services/workspaces/types.js";
import { ScopeError } from "../services/facets/scope.js";
import { readLotCutoverServerConfig } from "../services/facets/lots/lot-cutover-config.js";
import { qualifiedCutoverSafetyForRequest } from "../services/facets/lots/lot-cutover-safety.js";
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
  /**
   * Per-request safety factory. When present the entry route builds the
   * adapter from the current workspace, actor and qualified manifest
   * around server-held evidence; a static `cutoverSafety` is never
   * rebuilt and stays subject to the binding check below.
   */
  cutoverSafetyFor?: CutoverSafetyFactory;
  cutoverMapping?: { workspaceId: string; mapping: ManifestMapping };
}

/** Per-request 6K safety input: current workspace, actor and qualified manifest. */
export interface CutoverSafetyRequest {
  workspaceId: string;
  actorSub: string;
  report: LotMigrationReport;
  gate: ActivationGate;
}

export type CutoverSafetyFactory = (request: CutoverSafetyRequest) => CutoverSafety;

/** Reached by createApp/index.ts without changing shared startup ownership. */
export function configuredCutoverDeps(deps: ScopedLotCutoverDeps): ScopedLotCutoverDeps {
  if (deps.cutoverMapping || deps.cutoverSafety || deps.cutoverSafetyFor) return deps;
  const config = readLotCutoverServerConfig();
  if (!config) return deps;
  return { ...deps, cutoverMapping: { workspaceId: config.workspaceId, mapping: config.mapping },
    cutoverSafetyFor: (request) => qualifiedCutoverSafetyForRequest(deps.db, {
      evidence: config.maintenance.evidence,
      maintenanceAttemptId: config.maintenance.maintenanceAttemptId,
      releaseId: config.maintenance.releaseId,
      instanceIds: config.maintenance.instanceIds,
      options: {
        ...(config.maintenance.options?.qualifiedEmptyManifest !== undefined
          ? { qualifiedEmptyManifest: config.maintenance.options.qualifiedEmptyManifest } : {}),
        ...(config.maintenance.options?.emptyReadbackScope
          ? { emptyReadbackScope: config.maintenance.options.emptyReadbackScope } : {}),
      },
    }, request) };
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

/**
 * Refuse the reuse of a bound adapter under another request identity. An
 * adapter qualified for one actor never authorizes a different moderator,
 * even when the runner would authorize that moderator on its own rights.
 */
export function assertCutoverSafetyBinding(
  safety: CutoverSafety, workspaceId: string, actorSub: string,
): void {
  const binding = safety.safetyBinding;
  if (!binding) return;
  if (binding.workspaceId.toLowerCase() !== workspaceId.toLowerCase()) {
    throw new ScopeError(403, "maintenance_evidence_workspace_mismatch");
  }
  if (binding.actorSub !== actorSub) {
    throw new ScopeError(403, "maintenance_evidence_actor_mismatch");
  }
}

export function scopedLotCutoverRoute(deps: ScopedLotCutoverDeps): Hono {
  deps = configuredCutoverDeps(deps);
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
