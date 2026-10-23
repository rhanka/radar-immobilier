import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { startComposedBase } from "./base-api-fixture.js";

describeDb("base-api composed composition", () => {
  it("serves health and legacy signal reads through createApp", async () => {
    const { app, data, cookie } = await startComposedBase();
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    const unauthenticated = await app.request("/api/v1/signal-facets/cities/synthetic-city");
    expect(unauthenticated.status).toBe(401);
    const sessionCookie = await cookie(data.member.sub);
    const cities = await app.request("/api/v1/signal-facets/cities/synthetic-city", {
      headers: { cookie: sessionCookie },
    });
    expect(cities.status).toBe(200);
    expect(cities.headers.get("cache-control")).toBe("private, no-store");
    expect(cities.headers.get("vary")).toBe("Cookie, Authorization");
    expect(await cities.json()).toEqual({ ok: true, heads: [] });
  });

  it("keeps mounted scoped reads closed before activation", async () => {
    const { app, data, cookie } = await startComposedBase();
    const sessionCookie = await cookie(data.member.sub);
    const scoped = await app.request(
      `/api/v1/workspaces/${data.workspaceId}/signal-facets/personal/cities/synthetic-city`,
      { headers: { cookie: sessionCookie } },
    );
    expect(scoped.status).toBe(503);
  });

  it("keeps artifact configuration absent", async () => {
    const { app } = await startComposedBase();
    const scoped = await app.request("/api/v1/artifacts/control/meta?artifactId=x");
    expect([401, 403, 404, 503]).toContain(scoped.status);
  });
});
