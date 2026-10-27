import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { classificationFixture } from "./classification-fixture.js";
import { discoverFacetContext } from "../../src/services/facets/classification-discovery.js";
import { FacetContextResponse } from "../../src/services/facets/classification-context-contract.js";

describeDb("classification context authority", () => {
  it("should expose signal availability separately from closed lots and nullable labels", async () => {
    const f = await classificationFixture();
    const response = await f.request("facet-context");
    expect(response.status).toBe(200);
    const body = FacetContextResponse.parse(await response.json());
    expect(body.context.signals.availability).toEqual({ state: "open" });
    expect(body.context.lots.availability).toEqual({ state: "closed", reason: "not_configured" });
    expect(body.context.signals.canModerateArchive).toBe(false);
    expect(body.context.reasonCatalog.entries?.length).toBeGreaterThan(0);
    expect(body.context.reasonCatalog.entries?.every((entry) => entry.label === null)).toBe(true);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
    expect(f.head).not.toHaveBeenCalled();
    expect((await f.app.request("/", { headers: { cookie: await (await import("./base-api-fixture.js")).baseCookie(f.data.contributor.sub) } })).status).toBe(200);
  });
  it("should reject missing membership, unknown workspaces and unapproved accounts without data", async () => {
    const f = await classificationFixture();
    for (const [sub, id] of [[f.data.outsider.sub, f.data.workspaceId], [f.data.contributor.sub, randomUUID()]]) {
      const response = await f.request("facet-context", sub, id);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("workspace_not_authorized");
    }
    await f.data.pool.query("UPDATE account_users SET status='pending' WHERE id=$1", [f.data.contributor.id]);
    const response = await f.request("facet-context");
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("account_not_approved");
    const anonymous = await f.app.request(`/api/v1/workspaces/${f.data.workspaceId}/facet-context`);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ ok: false, error: { code: "unauthenticated", action: "authenticate" } });
    expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
  });
  it("should discover zero, one or many memberships without selecting the first", async () => {
    const f = await classificationFixture();
    const many = await discoverFacetContext(f.data.db, f.data.contributor.sub, "h5");
    expect(many.workspaces).toHaveLength(2);
    expect(many.selectedWorkspace).toBeNull();
    expect(many.operations).toEqual([]);
    await f.data.pool.query("UPDATE workspace_memberships SET status='revoked',revoked_at=now() WHERE account_id=$1 AND workspace_id=$2", [f.data.contributor.id, f.data.otherId]);
    expect((await discoverFacetContext(f.data.db, f.data.contributor.sub, "h5")).selectedWorkspace?.workspaceId).toBe(f.data.workspaceId);
    await f.data.pool.query("UPDATE workspace_memberships SET status='revoked',revoked_at=now() WHERE account_id=$1", [f.data.contributor.id]);
    expect(await discoverFacetContext(f.data.db, f.data.contributor.sub, "h5")).toMatchObject({ workspaces: [], selectedWorkspace: null, operations: [] });
  });
  it("should expose durable closure without opening the epoch or reading heads", async () => {
    const f = await classificationFixture();
    await f.data.pool.query("UPDATE facet_activation_state SET maintenance_barrier=true WHERE workspace_id=$1", [f.data.workspaceId]);
    const body = await (await f.request("facet-context")).json();
    expect(body.context.signals.availability).toEqual({ state: "closed", reason: "maintenance" });
    expect(body.context.reasonCatalog).toEqual({ availability: { state: "closed", reason: "maintenance" }, profileId: null, digest: null, entries: null });
    for (const query of ["?unknown=1", "?a=1&a=2", "?__proto__=x", "?__proto__=a&__proto__=b"]) {
      const response = await f.request(`facet-context${query}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false, error: { code: "invalid_query" } });
    }
  });
  it("should return a typed JSON unauthenticated refusal for browser navigations on read routes", async () => {
    const f = await classificationFixture();
    const paths = ["facet-context", "signal-facets/search?citySlug=synthetic-city",
      `signal-facets/state?citySlug=synthetic-city&type=Signal&id=${f.signal.target.id}`];
    for (const suffix of paths) {
      const response = await f.app.request(`/api/v1/workspaces/${f.data.workspaceId}/${suffix}`,
        { headers: { accept: "text/html" } });
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toMatchObject({ ok: false, error: { code: "unauthenticated", action: "authenticate" } });
      expect(typeof body.requestId).toBe("string");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });
});
