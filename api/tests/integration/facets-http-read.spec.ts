import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { createDb } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { accountUsers, graphNodes } from "../../src/db/schema.js";
import { writeFacet } from "../../src/services/facets/writer.js";
import { facetFixture } from "./facets-fixture.js";
import { facetCookie, facetHttp } from "./facets-http-fixture.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());
it("should read the runtime codebook and isolate personal heads and availability", async () => {
  const alice = await facetFixture(db);
  const bob = await facetFixture(db);
  const app = facetHttp(db);
  const cookie = await facetCookie(alice.sub);
  const cityPath = `/api/v1/signal-facets/cities/${alice.target.citySlug}`;
  const get = (path: string, session = cookie) => app.request(path, { headers: { cookie: session } });
  expect((await get(cityPath, "")).status).toBe(401);
  expect((await get(`${cityPath}?scope=personal`)).status).toBe(400);
  const codeResponse = await get("/api/v1/signal-facets/reason-codes");
  expect(codeResponse.headers.get("cache-control")).toBe("private, no-store");
  expect(codeResponse.headers.get("vary")).toBe("Cookie, Authorization");
  const codes = await codeResponse.json();
  expect(codes.profileId).toBe("immo-steve-2026-09");
  expect(codes.codes).toHaveLength(28);
  expect(codes.codes.find((row: { code: string }) => row.code === "V2-PRECEDENT").verdict).toBe("non_pertinent");
  await writeFacet(db, alice.sub, { action: "discard", target: alice.target, reasonCode: "N-ADMIN", commandKey: randomUUID() });
  expect((await (await get(cityPath)).json()).heads).toEqual([{
    id: expect.any(String), target: alice.target, facet: "archive", basket: null, state: "active",
    reasonCode: "N-ADMIN", verdict: "non_pertinent", createdAt: expect.any(String),
    targetAvailable: true, changedSinceArchive: false,
  }]);
  expect((await (await get(cityPath, await facetCookie(bob.sub))).json()).heads).toEqual([]);
  await db.update(graphNodes).set({ label: "Changed synthetic content" }).where(eq(graphNodes.citySlug, alice.target.citySlug));
  expect((await (await get(cityPath)).json()).heads).toMatchObject([{ targetAvailable: true, changedSinceArchive: true }]);
  await db.delete(graphNodes).where(eq(graphNodes.citySlug, alice.target.citySlug));
  expect((await (await get(cityPath)).json()).heads).toMatchObject([{ targetAvailable: false, changedSinceArchive: null }]);
  await db.update(accountUsers).set({ status: "suspended" }).where(eq(accountUsers.sub, alice.sub));
  expect((await get(cityPath)).status).toBe(403);
  expect((await get("/api/v1/signal-facets/reason-codes")).status).toBe(403);
});
