import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Database } from "../../src/db/client.js";
import { scopedSignalRevealRoute } from "../../src/routes/scoped-signal-reveal.js";

type Session = { sub: string; via?: string } | null;

const db = {} as Database;
const INVALID_WORKSPACE = "not-a-uuid";
const VALID_WORKSPACE = "123e4567-e89b-12d3-a456-426614174000";

function mount(session: Session): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("session" as never, session as never);
    await next();
  });
  app.route("/", scopedSignalRevealRoute({ db, auth: { enabled: true } }));
  return app;
}

describe("base-api scoped reason codes", () => {
  it("guards the scoped catalog without legacy readers", async () => {
    const anonymous = mount(null);
    const denied = await anonymous.request(
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/reason-codes`,
    );
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect(denied.headers.get("vary")).toBe("Cookie, Authorization");
    const bearer = mount({ sub: "user-1", via: "bearer" });
    const invalid = await bearer.request(
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/reason-codes`,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_scoped_identity" });
  });

  it("guards the reveal read without restoring anything", async () => {
    const anonymous = mount(null);
    const denied = await anonymous.request(
      `/api/v1/workspaces/${VALID_WORKSPACE}/signal-facets/reveal?citySlug=c&type=Signal&id=x`,
    );
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    const reader = mount({ sub: "user-1", via: "bearer" });
    const invalidQuery = await reader.request(
      `/api/v1/workspaces/${VALID_WORKSPACE}/signal-facets/reveal?citySlug=c&type=Signal`,
    );
    expect(invalidQuery.status).toBe(400);
    expect(await invalidQuery.json()).toMatchObject({ error: "invalid_scoped_identity" });
    const invalidWorkspace = await reader.request(
      `/api/v1/workspaces/${INVALID_WORKSPACE}/signal-facets/reveal?citySlug=c&type=Signal&id=x`,
    );
    expect(invalidWorkspace.status).toBe(400);
  });
});
