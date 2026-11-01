import { describe, expect, it, vi } from "vitest";
import type { ArtifactDeleteConfirmation } from "@radar/artifacts-host";
import { controlRoute } from "../../../api/src/artifacts/control-route.js";
import { signSession, SESSION_COOKIE_NAME } from "../../../api/src/services/auth/session.js";
import type { AuthConfig } from "../../../api/src/config.js";

const ID = "123e4567-e89b-12d3-a456-426614174000";
const origin = "https://app.test";
const secret = "p0b-unit-test-session-secret-only";
async function setup() {
  const approve = vi.fn(async (_ref: string, actor: string) => actor === "alice");
  const read = vi.fn(async () => ({ artifactId: ID, expectedCurrentReleaseId: null,
    expiresAt: "2099-01-01T00:00:00Z", approved: false, consumed: false }));
  const app = controlRoute({ auth: { enabled: true, appBaseUrl: origin, sessionSecret: secret } as AuthConfig,
    accounts: { query: async () => ({ rows: [{ status: "approved" }] }) },
    backend: { handle: async () => ({ status: 200, body: {} }) },
    confirmation: { read, approve } as unknown as ArtifactDeleteConfirmation });
  const token = await signSession({ sub: "alice" }, { sessionSecret: secret, ttlSeconds: 60 });
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}`, origin, "content-type": "application/x-www-form-urlencoded" };
  const path = `/delete-confirmations/${ID}`;
  return { app, path, headers, read, approve };
}

describe("trusted deletion approval route", () => {
  it("should display the target and require a separate explicit action", async () => {
    const h = await setup();
    const page = await h.app.request(h.path, { headers: h.headers });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Confirm permanent deletion");
    expect(page.headers.get("cache-control")).toContain("no-store");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(h.approve).not.toHaveBeenCalled();
    const approved = await h.app.request(h.path, { method: "POST", headers: h.headers, body: "confirm=delete" });
    expect(approved.status).toBe(200);
    expect(h.approve).toHaveBeenCalledExactlyOnceWith(ID, "alice");
  });

  it("should refuse bearer calls, missing cookies, cross-origin requests and implicit approvals", async () => {
    const h = await setup();
    const attempts = [
      { ...h.headers, authorization: "Bearer synthetic" },
      { origin, "content-type": "application/x-www-form-urlencoded" },
      { ...h.headers, origin: "https://attacker.test" },
    ];
    for (const headers of attempts) {
      expect((await h.app.request(h.path, { method: "POST", headers, body: "confirm=delete" })).status).toBeGreaterThanOrEqual(400);
    }
    expect((await h.app.request(h.path, { method: "POST", headers: h.headers, body: "" })).status).toBe(400);
    expect(h.approve).not.toHaveBeenCalled();
  });
});
