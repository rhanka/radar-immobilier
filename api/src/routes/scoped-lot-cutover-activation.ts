/**
 * 6K cutover activation routes: explicit D5 dispositions and the
 * protected activation run.
 *
 * Both endpoints require a moderator browser session; activation
 * additionally requires an explicit confirmation and never runs at
 * deployment. The server recomputes the 6F manifest from live source
 * rows; no client-supplied manifest is trusted.
 */
import { Hono } from "hono";
import { z } from "zod";
import {
  cutoverImportKeyFor,
  defaultCutoverSafety,
  evaluateActivationGate,
  recordD5Dispositions,
  runLotCutover,
} from "../services/facets/lots/lot-cutover.js";
import {
  assertManifestMapping,
  recomputeLotManifest,
} from "../services/facets/lots/lot-manifest-refresh.js";
import { toLotError } from "./scoped-lot-facets-common.js";
import {
  assertCutoverSafetyBinding,
  configuredCutoverDeps,
  assertModerator,
  cutoverWorkspaceGuard,
  qualifiedCutoverMapping,
  type ScopedLotCutoverDeps,
} from "./scoped-lot-cutover.js";

const decisionSchema = z.object({
  targetKey: z.string().min(1).max(512),
  decision: z.enum(["activate", "keep-pending"]),
  sourceId: z.string().min(1).max(512).optional(),
  reason: z.string().min(1).max(1024),
}).strict();

export const dispositionsBodySchema = z.object({
  manifestSha: z.string().length(64).regex(/^[a-f0-9]{64}$/),
  decisions: z.array(decisionSchema).min(1).max(200),
}).strict();

const cutoverBodySchema = z.object({
  mapping: z.object({
    mappingVersion: z.string().min(1).max(256),
    importerVersion: z.string().min(1).max(256),
    destinationsQualified: z.boolean(),
  }).strict(),
  confirmCutover: z.boolean(),
}).strict();

export function scopedLotCutoverActivationRoute(deps: ScopedLotCutoverDeps): Hono {
  deps = configuredCutoverDeps(deps);
  const app = new Hono();
  app.route("/", cutoverWorkspaceGuard(deps));

  app.post("/api/v1/workspaces/:workspaceId/lot-facets/cutover/d5-dispositions", async (c) => {
    const session = c.get("session" as never) as { sub: string };
    try {
      await assertModerator(deps.db, c.req.param("workspaceId"), session.sub);
      const body = dispositionsBodySchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "invalid_facet_command" }, 400);
      const recorded = await recordD5Dispositions(deps.db, {
        workspaceId: c.req.param("workspaceId"), actorSub: session.sub,
        manifestSha: body.data.manifestSha, decisions: body.data.decisions,
      });
      return c.json({ ok: true, ...recorded });
    } catch (error) {
      return toLotError(c, error);
    }
  });

  app.post("/api/v1/workspaces/:workspaceId/lot-facets/cutover", async (c) => {
    const session = c.get("session" as never) as { sub: string };
    try {
      await assertModerator(deps.db, c.req.param("workspaceId"), session.sub);
      const body = cutoverBodySchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "invalid_facet_command" }, 400);
      assertManifestMapping(body.data.mapping);
      const mapping = qualifiedCutoverMapping(deps, c.req.param("workspaceId"), body.data.mapping);
      const report = await recomputeLotManifest(deps.db, mapping);
      const gate = await evaluateActivationGate(deps.db, c.req.param("workspaceId"), report);
      const safety = deps.cutoverSafetyFor
        ? deps.cutoverSafetyFor({ workspaceId: c.req.param("workspaceId"),
          actorSub: session.sub, report, gate })
        : (deps.cutoverSafety ?? defaultCutoverSafety(deps.db, session.sub, gate.ready));
      assertCutoverSafetyBinding(safety, c.req.param("workspaceId"), session.sub);
      const receipt = await runLotCutover(deps.db, {
        workspaceId: c.req.param("workspaceId"), actorSub: session.sub, report,
        importKey: cutoverImportKeyFor(c.req.param("workspaceId")),
        confirmCutover: body.data.confirmCutover,
        recomputeManifest: () => recomputeLotManifest(deps.db, mapping),
      }, safety);
      return c.json({ ok: true, receipt });
    } catch (error) {
      return toLotError(c, error);
    }
  });

  return app;
}
