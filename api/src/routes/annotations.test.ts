import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { CanonicalCommandStore, CanonicalHttpPorts } from "@sentropic/comments";
import { annotationsRoute, type AnnotationsDeps } from "./annotations.js";
import { signSession } from "../services/auth/session.js";
import { snapshotResource } from "../services/annotations/host-ports.js";
import { SYNTHETIC_CAPACITY, SYNTHETIC_SCOPE } from "../services/annotations/fixtures.js";

const sessionSecret = "synthetic-secret-with-enough-bytes";
const resource = snapshotResource({ scope: SYNTHETIC_SCOPE, namespace: "immo.graph",
  citySlug: "synthetic-city", kind: "signal", nativeId: "native-id", sourceVersion: "v1" });

function setup(options: Partial<AnnotationsDeps> = {}, includeModule = true, includeCapacity = true) {
  const factory = vi.fn((ports: CanonicalHttpPorts) => {
    // Structural module double: proves the host's wiring, no canonical store or command implementation.
    const router = new Hono();
    router.post("/", async (c) => {
      const { principal } = await c.req.json<{ principal: string }>();
      const allowed = await ports.capabilities.check(principal, "comment", [resource]);
      return c.json({ allowed, resolved: await ports.resolver.resolve(principal, resource) }, allowed ? 200 : 403);
    });
    return router;
  });
  const approvedPrincipal = vi.fn(async () => true);
  const deps: AnnotationsDeps = {
    sessionSecret, approvedPrincipal,
    ...(includeCapacity ? { capacity: SYNTHETIC_CAPACITY } : {}),
    repository: { hasCapability: async () => true, resources: async () => [{ ref: resource,
      sourceVersion: "v1", frozenDigest: "a".repeat(64), currentDigest: "a".repeat(64), available: true }] },
    ...(includeModule ? { module: { createCanonicalCommentsRouter: factory,
      store: {} as CanonicalCommandStore } } : {}),
    ...options,
  };
  return { app: new Hono().route("/api/v1/annotations", annotationsRoute(deps)), factory, approvedPrincipal };
}

async function cookie(sub: string) {
  return `radar_session=${await signSession({ sub }, { sessionSecret, ttlSeconds: 60 })}`;
}

describe("authenticated canonical module composition", () => {
  it("should refuse open mode and invalid sessions", async () => {
    const open = new Hono().route("/api/v1/annotations", annotationsRoute());
    expect((await open.request("/api/v1/annotations", { method: "POST" })).status).toBe(401);
    const { app } = setup();
    expect((await app.request("/api/v1/annotations", { method: "POST", headers: { cookie: "radar_session=bad" } })).status).toBe(401);
  });

  it("should refuse a valid session whose account has been removed or suspended", async () => {
    const { app } = setup({ approvedPrincipal: async () => false });
    expect((await app.request("/api/v1/annotations", { method: "POST",
      headers: { cookie: await cookie("deleted-account") } })).status).toBe(403);
  });

  it("should expose absent module status only after authentication", async () => {
    const { app } = setup({}, false);
    const response = await app.request("/api/v1/annotations", { method: "POST", headers: { cookie: await cookie("subject-a") } });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("unavailable");
    const missingCapacity = setup({}, true, false);
    expect((await missingCapacity.app.request("/api/v1/annotations", { method: "POST",
      headers: { cookie: await cookie("subject-a") } })).status).toBe(503);
    expect(missingCapacity.factory).not.toHaveBeenCalled();
  });

  it("should bind every port call to each authenticated subject under concurrency", async () => {
    const { app, factory } = setup();
    const headers = { "content-type": "application/json", cookie: await cookie("subject-a") };
    const [permitted, spoofed] = await Promise.all([
      app.request("/api/v1/annotations", { method: "POST", headers, body: JSON.stringify({ principal: "subject-a" }) }),
      app.request("/api/v1/annotations", { method: "POST", headers: { ...headers, cookie: await cookie("subject-b") },
        body: JSON.stringify({ principal: "subject-a" }) }),
    ]);
    expect(permitted.status).toBe(200);
    expect(spoofed.status).toBe(403);
    expect(await spoofed.json()).toEqual({ allowed: false, resolved: "unavailable" });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(expect.anything(), { capacity: SYNTHETIC_CAPACITY });
  });
});
