/**
 * 6G workspace routes: list the caller's workspaces and manage memberships.
 * Membership changes require a browser session holding the management
 * capability. These routes stay unmounted from `app.ts` until 6H activates
 * workspace scope; existing reads and writes are untouched.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { privateSignalResponse } from "../services/facets/private-response.js";
import { applyMembershipCommand } from "../services/workspaces/membership-command.js";
import { listWorkspacesForAccount } from "../services/workspaces/store.js";
import {
  WorkspaceError,
  WorkspaceRevisionConflictError,
} from "../services/workspaces/types.js";

const uuid = z.string().uuid();
const membershipBody = z.object({
  accountId: uuid,
  status: z.enum(["active", "revoked"]).optional(),
  moderateArchive: z.boolean().optional(),
  manageMembers: z.boolean().optional(),
  expectedRevision: z.number().int().min(1).nullish(),
}).strict().refine((body) => body.status !== "revoked"
  || (body.moderateArchive === undefined && body.manageMembers === undefined));

export interface WorkspacesRouteDeps {
  db: Database;
  auth?: { enabled: boolean };
}

export function workspacesRoute(deps: WorkspacesRouteDeps): Hono {
  const app = new Hono();
  app.use("/api/v1/workspaces/*", privateSignalResponse);
  app.use("/api/v1/workspaces/*", async (c, next) => {
    const session = c.get("session" as never) as { sub?: string; via?: string } | undefined;
    if (!deps.auth?.enabled || !session?.sub) return c.json({ error: "unauthenticated" }, 401);
    if (c.req.method !== "GET" && session.via === "bearer") {
      return c.json({ error: "browser_session_required" }, 403);
    }
    return next();
  });
  app.get("/api/v1/workspaces", async (c) => {
    const session = c.get("session" as never) as { sub: string };
    try {
      const items = await listWorkspacesForAccount(deps.db, session.sub);
      return c.json({ ok: true, workspaces: items });
    } catch (error) {
      if (error instanceof WorkspaceError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });
  app.post("/api/v1/workspaces/:workspaceId/memberships", async (c) => {
    const session = c.get("session" as never) as { sub: string };
    const workspaceId = c.req.param("workspaceId");
    if (!z.string().uuid().safeParse(workspaceId).success) {
      return c.json({ error: "invalid_workspace_command" }, 400);
    }
    const body = membershipBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_workspace_command" }, 400);
    const { accountId, status, moderateArchive, manageMembers, expectedRevision } = body.data;
    try {
      const record = await applyMembershipCommand(deps.db, {
        workspaceId, targetAccountId: accountId, actorSub: session.sub,
        reason: status === "revoked" ? "manager revocation" : "manager grant",
        expectedRevision,
        ...(status === undefined ? {} : { status }),
        ...(moderateArchive === undefined ? {} : { moderateArchive }),
        ...(manageMembers === undefined ? {} : { manageMembers }),
      });
      return c.json({ ok: true, membership: record });
    } catch (error) {
      if (error instanceof WorkspaceRevisionConflictError) {
        return c.json({ error: error.message, current: error.current }, error.status);
      }
      if (error instanceof WorkspaceError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });
  return app;
}
