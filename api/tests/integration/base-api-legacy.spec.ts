import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Database } from "../../src/db/client.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { graphSignalsRoute } from "../../src/routes/graph-signals.js";
import { signalFacetsRoute } from "../../src/routes/signal-facets.js";
import { legacyFenceStatus } from "../../src/services/facets/legacy-retirement.js";

const db = {} as Database;
const store = {} as ObjectStore;

function graph(retirement?: "cutover-closed" | "retired"): Hono {
  const app = new Hono();
  app.route("/", graphSignalsRoute({ db, store, ...(retirement ? { retirement } : {}) }));
  return app;
}

function facets(retirement?: "cutover-closed" | "retired"): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("session" as never, { sub: "user-1" } as never);
    await next();
  });
  app.route("/", signalFacetsRoute({ db, auth: { enabled: true }, ...(retirement ? { retirement } : {}) }));
  return app;
}

describe("base-api legacy retirement fence", () => {
  it("maps retirement state to explicit statuses without a 404", () => {
    expect(legacyFenceStatus(undefined)).toBeNull();
    expect(legacyFenceStatus("serving")).toBeNull();
    expect(legacyFenceStatus("cutover-closed")).toBe(503);
    expect(legacyFenceStatus("retired")).toBe(410);
  });

  it("fences graph-signals city reads with the scoped successor", async () => {
    for (const [state, status, error] of [
      ["cutover-closed", 503, "legacy_cutover_closed"],
      ["retired", 410, "legacy_retired"],
    ] as const) {
      const res = await graph(state).request("/api/graph-signals/some-city");
      expect(res.status).toBe(status);
      const body = await res.json() as { ok: boolean; error: string; successor: string };
      expect(body).toMatchObject({ ok: false, error });
      expect(body.successor).toContain("coherent-city");
      expect(body.successor).toContain("reveal");
      const aggregate = await graph(state).request("/api/graph-signals/by-city");
      expect(aggregate.status).toBe(status);
    }
  });

  it("fences legacy facet writes and reads before validation", async () => {
    const retired = await facets("retired").request("/api/v1/signal-facets/select", { method: "POST" });
    expect(retired.status).toBe(410);
    const retiredBody = await retired.json() as { error: string; successor: string };
    expect(retiredBody).toMatchObject({ error: "legacy_retired" });
    expect(retiredBody.successor).toContain("personal/select");
    const closed = await facets("cutover-closed").request("/api/v1/signal-facets/discard", { method: "POST" });
    expect(closed.status).toBe(503);
    const codes = await facets("retired").request("/api/v1/signal-facets/reason-codes");
    expect(codes.status).toBe(410);
    const cities = await facets("retired").request("/api/v1/signal-facets/cities/some-city");
    expect(cities.status).toBe(410);
  });
});
