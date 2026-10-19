import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, expect, it } from "vitest";
import { createDb } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { accountUsers } from "../../src/db/schema.js";
import { facetFixture } from "./facets-fixture.js";
import { facetCookie, facetHttp, facetAuth } from "./facets-http-fixture.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());
it("should enforce browser identity, strict commands and domain errors", async () => {
  const { sub, target } = await facetFixture(db);
  const app = facetHttp(db);
  const cookie = await facetCookie(sub);
  const post = (action: string, body: unknown, key: string | null = randomUUID(), session = cookie) =>
    app.request(`/api/v1/signal-facets/${action}`, { method: "POST", body: JSON.stringify(body),
      headers: { "content-type": "application/json", cookie: session, ...(key ? { "Idempotency-Key": key } : {}) } });
  const body = { target, basket: "pertinent" };
  expect((await post("select", body, null)).status).toBe(400);
  expect((await post("select", body, "invalid")).status).toBe(400);
  expect((await post("select", { ...body, target: { ...target, id: `native${String.fromCharCode(0)}id` } })).status).toBe(400);
  for (const extra of [{ actor: sub }, { ownerId: sub }, { scope: "personal" }, { target: { ...target, actor: sub } }]) {
    expect((await post("select", { ...body, ...extra })).status).toBe(400);
  }
  expect((await post("select", body, randomUUID(), "")).status).toBe(401);
  expect((await app.request("/api/v1/signal-facets/select", { method: "POST", headers: { accept: "text/html" } })).status).toBe(401);
  expect((await post("select", { ...body, target: { ...target, id: "missing" } })).status).toBe(404);
  for (const reasonCode of [undefined, "UNKNOWN", "P-DENSITE"]) {
    expect((await post("discard", { target, reasonCode })).status).toBe(422);
  }
  const key = randomUUID();
  const first = await post("select", body, key);
  expect(first.status).toBe(200);
  expect(await (await post("select", body, key)).json()).toEqual(await first.json());
  expect((await post("select", { ...body, reasonCode: "P-DENSITE" }, key)).status).toBe(409);
  expect((await post("deselect", body)).status).toBe(200);
  expect((await post("discard", { target, reasonCode: "N-ADMIN" })).status).toBe(200);
  expect((await post("restore", { target })).status).toBe(200);
  await db.update(accountUsers).set({ status: "suspended" }).where(eq(accountUsers.sub, sub));
  expect((await post("select", body)).status).toBe(403);
  const open = facetHttp(db, { ...facetAuth, enabled: false });
  expect((await open.request("/api/v1/signal-facets/select", { method: "POST" })).status).toBe(401);
});
it("should reject writes authenticated by a verified per-user bearer", async () => {
  const { sub, target } = await facetFixture(db);
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "facet-test-key", alg: "RS256" };
  const bearer = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer(facetAuth.issuer).setAudience(facetAuth.bearerAudiences[0]!)
    .setSubject(sub).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const app = facetHttp(db, facetAuth, createLocalJWKSet({ keys: [jwk] }));
  for (const action of ["select", "deselect", "discard", "restore"]) {
    const response = await app.request(`/api/v1/signal-facets/${action}`, { method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ target, basket: "pertinent" }) });
    expect(response.status).toBe(403);
  }
});
