import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Database } from "../../src/db/client.js";
import { workspacesRoute } from "../../src/routes/workspaces.js";
import { scopedSignalFacetsRoute } from "../../src/routes/scoped-signal-facets.js";
import { scopedWorkspaceArchiveRoute } from "../../src/routes/scoped-workspace-archive.js";
import { scopedProjectionRevisionsRoute } from "../../src/routes/scoped-projection-revisions.js";
import { scopedProjectionEventsRoute } from "../../src/routes/scoped-projection-events.js";

type Session = { sub: string; via?: string } | null;

const db = {} as Database;
const auth = { enabled: true };
const INVALID_WORKSPACE = "not-a-uuid";

function mount(
  session: Session,
  order: Array<"facets" | "archive" | "revisions" | "events" | "workspaces">,
): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("session" as never, session as never);
    await next();
  });
  const routers = {
    facets: () => scopedSignalFacetsRoute({ db, auth }),
    archive: () => scopedWorkspaceArchiveRoute({ db, auth }),
    revisions: () => scopedProjectionRevisionsRoute({ db, auth }),
    events: () => scopedProjectionEventsRoute({ db, auth }),
    workspaces: () => workspacesRoute({ db, auth }),
  };
  for (const key of order) app.route("/", routers[key]());
  return app;
}

const bearer: Session = { sub: "user-1", via: "bearer" };

describe("base-api scoped middleware isolation", () => {
  it("rejects bearer SSE reads while preserving bearer sibling reads", async () => {
    const permissiveFirst = mount(bearer, ["facets", "archive", "revisions", "events", "workspaces"]);
    const events = await permissiveFirst.request(
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/projection-events?citySlug=c&mode=signal`,
    );
    expect(events.status).toBe(403);
    expect(await events.json()).toMatchObject({ error: "browser_session_required" });
    const restrictiveFirst = mount(bearer, ["events", "facets"]);
    const facets = await restrictiveFirst.request(
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/personal/cities/c`,
    );
    expect(facets.status).toBe(400);
    expect(await facets.json()).toMatchObject({ error: "invalid_scoped_identity" });
  });

  it("keeps session-only writes and private headers on every family", async () => {
    const app = mount(bearer, ["facets", "archive", "revisions", "events", "workspaces"]);
    const write = await app.request(
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/personal/select`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    expect(write.status).toBe(403);
    const anonymous = mount(null, ["facets", "archive", "revisions", "events", "workspaces"]);
    for (const path of [
      "/api/v1/workspaces",
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/personal/cities/c`,
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/archive/cities/c`,
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/projection-revisions?citySlug=c&mode=signal`,
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/projection-events?citySlug=c&mode=signal`,
    ]) {
      const res = await anonymous.request(path);
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("vary")).toBe("Cookie, Authorization");
    }
  });
});
