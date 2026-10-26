import { expect, it } from "vitest";
import { Hono } from "hono";
import { mintPageWriteGrant, resolveWritePage, type PageWriteAuthority,
  type PageWriteAuthorityDeps } from "./write-intent-page-authority.js";
import { writeIntentError } from "./write-intent-errors.js";

const page = { grant: { issuer: "https://h5.test", audience: "radar-artifact-write",
  identityIssuer: "https://auth.test", tier: "preprod", sessionId: "page" },
  pageInstanceId: "instance", pageExpiresAtMs: 5000, delegationExpiresAtMs: 6000,
  authorityReferences: {} } as PageWriteAuthority;
const deps = { grantKeyId: "key", grantIssuer: page.grant,
  resolvePage: async () => page } as unknown as PageWriteAuthorityDeps;

it("should distinguish authenticated P expiry from missing page authority", async () => {
  const app = new Hono();
  app.get("/", async (c) => {
    try { await resolveWritePage(c, deps, () => 5000); return c.json({ unexpected: true }); }
    catch (error) { return writeIntentError(c, error); }
  });
  const response = await app.request("/");
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: {
    code: "page_session_expired", action: "authenticate", attemptOutcome: "not_executed" } });
  const missing = { ...deps, resolvePage: async () => null };
  await expect(mintPageWriteGrant(null as never, missing, 5000))
    .rejects.toMatchObject({ status: 403, message: "write_grant_required" });
});

it("should preserve delegation expiry and reject mismatched P before exposing expiry", async () => {
  await expect(mintPageWriteGrant({ ...page, pageExpiresAtMs: 7000 }, deps, 6000))
    .rejects.toMatchObject({ status: 401, message: "write_grant_expired" });
  await expect(mintPageWriteGrant({ ...page, grant: { ...page.grant, tier: "prod" } }, deps, 6000))
    .rejects.toMatchObject({ status: 403, message: "write_grant_required" });
});
