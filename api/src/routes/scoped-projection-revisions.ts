/**
 * 6L1 scoped projection-revision routes: authorized staleness detection
 * and coherent city reload.
 * GATED: this router is not mounted in `app.ts` until the protected 6H
 * activation opens the scope. Legacy readers keep serving unchanged
 * behavior; nothing here retires them (6K/6L own that cutover).
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { getSignalNodesForCity } from "../services/graph/graph-store.js";
import {
  buildScopedSignalCards,
  scopedLegacyProjection,
  type ScopedSignalCardDeps,
} from "../services/facets/scoped-signal-cards.js";
import { FacetError, targetFingerprint } from "../services/facets/target.js";
import { ScopeError } from "../services/facets/scope.js";
import { WorkspaceError } from "../services/workspaces/types.js";
import {
  readCoherentProjection,
  readProjectionScope,
} from "../services/facets/projection-revisions.js";
import { readScopedPersonalHeads } from "../services/facets/scoped-reader.js";
import { readWorkspaceArchiveCity } from "../services/facets/workspace-reader.js";

const workspaceId = z.string().guid();
const city = z.string().min(1).max(128).regex(/^[a-z0-9-]+$/);
const mode = z.enum(["signal"]);

export interface ScopedProjectionRevisionsDeps extends ScopedSignalCardDeps {
  db: Database;
  auth?: { enabled: boolean };
}

function revisionsOf(scope: { personalRevision: number; workspaceRevision: number;
  sourceRevision: number; sourceDigest: string }) {
  return {
    personal: scope.personalRevision,
    workspace: scope.workspaceRevision,
    source: scope.sourceRevision,
    sourceDigest: scope.sourceDigest,
  };
}

const SCOPED_REVISION_GUARDED = [
  "/api/v1/workspaces/:workspaceId/signal-facets/projection-revisions",
  "/api/v1/workspaces/:workspaceId/signal-facets/coherent-city",
];

export function scopedProjectionRevisionsRoute(deps: ScopedProjectionRevisionsDeps): Hono {
  const app = new Hono();
  for (const path of SCOPED_REVISION_GUARDED) {
    app.use(path, async (c, next) => {
      c.header("Cache-Control", "private, no-store");
      c.header("Vary", "Cookie, Authorization");
      await next();
    });
  }
  for (const path of SCOPED_REVISION_GUARDED) {
    app.use(path, async (c, next) => {
      const session = c.get("session" as never) as { sub?: string; via?: string } | undefined;
      if (!deps.auth?.enabled || !session?.sub) return c.json({ error: "unauthenticated" }, 401);
      if (c.req.method !== "GET" && session.via === "bearer") {
        return c.json({ error: "browser_session_required" }, 403);
      }
      if (!workspaceId.safeParse(c.req.param("workspaceId")).success) {
        return c.json({ error: "invalid_scoped_identity" }, 400);
      }
      return next();
    });
  }
  app.get("/api/v1/workspaces/:workspaceId/signal-facets/projection-revisions", async (c) => {
    const params = z.object({ citySlug: city, mode }).safeParse({
      citySlug: c.req.query("citySlug"), mode: c.req.query("mode"),
    });
    if (!params.success) return c.json({ error: "invalid_scoped_identity" }, 400);
    const session = c.get("session" as never) as { sub: string };
    try {
      const scope = await readProjectionScope(deps.db, session.sub,
        c.req.param("workspaceId"), params.data.citySlug, params.data.mode);
      return c.json({ ok: true, workspaceId: c.req.param("workspaceId"),
        citySlug: params.data.citySlug, mode: params.data.mode,
        token: scope.token, revisions: revisionsOf(scope),
        membership: { revision: scope.membershipRevision,
          moderateArchive: scope.moderateArchive, manageMembers: scope.manageMembers } });
    } catch (error) {
      if (error instanceof WorkspaceError || error instanceof ScopeError) {
        return c.json({ error: error.message }, error.status);
      }
      if (error instanceof FacetError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });
  app.get("/api/v1/workspaces/:workspaceId/signal-facets/coherent-city", async (c) => {
    const params = z.object({ citySlug: city, mode }).safeParse({
      citySlug: c.req.query("citySlug"), mode: c.req.query("mode"),
    });
    if (!params.success) return c.json({ error: "invalid_scoped_identity" }, 400);
    const session = c.get("session" as never) as { sub: string };
    try {
      const coherent = await readCoherentProjection(deps.db, session.sub,
        c.req.param("workspaceId"), params.data.citySlug, params.data.mode,
        async () => ({
          archive: await readWorkspaceArchiveCity(deps.db, session.sub,
            c.req.param("workspaceId"), params.data.citySlug),
          selection: await readScopedPersonalHeads(deps.db, session.sub,
            c.req.param("workspaceId"), params.data.citySlug),
          signals: await getSignalNodesForCity(deps.db, params.data.citySlug),
        }));
      const heads = coherent.payload.archive.map((row) => ({
        target: row.target,
        personal: row.personal,
        workspace: row.workspace,
        effectiveDiscarded: row.effectiveDiscarded,
        capabilities: row.capabilities,
      }));
      const key = (row: { type: string; id: string }) => JSON.stringify([row.type, row.id]);
      const hiddenKeys = new Set(heads.filter((head) => head.effectiveDiscarded)
        .map((head) => key(head.target)));
      // Each served node carries the displayed fingerprint computed exactly
      // like the 6B contract, so the snapshot supports a follow-up command,
      // plus the server card fields derived from that same stored node
      // (classification, evidence) so the UI never reclassifies.
      const visibleNodes = coherent.payload.signals.filter((node) => !hiddenKeys.has(key(node)));
      const cards = await buildScopedSignalCards(deps, visibleNodes, params.data.citySlug);
      const signals = visibleNodes.map((node, index) => ({
        ...cards[index]!,
        id: node.id, type: node.type, citySlug: node.citySlug, label: node.label,
        props: node.props, sourceRef: node.sourceRef,
        facetFingerprint: targetFingerprint(node),
      }));
      const legacyProjection = scopedLegacyProjection(cards);
      const total = coherent.payload.signals.length;
      const hidden = total - signals.length;
      const selection = coherent.payload.selection.filter((head) => head.facet === "selection");
      const selected = selection.filter((head) => head.state === "active").length;
      return c.json({ ok: true, workspaceId: c.req.param("workspaceId"),
        citySlug: params.data.citySlug, mode: params.data.mode,
        token: coherent.scope.token, revisions: revisionsOf(coherent.scope),
        heads, selection, signals, legacyProjection,
        counts: { total, hidden, visible: signals.length, selected } });
    } catch (error) {
      if (error instanceof WorkspaceError || error instanceof ScopeError) {
        return c.json({ error: error.message }, error.status);
      }
      if (error instanceof FacetError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });
  return app;
}
